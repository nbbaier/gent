import { homedir } from "node:os";
import { join } from "node:path";
import type { CommandContext } from "../commands.ts";
import { emptyManifest, globalManifestPath, readManifest, writeManifest, type Manifest } from "../manifest.ts";
import type { Placement } from "../materialize.ts";
import { detectInstalledTools, resolveTargets } from "../registry/index.ts";

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
