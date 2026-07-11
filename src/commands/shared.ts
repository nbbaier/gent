import { homedir } from "node:os";
import { join } from "node:path";
import type { CommandContext } from "../commands.ts";
import { discoverSkills, type DiscoveredSkill } from "../discovery.ts";
import { emptyManifest, globalManifestPath, readManifest, writeManifest, type Manifest } from "../manifest.ts";
import type { Placement } from "../materialize.ts";
import { detectInstalledTools, resolveTargets } from "../registry/index.ts";
import { parseSourceRef, resolveSource, type ResolvedSource, type SourceRef } from "../sources/index.ts";

/** Same home-resolution pattern as globalManifestPath: injected env, never process globals. */
export function resolveHome(env: Record<string, string | undefined>): string {
	return env.HOME ?? homedir();
}

/** Load the global manifest, or an empty one when no manifest file exists yet. */
export async function loadGlobalManifest(
	ctx: Pick<CommandContext, "env">,
): Promise<{ path: string; manifest: Manifest }> {
	const path = globalManifestPath(ctx.env);
	const manifest = (await readManifest(path)) ?? emptyManifest();
	return { path, manifest };
}

export async function saveGlobalManifest(path: string, manifest: Manifest): Promise<void> {
	await writeManifest(path, manifest);
}

export function reportHoldoutConflicts(
	error: (line: string) => void,
	conflicts: string[],
): void {
	for (const conflict of conflicts) {
		error(`warning: '${conflict}' exists and is not gent's symlink; left untouched`);
	}
}

export interface RefetchedSkill {
	sourceRef: SourceRef;
	resolved: ResolvedSource;
	skill: DiscoveredSkill;
}

export function parseManifestSource(
	entry: Manifest["skills"][string],
	name: string,
	opts: { cwd: string; home: string },
): SourceRef {
	if (
		entry.source === "." ||
		entry.source === ".." ||
		entry.source.startsWith("./") ||
		entry.source.startsWith("../")
	) {
		throw new Error(
			`relative local source '${entry.source}' has no stable base; re-add '${name}' to record its absolute path`,
		);
	}
	return parseSourceRef(entry.source, opts);
}

/** Resolve a manifest source again and select the named skill from it. */
export async function refetchSkill(
	entry: Manifest["skills"][string],
	name: string,
	opts: { cwd: string; home: string; gitRef?: string | null },
): Promise<RefetchedSkill> {
	const parsed = parseManifestSource(entry, name, { cwd: opts.cwd, home: opts.home });
	const sourceRef =
		parsed.kind === "git" && opts.gitRef !== undefined
			? { ...parsed, ref: opts.gitRef }
			: parsed;
	const resolved = await resolveSource(sourceRef);
	const matches = (await discoverSkills(resolved.root)).filter((skill) => skill.name === name);
	if (matches.length === 0) {
		throw new Error(`skill '${name}' not found in source '${entry.source}'`);
	}
	if (matches.length > 1) {
		throw new Error(`source '${entry.source}' contains multiple skills named '${name}'`);
	}
	return { sourceRef, resolved, skill: matches[0] as DiscoveredSkill };
}

/**
 * Global-scope Placement: canonical store under <home>/.agents/skills, holdout
 * dirs from whichever installed tools (ADR-0002) don't read .agents/skills,
 * adjusted by the manifest's targets.add/exclude.
 */
export function buildGlobalPlacement(ctx: Pick<CommandContext, "env">, manifest: Manifest): Placement {
	const home = resolveHome(ctx.env);
	const storeRoot = join(home, ".agents", "skills");
	const detected = detectInstalledTools({ home });
	const targets = resolveTargets(detected, manifest.targets);
	const holdoutDirs = targets
		.filter((tool) => tool.holdout !== null)
		.map((tool) => join(home, tool.holdout!.globalDir));
	return { storeRoot, holdoutDirs };
}
