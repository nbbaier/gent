import { beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveSource } from "../src/sources/index.ts";

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

/**
 * Fixture repo, two commits:
 *   commit 1 (tag v1): skills/alpha/SKILL.md ("alpha v1"), skills/beta/SKILL.md
 *   commit 2 (main):   alpha edited ("alpha v2"), top-level README.md added
 */
let repo: string;
let sha1: string;
let sha2: string;

beforeAll(async () => {
	repo = await mkdtemp(join(tmpdir(), "gent-fixture-"));
	await git(["init", "-q", "-b", "main", "."], repo);
	await git(["config", "user.email", "t@example.com"], repo);
	await git(["config", "user.name", "t"], repo);
	// partial clone + arbitrary-sha fetch against a local remote
	await git(["config", "uploadpack.allowFilter", "true"], repo);
	await git(["config", "uploadpack.allowAnySHA1InWant", "true"], repo);

	await mkdir(join(repo, "skills", "alpha"), { recursive: true });
	await mkdir(join(repo, "skills", "beta"), { recursive: true });
	await Bun.write(join(repo, "skills", "alpha", "SKILL.md"), "---\nname: alpha\n---\nalpha v1\n");
	await Bun.write(join(repo, "skills", "beta", "SKILL.md"), "---\nname: beta\n---\n");
	await git(["add", "."], repo);
	await git(["commit", "-q", "-m", "one"], repo);
	await git(["tag", "v1"], repo);
	sha1 = await git(["rev-parse", "HEAD"], repo);

	await Bun.write(join(repo, "skills", "alpha", "SKILL.md"), "---\nname: alpha\n---\nalpha v2\n");
	await Bun.write(join(repo, "README.md"), "readme\n");
	await git(["add", "."], repo);
	await git(["commit", "-q", "-m", "two"], repo);
	sha2 = await git(["rev-parse", "HEAD"], repo);
});

const gitRef = (over: { ref?: string | null; subpath?: string | null } = {}) =>
	({ kind: "git", url: repo, ref: over.ref ?? null, subpath: over.subpath ?? null }) as const;

describe("git resolver", () => {
	test("no ref resolves the remote HEAD", async () => {
		const resolved = await resolveSource(gitRef());
		expect(resolved.resolvedRef).toBe(sha2);
		expect(resolved.files).toEqual([
			"README.md",
			"skills/alpha/SKILL.md",
			"skills/beta/SKILL.md",
		]);
		expect(resolved.subpath).toBeNull();
	});

	test("branch ref resolves to its tip", async () => {
		const resolved = await resolveSource(gitRef({ ref: "main" }));
		expect(resolved.resolvedRef).toBe(sha2);
	});

	test("tag ref pins old content", async () => {
		const resolved = await resolveSource(gitRef({ ref: "v1" }));
		expect(resolved.resolvedRef).toBe(sha1);
		expect(await Bun.file(join(resolved.root, "skills", "alpha", "SKILL.md")).text()).toContain(
			"alpha v1",
		);
		expect(resolved.files).not.toContain("README.md");
	});

	test("full sha ref", async () => {
		const resolved = await resolveSource(gitRef({ ref: sha1 }));
		expect(resolved.resolvedRef).toBe(sha1);
	});

	test("short sha falls back to a full fetch", async () => {
		const resolved = await resolveSource(gitRef({ ref: sha1.slice(0, 8) }));
		expect(resolved.resolvedRef).toBe(sha1);
	});

	test("subpath narrows root and files", async () => {
		const resolved = await resolveSource(gitRef({ subpath: "skills/alpha" }));
		expect(resolved.root.endsWith("skills/alpha")).toBe(true);
		expect(resolved.files).toEqual(["SKILL.md"]);
		expect(resolved.subpath).toBe("skills/alpha");
		expect(resolved.resolvedRef).toBe(sha2);
	});

	test("missing subpath errors", async () => {
		expect(resolveSource(gitRef({ subpath: "skills/nope" }))).rejects.toThrow(
			"subpath 'skills/nope' not found",
		);
	});

	test("unknown ref errors", async () => {
		expect(resolveSource(gitRef({ ref: "does-not-exist" }))).rejects.toThrow();
	});

	// SourceRefs can come straight from manifest data, so the resolver must
	// re-reject flag-like and traversal values itself (not rely on the parser).
	test("rejects flag-like refs, urls, and traversal subpaths", async () => {
		expect(resolveSource(gitRef({ ref: "--upload-pack=evil" }))).rejects.toThrow(
			"must not start with '-'",
		);
		expect(
			resolveSource({ kind: "git", url: "--upload-pack=evil", ref: null, subpath: null }),
		).rejects.toThrow("must not start with '-'");
		expect(resolveSource(gitRef({ subpath: "../outside" }))).rejects.toThrow("invalid subpath");
	});
});
