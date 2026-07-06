import { describe, expect, test } from "bun:test";
import { commands, resolveCommand } from "../src/commands.ts";
import { run, usage } from "../src/run.ts";
import type { Io } from "../src/io.ts";
import pkg from "../package.json";

function captureIo() {
	const out: string[] = [];
	const err: string[] = [];
	const io: Io = {
		print: (line) => out.push(line),
		error: (line) => err.push(line),
	};
	return { io, out, err };
}

describe("resolveCommand", () => {
	test("resolves every command by its canonical name", () => {
		for (const c of commands) {
			expect(resolveCommand(c.name)?.name).toBe(c.name);
		}
	});

	test.each([
		["a", "add"],
		["i", "add"],
		["install", "add"],
		["rm", "remove"],
		["r", "remove"],
		["uninstall", "remove"],
		["ls", "list"],
	])("resolves alias %s to %s", (alias, name) => {
		expect(resolveCommand(alias)?.name).toBe(name);
	});

	test("returns undefined for unknown names", () => {
		expect(resolveCommand("frobnicate")).toBeUndefined();
	});

	test("no name or alias is claimed twice", () => {
		const all = commands.flatMap((c) => [c.name, ...c.aliases]);
		expect(new Set(all).size).toBe(all.length);
	});
});

describe("run", () => {
	test("--help prints usage and exits 0", async () => {
		const { io, out } = captureIo();
		expect(await run(["--help"], io)).toBe(0);
		expect(out.join("\n")).toContain("Usage: gent <command>");
	});

	test("no arguments prints usage and exits 1", async () => {
		const { io, out } = captureIo();
		expect(await run([], io)).toBe(1);
		expect(out.join("\n")).toContain("Usage: gent <command>");
	});

	test("--version prints the package version", async () => {
		const { io, out } = captureIo();
		expect(await run(["--version"], io)).toBe(0);
		expect(out).toEqual([pkg.version]);
	});

	test("unknown command errors with usage and exits 1", async () => {
		const { io, err } = captureIo();
		expect(await run(["frobnicate"], io)).toBe(1);
		expect(err.join("\n")).toContain("unknown command 'frobnicate'");
		expect(err.join("\n")).toContain("Usage: gent <command>");
	});

	test("stub commands report not-implemented and exit 1", async () => {
		const { io, err } = captureIo();
		expect(await run(["sync"], io)).toBe(1);
		expect(err).toEqual(["gent sync: not implemented yet"]);
	});

	test("aliases dispatch to the canonical command", async () => {
		const { io, err } = captureIo();
		expect(await run(["ls"], io)).toBe(1);
		expect(err).toEqual(["gent list: not implemented yet"]);
	});

	test("usage lists every command with its aliases", () => {
		const text = usage();
		for (const c of commands) {
			expect(text).toContain([c.name, ...c.aliases].join(", "));
		}
	});
});
