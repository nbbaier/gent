import { stat } from "node:fs/promises";
import { walkFiles } from "../fs-util.ts";
import type { ResolvedSource, SourceRef } from "./types.ts";

/** Read a local directory in place — no copy, no ref to resolve. */
export async function resolveLocal(
	ref: Extract<SourceRef, { kind: "local" }>,
): Promise<ResolvedSource> {
	const pathStat = await stat(ref.path).catch(() => null);
	if (!pathStat) throw new Error(`local source '${ref.path}' does not exist`);
	if (!pathStat.isDirectory())
		throw new Error(`local source '${ref.path}' is not a directory`);
	return {
		root: ref.path,
		files: await walkFiles(ref.path),
		resolvedRef: null,
		subpath: null,
	};
}
