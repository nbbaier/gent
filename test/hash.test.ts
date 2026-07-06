import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashFolder } from "../src/hash.ts";

async function makeDir(files: Record<string, string>): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "gent-hash-"));
	for (const [rel, content] of Object.entries(files)) {
		await mkdir(join(dir, rel, ".."), { recursive: true });
		await Bun.write(join(dir, rel), content);
	}
	return dir;
}

const SKILL = { "SKILL.md": "---\nname: x\n---\n", "assets/a.txt": "aaa" };

describe("hashFolder", () => {
	test("format is sha256:<hex>", async () => {
		expect(await hashFolder(await makeDir(SKILL))).toMatch(/^sha256:[0-9a-f]{64}$/);
	});

	test("same content hashes the same regardless of creation order", async () => {
		const one = await makeDir(SKILL);
		const two = await makeDir({ "assets/a.txt": "aaa", "SKILL.md": "---\nname: x\n---\n" });
		expect(await hashFolder(one)).toBe(await hashFolder(two));
	});

	test("content change changes the hash", async () => {
		const dir = await makeDir(SKILL);
		const before = await hashFolder(dir);
		await Bun.write(join(dir, "assets", "a.txt"), "bbb");
		expect(await hashFolder(dir)).not.toBe(before);
	});

	test("rename changes the hash even with identical bytes", async () => {
		const dir = await makeDir(SKILL);
		const before = await hashFolder(dir);
		await rename(join(dir, "assets", "a.txt"), join(dir, "assets", "b.txt"));
		expect(await hashFolder(dir)).not.toBe(before);
	});

	test("moving content between files changes the hash", async () => {
		// Guards the per-file framing: {"a": "xy", "b": ""} vs {"a": "x", "b": "y"}.
		const one = await makeDir({ a: "xy", b: "" });
		const two = await makeDir({ a: "x", b: "y" });
		expect(await hashFolder(one)).not.toBe(await hashFolder(two));
	});

	test(".git contents are excluded", async () => {
		const dir = await makeDir(SKILL);
		const before = await hashFolder(dir);
		await mkdir(join(dir, ".git"), { recursive: true });
		await Bun.write(join(dir, ".git", "HEAD"), "ref: refs/heads/main");
		expect(await hashFolder(dir)).toBe(before);
		await rm(join(dir, ".git"), { recursive: true });
	});

	test("empty folder has a stable hash", async () => {
		const one = await mkdtemp(join(tmpdir(), "gent-empty-"));
		const two = await mkdtemp(join(tmpdir(), "gent-empty-"));
		expect(await hashFolder(one)).toBe(await hashFolder(two));
	});
});
