import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tools } from "../src/registry/data.ts";
import { detectInstalledTools, resolveTargets } from "../src/registry/detect.ts";

describe("registry data invariants", () => {
	test("exposes exactly 9 tools with unique ids", () => {
		expect(tools.length).toBe(9);
		const ids = tools.map((t) => t.id);
		expect(new Set(ids).size).toBe(9);
	});

	test("exactly 2 tools are holdouts: claude-code and droid", () => {
		const holdouts = tools.filter((t) => t.holdout !== null).map((t) => t.id);
		expect(holdouts.sort()).toEqual(["claude-code", "droid"]);
	});

	test("every 'query' strategy entry has queryCommand + parseFormat", () => {
		for (const t of tools) {
			if (t.runtime.strategy === "query") {
				expect(t.runtime.queryCommand).toBeDefined();
				expect(t.runtime.queryCommand?.length).toBeGreaterThan(0);
				expect(t.runtime.parseFormat).toBeDefined();
			}
		}
	});

	test("every 'query-trust-corrected' entry also has trustCheck", () => {
		for (const t of tools) {
			if (t.runtime.strategy === "query-trust-corrected") {
				expect(t.runtime.trustCheck).toBeDefined();
				expect(t.runtime.trustCheck?.file).toBeTruthy();
			}
		}
	});

	test("'model'-strategy entries have no queryCommand", () => {
		for (const t of tools) {
			if (t.runtime.strategy === "model") {
				expect(t.runtime.queryCommand).toBeUndefined();
			}
		}
	});
});

describe("detectInstalledTools", () => {
	test("detects a tool via a bin on PATH", async () => {
		const dir = await mkdtemp(join(tmpdir(), "gent-registry-home-"));
		const detected = detectInstalledTools({
			home: dir,
			which: (bin) => (bin === "claude" ? "/usr/local/bin/claude" : null),
			appExists: () => false,
		});
		const ids = detected.map((t) => t.id);
		expect(ids).toContain("claude-code");
		expect(ids).not.toContain("droid");
	});

	test("detects a tool via a configDir under home", async () => {
		const dir = await mkdtemp(join(tmpdir(), "gent-registry-home-"));
		await mkdir(join(dir, ".gemini"), { recursive: true });
		const detected = detectInstalledTools({
			home: dir,
			which: () => null,
			// Real filesystem check against the temp home — proves the configDir
			// channel joins home + configDir rather than trusting a stub.
			appExists: (p) => existsSync(p),
		});
		expect(detected.map((t) => t.id)).toContain("gemini");
	});

	test("detects a tool via an appPath", async () => {
		const dir = await mkdtemp(join(tmpdir(), "gent-registry-home-"));
		const detected = detectInstalledTools({
			home: dir,
			which: () => null,
			appExists: (p) => p === "/Applications/Cursor.app",
		});
		expect(detected.map((t) => t.id)).toContain("cursor");
	});

	test("does not detect a tool when nothing matches", async () => {
		const dir = await mkdtemp(join(tmpdir(), "gent-registry-home-"));
		const detected = detectInstalledTools({
			home: dir,
			which: () => null,
			appExists: () => false,
		});
		expect(detected).toEqual([]);
	});
});

describe("resolveTargets", () => {
	const claudeCode = tools.find((t) => t.id === "claude-code")!;
	const droid = tools.find((t) => t.id === "droid")!;
	const amp = tools.find((t) => t.id === "amp")!;

	test("returns detected holdouts as-is with no targets", () => {
		const result = resolveTargets([claudeCode]);
		expect(result.map((t) => t.id)).toEqual(["claude-code"]);
	});

	test("targets.add adds a tool by id even if not detected", () => {
		const result = resolveTargets([claudeCode], { add: ["droid"] });
		expect(result.map((t) => t.id).sort()).toEqual(["claude-code", "droid"]);
	});

	test("targets.exclude removes a detected tool", () => {
		const result = resolveTargets([claudeCode, droid], { exclude: ["droid"] });
		expect(result.map((t) => t.id)).toEqual(["claude-code"]);
	});

	test("exclude wins over add for the same id", () => {
		const result = resolveTargets([claudeCode], { add: ["amp"], exclude: ["amp"] });
		expect(result.map((t) => t.id)).toEqual(["claude-code"]);
	});

	test("throws on an unknown id in add with the exact message shape", () => {
		expect(() => resolveTargets([], { add: ["not-a-real-tool"] })).toThrow(
			`unknown target 'not-a-real-tool' — known: ${tools
				.map((t) => t.id)
				.sort()
				.join(", ")}`,
		);
	});

	test("throws on an unknown id in exclude", () => {
		expect(() => resolveTargets([], { exclude: ["nope"] })).toThrow("unknown target 'nope'");
	});

	test("does not duplicate a tool detected as holdout AND added", () => {
		const result = resolveTargets([claudeCode], { add: ["claude-code"] });
		expect(result.map((t) => t.id)).toEqual(["claude-code"]);
	});
});
