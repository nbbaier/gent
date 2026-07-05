# Agent Skill Resolution — research & plan for `gent list --agent`

> Working doc. Captures what we've verified about how each agent resolves skills **in practice**, so `gent` can answer "which skills does agent X actually have access to?" — and flags what still needs drilling into. Companion to the reference data in [`skill-locations.md`](./skill-locations.md) and [`skill-data.json`](./skill-data.json).
>
> Last updated: 2026-07-05. All "observed" facts are from this machine (darwin 24.6.0) on the date noted and will drift as tools update.

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
| **Claude Code** | — (no skills subcommand) | ❌ | ❌ | ❌ | ❌ | Must model + probe — best-documented of this group (scope precedence + plugin namespacing documented; docs claim parent-dir `.claude/skills` walk-up to repo root, untested) |

**6 of 9 give an authoritative resolved list** (Copilot CLI, Amp, OpenCode, Pi, Gemini, Codex) — four emit machine-readable output (Copilot CLI, Amp, OpenCode JSON; Pi JSONL over RPC). Three of the six were found only on 2026-07-05 hiding in undocumented surfaces: `codex debug prompt-input`, `opencode debug skill`, and Pi's `--mode rpc` `get_commands`. The "no query command" claims in earlier notes came from reading docs and `--help` for *documented* commands — **check `<tool> debug --help` and any headless/RPC/serve mode before concluding an agent can't be queried.** Only droid, Cursor, and Claude Code still need a modeled resolver.

> Drift note (2026-07-05): Amp's JSON list returned 135 skills (53 `~/.agents/skills` + 79 Claude plugin-cache + 3 built-in) vs. 132 observed on 2026-07-04 — the `~/.agents/skills` count moved 50→53 in a day. Query-at-runtime absorbs this automatically; a modeled resolver would need the drift harness (open question 6).

### Note: Copilot CLI ≠ Copilot cloud agent

`skill-data.json`'s "GitHub Copilot (cloud agent)" entry targets the **cloud** surface (server-side, not introspectable here, no plugin skills) — it's out of scope for the table above, since `gent list --agent` resolves against local machine + project context; only the CLI surface is modeled. The **CLI** (`copilot`) is a separate surface that *does* support plugin-bundled skills and exposes the best query interface we found. Its `copilot skill --help` documents its own sources:

- **Project:** `.github/skills/`, `.agents/skills/`, or `.claude/skills/`
- **Personal:** `~/.copilot/skills/` or `~/.agents/skills/`
- **Plugin:** installed plugins that bundle skills
- **Custom:** dirs added with `copilot skill add <directory>`

Observed `--json` `source` values: `personal-agents` (53, → `~/.agents/skills`), `builtin` (1, → `~/Library/Caches/copilot/pkg/.../builtin`), and — from the 2026-07-05 walk-up probes — `project` (cwd skill dirs) and `inherited` (ancestor dirs up to the git root). The earlier `project-*` guess was wrong. Still unobserved: `personal-copilot` (`~/.copilot/skills/`), `plugin`, `custom` (`copilot skill add`).

## The 5 dimensions a resolver spec must capture

For each agent, gent's model needs:

1. **Global roots** — which `~/.X/skills` dirs (droid surprised us with 4).
2. **Project roots + walk-up rule** — which in-repo dirs, and how far up the tree (cwd only? up to git root? filesystem root?). This is the "sensitive to project context" requirement. **Tested 2026-07-05 for Amp (filesystem root), Copilot CLI (git root), Gemini (cwd only)** — three agents, three different answers. Untested for the rest.
3. **Symlink following** — yes/no (decides whether the `~/.agents → ~/.claude` symlink farm counts as a second source or the same one).
4. **Plugin / extension sources** — cache locations + enable/disable state.
5. **Precedence / dedup on name collision** — who wins, or do duplicates coexist (Codex docs say both remain). **Tested 2026-07-05 for Amp + Copilot CLI (dedup, nearest dir wins) and Gemini (last-wins override).** Untested for the rest.

The isolation probe covers 1–3; `plugin list`-style commands + cache enumeration cover 4; deliberately colliding names covers 5.

## What's verified so far

- **Symlink topology (the backbone).** `~/.agents/skills/` is the physical source of truth (~53 real skill dirs). `~/.claude/skills/` is mostly symlinks back into it (+ a few real `ui-*` dirs). This is why most agents converge on the same set.
- **droid** — reads `~/.agents/skills/` directly; isolation-probe confirmed (`53→54`). Follows symlinks. ⚠️ The "4 global roots incl. `~/.claude`" claim is now in doubt — the 2026-07-05 probe found the header's home scan is `.factory`/`.agent`/`.agents` only, with `.claude` handled by a separate legacy importer (see droid subsection under walk-up findings). Project scope probed 2026-07-05: single-anchor resolution, three flavors at the git root.
- **Amp** — resolved list = 50 `~/.agents/skills` + 79 Claude plugin-cache + 3 built-in (132). Reads Claude Code plugin caches, **not** Codex's. Amp's own plugins are TS-only (no skill API).
- **Gemini** — 52 = 50 `~/.agents/skills` + 2 npm-bundled built-ins. Reads neither Claude nor Codex plugin caches.
- **Copilot CLI** — 54 = 53 `~/.agents/skills` + 1 builtin, via `--json` (`name/description/source/path`).
- **Codex** — 50 `~/.agents/skills` + 5 `~/.codex/skills/.system` + 8 enabled plugins (`codex plugin list`). As of 2026-07-05: full resolution probed + source-verified — see the Codex subsection under walk-up findings, incl. the `codex debug prompt-input` query surface.
- **Pi** — 53 resolved on this machine via RPC `get_commands` (44 `~/.pi/agent/skills` + 9 `~/.agents/skills` after physical-path + name dedup); full resolution probed 2026-07-05 — see the Pi subsection under walk-up findings.
- **OpenCode** — 54 resolved on this machine via `opencode debug skill` (51 `~/.agents/skills` + 2 `~/.claude/skills` + 1 built-in); full resolution probed 2026-07-05 — see the OpenCode subsection under walk-up findings.
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
- **Precedence: the header count does NOT dedup names** — a colliding name in two anchor flavors counts as 2. Caveat: that's the count, not the invocation winner; the runtime loader dedups by directory path only, and which same-named skill wins on invocation is **unverified** (not observable via this signal).
- **Discrepancy flag vs. the earlier 4-global-roots claim:** the header's home scan is `.factory`/`.agent`/`.agents` only — no `~/.claude/skills` — and the clean baseline of exactly 53 is consistent with that. The binary has a *separate* `.claude/skills` walk-up **importer** (`EM0`, cwd→git-root, "imported/skipped/failed" semantics) that does not feed the header. So `.claude` support looks like a distinct legacy-import path, and the earlier "4 global roots incl. `~/.claude`" claim may describe a different code path or be stale for v0.164 — needs a dedicated follow-up probe.
- Symlink caveat: the header counter uses `Dirent.isDirectory()` (doesn't resolve symlinks), so symlinked skill dirs may be uncounted by the header even if loaded — untested.

### Cursor (probed 2026-07-05, cursor-agent 2026.07.01-41b2de7)

- **No local query surface.** `cursor-agent skills` just feeds "skills" to a live agent (paid — same trap as `codex skills`). Empirical signal: a single headless `cursor-agent --print --trust --mode ask` call from the probe tree asking the model to enumerate `curprobe-*` skills verbatim from its context — the only agent whose verification required a model call.
- **Anchor: the workspace dir (= cwd, or `--workspace`), no walk in either direction.** From a cwd two levels below the git root, all four cwd flavors loaded; probes at the intermediate dir, the git root, above the git root, and **below cwd** all failed to load. Same cwd-only pattern as Gemini. (The bundle *contains* a `nestedExtensibilityService` that ripwalks downward with globs `*/**/.cursor/**`, `*/**/.agents/**` — but it's gated by a constructor flag and was inactive in the headless CLI run.)
- **Project flavors at the anchor: `.cursor/skills`, `.agents/skills`, `.claude/skills`, `.codex/skills`** — all four observed loading. The `.claude`/`.codex` legacy pair is gated by `allow_third_party_plugin_imports` (a server-delivered team-policy protobuf field; enabled for this account). User scope mirrors it: `~/.cursor/skills` + `~/.agents/skills` (+ gated `~/.claude`, `~/.codex`); built-ins live at `~/.cursor/skills-cursor` (17 present).
- **Trust-gated** (third trust-gated agent, after Gemini and Pi): headless runs need `--trust`.
- **Precedence: sort-only tiers, no name dedup found in source** — skills are sorted Builtin → UserHome → Workspace → Plugin for the prompt, and no name-keyed dedup exists in the discovery path (like Codex, collisions likely coexist). Probe inconclusive: the model listed the 4-flavor collision probe once (via its `.claude` path); a confirming call wasn't run. Marked unverified.

Consequence for gent: the eight agents characterized so far span **six walk-up patterns** (Amp unbounded ancestors / Copilot CLI + OpenCode git-root-bounded ancestors / Gemini + Cursor cwd-only / Codex project-root-marker ancestors, default `.git`, configurable / Pi per-flavor: `.pi` cwd-only + `.agents` git-root-bounded-or-fs-root / droid single-anchor: git root inside a repo, exact cwd outside, no ancestor scan) and **at least three collision behaviors** (precedence-ordered dedup: Amp, Copilot, OpenCode, Pi / last-wins override: Gemini / no dedup: Codex, likely Cursor, and droid's count doesn't dedup either though its invocation winner is unverified). Project context sensitivity cannot be generic — it's per-agent, per-trust-state (Gemini, Pi, Cursor), and per-config (Codex's `project_root_markers`, Cursor's `allow_third_party_plugin_imports`).

## Open questions — next-session drill-down

Ranked by leverage for the resolver:

1. **Project walk-up behavior** (dimension 2) — ✅ **done for Amp, Copilot CLI, Gemini, Codex, OpenCode, Pi, droid, Cursor** (2026-07-05, see findings section). Still untested: Claude Code only.
2. **Precedence / dedup** (dimension 5) — ✅ **done for Amp, Copilot CLI, OpenCode** (dedup, nearest-dir wins, flavor order at same level), **Pi** (first-wins over precedence chain + physical-path dedup), **Gemini** (last-wins override, from source + docs), **Codex** (no dedup — colliding names coexist, sorted by scope rank), **droid partially** (header count doesn't dedup; runtime invocation winner unverified), and **Cursor partially** (sort-only tiers in source, no name dedup found; probe inconclusive). Still untested: Claude Code.
3. **Isolation battery:** only Claude Code remains — no skills-list subcommand (and unlike Codex/OpenCode/Pi, no debug/RPC equivalent found), and its documented parent-dir walk-up (to repo root) is untested. (Codex, OpenCode, Pi resolved via undocumented query surfaces; droid via the pty header-count harness; Cursor via one headless model call.)
3b. **droid follow-ups** — (i) reconcile the `~/.claude/skills` global-root claim with the header's 3-root home scan and the separate `EM0` legacy `.claude` importer (which *does* walk cwd→git root, unlike the main scan); (ii) determine the runtime invocation winner on name collision; (iii) check whether symlinked skill dirs are undercounted by the header (`Dirent.isDirectory()`).
4. **Copilot source taxonomy** — partially done: `project` and `inherited` observed (2026-07-05). Remaining: `personal-copilot`, `plugin`, `custom`.
5. **Runtime strategy decision** — query-vs-model (hybrid?), which determines whether the modeled specs are load-bearing at runtime or just documentation. New input: Gemini's trust gate means even query output needs a modeled correction (check trust, warn or supplement), and the Amp 132→135 day-over-day drift shows why query-at-runtime is attractive where it exists.
6. **Drift harness** — automate the isolation probe + query-command checks so gent can detect when a tool changes its resolution across versions.

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
