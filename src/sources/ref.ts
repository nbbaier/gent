import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { SourceRef } from "./types.ts";

export interface ParseOptions {
	cwd?: string;
	home?: string;
}

/**
 * Turn a user-supplied source string into a SourceRef.
 *
 * Local: "/abs", "./rel", "../rel", "~/path", "file://…" (no #ref — a local
 * path is always read as-is). Git: "github:owner/repo[/subpath]", any
 * http(s)/ssh/git@ URL, or anything ending in .git; an optional "#ref"
 * suffix pins a branch, tag, or sha. Subpaths are only expressible in the
 * github: shorthand.
 */
export function parseSourceRef(raw: string, opts: ParseOptions = {}): SourceRef {
	const cwd = opts.cwd ?? process.cwd();
	const home = opts.home ?? homedir();

	if (raw.startsWith("file://")) {
		return { kind: "local", path: fileURLToPath(raw) };
	}
	if (raw === "~" || raw.startsWith("~/")) {
		return { kind: "local", path: join(home, raw.slice(2)) };
	}
	if (raw === "." || raw === ".." || /^(\/|\.\/|\.\.\/)/.test(raw)) {
		return { kind: "local", path: resolve(cwd, raw) };
	}

	const hashAt = raw.indexOf("#");
	const base = hashAt === -1 ? raw : raw.slice(0, hashAt);
	const ref = hashAt === -1 ? null : raw.slice(hashAt + 1) || null;

	if (base.startsWith("github:")) {
		const parts = base.slice("github:".length).split("/").filter(Boolean);
		if (parts.length < 2) {
			throw new Error(`invalid github source '${raw}' — expected github:owner/repo[/subpath]`);
		}
		const [owner, repo, ...sub] = parts;
		return checked({
			kind: "git",
			url: `https://github.com/${owner}/${repo}.git`,
			ref,
			subpath: sub.length ? sub.join("/") : null,
		});
	}

	if (/^(https?|ssh|git):\/\//.test(base) || base.startsWith("git@") || base.endsWith(".git")) {
		return checked({ kind: "git", url: base, ref, subpath: null });
	}

	throw new Error(
		`unrecognized source '${raw}' — expected github:owner/repo, a git URL, or a local path (prefix with ./ for relative paths)`,
	);
}

/**
 * url/ref/subpath become positional git arguments — reject anything git
 * would read as a flag (leading "-") or that escapes the checkout (".."
 * subpath segments). Exported for the resolver to re-check, since
 * SourceRefs can also be built from manifest data rather than this parser.
 */
export function assertSafeGitRef(ref: Extract<SourceRef, { kind: "git" }>): void {
	if (ref.url.startsWith("-")) {
		throw new Error(`invalid git url '${ref.url}' — must not start with '-'`);
	}
	if (ref.ref?.startsWith("-")) {
		throw new Error(`invalid git ref '${ref.ref}' — must not start with '-'`);
	}
	if (ref.subpath !== null) {
		const segments = ref.subpath.split("/");
		if (segments.some((s) => s === "" || s === "." || s === ".." || s.startsWith("-"))) {
			throw new Error(
				`invalid subpath '${ref.subpath}' — segments must not be empty, '.', '..', or start with '-'`,
			);
		}
	}
}

function checked(ref: Extract<SourceRef, { kind: "git" }>): SourceRef {
	assertSafeGitRef(ref);
	return ref;
}
