import { beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readlink, lstat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../src/run.ts";
import type { Io } from "../src/io.ts";
import { writeManifest, globalManifestPath, readManifest, type Manifest } from "../src/manifest.ts";
import { hashFolder } from "../src/hash.ts";

function captureIo(answers: string[] = []) {
	const out: string[] = [];
	const err: string[] = [];
	const asked: string[] = [];
	const io: Io = {
		print: (line) => out.push(line),
		error: (line) => err.push(line),
		ask: async (question) => {
			asked.push(question);
			return answers.shift() ?? "";
		},
	};
	return { io, out, err, asked };
}

async function tmpHome(): Promise<string> {
	return mkdtemp(join(tmpdir(), "gent-cmd-home-"));
}

/** Fake Claude Code being installed, so detection picks it up as a holdout target. */
async function withClaudeCode(home: string): Promise<void> {
	await mkdir(join(home, ".claude"), { recursive: true });
}

async function writeSkillDir(dir: string, name: string, body = "body"): Promise<string> {
	const skillDir = join(dir, name);
	await mkdir(skillDir, { recursive: true });
	await Bun.write(join(skillDir, "SKILL.md"), `---\nname: ${name}\n---\n${body}\n`);
	return skillDir;
}

function ctxFor(home: string, interactive = false) {
	return { env: { HOME: home, XDG_CONFIG_HOME: undefined }, cwd: home, interactive };
}

describe("gent list", () => {
	test("empty manifest prints 'no managed skills' and exits 0", async () => {
		const home = await tmpHome();
		const { io, out } = captureIo();

		const code = await run(["list"], io, ctxFor(home));

		expect(code).toBe(0);
		expect(out).toEqual(["no managed skills"]);
	});

	test("--json on an empty manifest prints []", async () => {
		const home = await tmpHome();
		const { io, out } = captureIo();

		const code = await run(["list", "--json"], io, ctxFor(home));

		expect(code).toBe(0);
		expect(out).toEqual(["[]"]);
	});

	test("populated manifest prints aligned rows and computes status", async () => {
		const home = await tmpHome();
		await withClaudeCode(home);
		const storeRoot = join(home, ".agents", "skills");

		const okDir = await writeSkillDir(storeRoot, "alpha", "alpha body");
		const okHash = await hashFolder(okDir);

		const drifted = await writeSkillDir(storeRoot, "beta", "beta body");
		const driftedHashAtWrite = await hashFolder(drifted);
		// Mutate on-disk content after recording, so store hash no longer matches.
		await Bun.write(join(drifted, "SKILL.md"), "---\nname: beta\n---\nchanged\n");

		const manifest: Manifest = {
			version: 1,
			skills: {
				alpha: { source: "github:o/r/alpha", ref: "main", resolvedRef: "deadbeefcafefeed", hash: okHash },
				beta: { source: "./local/beta", hash: driftedHashAtWrite },
				gone: {
					source: "github:o/r/gone",
					resolvedRef: "deadbeefcafefeed",
					hash: "sha256:missing",
				},
			},
		};
		await writeManifest(globalManifestPath({ HOME: home }), manifest);

		const { io, out } = captureIo();
		const code = await run(["list"], io, ctxFor(home));

		expect(code).toBe(0);
		const text = out.join("\n");
		expect(text).toContain("alpha");
		expect(text).toContain("github:o/r/alpha");
		expect(text).toContain("main");
		expect(text).toContain("ok");
		expect(text).toContain("beta");
		expect(text).toContain("drifted");
		expect(text).toContain("local");
		expect(text).toContain("gone");
		expect(text).toContain("missing");
		expect(text).toContain("deadbeefcafe");
	});

	test("--json emits the full record shape", async () => {
		const home = await tmpHome();
		const storeRoot = join(home, ".agents", "skills");
		const dir = await writeSkillDir(storeRoot, "alpha");
		const hash = await hashFolder(dir);
		const manifest: Manifest = {
			version: 1,
			skills: { alpha: { source: "github:o/r/alpha", hash } },
		};
		await writeManifest(globalManifestPath({ HOME: home }), manifest);

		const { io, out } = captureIo();
		const code = await run(["list", "--json"], io, ctxFor(home));

		expect(code).toBe(0);
		const parsed = JSON.parse(out.join("\n"));
		expect(parsed).toEqual([{ name: "alpha", source: "github:o/r/alpha", hash, status: "ok" }]);
	});
});

describe("gent add (local source)", () => {
	test("single skill materializes into the store, links holdouts, and records the manifest entry", async () => {
		const home = await tmpHome();
		await withClaudeCode(home);
		const sourceDir = await mkdtemp(join(tmpdir(), "gent-src-"));
		const skillDir = await writeSkillDir(sourceDir, "alpha", "alpha body");

		const { io, out, err } = captureIo();
		const code = await run(["add", skillDir], io, ctxFor(home));

		expect(code).toBe(0);
		expect(err).toEqual([]);
		expect(out).toEqual([`added alpha (${skillDir})`]);

		const storeDir = join(home, ".agents", "skills", "alpha");
		expect(await Bun.file(join(storeDir, "SKILL.md")).text()).toContain("alpha body");

		const link = join(home, ".claude", "skills", "alpha");
		expect(await readlink(link)).toBe(storeDir);

		const manifest = await readManifest(globalManifestPath({ HOME: home }));
		expect(manifest?.skills.alpha?.source).toBe(skillDir);
		expect(manifest?.skills.alpha?.hash).toBe(await hashFolder(storeDir));
	});

	test("--all materializes every discovered skill from a multi-skill source", async () => {
		const home = await tmpHome();
		const sourceDir = await mkdtemp(join(tmpdir(), "gent-src-"));
		await writeSkillDir(sourceDir, "alpha");
		await writeSkillDir(sourceDir, "beta");

		const { io, out, err } = captureIo();
		const code = await run(["add", sourceDir, "--all"], io, ctxFor(home));

		expect(code).toBe(0);
		expect(err).toEqual([]);
		expect(out.sort()).toEqual([`added alpha (${sourceDir})`, `added beta (${sourceDir})`].sort());

		const manifest = await readManifest(globalManifestPath({ HOME: home }));
		expect(Object.keys(manifest?.skills ?? {}).sort()).toEqual(["alpha", "beta"]);
	});

	test("multiple skills, non-interactive, no --all errors listing names and leaves the manifest untouched", async () => {
		const home = await tmpHome();
		const sourceDir = await mkdtemp(join(tmpdir(), "gent-src-"));
		await writeSkillDir(sourceDir, "alpha");
		await writeSkillDir(sourceDir, "beta");

		const { io, out, err } = captureIo();
		const code = await run(["add", sourceDir], io, ctxFor(home, false));

		expect(code).toBe(1);
		expect(out).toEqual([]);
		expect(err.join("\n")).toContain("alpha");
		expect(err.join("\n")).toContain("beta");
		expect(err.join("\n")).toContain("--all");

		expect(await readManifest(globalManifestPath({ HOME: home }))).toBeNull();
	});

	test("multiple skills, interactive, prompts a numbered multiselect and adds the chosen subset", async () => {
		const home = await tmpHome();
		const sourceDir = await mkdtemp(join(tmpdir(), "gent-src-"));
		await writeSkillDir(sourceDir, "alpha");
		await writeSkillDir(sourceDir, "beta");
		await writeSkillDir(sourceDir, "gamma");

		const { io, err, asked } = captureIo(["1,3"]);
		const code = await run(["add", sourceDir], io, ctxFor(home, true));

		expect(code).toBe(0);
		expect(err).toEqual([]);
		expect(asked.length).toBe(1);
		expect(asked[0]).toContain("Select skills to add");

		const manifest = await readManifest(globalManifestPath({ HOME: home }));
		expect(Object.keys(manifest?.skills ?? {}).sort()).toEqual(["alpha", "gamma"]);
	});

	test("collision with an existing managed skill errors and leaves the manifest and disk untouched", async () => {
		const home = await tmpHome();
		const manifestPath = globalManifestPath({ HOME: home });
		await writeManifest(manifestPath, {
			version: 1,
			skills: { alpha: { source: "github:existing/repo", hash: "sha256:existing" } },
		});

		const sourceDir = await mkdtemp(join(tmpdir(), "gent-src-"));
		const skillDir = await writeSkillDir(sourceDir, "alpha");

		const { io, out, err } = captureIo();
		const code = await run(["add", skillDir], io, ctxFor(home));

		expect(code).toBe(1);
		expect(out).toEqual([]);
		expect(err).toEqual(["gent add: skill 'alpha' already managed (from github:existing/repo)"]);

		const storeDir = join(home, ".agents", "skills", "alpha");
		expect(await lstat(storeDir).catch(() => null)).toBeNull();

		const manifest = await readManifest(manifestPath);
		expect(manifest?.skills.alpha?.source).toBe("github:existing/repo");
	});

	test("a collision inside an --all batch blocks the whole batch (all-or-nothing)", async () => {
		const home = await tmpHome();
		const manifestPath = globalManifestPath({ HOME: home });
		await writeManifest(manifestPath, {
			version: 1,
			skills: { alpha: { source: "github:existing/repo", hash: "sha256:existing" } },
		});

		const sourceDir = await mkdtemp(join(tmpdir(), "gent-src-"));
		await writeSkillDir(sourceDir, "alpha");
		await writeSkillDir(sourceDir, "beta");

		const { io, err } = captureIo();
		const code = await run(["add", sourceDir, "--all"], io, ctxFor(home));

		expect(code).toBe(1);
		expect(err).toEqual(["gent add: skill 'alpha' already managed (from github:existing/repo)"]);

		const betaStore = join(home, ".agents", "skills", "beta");
		expect(await lstat(betaStore).catch(() => null)).toBeNull();

		const manifest = await readManifest(manifestPath);
		expect(Object.keys(manifest?.skills ?? {})).toEqual(["alpha"]);
	});
});

describe("gent add (git source)", () => {
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
	 * Fixture repo, two commits (tag v1, then main), reached through the CLI's
	 * "github:owner/repo" shorthand via a `url.insteadOf` rewrite scoped to a
	 * throwaway GIT_CONFIG_GLOBAL — no real network, no source-file changes,
	 * and it never touches the developer's real ~/.gitconfig.
	 */
	let repo: string;
	let sha1: string;
	let sha2: string;
	let originalGitConfigGlobal: string | undefined;

	beforeAll(async () => {
		repo = await mkdtemp(join(tmpdir(), "gent-add-fixture-"));
		await git(["init", "-q", "-b", "main", "."], repo);
		await git(["config", "user.email", "t@example.com"], repo);
		await git(["config", "user.name", "t"], repo);
		await git(["config", "uploadpack.allowFilter", "true"], repo);
		await git(["config", "uploadpack.allowAnySHA1InWant", "true"], repo);

		await Bun.write(join(repo, "SKILL.md"), "---\nname: gitskill\n---\nv1\n");
		await git(["add", "."], repo);
		await git(["commit", "-q", "-m", "one"], repo);
		await git(["tag", "v1"], repo);
		sha1 = await git(["rev-parse", "HEAD"], repo);

		await Bun.write(join(repo, "SKILL.md"), "---\nname: gitskill\n---\nv2\n");
		await git(["add", "."], repo);
		await git(["commit", "-q", "-m", "two"], repo);
		sha2 = await git(["rev-parse", "HEAD"], repo);

		const configDir = await mkdtemp(join(tmpdir(), "gent-add-gitconfig-"));
		const configPath = join(configDir, "gitconfig");
		await Bun.write(
			configPath,
			[
				`[url "file://${repo}/"]`,
				"    insteadOf = https://github.com/gent-fixture-owner/gent-fixture-repo.git",
				"",
			].join("\n"),
		);
		originalGitConfigGlobal = process.env.GIT_CONFIG_GLOBAL;
		process.env.GIT_CONFIG_GLOBAL = configPath;
	});

	// Not using bun:test's afterAll import to keep this block self-contained;
	// restore is best-effort cleanup so later test files see the real config.
	process.on("exit", () => {
		if (originalGitConfigGlobal === undefined) delete process.env.GIT_CONFIG_GLOBAL;
		else process.env.GIT_CONFIG_GLOBAL = originalGitConfigGlobal;
	});

	test("records resolvedRef and a #ref pin, and materializes the pinned content", async () => {
		const home = await tmpHome();
		const { io, out, err } = captureIo();

		const code = await run(
			["add", "github:gent-fixture-owner/gent-fixture-repo#v1"],
			io,
			ctxFor(home),
		);

		expect(code).toBe(0);
		expect(err).toEqual([]);
		expect(out).toEqual(["added gitskill (github:gent-fixture-owner/gent-fixture-repo)"]);

		const manifest = await readManifest(globalManifestPath({ HOME: home }));
		const entry = manifest?.skills.gitskill;
		expect(entry?.source).toBe("github:gent-fixture-owner/gent-fixture-repo");
		expect(entry?.ref).toBe("v1");
		expect(entry?.resolvedRef).toBe(sha1);
		expect(entry?.resolvedRef).not.toBe(sha2);

		const storeDir = join(home, ".agents", "skills", "gitskill");
		expect(await Bun.file(join(storeDir, "SKILL.md")).text()).toContain("v1");
	});
});

describe("gent remove", () => {
	test("missing argument is a usage error", async () => {
		const home = await tmpHome();
		const { io, out, err } = captureIo();

		const code = await run(["remove"], io, ctxFor(home));

		expect(code).toBe(1);
		expect(out).toEqual([]);
		expect(err.join("\n")).toContain("usage");
	});

	test("unknown skill name errors and leaves the manifest untouched", async () => {
		const home = await tmpHome();
		const { io, out, err } = captureIo();

		const code = await run(["remove", "nope"], io, ctxFor(home));

		expect(code).toBe(1);
		expect(out).toEqual([]);
		expect(err).toEqual(["gent remove: no managed skill 'nope'"]);
	});

	test("happy path: dematerializes the store entry, drops the manifest entry, and removes holdout links", async () => {
		const home = await tmpHome();
		await withClaudeCode(home);
		const sourceDir = await mkdtemp(join(tmpdir(), "gent-src-"));
		const skillDir = await writeSkillDir(sourceDir, "alpha");
		await run(["add", skillDir], captureIo().io, ctxFor(home));

		const storeDir = join(home, ".agents", "skills", "alpha");
		const linkPath = join(home, ".claude", "skills", "alpha");
		expect(await lstat(storeDir).catch(() => null)).not.toBeNull();
		expect(await readlink(linkPath)).toBe(storeDir);

		const { io, out, err } = captureIo();
		const code = await run(["remove", "alpha"], io, ctxFor(home));

		expect(code).toBe(0);
		expect(err).toEqual([]);
		expect(out).toEqual(["removed alpha"]);

		expect(await lstat(storeDir).catch(() => null)).toBeNull();
		expect(await lstat(linkPath).catch(() => null)).toBeNull();

		const manifest = await readManifest(globalManifestPath({ HOME: home }));
		expect(manifest?.skills.alpha).toBeUndefined();
	});

	test("a foreign real directory at a holdout path survives removal, reported as a warning", async () => {
		const home = await tmpHome();
		await withClaudeCode(home);
		const sourceDir = await mkdtemp(join(tmpdir(), "gent-src-"));
		const skillDir = await writeSkillDir(sourceDir, "alpha");
		await run(["add", skillDir], captureIo().io, ctxFor(home));

		// Replace the holdout symlink with a real foreign directory gent must not touch.
		const linkPath = join(home, ".claude", "skills", "alpha");
		await rm(linkPath, { recursive: true, force: true });
		await mkdir(linkPath, { recursive: true });
		await Bun.write(join(linkPath, "keep.txt"), "do not delete");

		const { io, out, err } = captureIo();
		const code = await run(["remove", "alpha"], io, ctxFor(home));

		expect(code).toBe(0);
		expect(out).toEqual(["removed alpha"]);
		expect(err.length).toBe(1);
		expect(err[0]).toContain(linkPath);

		expect(await Bun.file(join(linkPath, "keep.txt")).text()).toBe("do not delete");
		const storeDir = join(home, ".agents", "skills", "alpha");
		expect(await lstat(storeDir).catch(() => null)).toBeNull();

		const manifest = await readManifest(globalManifestPath({ HOME: home }));
		expect(manifest?.skills.alpha).toBeUndefined();
	});
});
