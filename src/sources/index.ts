import { resolveGit, type GitResolveOptions } from "./git.ts";
import { resolveLocal } from "./local.ts";
import type { ResolvedSource, SourceRef } from "./types.ts";

export { parseSourceRef } from "./ref.ts";
export type { ResolvedSource, SourceRef } from "./types.ts";

/** One contract for every source kind: resolve(ref) -> {files, resolvedRef, subpath}. */
export function resolveSource(
	ref: SourceRef,
	opts: GitResolveOptions = {},
): Promise<ResolvedSource> {
	switch (ref.kind) {
		case "git":
			return resolveGit(ref, opts);
		case "local":
			return resolveLocal(ref);
	}
}
