import { describe, expect, test } from "bun:test";
import { parseSourceRef } from "../src/sources/ref.ts";

const opts = { cwd: "/work", home: "/home/u" };

describe("parseSourceRef — github shorthand", () => {
	test("owner/repo", () => {
		expect(parseSourceRef("github:vercel-labs/skills", opts)).toEqual({
			kind: "git",
			url: "https://github.com/vercel-labs/skills.git",
			ref: null,
			subpath: null,
		});
	});

	test("with subpath and ref", () => {
		expect(parseSourceRef("github:o/r/skills/foo#v1.2.0", opts)).toEqual({
			kind: "git",
			url: "https://github.com/o/r.git",
			ref: "v1.2.0",
			subpath: "skills/foo",
		});
	});

	test("empty #ref is treated as no ref", () => {
		expect(parseSourceRef("github:o/r#", opts)).toMatchObject({ ref: null });
	});

	test("rejects a bare owner", () => {
		expect(() => parseSourceRef("github:owner", opts)).toThrow("expected github:owner/repo");
	});
});

describe("parseSourceRef — git URLs", () => {
	test.each([
		"https://github.com/o/r.git",
		"https://example.com/o/r",
		"http://example.com/o/r.git",
		"ssh://git@example.com/o/r.git",
		"git@github.com:o/r.git",
	])("%s is a git source", (url) => {
		expect(parseSourceRef(url, opts)).toEqual({ kind: "git", url, ref: null, subpath: null });
	});

	test("splits #ref off a URL", () => {
		expect(parseSourceRef("https://example.com/o/r.git#main", opts)).toMatchObject({
			url: "https://example.com/o/r.git",
			ref: "main",
		});
	});
});

describe("parseSourceRef — local paths", () => {
	test.each([
		["/abs/skills", "/abs/skills"],
		["./skills", "/work/skills"],
		["../skills", "/skills"],
		[".", "/work"],
		["~/skills", "/home/u/skills"],
		["file:///abs/skills", "/abs/skills"],
	])("%s → %s", (raw, path) => {
		expect(parseSourceRef(raw, opts)).toEqual({ kind: "local", path });
	});

	test("local paths keep a # as part of the path", () => {
		expect(parseSourceRef("./skills#1", opts)).toEqual({ kind: "local", path: "/work/skills#1" });
	});
});

describe("parseSourceRef — errors", () => {
	test.each(["foo", "foo/bar", "npm:left-pad"])("rejects '%s'", (raw) => {
		expect(() => parseSourceRef(raw, opts)).toThrow("unrecognized source");
	});
});

describe("parseSourceRef — argument injection", () => {
	test("rejects refs that look like git flags", () => {
		expect(() => parseSourceRef("github:o/r#--upload-pack=touch${IFS}pwned", opts)).toThrow(
			"must not start with '-'",
		);
		expect(() => parseSourceRef("https://example.com/o/r.git#-b", opts)).toThrow(
			"must not start with '-'",
		);
	});

	test("rejects urls that look like git flags", () => {
		expect(() => parseSourceRef("--upload-pack=evil.git", opts)).toThrow(
			"must not start with '-'",
		);
	});

	test("rejects subpath traversal and flag-like segments", () => {
		expect(() => parseSourceRef("github:o/r/../../../etc", opts)).toThrow("invalid subpath");
		expect(() => parseSourceRef("github:o/r/skills/-flag", opts)).toThrow("invalid subpath");
		expect(() => parseSourceRef("github:o/r/skills/./x", opts)).toThrow("invalid subpath");
	});
});
