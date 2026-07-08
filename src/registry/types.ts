/**
 * The tool registry schema. gent uses this to detect which agent tools are
 * installed and where they read skills from, so it knows which holdout tools
 * (ADR-0002) need a symlink into the canonical `.agents/skills` store.
 *
 * The `runtime` field is not consumed in v1 — it ships now so the registry
 * never needs reshaping when `gent list --agent` (issue #16) lands the query
 * runners and modeled resolver described in ADR-0004.
 */

/** How far up the directory tree a project-scope skill dir is searched for. */
export type WalkUpRule =
	| "none" // exactly the anchor dir (cwd), no ancestors
	| "git-root" // cwd → git root, inclusive; nothing above
	| "git-root-or-fs-root" // cwd → git root; if no .git anywhere, to filesystem root
	| "fs-root" // cwd and every ancestor to the filesystem root
	| "git-root-anchor"; // no ancestor scan: the single dir is the git root (cwd outside a repo)

export interface ProjectFlavor {
	/** Repo-relative skills dir, e.g. ".agents/skills". */
	dir: string;
	walkUp: WalkUpRule;
}

export type RuntimeStrategy = "query" | "model" | "query-trust-corrected";

export interface ToolRuntime {
	strategy: RuntimeStrategy;
	/** argv to shell out to for the resolved-skill list; absent for strategy "model". */
	queryCommand?: string[];
	/** How to parse queryCommand output. */
	parseFormat?: "json" | "jsonl" | "text";
	/** How to check folder trust before believing query output (Gemini, Pi). */
	trustCheck?: { file: string; note: string };
	/** Surfaces that must never be invoked (paid-prompt traps). */
	neverInvoke?: string[];
}

export interface ToolSpec {
	/** Stable id used in manifest `targets` add/exclude, e.g. "claude-code". */
	id: string;
	displayName: string;
	detect: {
		/** Binary names to look up on PATH. */
		bins: string[];
		/** Home-relative config dirs whose existence implies installation, e.g. ".claude". */
		configDirs: string[];
		/** Absolute app-bundle paths (macOS), e.g. "/Applications/Cursor.app". */
		appPaths: string[];
	};
	/** Home-relative global skills roots the tool reads, first = preferred. */
	globalRoots: string[];
	projectFlavors: ProjectFlavor[];
	/**
	 * Set when the tool does NOT read `.agents/skills` and needs a symlink:
	 * home-relative global dir and repo-relative project dir to link into.
	 */
	holdout: { globalDir: string; projectDir: string } | null;
	runtime: ToolRuntime;
	/** Version + date the facts were observed at (they drift with tool updates). */
	observed: { version: string; date: string };
}
