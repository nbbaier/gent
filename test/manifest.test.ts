import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	MANIFEST_VERSION,
	emptyManifest,
	globalManifestPath,
	readManifest,
	serializeManifest,
	writeManifest,
	type Manifest,
} from "../src/manifest.ts";

const entry = (n: number) => ({ source: `github:o/r/skill-${n}`, hash: `sha256:${n}` });

describe("globalManifestPath", () => {
	test("defaults to ~/.config/gent/gent.json", () => {
		expect(globalManifestPath({ HOME: "/home/u" })).toBe("/home/u/.config/gent/gent.json");
	});

	test("respects XDG_CONFIG_HOME", () => {
		expect(globalManifestPath({ HOME: "/home/u", XDG_CONFIG_HOME: "/xdg" })).toBe(
			"/xdg/gent/gent.json",
		);
	});
});

describe("serializeManifest", () => {
	test("sorts skill names and target lists", () => {
		const manifest: Manifest = {
			version: MANIFEST_VERSION,
			skills: { b: entry(2), a: entry(1) },
			targets: { exclude: ["z", "y"], add: ["m"] },
		};
		const text = serializeManifest(manifest);
		expect(text.indexOf('"a"')).toBeLessThan(text.indexOf('"b"'));
		expect(text.indexOf('"y"')).toBeLessThan(text.indexOf('"z"'));
		expect(text.indexOf('"add"')).toBeLessThan(text.indexOf('"exclude"'));
	});

	test("emits fixed entry key order regardless of input order", () => {
		const a = serializeManifest({
			version: 1,
			skills: { s: { hash: "sha256:x", resolvedRef: "abc", ref: "main", source: "github:o/r" } },
		});
		const b = serializeManifest({
			version: 1,
			skills: { s: { source: "github:o/r", ref: "main", resolvedRef: "abc", hash: "sha256:x" } },
		});
		expect(a).toBe(b);
		expect(a).toMatch(/"source"[\s\S]*"ref"[\s\S]*"resolvedRef"[\s\S]*"hash"/);
	});

	test("omits empty targets and ends with a newline", () => {
		const text = serializeManifest({ version: 1, skills: {}, targets: { add: [] } });
		expect(text).not.toContain("targets");
		expect(text.endsWith("\n")).toBe(true);
	});
});

describe("read/write round trip", () => {
	test("write → read → write is byte-identical", async () => {
		const dir = await mkdtemp(join(tmpdir(), "gent-manifest-"));
		const path = join(dir, "gent.json");
		const manifest: Manifest = {
			version: MANIFEST_VERSION,
			skills: {
				zeta: { source: "github:o/r/zeta", ref: "main", resolvedRef: "deadbeef", hash: "sha256:z" },
				alpha: { source: "./local/alpha", hash: "sha256:a" },
			},
			targets: { exclude: ["cursor"] },
		};
		await writeManifest(path, manifest);
		const first = await Bun.file(path).text();
		const read = await readManifest(path);
		expect(read).not.toBeNull();
		await writeManifest(path, read as Manifest);
		expect(await Bun.file(path).text()).toBe(first);
	});

	test("creates parent directories (fresh global config dir)", async () => {
		const dir = await mkdtemp(join(tmpdir(), "gent-home-"));
		const path = globalManifestPath({ HOME: dir });
		await writeManifest(path, emptyManifest());
		expect(await readManifest(path)).toEqual(emptyManifest());
	});

	test("returns null for a missing file", async () => {
		const dir = await mkdtemp(join(tmpdir(), "gent-missing-"));
		expect(await readManifest(join(dir, "gent.json"))).toBeNull();
	});
});

describe("validation", () => {
	const dir = mkdtemp(join(tmpdir(), "gent-invalid-"));

	async function writeRaw(name: string, content: string): Promise<string> {
		const path = join(await dir, name);
		await Bun.write(path, content);
		return path;
	}

	test("rejects invalid JSON", async () => {
		const path = await writeRaw("bad.json", "{nope");
		expect(readManifest(path)).rejects.toThrow("not valid JSON");
	});

	test("rejects unsupported versions", async () => {
		const path = await writeRaw("v9.json", JSON.stringify({ version: 9, skills: {} }));
		expect(readManifest(path)).rejects.toThrow("unsupported manifest version 9");
	});

	test("rejects entries without source or hash", async () => {
		const path = await writeRaw(
			"nosrc.json",
			JSON.stringify({ version: 1, skills: { x: { hash: "sha256:x" } } }),
		);
		expect(readManifest(path)).rejects.toThrow("skill 'x' is missing a 'source' string");
	});

	test("rejects non-string target lists", async () => {
		const path = await writeRaw(
			"targets.json",
			JSON.stringify({ version: 1, skills: {}, targets: { add: [1] } }),
		);
		expect(readManifest(path)).rejects.toThrow("'targets.add' must be an array of strings");
	});
});
