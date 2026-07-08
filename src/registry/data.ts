import type { ToolSpec } from "./types.ts";

/**
 * The nine known agent tools, derived from `docs/skill-data.json` and the
 * per-agent findings sections of `docs/agent-skill-resolution.md`. All facts
 * were observed on one machine (darwin 24.6.0) at the versions/dates below —
 * expect drift with tool updates (see the Maintenance notes in issue #7).
 *
 * `observed.version` is "unknown" for tools whose version was never captured
 * in the research (Amp, Copilot CLI, Gemini CLI) — the docs record dates but
 * no version string for those three.
 *
 * Exactly two tools are holdouts (ADR-0002): Claude Code and Factory droid.
 * The symlink gate is retired, so there is no copy-fallback field.
 */
export const tools: ToolSpec[] = [
	{
		id: "amp",
		displayName: "Amp",
		detect: {
			bins: ["amp"],
			configDirs: [".config/amp"],
			appPaths: [],
		},
		// Precedence (first wins): ~/.config/agents/skills, ~/.agents/skills,
		// ~/.config/amp/skills, .agents/skills, .claude/skills, ~/.claude/skills.
		globalRoots: [".config/agents/skills", ".agents/skills", ".config/amp/skills", ".claude/skills"],
		projectFlavors: [
			// Walk-up is unbounded: scans cwd and every ancestor to the filesystem
			// root, git root is not a boundary (probed 2026-07-05).
			{ dir: ".agents/skills", walkUp: "fs-root" },
			{ dir: ".claude/skills", walkUp: "fs-root" },
		],
		holdout: null,
		runtime: {
			strategy: "query",
			queryCommand: ["amp", "skill", "list", "--json"],
			parseFormat: "json",
		},
		observed: { version: "unknown", date: "2026-07-05" },
	},
	{
		id: "claude-code",
		displayName: "Claude Code",
		detect: {
			bins: ["claude"],
			configDirs: [".claude"],
			appPaths: [],
		},
		globalRoots: [".claude/skills"],
		projectFlavors: [
			// cwd -> git root inclusive; no .git anywhere -> filesystem root
			// (undocumented fallback, probe-confirmed 2026-07-06).
			{ dir: ".claude/skills", walkUp: "git-root-or-fs-root" },
		],
		// Does not read .agents/skills (isolation-probe confirmed) — the only
		// source of shared content is the ~/.claude/skills symlink farm, so it
		// needs a real symlink into the canonical store (ADR-0002).
		holdout: { globalDir: ".claude/skills", projectDir: ".claude/skills" },
		runtime: {
			// Query surface exists (bogus-key debug harness) but leaves junk
			// session transcripts on every run; modeled per ADR-0004.
			strategy: "model",
		},
		observed: { version: "2.1.201", date: "2026-07-06" },
	},
	{
		id: "codex",
		displayName: "OpenAI Codex",
		detect: {
			bins: ["codex"],
			configDirs: [".codex"],
			appPaths: [],
		},
		globalRoots: [".agents/skills", ".codex/skills", ".codex/skills/.system"],
		projectFlavors: [
			// Walk-up stops at the nearest project-root marker (default .git),
			// inclusive; configurable via project_root_markers.
			{ dir: ".agents/skills", walkUp: "git-root" },
			{ dir: ".codex/skills", walkUp: "git-root" },
		],
		holdout: null,
		runtime: {
			strategy: "query",
			queryCommand: ["codex", "debug", "prompt-input"],
			parseFormat: "text",
			// `codex skills` is a paid-prompt trap — never invoke it.
			neverInvoke: ["codex skills"],
		},
		observed: { version: "0.140.0", date: "2026-07-05" },
	},
	{
		id: "copilot-cli",
		displayName: "GitHub Copilot CLI",
		detect: {
			bins: ["copilot"],
			configDirs: [".copilot"],
			appPaths: [],
		},
		globalRoots: [".copilot/skills", ".agents/skills"],
		projectFlavors: [
			// Walk-up stops at the git root, inclusive (source labels: `project`
			// at cwd, `inherited` for any ancestor including the git root).
			{ dir: ".github/skills", walkUp: "git-root" },
			{ dir: ".agents/skills", walkUp: "git-root" },
			{ dir: ".claude/skills", walkUp: "git-root" },
		],
		holdout: null,
		runtime: {
			strategy: "query",
			queryCommand: ["copilot", "skill", "list", "--json"],
			parseFormat: "json",
		},
		observed: { version: "unknown", date: "2026-07-06" },
	},
	{
		id: "cursor",
		displayName: "Cursor",
		detect: {
			bins: ["cursor-agent"],
			configDirs: [".cursor"],
			appPaths: ["/Applications/Cursor.app"],
		},
		globalRoots: [".cursor/skills", ".agents/skills", ".claude/skills", ".codex/skills"],
		projectFlavors: [
			// Anchor is the workspace dir (cwd), no walk in either direction.
			{ dir: ".cursor/skills", walkUp: "none" },
			{ dir: ".agents/skills", walkUp: "none" },
			{ dir: ".claude/skills", walkUp: "none" },
			{ dir: ".codex/skills", walkUp: "none" },
		],
		holdout: null,
		runtime: {
			// No local query surface; `cursor-agent skills` costs a model call.
			strategy: "model",
			neverInvoke: ["cursor-agent skills"],
		},
		observed: { version: "2026.07.01-41b2de7", date: "2026-07-06" },
	},
	{
		id: "droid",
		displayName: "Factory droid",
		detect: {
			bins: ["droid"],
			configDirs: [".factory"],
			appPaths: [],
		},
		// .claude is NOT a global root for droid — that path is an interactive
		// "Import Skills from Claude Code" copy flow, not a resolution source
		// (reconciled 2026-07-06, v0.164.0).
		globalRoots: [".factory/skills", ".agents/skills", ".agent/skills"],
		projectFlavors: [
			// Single anchor, no ancestor scan: the git root inside a repo, the
			// exact cwd outside one.
			{ dir: ".factory/skills", walkUp: "git-root-anchor" },
			{ dir: ".agents/skills", walkUp: "git-root-anchor" },
			{ dir: ".agent/skills", walkUp: "git-root-anchor" },
		],
		// Holdout per ADR-0002: gent links into droid's own .factory/skills
		// root rather than relying solely on the .agents/skills reads above
		// (symlink-following end-to-end verified 2026-07-06, v0.164.0).
		holdout: { globalDir: ".factory/skills", projectDir: ".factory/skills" },
		runtime: {
			// No list output; must model (TUI header count is probe-only).
			strategy: "model",
		},
		observed: { version: "0.164.0", date: "2026-07-06" },
	},
	{
		id: "gemini",
		displayName: "Gemini CLI",
		detect: {
			bins: ["gemini"],
			configDirs: [".gemini"],
			appPaths: [],
		},
		// Within a tier, .agents/skills takes precedence over .gemini/skills.
		globalRoots: [".agents/skills", ".gemini/skills"],
		projectFlavors: [
			// Project scope is cwd only — no walk-up in either direction.
			{ dir: ".agents/skills", walkUp: "none" },
			{ dir: ".gemini/skills", walkUp: "none" },
		],
		holdout: null,
		runtime: {
			strategy: "query-trust-corrected",
			queryCommand: ["gemini", "skills", "list", "--all"],
			parseFormat: "text",
			trustCheck: {
				file: ".gemini/trustedFolders.json",
				note: "In an untrusted folder, `gemini skills list --all` silently omits all project skills — check trust state before treating the query output as complete.",
			},
		},
		observed: { version: "unknown", date: "2026-07-05" },
	},
	{
		id: "opencode",
		displayName: "OpenCode",
		detect: {
			bins: ["opencode"],
			configDirs: [".opencode", ".config/opencode"],
			appPaths: [],
		},
		globalRoots: [".config/opencode/skills", ".opencode/skills", ".claude/skills", ".agents/skills"],
		projectFlavors: [
			// Walk-up is git-root-bounded, inclusive.
			{ dir: ".opencode/skills", walkUp: "git-root" },
			{ dir: ".agents/skills", walkUp: "git-root" },
			{ dir: ".claude/skills", walkUp: "git-root" },
		],
		holdout: null,
		runtime: {
			strategy: "query",
			queryCommand: ["opencode", "debug", "skill"],
			parseFormat: "json",
		},
		observed: { version: "1.17.9", date: "2026-07-05" },
	},
	{
		id: "pi",
		displayName: "Pi",
		detect: {
			bins: ["pi"],
			configDirs: [".pi"],
			appPaths: [],
		},
		globalRoots: [".pi/agent/skills", ".agents/skills"],
		projectFlavors: [
			// .pi/skills is cwd-only (trust-gated); .agents/skills walks up to
			// the git root inclusive, or the filesystem root with no .git
			// anywhere — a genuine per-flavor split, the reason walkUp lives
			// on ProjectFlavor rather than on ToolSpec.
			{ dir: ".pi/skills", walkUp: "none" },
			{ dir: ".agents/skills", walkUp: "git-root-or-fs-root" },
		],
		holdout: null,
		runtime: {
			strategy: "query-trust-corrected",
			// Request is written to stdin, not argv:
			//   printf '{"type":"get_commands","id":"1"}\n' | pi --mode rpc --offline --no-session
			queryCommand: ["pi", "--mode", "rpc", "--offline", "--no-session"],
			parseFormat: "jsonl",
			trustCheck: {
				file: ".pi/agent/trust.json",
				note: "Project sources load only when the folder is trusted; the RPC request `{\"type\":\"get_commands\",\"id\":\"1\"}\\n` must be written to stdin, not passed as argv.",
			},
		},
		observed: { version: "0.80.3", date: "2026-07-05" },
	},
];
