import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp } from "node:fs/promises";
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
	return mkdtemp(join(tmpdir(), "gent-update-home-"));
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
let fixtureSha2: string;
let originalGitConfigGlobal: string | undefined;

beforeAll(async () => {
	fixtureRepo = await mkdtemp(join(tmpdir(), "gent-update-git-fixture-"));
	await git(["init", "-q", "-b", "main", "."], fixtureRepo);
	await git(["config", "user.email", "t@example.com"], fixtureRepo);
	await git(["config", "user.name", "t"], fixtureRepo);
	await git(["config", "uploadpack.allowFilter", "true"], fixtureRepo);
	await git(["config", "uploadpack.allowAnySHA1InWant", "true"], fixtureRepo);
	await Bun.write(join(fixtureRepo, "SKILL.md"), "---\nname: gitskill\n---\nv1\n");
	await git(["add", "."], fixtureRepo);
	await git(["commit", "-q", "-m", "one"], fixtureRepo);
	fixtureSha1 = await git(["rev-parse", "HEAD"], fixtureRepo);
	await Bun.write(join(fixtureRepo, "SKILL.md"), "---\nname: gitskill\n---\nv2\n");
	await git(["add", "."], fixtureRepo);
	await git(["commit", "-q", "-m", "two"], fixtureRepo);
	fixtureSha2 = await git(["rev-parse", "HEAD"], fixtureRepo);

	const configDir = await mkdtemp(join(tmpdir(), "gent-update-gitconfig-"));
	const configPath = join(configDir, "gitconfig");
	await Bun.write(
		configPath,
		[
			`[url "file://${fixtureRepo}/"]`,
			"    insteadOf = https://github.com/gent-update-fixture-owner/gent-update-fixture-repo.git",
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

describe("gent update", () => {
	test("does not re-resolve a full-SHA git pin", async () => {
		const home = await tmpHome();
		const source = `github:gent-update-fixture-owner/gent-update-fixture-repo#${fixtureSha1}`;
		const added = captureIo();
		expect(await run(["add", source], added.io, ctxFor(home))).toBe(0);

		const manifestPath = globalManifestPath({ HOME: home });
		const manifestBefore = await Bun.file(manifestPath).text();
		const storeFile = join(home, ".agents", "skills", "gitskill", "SKILL.md");

		const { io, out, err } = captureIo();
		const code = await run(["update"], io, ctxFor(home));

		expect(code).toBe(0);
		expect(out).toEqual([`pinned gitskill (${fixtureSha1})`]);
		expect(err).toEqual([]);
		expect(await Bun.file(storeFile).text()).toContain("v1");
		expect(await Bun.file(manifestPath).text()).toBe(manifestBefore);
	});

	test("advances a branch ref, records the new hash, and re-materializes", async () => {
		const home = await tmpHome();
		const oldSourceDir = await mkdtemp(join(tmpdir(), "gent-update-old-source-"));
		await Bun.write(join(oldSourceDir, "SKILL.md"), "---\nname: gitskill\n---\nv1\n");
		const oldHash = await hashFolder(oldSourceDir);
		const storeDir = join(home, ".agents", "skills", "gitskill");
		await mkdir(storeDir, { recursive: true });
		await Bun.write(join(storeDir, "SKILL.md"), await Bun.file(join(oldSourceDir, "SKILL.md")).text());
		const manifestPath = globalManifestPath({ HOME: home });
		await writeManifest(manifestPath, {
			version: 1,
			skills: {
				gitskill: {
					source: "github:gent-update-fixture-owner/gent-update-fixture-repo",
					ref: "main",
					resolvedRef: fixtureSha1,
					hash: oldHash,
				},
			},
		});

		const { io, out, err } = captureIo();
		const code = await run(["update", "gitskill"], io, ctxFor(home));

		expect(code).toBe(0);
		expect(out).toEqual([`updated gitskill (${fixtureSha1.slice(0, 8)}..${fixtureSha2.slice(0, 8)})`]);
		expect(err).toEqual([]);
		expect(await Bun.file(join(storeDir, "SKILL.md")).text()).toContain("v2");
		const entry = (await readManifest(manifestPath))?.skills.gitskill;
		expect(entry?.ref).toBe("main");
		expect(entry?.resolvedRef).toBe(fixtureSha2);
		expect(entry?.hash).toBe(await hashFolder(storeDir));
	});

	test("re-records changed local source bytes and reports an unchanged source as up to date", async () => {
		const home = await tmpHome();
		const sourceParent = await mkdtemp(join(tmpdir(), "gent-update-source-"));
		const sourceDir = join(sourceParent, "alpha");
		await mkdir(sourceDir, { recursive: true });
		await Bun.write(join(sourceDir, "SKILL.md"), "---\nname: alpha\n---\nv1\n");
		expect(await run(["add", sourceDir], captureIo().io, ctxFor(home))).toBe(0);

		await Bun.write(join(sourceDir, "SKILL.md"), "---\nname: alpha\n---\nv2\n");
		const { io, out, err } = captureIo();
		expect(await run(["update", "alpha"], io, ctxFor(home))).toBe(0);
		expect(out).toEqual(["updated alpha"]);
		expect(err).toEqual([]);
		const storeFile = join(home, ".agents", "skills", "alpha", "SKILL.md");
		expect(await Bun.file(storeFile).text()).toContain("v2");

		const manifestPath = globalManifestPath({ HOME: home });
		const manifestAfterUpdate = await Bun.file(manifestPath).text();
		const entry = (await readManifest(manifestPath))?.skills.alpha;
		expect(entry?.hash).toBe(await hashFolder(sourceDir));

		const second = captureIo();
		expect(await run(["update", "alpha"], second.io, ctxFor(home))).toBe(0);
		expect(second.out).toEqual(["up to date alpha"]);
		expect(second.err).toEqual([]);
		expect(await Bun.file(manifestPath).text()).toBe(manifestAfterUpdate);
	});

	test("updates from the originally added relative source when run from another cwd", async () => {
		const home = await tmpHome();
		const addCwd = await mkdtemp(join(tmpdir(), "gent-update-add-cwd-"));
		const sourceDir = join(addCwd, "alpha");
		await mkdir(sourceDir, { recursive: true });
		await Bun.write(join(sourceDir, "SKILL.md"), "---\nname: alpha\n---\noriginal v1\n");
		expect(
			await run(["add", "./alpha"], captureIo().io, { ...ctxFor(home), cwd: addCwd }),
		).toBe(0);

		await Bun.write(join(sourceDir, "SKILL.md"), "---\nname: alpha\n---\noriginal v2\n");
		const updateCwd = await mkdtemp(join(tmpdir(), "gent-update-other-cwd-"));
		const unrelatedDir = join(updateCwd, "alpha");
		await mkdir(unrelatedDir, { recursive: true });
		await Bun.write(join(unrelatedDir, "SKILL.md"), "---\nname: alpha\n---\nunrelated bytes\n");

		const { io, out, err } = captureIo();
		expect(
			await run(["update", "alpha"], io, { ...ctxFor(home), cwd: updateCwd }),
		).toBe(0);
		expect(out).toEqual(["updated alpha"]);
		expect(err).toEqual([]);
		const storeFile = join(home, ".agents", "skills", "alpha", "SKILL.md");
		expect(await Bun.file(storeFile).text()).toContain("original v2");
		expect(await Bun.file(storeFile).text()).not.toContain("unrelated bytes");
	});

	test("rejects a legacy relative manifest source instead of resolving it from the command cwd", async () => {
		const home = await tmpHome();
		const updateCwd = await mkdtemp(join(tmpdir(), "gent-update-legacy-cwd-"));
		const sourceDir = join(updateCwd, "alpha");
		await mkdir(sourceDir, { recursive: true });
		await Bun.write(join(sourceDir, "SKILL.md"), "---\nname: alpha\n---\nunrelated bytes\n");
		const manifestPath = globalManifestPath({ HOME: home });
		await writeManifest(manifestPath, {
			version: 1,
			skills: {
				alpha: { source: "./alpha", hash: await hashFolder(sourceDir) },
			},
		});

		const { io, out, err } = captureIo();
		expect(
			await run(["update", "alpha"], io, { ...ctxFor(home), cwd: updateCwd }),
		).toBe(1);
		expect(out).toEqual([]);
		expect(err).toHaveLength(1);
		expect(err[0]).toContain("relative local source './alpha'");
		expect(err[0]).toContain("remove and re-add 'alpha' using its source path");
		expect(
			await Bun.file(join(home, ".agents", "skills", "alpha", "SKILL.md")).exists(),
		).toBe(false);
	});

	test("protects drifted store bytes until --force is supplied", async () => {
		const home = await tmpHome();
		const sourceParent = await mkdtemp(join(tmpdir(), "gent-update-source-"));
		const sourceDir = join(sourceParent, "alpha");
		await mkdir(sourceDir, { recursive: true });
		await Bun.write(join(sourceDir, "SKILL.md"), "---\nname: alpha\n---\nv1\n");
		expect(await run(["add", sourceDir], captureIo().io, ctxFor(home))).toBe(0);

		const manifestPath = globalManifestPath({ HOME: home });
		const manifestBefore = await Bun.file(manifestPath).text();
		const storeFile = join(home, ".agents", "skills", "alpha", "SKILL.md");
		await Bun.write(storeFile, "---\nname: alpha\n---\nhand edit\n");
		await Bun.write(join(sourceDir, "SKILL.md"), "---\nname: alpha\n---\nv2\n");

		let result = captureIo();
		expect(await run(["update", "alpha"], result.io, ctxFor(home))).toBe(0);
		expect(result.out).toEqual([]);
		expect(result.err).toEqual([
			"warning: alpha has drifted; 'gent update --force alpha' discards the local edits",
		]);
		expect(await Bun.file(storeFile).text()).toContain("hand edit");
		expect(await Bun.file(manifestPath).text()).toBe(manifestBefore);

		result = captureIo();
		expect(await run(["update", "--force", "alpha"], result.io, ctxFor(home))).toBe(0);
		expect(result.out).toEqual(["updated alpha"]);
		expect(result.err).toEqual([]);
		expect(await Bun.file(storeFile).text()).toContain("v2");
		expect(await Bun.file(manifestPath).text()).not.toBe(manifestBefore);
	});

	test("reports an unknown named skill without writing a manifest", async () => {
		const home = await tmpHome();
		const { io, out, err } = captureIo();

		expect(await run(["update", "missing"], io, ctxFor(home))).toBe(1);
		expect(out).toEqual([]);
		expect(err).toEqual(["gent update: no managed skill 'missing'"]);
		expect(await Bun.file(globalManifestPath({ HOME: home })).exists()).toBe(false);
	});
});
