import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readlink, rm, symlink, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../src/run.ts";
import type { Io } from "../src/io.ts";
import { globalManifestPath, readManifest, writeManifest } from "../src/manifest.ts";
import { hashFolder } from "../src/hash.ts";

function captureIo() {
	const out: string[] = [];
	const err: string[] = [];
	const io: Io = {
		print: (line) => out.push(line),
		error: (line) => err.push(line),
		ask: async () => "",
	};
	return { io, out, err };
}

async function tmpHome(): Promise<string> {
	return mkdtemp(join(tmpdir(), "gent-sync-home-"));
}

async function writeSkillDir(parent: string, name: string, body = "body"): Promise<string> {
	const dir = join(parent, name);
	await mkdir(dir, { recursive: true });
	await Bun.write(join(dir, "SKILL.md"), `---\nname: ${name}\n---\n${body}\n`);
	return dir;
}

function ctxFor(home: string) {
	return { env: { HOME: home, XDG_CONFIG_HOME: undefined }, cwd: home, interactive: false };
}

async function sh(args: string[], cwd: string): Promise<string> {
	const proc = Bun.spawn(args, { cwd, stdout: "pipe", stderr: "pipe" });
	const [stdout, stderr, code] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	if (code !== 0) throw new Error(`${args.join(" ")} failed: ${stderr}`);
	return stdout.trim();
}

const git = (args: string[], cwd: string) => sh(["git", ...args], cwd);

let fixtureRepo: string;
let fixtureSha1: string;
let originalGitConfigGlobal: string | undefined;

beforeAll(async () => {
	fixtureRepo = await mkdtemp(join(tmpdir(), "gent-sync-git-fixture-"));
	await git(["init", "-q", "-b", "main", "."], fixtureRepo);
	await git(["config", "user.email", "t@example.com"], fixtureRepo);
	await git(["config", "user.name", "t"], fixtureRepo);
	await git(["config", "uploadpack.allowFilter", "true"], fixtureRepo);
	await git(["config", "uploadpack.allowAnySHA1InWant", "true"], fixtureRepo);
	await Bun.write(join(fixtureRepo, "SKILL.md"), "---\nname: gitskill\n---\nv1\n");
	await git(["add", "."], fixtureRepo);
	await git(["commit", "-q", "-m", "one"], fixtureRepo);
	await git(["tag", "v1"], fixtureRepo);
	fixtureSha1 = await git(["rev-parse", "HEAD"], fixtureRepo);
	await Bun.write(join(fixtureRepo, "SKILL.md"), "---\nname: gitskill\n---\nv2\n");
	await git(["add", "."], fixtureRepo);
	await git(["commit", "-q", "-m", "two"], fixtureRepo);

	const configDir = await mkdtemp(join(tmpdir(), "gent-sync-gitconfig-"));
	const configPath = join(configDir, "gitconfig");
	await Bun.write(
		configPath,
		[
			`[url "file://${fixtureRepo}/"]`,
			"    insteadOf = https://github.com/gent-sync-fixture-owner/gent-sync-fixture-repo.git",
			"",
		].join("\n"),
	);
	originalGitConfigGlobal = process.env.GIT_CONFIG_GLOBAL;
	process.env.GIT_CONFIG_GLOBAL = configPath;
});

afterAll(() => {
	if (originalGitConfigGlobal === undefined) delete process.env.GIT_CONFIG_GLOBAL;
	else process.env.GIT_CONFIG_GLOBAL = originalGitConfigGlobal;
});

describe("gent sync", () => {
	test("materializes a missing local skill without changing the manifest", async () => {
		const home = await tmpHome();
		await mkdir(join(home, ".claude"), { recursive: true });
		const sourceParent = await mkdtemp(join(tmpdir(), "gent-sync-source-"));
		const sourceDir = await writeSkillDir(sourceParent, "alpha", "alpha body");

		const added = captureIo();
		expect(await run(["add", sourceDir], added.io, ctxFor(home))).toBe(0);

		const manifestPath = globalManifestPath({ HOME: home });
		const manifestBefore = await Bun.file(manifestPath).text();
		const storeDir = join(home, ".agents", "skills", "alpha");
		const holdoutLink = join(home, ".claude", "skills", "alpha");
		const recordedHash = await hashFolder(storeDir);
		await rm(storeDir, { recursive: true, force: true });
		await unlink(holdoutLink);

		const { io, out, err } = captureIo();
		const code = await run(["sync"], io, ctxFor(home));

		expect(code).toBe(0);
		expect(out).toEqual(["materialized alpha"]);
		expect(err).toEqual([]);
		expect(await hashFolder(storeDir)).toBe(recordedHash);
		expect(await readlink(holdoutLink)).toBe(storeDir);
		expect(await Bun.file(manifestPath).text()).toBe(manifestBefore);
	});

	test("materializes from the originally added relative source when run from another cwd", async () => {
		const home = await tmpHome();
		const addCwd = await mkdtemp(join(tmpdir(), "gent-sync-add-cwd-"));
		await writeSkillDir(addCwd, "alpha", "original bytes");
		expect(
			await run(["add", "./alpha"], captureIo().io, { ...ctxFor(home), cwd: addCwd }),
		).toBe(0);

		const storeDir = join(home, ".agents", "skills", "alpha");
		await rm(storeDir, { recursive: true, force: true });
		const syncCwd = await mkdtemp(join(tmpdir(), "gent-sync-other-cwd-"));
		const unrelatedDir = await writeSkillDir(syncCwd, "alpha", "unrelated bytes");

		const { io, out, err } = captureIo();
		expect(await run(["sync"], io, { ...ctxFor(home), cwd: syncCwd })).toBe(0);
		expect(out).toEqual(["materialized alpha"]);
		expect(err).toEqual([]);
		expect(await Bun.file(join(storeDir, "SKILL.md")).text()).toContain("original bytes");
		expect(await Bun.file(join(unrelatedDir, "SKILL.md")).text()).toContain("unrelated bytes");
	});

	test("rejects a legacy relative manifest source instead of materializing from the command cwd", async () => {
		const home = await tmpHome();
		const syncCwd = await mkdtemp(join(tmpdir(), "gent-sync-legacy-cwd-"));
		const unrelatedDir = await writeSkillDir(syncCwd, "alpha", "unrelated bytes");
		await writeManifest(globalManifestPath({ HOME: home }), {
			version: 1,
			skills: {
				alpha: { source: "./alpha", hash: await hashFolder(unrelatedDir) },
			},
		});

		const { io, out, err } = captureIo();
		expect(await run(["sync"], io, { ...ctxFor(home), cwd: syncCwd })).toBe(1);
		expect(out).toEqual([]);
		expect(err).toHaveLength(1);
		expect(err[0]).toContain("relative local source './alpha'");
		expect(err[0]).toContain("remove and re-add 'alpha' using its source path");
		expect(
			await Bun.file(join(home, ".agents", "skills", "alpha", "SKILL.md")).exists(),
		).toBe(false);
	});

	test("materializes missing git content from the manifest's pinned commit", async () => {
		const home = await tmpHome();
		await mkdir(join(home, ".claude"), { recursive: true });
		const source = "github:gent-sync-fixture-owner/gent-sync-fixture-repo#v1";
		const added = captureIo();
		expect(await run(["add", source], added.io, ctxFor(home))).toBe(0);

		const manifestPath = globalManifestPath({ HOME: home });
		const manifestBefore = await Bun.file(manifestPath).text();
		const entry = (await readManifest(manifestPath))?.skills.gitskill;
		expect(entry?.resolvedRef).toBe(fixtureSha1);
		const storeDir = join(home, ".agents", "skills", "gitskill");
		await rm(storeDir, { recursive: true, force: true });

		const { io, out, err } = captureIo();
		const code = await run(["sync"], io, ctxFor(home));

		expect(code).toBe(0);
		expect(out).toEqual(["materialized gitskill"]);
		expect(err).toEqual([]);
		expect(await Bun.file(join(storeDir, "SKILL.md")).text()).toContain("v1");
		expect(await Bun.file(manifestPath).text()).toBe(manifestBefore);
	});

	test("repairs a missing or wrong holdout link without changing store bytes", async () => {
		const home = await tmpHome();
		await mkdir(join(home, ".claude"), { recursive: true });
		const sourceParent = await mkdtemp(join(tmpdir(), "gent-sync-source-"));
		const sourceDir = await writeSkillDir(sourceParent, "alpha", "alpha body");
		expect(await run(["add", sourceDir], captureIo().io, ctxFor(home))).toBe(0);

		const storeDir = join(home, ".agents", "skills", "alpha");
		const holdoutLink = join(home, ".claude", "skills", "alpha");
		const recordedHash = await hashFolder(storeDir);

		await unlink(holdoutLink);
		let result = captureIo();
		expect(await run(["sync"], result.io, ctxFor(home))).toBe(0);
		expect(result.out).toEqual(["repaired alpha"]);
		expect(result.err).toEqual([]);
		expect(await readlink(holdoutLink)).toBe(storeDir);

		const wrongTarget = await mkdtemp(join(tmpdir(), "gent-sync-wrong-link-"));
		await unlink(holdoutLink);
		await Bun.write(join(wrongTarget, "keep.txt"), "foreign");
		await symlink(wrongTarget, holdoutLink);

		result = captureIo();
		expect(await run(["sync"], result.io, ctxFor(home))).toBe(0);
		expect(result.out).toEqual(["repaired alpha"]);
		expect(result.err).toEqual([]);
		expect(await readlink(holdoutLink)).toBe(storeDir);
		expect(await hashFolder(storeDir)).toBe(recordedHash);
	});

	test("leaves a real holdout entry untouched while reporting the conflict", async () => {
		const home = await tmpHome();
		await mkdir(join(home, ".claude"), { recursive: true });
		const sourceParent = await mkdtemp(join(tmpdir(), "gent-sync-source-"));
		const sourceDir = await writeSkillDir(sourceParent, "alpha");
		expect(await run(["add", sourceDir], captureIo().io, ctxFor(home))).toBe(0);

		const holdoutLink = join(home, ".claude", "skills", "alpha");
		await rm(holdoutLink, { recursive: true, force: true });
		await mkdir(holdoutLink, { recursive: true });
		await Bun.write(join(holdoutLink, "keep.txt"), "foreign");

		const { io, out, err } = captureIo();
		const code = await run(["sync"], io, ctxFor(home));

		expect(code).toBe(0);
		expect(out).toEqual([]);
		expect(err).toEqual([
			`warning: '${holdoutLink}' exists and is not gent's symlink; left untouched`,
		]);
		expect(await Bun.file(join(holdoutLink, "keep.txt")).text()).toBe("foreign");
	});

	test("warns on drift and only restores it with --force", async () => {
		const home = await tmpHome();
		const sourceParent = await mkdtemp(join(tmpdir(), "gent-sync-source-"));
		const sourceDir = await writeSkillDir(sourceParent, "alpha", "recorded body");
		expect(await run(["add", sourceDir], captureIo().io, ctxFor(home))).toBe(0);

		const manifestPath = globalManifestPath({ HOME: home });
		const manifestBefore = await Bun.file(manifestPath).text();
		const storeFile = join(home, ".agents", "skills", "alpha", "SKILL.md");
		await Bun.write(storeFile, "---\nname: alpha\n---\ndrifted body\n");

		let result = captureIo();
		expect(await run(["sync"], result.io, ctxFor(home))).toBe(0);
		expect(result.out).toEqual([]);
		expect(result.err).toEqual([
			"warning: alpha has drifted from its recorded hash (hand-edited?); 'gent sync --force' restores it",
		]);
		expect(await Bun.file(storeFile).text()).toContain("drifted body");
		expect(await Bun.file(manifestPath).text()).toBe(manifestBefore);

		result = captureIo();
		expect(await run(["sync", "--force"], result.io, ctxFor(home))).toBe(0);
		expect(result.out).toEqual(["restored alpha"]);
		expect(result.err).toEqual([]);
		expect(await Bun.file(storeFile).text()).toContain("recorded body");
		expect(await Bun.file(manifestPath).text()).toBe(manifestBefore);
	});

	test("prunes only store-pointing orphan links and reports unmanaged store dirs", async () => {
		const home = await tmpHome();
		await mkdir(join(home, ".claude"), { recursive: true });
		const sourceParent = await mkdtemp(join(tmpdir(), "gent-sync-source-"));
		const sourceDir = await writeSkillDir(sourceParent, "alpha");
		expect(await run(["add", sourceDir], captureIo().io, ctxFor(home))).toBe(0);

		const storeRoot = join(home, ".agents", "skills");
		const holdoutRoot = join(home, ".claude", "skills");
		const orphanLink = join(holdoutRoot, "orphan");
		await symlink(join(storeRoot, "orphan"), orphanLink);
		const foreignTarget = await mkdtemp(join(tmpdir(), "gent-sync-foreign-"));
		const foreignLink = join(holdoutRoot, "foreign");
		await symlink(foreignTarget, foreignLink);
		const unmanagedDir = await writeSkillDir(storeRoot, "manual", "hand installed");

		const { io, out, err } = captureIo();
		const code = await run(["sync"], io, ctxFor(home));

		expect(code).toBe(0);
		expect(out).toEqual([
			`pruned ${orphanLink}`,
			`unmanaged: ${unmanagedDir} (adopt with 'gent adopt manual')`,
		]);
		expect(err).toEqual([]);
		expect(await Bun.file(join(unmanagedDir, "SKILL.md")).exists()).toBe(true);
		expect(await readlink(foreignLink)).toBe(foreignTarget);
	});

	test("does not restore a missing local skill from changed source bytes, even with --force", async () => {
		const home = await tmpHome();
		const sourceParent = await mkdtemp(join(tmpdir(), "gent-sync-source-"));
		const sourceDir = await writeSkillDir(sourceParent, "alpha", "recorded body");
		expect(await run(["add", sourceDir], captureIo().io, ctxFor(home))).toBe(0);

		const manifestPath = globalManifestPath({ HOME: home });
		const manifestBefore = await Bun.file(manifestPath).text();
		const storeDir = join(home, ".agents", "skills", "alpha");
		await rm(storeDir, { recursive: true, force: true });
		await Bun.write(join(sourceDir, "SKILL.md"), "---\nname: alpha\n---\nchanged source\n");

		const { io, out, err } = captureIo();
		const code = await run(["sync", "--force"], io, ctxFor(home));

		expect(code).toBe(0);
		expect(out).toEqual([]);
		expect(err).toEqual([
			"warning: alpha: local source changed since it was recorded; run 'gent update alpha'",
		]);
		expect(await Bun.file(join(storeDir, "SKILL.md")).exists()).toBe(false);
		expect(await Bun.file(manifestPath).text()).toBe(manifestBefore);
	});

	test("reports an impossible forced restore when a present local source has changed", async () => {
		const home = await tmpHome();
		const sourceParent = await mkdtemp(join(tmpdir(), "gent-sync-source-"));
		const sourceDir = await writeSkillDir(sourceParent, "alpha", "recorded body");
		expect(await run(["add", sourceDir], captureIo().io, ctxFor(home))).toBe(0);

		const manifestPath = globalManifestPath({ HOME: home });
		const manifestBefore = await Bun.file(manifestPath).text();
		const storeFile = join(home, ".agents", "skills", "alpha", "SKILL.md");
		await Bun.write(storeFile, "---\nname: alpha\n---\ndrifted store\n");
		await Bun.write(join(sourceDir, "SKILL.md"), "---\nname: alpha\n---\nchanged source\n");

		const { io, out, err } = captureIo();
		const code = await run(["sync", "--force"], io, ctxFor(home));

		expect(code).toBe(1);
		expect(out).toEqual([]);
		expect(err).toHaveLength(1);
		expect(err[0]).toContain("restoration is impossible");
		expect(await Bun.file(storeFile).text()).toContain("drifted store");
		expect(await Bun.file(manifestPath).text()).toBe(manifestBefore);
	});

	test("continues syncing other skills and exits 1 when one skill cannot be verified", async () => {
		const home = await tmpHome();
		const sourceParent = await mkdtemp(join(tmpdir(), "gent-sync-source-"));
		const sourceDir = await writeSkillDir(sourceParent, "alpha", "alpha body");
		const localHash = await hashFolder(sourceDir);
		const manifestPath = globalManifestPath({ HOME: home });
		await writeManifest(manifestPath, {
			version: 1,
			skills: {
				alpha: { source: sourceDir, hash: localHash },
				gitskill: {
					source: "github:gent-sync-fixture-owner/gent-sync-fixture-repo",
					resolvedRef: fixtureSha1,
					hash: "sha256:wrong",
				},
			},
		});

		const { io, out, err } = captureIo();
		const code = await run(["sync"], io, ctxFor(home));

		expect(code).toBe(1);
		expect(out).toEqual(["materialized alpha"]);
		expect(err).toHaveLength(1);
		expect(err[0]).toContain("gitskill");
		expect(err[0]).toContain("does not match recorded sha256:wrong");
		expect(await Bun.file(join(home, ".agents", "skills", "alpha", "SKILL.md")).exists()).toBe(true);
	});
});
