import { describe, expect, test } from "bun:test";
import { chmod, lstat, mkdir, mkdtemp, readdir, readlink, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashFolder } from "../src/hash.ts";
import {
	dematerializeSkill,
	materializeSkill,
	repairLinks,
	type Placement,
} from "../src/materialize.ts";

async function makeDir(files: Record<string, string>): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "gent-mat-"));
	for (const [rel, content] of Object.entries(files)) {
		await mkdir(join(dir, rel, ".."), { recursive: true });
		await Bun.write(join(dir, rel), content);
	}
	return dir;
}

async function freshDir(): Promise<string> {
	return await mkdtemp(join(tmpdir(), "gent-mat-"));
}

async function exists(path: string): Promise<boolean> {
	try {
		await lstat(path);
		return true;
	} catch {
		return false;
	}
}

const SKILL = { "SKILL.md": "---\nname: x\n---\n", "assets/a.txt": "aaa" };

async function makePlacement(holdoutCount = 2): Promise<Placement> {
	const storeRoot = await freshDir();
	const holdoutDirs = await Promise.all(
		Array.from({ length: holdoutCount }, () => freshDir()),
	);
	return { storeRoot, holdoutDirs };
}

describe("materializeSkill", () => {
	test("writes a byte-identical store entry and symlinks each holdout dir absolutely", async () => {
		const srcDir = await makeDir(SKILL);
		const placement = await makePlacement(2);

		const report = await materializeSkill({ name: "x", srcDir, placement });

		const storeDir = join(placement.storeRoot, "x");
		expect(report.store).toBe(storeDir);
		expect(await hashFolder(storeDir)).toBe(await hashFolder(srcDir));
		expect(report.conflicts).toEqual([]);
		expect(report.linked.sort()).toEqual(
			placement.holdoutDirs.map((d) => join(d, "x")).sort(),
		);

		for (const holdoutDir of placement.holdoutDirs) {
			const linkPath = join(holdoutDir, "x");
			const st = await lstat(linkPath);
			expect(st.isSymbolicLink()).toBe(true);
			const target = await readlink(linkPath);
			expect(target).toBe(storeDir);
			expect(target.startsWith("/")).toBe(true);
		}
	});

	test("rejects a source tree containing a symlink", async () => {
		const srcDir = await makeDir(SKILL);
		const outside = await makeDir({ secret: "outside bytes" });
		await symlink(join(outside, "secret"), join(srcDir, "secret-link"));
		const placement = await makePlacement(1);

		await expect(
			materializeSkill({ name: "x", srcDir, placement }),
		).rejects.toThrow("symlinks are not allowed");
	});

	test("preserves the executable bit on copied files", async () => {
		const srcDir = await makeDir(SKILL);
		await Bun.write(join(srcDir, "run.sh"), "#!/bin/sh\necho hi\n");
		await chmod(join(srcDir, "run.sh"), 0o755);
		const placement = await makePlacement(1);

		const report = await materializeSkill({ name: "x", srcDir, placement });

		const st = await lstat(join(report.store, "run.sh"));
		expect(st.mode & 0o777).toBe(0o755);
	});

	test("re-materializing replaces store content atomically with no .tmp- residue", async () => {
		const srcDir = await makeDir(SKILL);
		const placement = await makePlacement(1);
		await materializeSkill({ name: "x", srcDir, placement });

		await Bun.write(join(srcDir, "assets", "a.txt"), "changed");
		const report = await materializeSkill({ name: "x", srcDir, placement });

		expect(await Bun.file(join(report.store, "assets", "a.txt")).text()).toBe("changed");
		expect(await hashFolder(report.store)).toBe(await hashFolder(srcDir));

		const entries = await readdir(placement.storeRoot);
		expect(entries.some((e) => e.startsWith(".tmp-"))).toBe(false);
	});

	test("matching expectHash succeeds", async () => {
		const srcDir = await makeDir(SKILL);
		const placement = await makePlacement(1);
		const expectHash = await hashFolder(srcDir);

		const report = await materializeSkill({ name: "x", srcDir, placement, expectHash });

		expect(await exists(report.store)).toBe(true);
	});

	test("wrong expectHash throws and leaves no store entry", async () => {
		const srcDir = await makeDir(SKILL);
		const placement = await makePlacement(1);
		const storeDir = join(placement.storeRoot, "x");
		const wrongHash = `sha256:${"0".repeat(64)}`;

		await expect(
			materializeSkill({ name: "x", srcDir, placement, expectHash: wrongHash }),
		).rejects.toThrow(/hash mismatch/);

		expect(await exists(storeDir)).toBe(false);
	});

	test("leaves a pre-existing real directory at a holdout path untouched and reports a conflict", async () => {
		const srcDir = await makeDir(SKILL);
		const placement = await makePlacement(1);
		const holdoutDir = placement.holdoutDirs[0] as string;
		const linkPath = join(holdoutDir, "x");
		await mkdir(linkPath, { recursive: true });
		await Bun.write(join(linkPath, "keep.txt"), "do not touch");

		const report = await materializeSkill({ name: "x", srcDir, placement });

		expect(report.conflicts).toEqual([linkPath]);
		expect(report.linked).toEqual([]);
		const st = await lstat(linkPath);
		expect(st.isSymbolicLink()).toBe(false);
		expect(await Bun.file(join(linkPath, "keep.txt")).text()).toBe("do not touch");
	});

	test("retargets a pre-existing symlink pointing at a stale location", async () => {
		const srcDir = await makeDir(SKILL);
		const placement = await makePlacement(1);
		const holdoutDir = placement.holdoutDirs[0] as string;
		const linkPath = join(holdoutDir, "x");
		const stale = await freshDir();
		await symlink(stale, linkPath);

		const report = await materializeSkill({ name: "x", srcDir, placement });

		const storeDir = join(placement.storeRoot, "x");
		expect(report.linked).toEqual([linkPath]);
		expect(await readlink(linkPath)).toBe(storeDir);
	});

	test("second run is idempotent: empty linked/conflicts, links unchanged", async () => {
		const srcDir = await makeDir(SKILL);
		const placement = await makePlacement(2);
		await materializeSkill({ name: "x", srcDir, placement });

		const report = await materializeSkill({ name: "x", srcDir, placement });

		expect(report.linked).toEqual([]);
		expect(report.conflicts).toEqual([]);
		const storeDir = join(placement.storeRoot, "x");
		for (const holdoutDir of placement.holdoutDirs) {
			expect(await readlink(join(holdoutDir, "x"))).toBe(storeDir);
		}
	});
});

describe("dematerializeSkill", () => {
	test("removes the store entry and all store-pointing symlinks", async () => {
		const srcDir = await makeDir(SKILL);
		const placement = await makePlacement(2);
		await materializeSkill({ name: "x", srcDir, placement });
		const storeDir = join(placement.storeRoot, "x");

		const report = await dematerializeSkill({ name: "x", placement });

		expect(report.removedStore).toBe(true);
		expect(report.conflicts).toEqual([]);
		expect(report.unlinked.sort()).toEqual(
			placement.holdoutDirs.map((d) => join(d, "x")).sort(),
		);
		expect(await exists(storeDir)).toBe(false);
		for (const holdoutDir of placement.holdoutDirs) {
			expect(await exists(join(holdoutDir, "x"))).toBe(false);
		}
	});

	test("removes a broken symlink whose target string points into storeRoot", async () => {
		const placement = await makePlacement(1);
		const holdoutDir = placement.holdoutDirs[0] as string;
		const linkPath = join(holdoutDir, "x");
		// Target never exists: exercises the string-prefix check, not realpath.
		await symlink(join(placement.storeRoot, "x"), linkPath);

		const report = await dematerializeSkill({ name: "x", placement });

		expect(report.unlinked).toEqual([linkPath]);
		expect(report.removedStore).toBe(false);
		expect(report.conflicts).toEqual([]);
		expect(await exists(linkPath)).toBe(false);
	});

	test("leaves a foreign symlink alone and reports it as a conflict", async () => {
		const placement = await makePlacement(1);
		const holdoutDir = placement.holdoutDirs[0] as string;
		const linkPath = join(holdoutDir, "x");
		const foreignTarget = await freshDir();
		await symlink(foreignTarget, linkPath);

		const report = await dematerializeSkill({ name: "x", placement });

		expect(report.conflicts).toEqual([linkPath]);
		expect(report.unlinked).toEqual([]);
		const st = await lstat(linkPath);
		expect(st.isSymbolicLink()).toBe(true);
		expect(await readlink(linkPath)).toBe(foreignTarget);
	});

	test("is a clean no-op when nothing exists", async () => {
		const placement = await makePlacement(2);

		const report = await dematerializeSkill({ name: "x", placement });

		expect(report).toEqual({ removedStore: false, unlinked: [], conflicts: [] });
	});
});

describe("repairLinks", () => {
	test("recreates a missing link and retargets a wrong one without touching store bytes", async () => {
		const srcDir = await makeDir(SKILL);
		const placement = await makePlacement(2);
		await materializeSkill({ name: "x", srcDir, placement });
		const storeDir = join(placement.storeRoot, "x");
		const hashBefore = await hashFolder(storeDir);

		const [h1, h2] = placement.holdoutDirs as [string, string];
		await rm(join(h1, "x"));
		const wrong = await freshDir();
		await rm(join(h2, "x"));
		await symlink(wrong, join(h2, "x"));

		const report = await repairLinks({ name: "x", placement });

		expect(report.store).toBe(storeDir);
		expect(report.linked.sort()).toEqual([join(h1, "x"), join(h2, "x")].sort());
		expect(await readlink(join(h1, "x"))).toBe(storeDir);
		expect(await readlink(join(h2, "x"))).toBe(storeDir);
		expect(await hashFolder(storeDir)).toBe(hashBefore);
	});

	test("throws when there is no store entry for the skill", async () => {
		const placement = await makePlacement(1);

		await expect(repairLinks({ name: "x", placement })).rejects.toThrow();
	});
});
