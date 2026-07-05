# Agent Skill Resolution — research & plan for `gent list --agent`

> Working doc. Captures what we've verified about how each agent resolves skills **in practice**, so `gent` can answer "which skills does agent X actually have access to?" — and flags what still needs drilling into. Companion to the reference data in [`skill-locations.md`](./skill-locations.md) and [`skill-data.json`](./skill-data.json).
>
> Last updated: 2026-07-04. All "observed" facts are from this machine (darwin 24.6.0) on that date and will drift as tools update.

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
| **Amp** | `amp` resolved list (see `amp-skills.md`) | ✅ | ✅ (`file://`) | partial | ⚠️ text | Authoritative, needs parsing |
| **Gemini CLI** | `gemini skills list --all` | ✅ | ✅ (`Location:`) | ✅ (`[Enabled]`) | ⚠️ text | Authoritative, needs parsing |
| **OpenAI Codex** | `codex plugin list` | plugins only | plugin paths | — | ⚠️ text | Partial — no skills-list command; dir scopes must be modeled |
| **Pi** | `pi list` | packages only | package paths | — | ⚠️ text | Partial — packages only; dir scopes must be modeled |
| **Factory (droid)** | — (TUI header `Skills (N)` count) | ❌ | ❌ | ❌ | ❌ | Must model + probe |
| **Cursor** | — (TUI, needs workspace trust) | ❌ | ❌ | ❌ | ❌ | Must model + probe |
| **OpenCode** | — (no skills subcommand) | ❌ | ❌ | ❌ | ❌ | Must model + probe |
| **GitHub Copilot (cloud agent)** | — (runs server-side) | ❌ | ❌ | ❌ | ❌ | Not locally introspectable; model repo + config inputs only |

**Only 3 of 9 give a clean authoritative resolved list** (Copilot CLI, Amp, Gemini). The rest need a modeled resolver — which is exactly why the empirical work is worth doing.

### Note: Copilot CLI ≠ Copilot cloud agent

`skill-data.json`'s "GitHub Copilot (cloud agent)" entry targets the **cloud** surface (server-side, not introspectable here, no plugin skills). The **CLI** (`copilot`) is a separate surface that *does* support plugin-bundled skills and exposes the best query interface we found. Its `copilot skill --help` documents its own sources:

- **Project:** `.github/skills/`, `.agents/skills/`, or `.claude/skills/`
- **Personal:** `~/.copilot/skills/` or `~/.agents/skills/`
- **Plugin:** installed plugins that bundle skills
- **Custom:** dirs added with `copilot skill add <directory>`

Observed `--json` `source` values here: `personal-agents` (53, → `~/.agents/skills`) and `builtin` (1, → `~/Library/Caches/copilot/pkg/.../builtin`). The other source labels (`project-*`, `personal-copilot`, `plugin`, `custom`) are inferred from `--help` but **not yet observed** — worth confirming with test skills.

## The 5 dimensions a resolver spec must capture

For each agent, gent's model needs:

1. **Global roots** — which `~/.X/skills` dirs (droid surprised us with 4).
2. **Project roots + walk-up rule** — which in-repo dirs, and how far up the tree (cwd only? up to git root? filesystem root?). This is the "sensitive to project context" requirement. **Untested for every agent so far.**
3. **Symlink following** — yes/no (decides whether the `~/.agents → ~/.claude` symlink farm counts as a second source or the same one).
4. **Plugin / extension sources** — cache locations + enable/disable state.
5. **Precedence / dedup on name collision** — who wins, or do duplicates coexist (Codex docs say both remain). **Untested for every agent so far.**

The isolation probe covers 1–3; `plugin list`-style commands + cache enumeration cover 4; deliberately colliding names covers 5.

## What's verified so far

- **Symlink topology (the backbone).** `~/.agents/skills/` is the physical source of truth (~53 real skill dirs). `~/.claude/skills/` is mostly symlinks back into it (+ a few real `ui-*` dirs). This is why most agents converge on the same set.
- **droid** — reads `~/.agents/skills/` directly; 4 global roots; isolation-probe confirmed (`53→54`). Follows symlinks.
- **Amp** — resolved list = 50 `~/.agents/skills` + 79 Claude plugin-cache + 3 built-in (132). Reads Claude Code plugin caches, **not** Codex's. Amp's own plugins are TS-only (no skill API).
- **Gemini** — 52 = 50 `~/.agents/skills` + 2 npm-bundled built-ins. Reads neither Claude nor Codex plugin caches.
- **Copilot CLI** — 54 = 53 `~/.agents/skills` + 1 builtin, via `--json` (`name/description/source/path`).
- **Codex** — 50 `~/.agents/skills` + 5 `~/.codex/skills/.system` + 8 enabled plugins (`codex plugin list`).
- **Plugin-skill behavior** — bundle skills: Claude Code, Codex, Cursor, Factory, Gemini, Pi; do **not**: OpenCode (hooks/tools only), Copilot cloud agent.

## Open questions — next-session drill-down

Ranked by leverage for the resolver:

1. **Project walk-up behavior** (dimension 2) for every agent — create a probe skill at `<repo>/.../skills/`, at a parent dir, and above the git root; see where each stops. Nothing here is tested yet.
2. **Precedence / dedup** (dimension 5) — same-named skill in two roots; does one win or do both show? Matters for what `gent list` reports as authoritative.
3. **Isolation battery for the model-only agents:** Cursor, OpenCode, Pi (and re-confirm Codex dir scopes, since it has no skills-list command).
4. **Copilot source taxonomy** — create test skills to observe the `project-*`, `personal-copilot`, `plugin`, `custom` source labels and their paths.
5. **Runtime strategy decision** — query-vs-model (hybrid?), which determines whether the modeled specs are load-bearing at runtime or just documentation.
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
