# Agent Skill Resolution — research & plan for `gent list --agent`

> Working doc. Captures what we've verified about how each agent resolves skills **in practice**, so `gent` can answer "which skills does agent X actually have access to?" — and flags what still needs drilling into. Companion to the reference data in [`skill-locations.md`](./skill-locations.md) and [`skill-data.json`](./skill-data.json).
>
> Last updated: 2026-07-06. All "observed" facts are from this machine (darwin 24.6.0) on the date noted and will drift as tools update.

## The goal this serves

`gent list --agent <name>` (or similar) should report **every skill a given agent has access to, whether or not gent manages it**, and be **sensitive to project context** (cwd, repo root, plugins installed). The whole-picture view is the point — a resolver that only knows about gent-managed skills is the vercel-skills failure mode we're explicitly trying to avoid.

To do that, gent needs an accurate model of each agent's skill **resolution algorithm**, not what the docs claim it is.

## Why documentation isn't enough (the droid lesson)

Factory's docs list only `~/.factory/skills/`, `<repo>/.factory/skills/`, and `<repo>/.agent/skills/`. In reality the `droid` binary reads **four** home-dir roots — `.factory`, `.agents`, `.agent`, `.claude` (+`/skills`) — three undocumented, and it scans `~/.agents/skills/` **directly**. This was invisible until we:

1. found the path is built by `path.join(home, ".agents", "skills")` (so the literal `.agents/skills` never appears in the binary — an earlier grep false-negatived on it), and
2. ran an **isolation probe**: a uniquely-named skill in `~/.agents/skills/` only (no symlink anywhere) moved droid's `Skills (53)` → `Skills (54)`.

Takeaway: **every agent's resolution needs empirical verification.** See the [isolation-probe method](./skill-locations.md#observed-on-this-machine-2026-07-04) (in `skill-locations.md`).

## Strategy: query-first, model-as-fallback

For each agent, prefer the cheapest **authoritative** method:

1. **If the agent exposes a "list resolved skills" command → shell out to it.** This is best: it returns everything the agent sees (managed or not), and it can't drift when the tool changes its paths. Ideal if it emits machine-readable output with a source path.
2. **If not → encode a discovery model**, verified by isolation probe, and re-verify on a schedule (tools drift; droid was v0.164 mid-session).

Open architectural decision (decide before building): does gent **call the query command at runtime** where one exists, and fall back to a modeled resolver otherwise (hybrid), or **always model** for a uniform code path? Hybrid is the current lean.

## Per-agent query interface (observed 2026-07-04)

| Agent | Command | Names | Path | Source label | Machine-readable | Verdict |
|---|---|:--:|:--:|:--:|:--:|---|
| **GitHub Copilot (CLI)** | `copilot skill list --json` | ✅ | ✅ | ✅ | ✅ JSON | **Best** — `{name, description, source, path}` per skill |
| **Amp** | `amp skill list --json` | ✅ | ✅ (`file://` `baseDir`) | inferable from path | ✅ JSON | **Best-tier** — `{skills: [{name, description, baseDir}], errors}`; no explicit source label, but `baseDir` identifies the root |
| **Gemini CLI** | `gemini skills list --all` | ✅ | ✅ (`Location:`) | ✅ (`[Enabled]`) | ⚠️ text | Authoritative **only in trusted folders** — silently omits workspace skills otherwise (see walk-up findings) |
| **OpenAI Codex** | `codex debug prompt-input` | ✅ | ✅ (root alias + short path) | ✅ (root ↔ scope) | ⚠️ JSON prompt render, skills list is text inside | **Authoritative** — renders the model-visible prompt locally (no model call, <1s): `### Skill roots` table + `### Available skills`. Undocumented debug surface, so higher drift risk. `codex plugin list` still useful for enable state |
| **Pi** | RPC: `printf '{"type":"get_commands","id":"1"}\n' \| pi --mode rpc --offline --no-session` | ✅ (`skill:<name>`) | ✅ (`sourceInfo.path`) | ✅ (`scope`/`origin`) | ✅ JSONL | **Best-tier** — no model call/key/network; richest source metadata of any agent. Trust-gated like Gemini: project skills only appear when the folder is trusted (add `--approve` to trust for the run). `pi list` = packages only |
| **Factory (droid)** | — (TUI header `Skills (N)` count) | ❌ | ❌ | ❌ | ❌ | Must model — no list output, but the count is a reliable probe signal via a pty harness (200×60 winsize, strip ANSI, regex the header); plain `script` fails (1-column pty) |
| **Cursor** | — (no local query; `cursor-agent skills` is a paid-prompt trap like `codex skills`) | ❌ | ❌ | ❌ | ❌ | Must model — probed via one headless `--print --trust --mode ask` model call (the only agent that required one) |
| **OpenCode** | `opencode debug skill` | ✅ | ✅ (`location`) | via path | ✅ JSON | **Best-tier** — `[{name, description, location, content}]`, no model call, context-sensitive; `<built-in>` sentinel for bundled skills. Undocumented debug surface (found 2026-07-05). Piping was flaky — write to file, then parse |
| **Claude Code** | Bogus-key headless run: `ANTHROPIC_API_KEY=bogus claude -p hi --debug --debug-file <f>` → debug log + session transcript | ✅ (transcript) | ⚠️ (roots, not per skill) | ✅ (scope counts) | ⚠️ log lines + transcript JSONL | **Authoritative & free** — auth fails *after* skill discovery (exit 1, no model call): the log prints the exact scan set (`Loading skills from: … project=[…]`) + per-scope counts, and the run's transcript contains the full skills attachment as `name: description` lines. Side effect: junk session transcripts under `~/.claude/projects/` to clean up |

**7 of 9 give an authoritative resolved list** (Copilot CLI, Amp, OpenCode, Pi, Gemini, Codex, Claude Code) — four emit machine-readable output (Copilot CLI, Amp, OpenCode JSON; Pi JSONL over RPC). Four of the seven were found hiding in undocumented surfaces: `codex debug prompt-input`, `opencode debug skill`, Pi's `--mode rpc` `get_commands` (all 2026-07-05), and Claude Code's bogus-key debug-log harness (2026-07-06). The "no query command" claims in earlier notes came from reading docs and `--help` for *documented* commands — **check `<tool> debug --help`, any headless/RPC/serve mode, and startup debug logging before concluding an agent can't be queried.** Only droid and Cursor still need a modeled resolver.

> Drift note (2026-07-05): Amp's JSON list returned 135 skills (53 `~/.agents/skills` + 79 Claude plugin-cache + 3 built-in) vs. 132 observed on 2026-07-04 — the `~/.agents/skills` count moved 50→53 in a day. Query-at-runtime absorbs this automatically; a modeled resolver would need the drift harness (open question 6).

### Note: Copilot CLI ≠ Copilot cloud agent

`skill-data.json`'s "GitHub Copilot (cloud agent)" entry targets the **cloud** surface (server-side, not introspectable here, no plugin skills) — it's out of scope for the table above, since `gent list --agent` resolves against local machine + project context; only the CLI surface is modeled. The **CLI** (`copilot`) is a separate surface that *does* support plugin-bundled skills and exposes the best query interface we found. Its `copilot skill --help` documents its own sources:

- **Project:** `.github/skills/`, `.agents/skills/`, or `.claude/skills/`
- **Personal:** `~/.copilot/skills/` or `~/.agents/skills/`
- **Plugin:** installed plugins that bundle skills
- **Custom:** dirs added with `copilot skill add <directory>`

Observed `--json` `source` values — **all seven now observed** (final three on 2026-07-06): `personal-agents` (53, → `~/.agents/skills`), `builtin` (1, → `~/Library/Caches/copilot/pkg/.../builtin`), `project` (cwd skill dirs), `inherited` (ancestor dirs up to the git root), `personal-copilot` (→ `~/.copilot/skills/`), `custom` (dirs registered via `copilot skill add`; removable via `copilot skill remove <dir>`), and `plugin` (→ `~/.copilot/installed-plugins/<marketplace>/<plugin>/skills/`). The earlier `project-*` guess was wrong. Bonus finding: Copilot CLI accepts **Claude Code-format marketplaces and plugins verbatim** — `copilot plugin marketplace add <local-path>` with a `.claude-plugin/marketplace.json` + a plugin's `.claude-plugin/plugin.json` and `skills/` dir installed and served its bundled skill unchanged.

## The 5 dimensions a resolver spec must capture

For each agent, gent's model needs:

1. **Global roots** — which `~/.X/skills` dirs (droid surprised us with 4).
2. **Project roots + walk-up rule** — which in-repo dirs, and how far up the tree (cwd only? up to git root? filesystem root?). This is the "sensitive to project context" requirement. ✅ **Now tested for all nine agents** — six distinct patterns (see the consequence paragraph under the walk-up findings).
3. **Symlink following** — yes/no (decides whether the `~/.agents → ~/.claude` symlink farm counts as a second source or the same one).
4. **Plugin / extension sources** — cache locations + enable/disable state.
5. **Precedence / dedup on name collision** — who wins, or do duplicates coexist (Codex docs say both remain). ✅ **Now characterized for all nine** (2026-07-05/06); droid's is source-derived rather than probe-confirmed.

The isolation probe covers 1–3; `plugin list`-style commands + cache enumeration cover 4; deliberately colliding names covers 5.

## What's verified so far

- **Symlink topology (the backbone).** `~/.agents/skills/` is the physical source of truth (~53 real skill dirs). `~/.claude/skills/` is mostly symlinks back into it (+ a few real `ui-*` dirs). This is why most agents converge on the same set.
- **droid** — reads `~/.agents/skills/` directly; isolation-probe confirmed (`53→54`). Follows symlinks (loader; the header count doesn't count symlinked dirs). ✅ Resolved 2026-07-06: the "4 global roots incl. `~/.claude`" claim is **wrong for v0.164** — global roots are `.factory`/`.agent`/`.agents` only; `.claude` is touched solely by an interactive "Import Skills from Claude Code" TUI flow that *copies* skills (see droid subsection). Project scope probed 2026-07-05: single-anchor resolution, three flavors at the git root.
- **Amp** — resolved list = 50 `~/.agents/skills` + 79 Claude plugin-cache + 3 built-in (132). Reads Claude Code plugin caches, **not** Codex's. Amp's own plugins are TS-only (no skill API).
- **Gemini** — 52 = 50 `~/.agents/skills` + 2 npm-bundled built-ins. Reads neither Claude nor Codex plugin caches.
- **Copilot CLI** — 54 = 53 `~/.agents/skills` + 1 builtin, via `--json` (`name/description/source/path`).
- **Codex** — 50 `~/.agents/skills` + 5 `~/.codex/skills/.system` + 8 enabled plugins (`codex plugin list`). As of 2026-07-05: full resolution probed + source-verified — see the Codex subsection under walk-up findings, incl. the `codex debug prompt-input` query surface.
- **Pi** — 53 resolved on this machine via RPC `get_commands` (44 `~/.pi/agent/skills` + 9 `~/.agents/skills` after physical-path + name dedup); full resolution probed 2026-07-05 — see the Pi subsection under walk-up findings.
- **OpenCode** — 54 resolved on this machine via `opencode debug skill` (51 `~/.agents/skills` + 2 `~/.claude/skills` + 1 built-in); full resolution probed 2026-07-05 — see the OpenCode subsection under walk-up findings.
- **Claude Code** — from a clean non-repo dir: 63 skill-dir commands (53 user + 10 legacy `~/.claude/commands`) + 80 plugin skills + 26 bundled, "144 skills via attachment". Isolation-probe confirmed it does **not** read `~/.agents/skills/` or `~/.config/claude/skills/` — the shared set arrives only via the `~/.claude/skills` symlink farm (follows symlinks, project scope too). Full resolution probed 2026-07-06 — see the Claude Code subsection under walk-up findings.
- **Plugin-skill behavior** — bundle skills: Claude Code, Codex, Cursor, Factory, Gemini, Pi; do **not**: OpenCode (hooks/tools only — if that ever changes, `opencode debug skill` would surface them), Copilot cloud agent.

## Walk-up & precedence findings (observed 2026-07-05)

Probe method: uniquely-named skills at five levels of a throwaway tree — below cwd, at cwd, at an intermediate dir, at the git root, and 1–3 levels above the git root — in each agent's project-dir flavors, then query from the deep cwd. Unique names keep attribution unambiguous (each name exists in exactly one place). Colliding-name probes added afterward for precedence.

### Amp

- **Walk-up: unbounded.** Scans `.agents/skills/` and `.claude/skills/` in **cwd and every ancestor directory** — probes 1, 2, and 3 levels *above the git root* all loaded. The git root is not a boundary; model it as "walk to filesystem root."
- Does **not** scan subdirectories below cwd, and does **not** read `.github/skills/`.
- **Precedence (name collision): nearest directory wins** (cwd beat git root); at the same level, `.agents/skills/` beats `.claude/skills/`. Dedup — one entry survives, matching the manual's "first wins."
- Query: `amp skill list --json` → `{skills: [{name, description, baseDir}], errors}`.

### GitHub Copilot CLI

- **Walk-up: stops at the git root.** Scans `.github/skills/`, `.agents/skills/`, and `.claude/skills/` at cwd and each ancestor **up to and including the git root**; probes above the git root did not load.
- **Source labels observed: `project`** (cwd) **and `inherited`** (any ancestor, including the git root). The `project-*` taxonomy previously inferred from `--help` is wrong — `--help`'s "Project" bullet maps to these two labels.
- **Precedence: nearest directory wins** (`project` beat `inherited`); at the same level, `.github/skills/` > `.agents/skills/` > `.claude/skills/`. Dedup — one entry survives.

### Gemini CLI

- **Walk-up: none.** Project scope is exactly **cwd** — `cwd/.gemini/skills/` and `cwd/.agents/skills/`. Probes at the git root and parent dirs did not load even when trusted. (Confirmed both from the bundle source — `path.join(this.targetDir, ...)`, no ancestor loop — and empirically from a trusted dir.)
- **Trust gate: workspace skills load only in trusted folders** (`~/.gemini/trustedFolders.json`; `discoverSkills` returns early with "Workspace skills disabled because folder is not trusted"). Untrusted → `gemini skills list --all` **silently omits all project skills**, so the query command is only authoritative in trusted folders. gent must check trust state before treating Gemini's output as complete.
- **Precedence, from the bundle: last-wins with a warning.** Load order: built-in → extension → `~/.gemini/skills` → `~/.agents/skills` → `cwd/.gemini/skills` → `cwd/.agents/skills`; a later same-named skill *overrides* the earlier one (emits a "Skill conflict detected" warning), so **project `.agents/skills` is the highest-precedence source** — matching the documented tier order.

### OpenAI Codex (probed 2026-07-05, v0.140.0; source corroboration from openai/codex 0.142.5)

- **Query surface discovered: `codex debug prompt-input`** — renders the exact model-visible prompt as JSON locally (no model call, works offline, <1s), including a `### Skill roots` alias table (`r0 = /abs/path`, …) and `### Available skills` (`- name: desc (file: rN/<name>/SKILL.md)`). Context-sensitive (run it from the target cwd). Verified independently on this machine. Undocumented, so treat as higher-drift than the documented commands.
- **Walk-up: stops at the project root, inclusive** — probes at cwd, intermediate dir, and git root loaded; 1–2 levels above did not. The boundary is the nearest **project-root marker**, default `.git`, configurable via `project_root_markers` in config.toml (empty array → cwd only). Source: `find_project_root` walks `cwd.ancestors()`; `dirs_between_project_root_and_cwd` yields the scan set.
- **Project flavors: `.agents/skills` AND `.codex/skills`** (the latter under-documented), both git-root-bounded. **`.claude/skills` is NOT read in-repo** (probes at cwd and git root both absent) — unlike Amp and Copilot CLI.
- **Precedence: NO dedup — colliding names coexist** (confirmed: same name at two levels appears 2×; same name cross-flavor in one dir appears 2×). Dedup is by physical path only; entries are sorted by scope rank (Repo > User > System > Admin) then name, so the higher-scope copy lists first but the other survives. Matches the docs' claim, now probe-confirmed.
- Global roots: `~/.agents/skills` (User), deprecated-but-still-scanned `~/.codex/skills` (User), bundled `~/.codex/skills/.system` (System), `/etc/codex/skills` (Admin, absent here), plugin caches under `~/.codex/plugins/cache/*` (the real 5th source), plus an `extra_skill_roots` config hook. Roots scanned recursively to depth 6; directory symlinks followed.

### OpenCode (probed 2026-07-05, v1.17.9)

- **Query surface discovered: `opencode debug skill`** — JSON array of `{name, description, location, content}`, `location` is the absolute `SKILL.md` path (or `<built-in>`). No model call, offline, context-sensitive to cwd. Verified independently on this machine. Undocumented debug surface. Practical note: piping the output was flaky — redirect to a file, then parse.
- **Global roots (4 + built-in):** `~/.config/opencode/skills`, `~/.opencode/skills` (both probe-confirmed), `~/.agents/skills`, `~/.claude/skills`, plus 1 built-in (`customize-opencode`).
- **Project flavors: `.opencode/skills`, `.agents/skills`, `.claude/skills`** are read; `.github/skills` and `.agent/skills` (singular) are **not**.
- **Walk-up: git-root-bounded, inclusive** (same rule as Copilot CLI) — cwd, intermediate dirs, and git root loaded; above the git root did not. Whether an `opencode.json`-only project (no `.git`) also bounds the walk is untested.
- **Precedence: dedup to one entry per name** — nearest directory wins; at the same level `.agents/skills` > `.opencode/skills` > `.claude/skills`; **project overrides global**.
- **No config gating** — skills load with no `opencode.json` and empty config dirs (contrast Gemini's trust gate).

### Pi (probed 2026-07-05, v0.80.3 `@earendil-works/pi-coding-agent`; source at `~/.opensrc`)

- **Query surface discovered: RPC mode** — `printf '{"type":"get_commands","id":"1"}\n' | pi --mode rpc --offline --no-session` returns one JSONL response whose `data.commands` includes every resolved skill as `{name: "skill:<name>", description, sourceInfo: {path, baseDir, scope, origin, source}}`. No model call, no API key, no network; cwd- and trust-sensitive. Verified independently on this machine (53 skills). Richest source metadata of any agent's query output.
- **Global roots (trust-independent):** `~/.pi/agent/skills` (or `$PI_CODING_AGENT_DIR/skills`) and `~/.agents/skills`.
- **Project roots (trust-gated):** `<cwd>/.pi/skills` — **cwd only, no walk-up** — and `.agents/skills` with **git-root-bounded inclusive walk-up**; if no `.git` anywhere, the walk continues to the **filesystem root**. A per-flavor split within one agent — the first we've seen.
- **Package skills** (5th origin): npm/git/local packages from `~/.pi/agent/settings.json` or `<cwd>/.pi/settings.json`, skills via a `pi.skills` manifest in package.json or a conventional `skills/` dir.
- **Precedence: first-wins over a sorted chain** — project `.pi` > project `.agents` (nearest ancestor first) > user `~/.pi/agent` > user `~/.agents` > package. Physical-path dedup collapses symlinked duplicates; name collisions drop the later entry with a `collision` diagnostic.
- **Trust gate:** project sources load only when the folder is trusted (`~/.pi/agent/trust.json`; `--approve` trusts for the run). Same caveat as Gemini: untrusted cwd → the query output silently omits project skills.
- **Gotcha for gent:** the trust-*need* check scans `.agents/skills` ancestors unbounded (to filesystem root), while the loader's walk-up is git-root-bounded — a repo can be flagged as needing trust by an ancestor dir the loader would never actually read.

### Factory droid (probed 2026-07-05, v0.164.0; signal = `Skills (N)` header via pty harness)

- **Walk-up: none — a single anchor directory.** Inside a repo, droid resolves cwd to the **git root** (walks up only to *find* `.git`, handling worktree `.git` files) and scans project skills **only there** — probes at cwd, intermediate dirs, and above the git root all failed to load; git-root probes loaded. Outside a repo, the anchor is the **exact cwd** (parent-dir probe did not load). A sixth distinct pattern: not an ancestor scan at all.
- **Project flavors at the anchor: `.factory/skills`, `.agents/skills`, `.agent/skills`** (+3 confirmed individually). **`.claude/skills` is NOT read** at the anchor or cwd — at least not by the header's scan set (`he1`), which has no `.claude` entry.
- **Precedence: the header count does NOT dedup names** — a colliding name in two anchor flavors counts as 2. But resolution *does* dedup (see the 2026-07-06 follow-ups below): the header count and the resolved skill list are different code paths.
- **Follow-ups resolved (2026-07-06, same v0.164.0):**
  - *(i) `~/.claude` reconciled — the 4-global-roots claim is wrong for v0.164.* Isolation probe: a skill in `~/.claude/skills/` only left the header at 53. The `EM0`/`lM0` code path is an **interactive "Import Skills from Claude Code" TUI flow** (space-to-select picker): `lM0` walks cwd→git-root (fs root if no `.git`) collecting existing `.claude/skills` dirs plus `~/.claude/skills` as "personal", and importing **copies** the selected skill dirs into droid's own skills dirs. It is dormant at startup — two consecutive runs in a repo with a `.claude/skills` probe changed nothing (no count change, no files copied). `.claude` is not a resolution source at all. (A parallel "Import Claude Code Subagents" flow exists for droids.)
  - *(ii) Invocation winner recovered from bundle source (not yet probe-confirmed — would need a paid run).* Resolution dedups **first-wins by normalized name**: the settings chain merges with precedence **runtime > folder > project > user > org**; within a level, `.factory/skills` beats the agent-standard folders (`.agents`/`.agent`); final resolution (`$xn`) then puts **builtin > mission > directory skills**, and slash-command registration (`fDH`) also skips later same-named entries (`skippedDueToNameConflict`). Quirk: an *enabled* lower-precedence skill replaces a *disabled* higher-precedence one (`P$R`).
  - *(iii) Symlinked skill dirs: loaded but uncounted.* Probe: a real skill dir moved the header 53→54; adding a symlinked one didn't (still 54). The actual loader (`q7T`) explicitly includes `isSymbolicLink()` entries with realpath-based cycle detection (and recurses into subdirectories until it finds a `SKILL.md`), so the header **undercounts** for anyone using symlinked skill dirs.

### Cursor (probed 2026-07-05, cursor-agent 2026.07.01-41b2de7)

- **No local query surface.** `cursor-agent skills` just feeds "skills" to a live agent (paid — same trap as `codex skills`). Empirical signal: a single headless `cursor-agent --print --trust --mode ask` call from the probe tree asking the model to enumerate `curprobe-*` skills verbatim from its context — the only agent whose verification required a model call.
- **Anchor: the workspace dir (= cwd, or `--workspace`), no walk in either direction.** From a cwd two levels below the git root, all four cwd flavors loaded; probes at the intermediate dir, the git root, above the git root, and **below cwd** all failed to load. Same cwd-only pattern as Gemini. (The bundle *contains* a `nestedExtensibilityService` that ripwalks downward with globs `*/**/.cursor/**`, `*/**/.agents/**` — but it's gated by a constructor flag and was inactive in the headless CLI run.)
- **Project flavors at the anchor: `.cursor/skills`, `.agents/skills`, `.claude/skills`, `.codex/skills`** — all four observed loading. The `.claude`/`.codex` legacy pair is gated by `allow_third_party_plugin_imports` (a server-delivered team-policy protobuf field; enabled for this account). User scope mirrors it: `~/.cursor/skills` + `~/.agents/skills` (+ gated `~/.claude`, `~/.codex`); built-ins live at `~/.cursor/skills-cursor` (17 present).
- **Trust-gated** (third trust-gated agent, after Gemini and Pi): headless runs need `--trust`.
- **Precedence (updated 2026-07-06): name dedup to one entry — probe-confirmed.** Two headless calls with controls: a 4-flavor collision plus two *distinct-named* control skills in the same workspace — both controls appeared in the model-visible skill list, the collision appeared **exactly once** (via `.claude`, the same winner as the 2026-07-05 probe); a 2-flavor round (`.cursor` + `.agents`) showed the `.agents` copy. Observed flavor precedence: **`.claude` > `.agents` > `.cursor`** (`.codex` unranked beyond losing to `.claude`). This contradicts the bundle-source reading (sort-only, no name-keyed dedup in the local discovery path) — the dedup must happen later, plausibly server-side during prompt assembly (cursor-agent builds its prompt through Cursor's API service). Method caveat: Cursor truncates the prompt's skill list ("Additional skills omitted from this initial list (48)"), which is why the distinct-named controls were needed to rule out truncation as the explanation.

### Claude Code (probed 2026-07-06, v2.1.201)

- **Query surface discovered: the bogus-key debug harness.** `ANTHROPIC_API_KEY=sk-ant-bogus claude -p hi --debug --debug-file <file>` — the bogus env key overrides OAuth, auth fails (exit 1, **no model call, free**), but skill discovery has already run and logged. Two complementary outputs: (1) the debug log prints the literal scan set (`Loading skills from: managed=…, user=…, project=[dir, dir, …]`) plus per-scope counts (`Loaded N unique skills (… managed: a, user: b, project: c, additional: d, legacy commands: e)`) and per-plugin loads with cache paths; (2) the run still writes a session transcript (`~/.claude/projects/<munged-cwd>/<uuid>.jsonl`) whose skills attachment enumerates **every resolved skill as `name: description`** — the full model-visible list. Context-sensitive to cwd. Caveats: undocumented log format (drift risk), skill-dir skills get no per-skill path lines (attribute via the scan-set dirs), and each probe leaves a junk transcript to clean up (`rm` or `claude project purge`).
- **Global roots: `~/.claude/skills` only.** Isolation probes in `~/.agents/skills/` and `~/.config/claude/skills/` did **not** load — confirming the earlier transitive-symlink model: Claude Code sees the shared `~/.agents` content only because `~/.claude/skills/` symlinks into it. The `managed` root (`/Library/Application Support/ClaudeCode/.claude/skills`) is scanned but absent on this machine (untested — needs admin to create).
- **Project flavor: `.claude/skills` only** — `.agents/skills`, `.agent/skills`, `.github/skills`, `.codex/skills` probes all ignored at cwd. The only agent of the nine that reads no compatibility flavor at all.
- **Walk-up: cwd → git root, inclusive** (docs said "up to the repo root" — now probe-confirmed: cwd, intermediate, and git-root probes loaded; 1–3 levels above did not; no downward scan below cwd). **No `.git` anywhere → the walk continues to the filesystem root** (all six ancestor levels of a non-repo tree loaded) — an undocumented fallback, same pattern as Pi's `.agents` flavor. `--add-dir <dir>` additionally loads `<dir>/.claude/skills` (the exact dir only, no walk-up from it), reported as the separate `additional` scope.
- **Symlinks: followed** (project-scope symlinked skill dir loaded; the user-scope symlink farm corroborates).
- **Precedence: no name dedup in the prompt — but a deterministic invocation winner.** Colliding names coexist in the skills attachment (both copies listed, most-specific first), like Codex. On invocation (`/name` — expansion happens locally, so the winner is observable in the transcript of a failed-auth run): **nearest directory wins within project scope** (cwd beat git root); **across scopes, user beats project** (re-verified twice) — surprising versus most agents but matching Claude Code's documented `enterprise > personal > project` order. Plugin skills are namespaced `plugin:skill`, so a same-named user skill coexists rather than colliding (a `duplicate/user-owned entries skipped` counter exists for true duplicates).
- **Skill identity: the directory name wins over frontmatter `name:`** (a dir `x` with `name: y` resolves as `x`).
- **No trust gate** — project skills loaded from throwaway tmp dirs in `-p` mode without prompting (contrast Gemini, Pi, Cursor).
- Misc: `--bare` ("reduced mode") skips skill-dir discovery entirely; `--disable-slash-commands` disables all skills; 26 bundled skills ship in the binary; `~/.claude/commands` still contributes legacy commands; `claude plugin init` scaffolds `~/.claude/skills/<name>/` as a `<name>@skills-dir` plugin, so `~/.claude/skills` doubles as a plugin source.

Consequence for gent: the nine agents characterized span **six walk-up patterns** (Amp unbounded ancestors / Copilot CLI + OpenCode git-root-bounded ancestors / Gemini + Cursor cwd-only / Codex project-root-marker ancestors, default `.git`, configurable / Pi's `.agents` flavor + Claude Code git-root-bounded-or-fs-root ancestors — Pi's `.pi` flavor is cwd-only / droid single-anchor: git root inside a repo, exact cwd outside, no ancestor scan) and **four collision behaviors** (precedence-ordered dedup: Amp, Copilot, OpenCode, Pi, Cursor — prompt-level, `.claude` > `.agents` > `.cursor` — and droid at resolution — first-wins per bundle source; only its header count doesn't dedup / last-wins override: Gemini / no dedup: Codex / coexist-in-prompt with a deterministic invocation winner: Claude Code — nearest dir within project scope, user over project across scopes). Project context sensitivity cannot be generic — it's per-agent, per-trust-state (Gemini, Pi, Cursor), and per-config (Codex's `project_root_markers`, Cursor's `allow_third_party_plugin_imports`).

## Open questions — next-session drill-down

Ranked by leverage for the resolver:

1. **Project walk-up behavior** (dimension 2) — ✅ **done for all nine agents** (Amp, Copilot CLI, Gemini, Codex, OpenCode, Pi, droid, Cursor 2026-07-05; Claude Code 2026-07-06 — see findings sections).
2. **Precedence / dedup** (dimension 5) — ✅ **done for all nine** (2026-07-05/06): **Amp, Copilot CLI, OpenCode** (dedup, nearest-dir wins, flavor order at same level), **Pi** (first-wins over precedence chain + physical-path dedup), **Gemini** (last-wins override, from source + docs), **Codex** (no dedup — colliding names coexist, sorted by scope rank), **Claude Code** (coexist in prompt; invocation winner: nearest dir within project, user over project across scopes — matches documented order), **Cursor** (prompt-level dedup, probe-confirmed with controls; `.claude` > `.agents` > `.cursor`), **droid** (resolution dedups first-wins per bundle source — runtime > folder > project > user > org, `.factory` beats agent-standard dirs, builtin > mission > directory; header count alone doesn't dedup; source-derived, not probe-confirmed).
3. **Isolation battery:** ✅ **complete — all nine agents probed.** Claude Code closed out 2026-07-06 via the bogus-key debug harness (no model call needed; Cursor remains the only agent that ever required one).
3b. **droid follow-ups** — ✅ **all three resolved 2026-07-06** (see the droid subsection): `.claude` is only an interactive import flow, not a root; invocation winner recovered from bundle source; symlinked skill dirs are loaded but uncounted by the header.
3c. **Cursor precedence confirmation** — ✅ **done 2026-07-06**: dedup confirmed with distinct-named controls ruling out list truncation.
4. **Copilot source taxonomy** — ✅ **complete 2026-07-06**: all seven labels observed (`builtin`, `personal-agents`, `personal-copilot`, `project`, `inherited`, `plugin`, `custom`). Plugin skills install from Claude Code-format marketplaces (local paths accepted) into `~/.copilot/installed-plugins/`.
5. **Runtime strategy decision** — query-vs-model (hybrid?), which determines whether the modeled specs are load-bearing at runtime or just documentation. New inputs: Gemini's trust gate means even query output needs a modeled correction (check trust, warn or supplement); the Amp 132→135 day-over-day drift shows why query-at-runtime is attractive where it exists; and Claude Code's harness is authoritative but has side effects (junk transcripts) and an undocumented log format — a case where gent might prefer the modeled resolver at runtime and use the harness only for verification.
6. **Drift harness** — automate the isolation probe + query-command checks so gent can detect when a tool changes its resolution across versions. Claude Code's fs-root fallback and `additional` scope are exactly the kind of undocumented behavior it should watch.
7. **Claude Code managed scope** — `/Library/Application Support/ClaudeCode/.claude/skills` is scanned but absent on this machine; creating it needs admin. Low value unless gent targets managed installs.

## Method appendix — the isolation probe

Reusable recipe (details and the droid worked example in [`skill-locations.md`](./skill-locations.md#observed-on-this-machine-2026-07-04)):

1. Find a "loaded skills" signal — a query command, or a UI count that prints without auth (droid's `Skills (N)` shows even at the login screen).
2. Baseline it from a **clean non-repo dir** (so project scopes don't interfere with a global-path test).
3. Create **one uniquely-named** throwaway skill (folder + minimal `SKILL.md` with `name`/`description` frontmatter) in **exactly one** candidate dir, with **no symlink or copy** elsewhere.
4. Re-read the signal. Gained the probe → that dir is scanned directly. Didn't → it isn't.
5. Remove the probe; repeat per dir. Also test project dirs and parent dirs for the walk-up rule.

Confound to avoid (this tripped up the first `droid-skill-discovery-report.md`): if the probe skill also exists in another scanned dir — e.g. via the `~/.agents → ~/.claude` symlink farm — you can't attribute which path found it. One dir, no symlinks.

## Cross-references

- [`skill-locations.md`](./skill-locations.md) — per-tool documented paths + the "Observed on this machine" section.
- [`skill-data.json`](./skill-data.json) — machine-readable source data (documented + `observed` fields).
- [`amp-skills.md`](./amp-skills.md) — Amp's full resolved skill dump.
- [`droid-skill-discovery-report.md`](./droid-skill-discovery-report.md) — droid's self-investigation (its conclusion was right; its method couldn't attribute — see the correction in `skill-locations.md`).
