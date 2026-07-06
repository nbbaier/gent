export type SourceRef =
	| {
			kind: "git";
			url: string;
			/** Declared ref (branch, tag, or sha); null means the remote HEAD. */
			ref: string | null;
			/** Directory within the repo to narrow to, e.g. "skills/foo". */
			subpath: string | null;
	  }
	| { kind: "local"; path: string };

export interface ResolvedSource {
	/** Directory holding the fetched files, already narrowed to subpath when set. */
	root: string;
	/** Sorted relative file paths under root. */
	files: string[];
	/** Commit sha the ref resolved to; null for local sources. */
	resolvedRef: string | null;
	subpath: string | null;
}
