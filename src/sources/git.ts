import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { walkFiles } from "../fs-util.ts";
import type { ResolvedSource, SourceRef } from "./types.ts";

export interface GitResolveOptions {
	/** Checkout directory; a fresh temp dir is created when omitted. */
	workDir?: string;
}

async function git(args: string[], cwd?: string): Promise<string> {
	const proc = Bun.spawn(["git", ...args], {
		cwd,
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, code] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	if (code !== 0) {
		throw new Error(
			`git ${args.join(" ")} failed (exit ${code}): ${stderr.trim()}`,
		);
	}
	return stdout.trim();
}

/**
 * Fetch a git source with system git: sparse partial checkout (blobless,
 * depth 1, narrowed to subpath) + rev-parse for the resolved sha. Falls back
 * to a full blobless fetch for refs that can't be fetched directly (e.g.
 * short shas).
 */
export async function resolveGit(
	ref: Extract<SourceRef, { kind: "git" }>,
	opts: GitResolveOptions = {},
): Promise<ResolvedSource> {
	const checkout = opts.workDir ?? (await mkdtemp(join(tmpdir(), "gent-git-")));
	await git(["init", "-q", checkout]);
	await git(["remote", "add", "origin", ref.url], checkout);
	if (ref.subpath) {
		await git(["sparse-checkout", "set", ref.subpath], checkout);
	}

	try {
		await git(
			[
				"fetch",
				"-q",
				"--depth",
				"1",
				"--filter=blob:none",
				"origin",
				ref.ref ?? "HEAD",
			],
			checkout,
		);
		await git(["checkout", "-q", "--detach", "FETCH_HEAD"], checkout);
	} catch (primaryError) {
		if (!ref.ref) throw primaryError;
		await git(
			["fetch", "-q", "--filter=blob:none", "--tags", "origin"],
			checkout,
		);
		let target: string;
		try {
			target = await git(
				["rev-parse", "--verify", `refs/remotes/origin/${ref.ref}`],
				checkout,
			);
		} catch {
			target = await git(
				["rev-parse", "--verify", `${ref.ref}^{commit}`],
				checkout,
			);
		}
		await git(["checkout", "-q", "--detach", target], checkout);
	}

	const resolvedRef = await git(["rev-parse", "HEAD"], checkout);
	const root = ref.subpath ? join(checkout, ref.subpath) : checkout;
	const rootStat = await stat(root).catch(() => null);
	if (!rootStat?.isDirectory()) {
		throw new Error(
			`subpath '${ref.subpath}' not found in ${ref.url} at ${resolvedRef}`,
		);
	}
	return {
		root,
		files: await walkFiles(root),
		resolvedRef,
		subpath: ref.subpath,
	};
}
