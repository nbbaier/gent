import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveSource } from "../src/sources/index.ts";

describe("local resolver", () => {
	test("lists files in place with no resolved ref", async () => {
		const dir = await mkdtemp(join(tmpdir(), "gent-local-"));
		await mkdir(join(dir, "nested"), { recursive: true });
		await Bun.write(join(dir, "SKILL.md"), "---\nname: x\n---\n");
		await Bun.write(join(dir, "nested", "asset.txt"), "hi");
		expect(await resolveSource({ kind: "local", path: dir })).toEqual({
			root: dir,
			files: ["SKILL.md", "nested/asset.txt"],
			resolvedRef: null,
			subpath: null,
		});
	});

	test("errors on a missing path", async () => {
		expect(resolveSource({ kind: "local", path: "/nope/never" })).rejects.toThrow(
			"does not exist",
		);
	});

	test("errors on a file path", async () => {
		const dir = await mkdtemp(join(tmpdir(), "gent-localf-"));
		const file = join(dir, "SKILL.md");
		await Bun.write(file, "x");
		expect(resolveSource({ kind: "local", path: file })).rejects.toThrow("not a directory");
	});
});
