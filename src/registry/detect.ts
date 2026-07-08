import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Targets } from "../manifest.ts";
import { tools } from "./data.ts";
import type { ToolSpec } from "./types.ts";

export interface DetectOptions {
	home?: string;
	which?: (bin: string) => string | null;
	appExists?: (absPath: string) => boolean;
}

/** A tool is installed if any bin is on PATH, any configDir exists under home, or any appPath exists. */
export function detectInstalledTools(opts: DetectOptions = {}): ToolSpec[] {
	const home = opts.home ?? homedir();
	const which = opts.which ?? ((bin: string) => Bun.which(bin));
	const appExists = opts.appExists ?? ((p: string) => existsSync(p));

	return tools.filter((tool) => {
		const { bins, configDirs, appPaths } = tool.detect;
		if (bins.some((bin) => which(bin) !== null)) return true;
		if (configDirs.some((dir) => appExists(join(home, dir)))) return true;
		if (appPaths.some((p) => appExists(p))) return true;
		return false;
	});
}

/**
 * Effective holdout set: detected holdout tools, plus manifest targets.add
 * ids, minus targets.exclude ids. Unknown ids throw. targets.add also
 * rejects known non-holdout ids — such a tool has no holdout dirs to link
 * into, so downstream materialization would crash or silently no-op.
 * targets.exclude stays permissive for any known id (excluding a
 * non-holdout is a harmless no-op).
 */
export function resolveTargets(detected: ToolSpec[], targets?: Targets): ToolSpec[] {
	const byId = new Map(tools.map((t) => [t.id, t]));
	const knownIds = [...byId.keys()].sort();
	const holdoutIds = tools
		.filter((t) => t.holdout !== null)
		.map((t) => t.id)
		.sort();

	function lookup(id: string): ToolSpec {
		const tool = byId.get(id);
		if (!tool) {
			throw new Error(`unknown target '${id}' — known: ${knownIds.join(", ")}`);
		}
		return tool;
	}

	const excluded = new Set((targets?.exclude ?? []).map((id) => lookup(id).id));
	const result = new Map<string, ToolSpec>();

	for (const tool of detected) {
		if (tool.holdout === null) continue;
		if (excluded.has(tool.id)) continue;
		result.set(tool.id, tool);
	}

	for (const id of targets?.add ?? []) {
		const tool = lookup(id);
		if (tool.holdout === null) {
			throw new Error(
				`invalid target '${id}' — not a holdout tool; holdout targets: ${holdoutIds.join(", ")}`,
			);
		}
		if (excluded.has(tool.id)) continue;
		result.set(tool.id, tool);
	}

	return [...result.values()];
}
