import { cp, lstat, mkdir, readlink, rename, rm, symlink, unlink } from "node:fs/promises";
import { join, sep } from "node:path";
import { walkFiles } from "./fs-util.ts";
import { hashFolder } from "./hash.ts";

/**
 * Where a skill's canonical store lives and which holdout tool dirs (ADR-0002
 * — tools that don't read `.agents/skills`) need a symlink back to it.
 * Deliberately plain strings: callers (registry-aware code, tests) build
 * this from whatever scope/home logic applies; these primitives don't know
 * about scopes or the registry.
 */
export interface Placement {
	/** Absolute canonical-store root, e.g. <home>/.agents/skills. */
	storeRoot: string;
	/** Absolute holdout skills dirs to symlink into, e.g. <home>/.claude/skills. */
	holdoutDirs: string[];
}

export interface MaterializeReport {
	/** Store dir written (always set on success). */
	store: string;
	/** Symlinks created or retargeted, absolute link paths. */
	linked: string[];
	/** Holdout paths NOT touched because a real (non-symlink) file/dir sits there. */
	conflicts: string[];
}

export interface DematerializeReport {
	removedStore: boolean;
	/** Symlink paths removed. */
	unlinked: string[];
	/** Holdout paths left alone (real files/dirs — never gent's to delete). */
	conflicts: string[];
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await lstat(path);
		return true;
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
		throw err;
	}
}

/** True when `target` is storeRoot itself or nested under it (boundary-safe string prefix, not realpath — rule 5). */
function isUnderStore(target: string, storeRoot: string): boolean {
	const prefix = storeRoot.endsWith(sep) ? storeRoot : storeRoot + sep;
	return target === storeRoot || target.startsWith(prefix);
}

/**
 * Ensure <holdoutDir>/<name> is a symlink to storeDir for every holdout dir
 * (ADR-0002): missing -> create; symlink with any other target -> retarget
 * (it's gent's namespace, so stale links are repaired); real file/dir ->
 * leave untouched and report as a conflict. Already-correct links are left
 * alone and not reported, so re-running is a true no-op (rule 6).
 */
async function linkHoldouts(
	storeDir: string,
	name: string,
	holdoutDirs: string[],
): Promise<{ linked: string[]; conflicts: string[] }> {
	const linked: string[] = [];
	const conflicts: string[] = [];
	for (const holdoutDir of holdoutDirs) {
		const linkPath = join(holdoutDir, name);
		await mkdir(holdoutDir, { recursive: true });
		if (!(await pathExists(linkPath))) {
			await symlink(storeDir, linkPath);
			linked.push(linkPath);
			continue;
		}
		const st = await lstat(linkPath);
		if (!st.isSymbolicLink()) {
			conflicts.push(linkPath);
			continue;
		}
		const target = await readlink(linkPath);
		if (target !== storeDir) {
			await unlink(linkPath);
			await symlink(storeDir, linkPath);
			linked.push(linkPath);
		}
	}
	return { linked, conflicts };
}

/**
 * Copy srcDir into <storeRoot>/<name> (replacing any existing entry), then
 * ensure <holdoutDir>/<name> is a symlink to the store entry for each
 * holdout (ADR-0002). Contents are copied byte-identical, never transformed
 * (ADR-0003). Idempotent. When expectHash is given, the copied store entry
 * is re-hashed and a mismatch throws (integrity check against the
 * manifest's recorded hash).
 */
export async function materializeSkill(opts: {
	name: string;
	srcDir: string;
	placement: Placement;
	expectHash?: string;
}): Promise<MaterializeReport> {
	const { name, srcDir, placement, expectHash } = opts;

	// Validates the source tree (throws on symlinks in source trees, rule 1).
	await walkFiles(srcDir);

	await mkdir(placement.storeRoot, { recursive: true });
	const tmp = join(placement.storeRoot, `.tmp-${name}-${process.pid}`);
	await rm(tmp, { recursive: true, force: true });
	await cp(srcDir, tmp, { recursive: true });

	// Atomic replace: build the new entry alongside, then swap it in under
	// the final name so a crash never leaves a half-written store entry
	// under <storeRoot>/<name> (rule 2).
	const storeDir = join(placement.storeRoot, name);
	await rm(storeDir, { recursive: true, force: true });
	await rename(tmp, storeDir);

	if (expectHash !== undefined) {
		const actual = await hashFolder(storeDir);
		if (actual !== expectHash) {
			await rm(storeDir, { recursive: true, force: true });
			throw new Error(
				`materialize: hash mismatch for skill '${name}': expected ${expectHash}, got ${actual}`,
			);
		}
	}

	const { linked, conflicts } = await linkHoldouts(storeDir, name, placement.holdoutDirs);
	return { store: storeDir, linked, conflicts };
}

/**
 * Remove <holdoutDir>/<name> links that point into storeRoot (including
 * broken ones — checked via the link's recorded target string, not
 * realpath, so a dangling link is still removable, rule 5), then remove
 * <storeRoot>/<name>. Idempotent — missing pieces are fine.
 */
export async function dematerializeSkill(opts: {
	name: string;
	placement: Placement;
}): Promise<DematerializeReport> {
	const { name, placement } = opts;
	const unlinked: string[] = [];
	const conflicts: string[] = [];

	for (const holdoutDir of placement.holdoutDirs) {
		const linkPath = join(holdoutDir, name);
		if (!(await pathExists(linkPath))) continue;
		const st = await lstat(linkPath);
		if (!st.isSymbolicLink()) {
			conflicts.push(linkPath);
			continue;
		}
		const target = await readlink(linkPath);
		if (isUnderStore(target, placement.storeRoot)) {
			await unlink(linkPath);
			unlinked.push(linkPath);
		} else {
			conflicts.push(linkPath);
		}
	}

	const storeDir = join(placement.storeRoot, name);
	const removedStore = await pathExists(storeDir);
	if (removedStore) {
		await rm(storeDir, { recursive: true, force: true });
	}

	return { removedStore, unlinked, conflicts };
}

/**
 * Re-create missing or wrong-target holdout links for an existing store
 * entry, without touching store contents — the recovery path when e.g.
 * moving $HOME breaks the absolute symlinks (rule 3, `gent sync`).
 */
export async function repairLinks(opts: {
	name: string;
	placement: Placement;
}): Promise<MaterializeReport> {
	const { name, placement } = opts;
	const storeDir = join(placement.storeRoot, name);
	if (!(await pathExists(storeDir))) {
		throw new Error(`materialize: no store entry for skill '${name}' at ${storeDir}`);
	}
	const { linked, conflicts } = await linkHoldouts(storeDir, name, placement.holdoutDirs);
	return { store: storeDir, linked, conflicts };
}
