# Agent Skill Locations by Tool

A reference for where each coding agent discovers skills, synthesized from `skill-data.json`. Each section lists the project-level (workspace/repo) and global (user/home) search paths, the tool-specific notes on precedence and compatibility, and — where the source documents it — the full precedence order across all scopes combined (highest priority first). Where a source does not state a collision-resolution order, that's called out explicitly rather than guessed at.

This dataset only covers tools actually installed on this machine (verified via `PATH`, package manager globals, and `/Applications`): Amp, Claude Code, OpenAI Codex, Cursor, Factory CLI (Droid), Gemini CLI, GitHub Copilot, OpenCode, and Pi.

Each section records both the tool's **documented** behavior (from its source docs) and, where it differs, what was **observed loading on this machine** on 2026-07-04. The two are kept separate: documented sections describe published behavior; the [Observed on this machine](#observed-on-this-machine-2026-07-04) section at the end records the empirically verified reality (resolved skill lists, binary path analysis, and the symlink topology that ties them together).

---

## Amp

**Source:** [https://ampcode.com/manual#agent-skills](https://ampcode.com/manual#agent-skills)

**Project search paths**

- `.agents/skills/`
- `.claude/skills/`

**Global search paths**

- `~/.config/agents/skills/`
- `~/.agents/skills/`
- `~/.config/amp/skills/`
- `~/.claude/skills/`

**Notes:** Full precedence (first wins): `~/.config/agents/skills/`, `~/.agents/skills/`, `~/.config/amp/skills/`, `.agents/skills/`, `.claude/skills/`, `~/.claude/skills/`, then plugins, legacy toolbox directories, and built-in skills.

**Precedence order (highest to lowest):**

1. `~/.config/agents/skills/`
2. `~/.agents/skills/`
3. `~/.config/amp/skills/`
4. `.agents/skills/`
5. `.claude/skills/`
6. `~/.claude/skills/`
7. Plugins, legacy toolbox directories, built-in skills

**Plugin skills:** Amp's own plugins are TypeScript modules (the `PluginAPI` exposes `registerTool`/`registerCommand`/`on`/`experimental.createAgent` — **no** skill-registration method), so they cannot ship skills. The "Plugins" entry in the precedence list refers to Amp reading skills bundled inside **Claude Code** plugin caches (`~/.claude/plugins/cache/`). Codex-native plugin caches (`~/.codex/plugins/`) are not read.

---

## Claude Code

**Source:** [https://code.claude.com/docs/en/skills#where-skills-live](https://code.claude.com/docs/en/skills#where-skills-live)

**Project search paths**

- `.claude/skills/<skill-name>/SKILL.md`

**Global search paths**

- `~/.claude/skills/<skill-name>/SKILL.md`

**Notes:** Also supports enterprise and plugin scopes. Same-name precedence is enterprise > personal > project. Plugin skills are namespaced (`plugin-name:skill-name`) so they cannot conflict. Project skills also load from `.claude/skills/` in every parent directory up to the repository root.

**Observed (2026-07-06, v2.1.201, isolation probes via the bogus-key debug harness):** walk-up confirmed cwd→git-root inclusive; **no `.git` → walks to the filesystem root** (undocumented). `.claude/skills` is the *only* project flavor (no `.agents`/`.agent`/`.github`/`.codex`). Global root is `~/.claude/skills` only (probes in `~/.agents/skills` and `~/.config/claude/skills` did not load). Symlinks followed at both scopes. `--add-dir <dir>` loads `<dir>/.claude/skills` (exact dir, no walk) as a separate `additional` scope. Colliding names coexist in the prompt (no dedup); on invocation the nearest project dir wins, and user beats project — the documented personal > project order, probe-confirmed. Directory name beats frontmatter `name:`. No trust gate.

**Precedence order (highest to lowest):**

1. Enterprise (managed settings)
2. `~/.claude/skills/` (Personal)
3. `.claude/skills/` (Project)
4. Bundled/built-in skills

Plugin skills sit outside this chain — their `plugin-name:skill-name` namespace means they never collide with the levels above.

**Plugin skills:** Plugins bundle a `skills/` directory (each skill a `<name>/SKILL.md`); skills are auto-discovered on install and namespaced `plugin-name:skill-name`. This is a genuine, first-class skill source — 97 plugin-cache skills were loaded on this machine (see [Observed](#observed-on-this-machine-2026-07-04)).

---

## OpenAI Codex

**Source:** [https://developers.openai.com/codex/skills#where-to-save-skills](https://developers.openai.com/codex/skills#where-to-save-skills)

**Project search paths**

- `$CWD/.agents/skills`
- `$CWD/../.agents/skills`
- `$REPO_ROOT/.agents/skills`

**Global search paths**

- `$HOME/.agents/skills`
- `/etc/codex/skills`
- bundled system skills

**Notes:** Scopes are REPO, USER, ADMIN (`/etc/codex/skills`), and SYSTEM (bundled with Codex). For repositories, Codex scans `.agents/skills` in every directory from the current working directory up to the repository root. If two skills share the same name across scopes, Codex does **not** merge or override them — both remain available in skill selectors, so the order below reflects discovery order, not override precedence.

**Precedence order (discovery order, not strict override):**

1. `$CWD/.agents/skills`
2. `$CWD/../.agents/skills`
3. `$REPO_ROOT/.agents/skills`
4. `$HOME/.agents/skills`
5. `/etc/codex/skills`
6. bundled system skills

**Plugin skills:** Codex plugins (managed via `codex plugin`, listed with `codex plugin list`) bundle a `skills/` directory that loads when the plugin is enabled — a **5th** skill source on top of the documented REPO/USER/ADMIN/SYSTEM scopes, not reflected in the source docs. There is no `codex skills` list subcommand. Eight enabled plugins were contributing skills on this machine (see [Observed](#observed-on-this-machine-2026-07-04)).

---

## Cursor

**Source:** [https://cursor.com/docs/skills#skill-directories](https://cursor.com/docs/skills#skill-directories)

**Project search paths**

- `.agents/skills/`
- `.cursor/skills/`

**Global search paths**

- `~/.agents/skills/`
- `~/.cursor/skills/`

**Notes:** Also reads legacy compatibility directories: `.claude/skills/` and `.codex/skills/` (project), and `~/.claude/skills/` and `~/.codex/skills/` (global). Skills are not currently discovered outside the root `.cursor/skills` directory in monorepos. Precedence when a skill name collides across locations is not documented.

**Precedence order:** Not documented in source.

**Plugin skills:** Cursor plugins (a directory with `.cursor-plugin/plugin.json` — **distinct** from VS Code editor extensions) bundle a `skills/` directory whose skills appear in the "Agent Decides" section. None were installed on this machine.

---

## Factory CLI

**Source:** [https://docs.factory.ai/cli/configuration/skills#where-skills-live](https://docs.factory.ai/cli/configuration/skills#where-skills-live)

**Project search paths**

- `<repo>/.factory/skills/`
- `<repo>/.agent/skills/`

**Global search paths**

- `~/.factory/skills/` (documented)
- `~/.agents/skills/` — **undocumented**, read directly by the `droid` binary (see below)
- `~/.agent/skills/` — **undocumented** (singular)
- `~/.claude/skills/` — **undocumented**

**Notes:** `<repo>/.agent/skills/` is a compatibility location discovered for the `.agent` folder convention. Each skill lives in its own directory containing a `SKILL.md`. Precedence when a skill name collides across workspace/personal/compatibility locations is not documented.

**Precedence order:** Not documented in source.

**Plugin skills:** Factory plugins bundle a `skills/` directory (skills are model-invoked automatically). None were installed on this machine (0 plugins).

**Observed (undocumented behavior):** The `droid` binary constructs its global skill roots as `path.join(homedir(), X, "skills")` for `X` in `{".factory", ".agents", ".agent", ".claude"}` — confirmed in the decompiled fragment `join(H,".agents","skills")`. So droid reads `~/.agents/skills/` **directly**, not just via `~/.claude/skills/` symlinks. This was verified two more ways: (1) droid's own self-investigation (`docs/droid-skill-discovery-report.md`), and (2) an **isolation probe** — creating a uniquely-named skill in `~/.agents/skills/` only, with no symlink anywhere else, moved the TUI count from `Skills (53)` to `Skills (54)`. Only `~/.factory/skills/` (plus the `.agent/skills` project compat dir) is documented; the three home-dir roots above are not.

> **Correction of an earlier false negative:** a prior pass grepped the binary for the slashed literal `.agents/skills` (0 hits) and wrongly concluded droid ignores `~/.agents/skills/`. The path is assembled from separate tokens `[".agents","skills"]`, so the slashed form never appears in the binary. droid **does** read `~/.agents/skills/` directly.

---

## Gemini CLI

**Source:** [https://geminicli.com/docs/cli/using-agent-skills/#discovery-tiers](https://geminicli.com/docs/cli/using-agent-skills/#discovery-tiers)

**Project search paths**

- `.agents/skills/`
- `.gemini/skills/`

**Global search paths**

- `~/.agents/skills/`
- `~/.gemini/skills/`

**Notes:** Full precedence (lowest to highest): built-in skills, extension skills, user skills, workspace skills. Within the same tier (user or workspace), the `.agents/skills/` alias takes precedence over the `.gemini/skills/` directory.

**Precedence order (highest to lowest):**

1. `.agents/skills/` (workspace)
2. `.gemini/skills/` (workspace)
3. `~/.agents/skills/` (user)
4. `~/.gemini/skills/` (user)
5. Extension skills
6. Built-in skills

**Plugin skills:** Gemini extensions (installed via `gemini extensions install`) bundle a top-level `skills/` directory = the documented "Extension Skills" tier. None shipping skills were installed here. Gemini's resolved list (`gemini skills list`) shows it reads only `~/.agents/skills/` and its own npm-bundled built-ins — **not** Claude/Codex plugin caches or `~/.claude/skills/`.

---

## GitHub Copilot (cloud agent)

**Source:** [https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/add-skills#creating-and-adding-a-skill](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/add-skills#creating-and-adding-a-skill)

**Project search paths**

- `.github/skills`
- `.claude/skills`
- `.agents/skills`

**Global search paths**

- `~/.copilot/skills`
- `~/.agents/skills`

**Notes:** Project skills are stored in the repository; personal skills are stored in the home directory and shared across projects. Locations are presented as alternatives rather than a searched, prioritized list, and precedence on a name collision is not documented.

**Precedence order:** Not documented in source.

**Plugin skills:** The **cloud agent** surface has no plugin/extension skill contribution. (VS Code's `chatSkills` contribution point and the Copilot **CLI**'s plugins do bundle skills, but those are different surfaces.) The cloud agent runs server-side and is not locally introspectable; on this machine nothing is populated (`~/.copilot/skills` and the in-repo dirs are all absent), and the local `~/.agents/skills/` store is irrelevant to it.

---

## OpenCode

**Source:** [https://opencode.ai/docs/skills/#place-files](https://opencode.ai/docs/skills/#place-files)

**Project search paths**

- `.opencode/skills/<name>/SKILL.md`
- `.claude/skills/<name>/SKILL.md`
- `.agents/skills/<name>/SKILL.md`

**Global search paths**

- `~/.config/opencode/skills/<name>/SKILL.md`
- `~/.claude/skills/<name>/SKILL.md`
- `~/.agents/skills/<name>/SKILL.md`

**Notes:** `.claude/skills/` and `.agents/skills/` directories are supported for compatibility with Claude Code and the agent-standard convention. Project-local paths are walked upward from the cwd to the git worktree root and global paths are additionally loaded, but which location wins on a name collision is not documented.

**Precedence order:** Not documented in source.

**Plugin skills:** OpenCode plugins (local JS/TS in `.opencode/plugins/` or npm packages) are for hooks, events, and custom tools **only** — they do **not** contribute skills. Skills come solely from the six documented directories. (Third-party plugins exist that reimplement skill-loading as a tool, but that is the inverse — the native path does not ingest plugin skills.)

---

## Pi

**Source:** [https://pi.dev/docs/latest/skills#locations](https://pi.dev/docs/latest/skills#locations)

**Project search paths**

- `.pi/skills/`
- `.agents/skills/`

**Global search paths**

- `~/.pi/agent/skills/`
- `~/.agents/skills/`

**Notes:** Project skills are resolved from `.pi/skills/` and `.agents/skills/` in the cwd and ancestor directories, up to the git repository root (or filesystem root when not in a repo). `~/.agents/skills/` is shared with Claude Code / OpenAI Codex. On a name collision, Pi warns and keeps the first skill found, but the order in which locations are checked is not documented.

**Precedence order:** Not documented in source.

**Plugin skills:** Pi packages (npm/git, installed via `pi install`) are a first-class skill source — via `skills/` directories or a `pi.skills` entry in `package.json` — alongside the project/global dirs. The one package installed here (`pi-cursor-sdk`) ships no skills.

---

## Synthesis: Can a tool use the `.agents/skills/` convention?

The dataset reveals a shared, cross-tool "agent standard" directory — `.agents/skills/` at the project level and `~/.agents/skills/` globally. Whether a tool honors it cleanly, partially, or not at all determines how portable a single skill installation can be.

### Full support — reads both `.agents/skills/` (project) and `~/.agents/skills/` (global)

| Tool                         | Project path      | Global path         |
| ---------------------------- | ----------------- | ------------------- |
| Amp                          | `.agents/skills/` | `~/.agents/skills/` |
| OpenAI Codex                 | `.agents/skills`  | `~/.agents/skills`  |
| Cursor                       | `.agents/skills/` | `~/.agents/skills/` |
| Gemini CLI                   | `.agents/skills/` | `~/.agents/skills/` |
| GitHub Copilot (cloud agent) | `.agents/skills`  | `~/.agents/skills`  |
| OpenCode                     | `.agents/skills/` | `~/.agents/skills/` |
| Pi                           | `.agents/skills/` | `~/.agents/skills/` |

These seven are mutually interoperable through the standard directory at both scopes. Amp was previously misclassified as "variant support" — its manual's precedence list confirms `~/.agents/skills/` is checked globally (second in precedence, right after the XDG-style `~/.config/agents/skills/`), so it belongs here.

### Variant support — documents a near-but-different path

- **Factory CLI** — *documents* only the **singular** `.agent/skills/` (no `s`) compat dir plus `~/.factory/skills/`. _Observed:_ the `droid` binary actually reads four home-dir roots — `~/.factory/skills/`, `~/.agents/skills/`, `~/.agent/skills/`, and `~/.claude/skills/` — the last three all **undocumented**. So in practice Factory belongs with "full support": it reads `~/.agents/skills/` **directly** (isolation-probe confirmed), not merely via symlinks.

### No support

- **Claude Code** — only `.claude/skills/` (project) and `~/.claude/skills/` (global). It genuinely does not read any `.agents/` directory — isolation-probe confirmed 2026-07-06 (a skill in `~/.agents/skills/` only, no symlink, did not load). _Observed:_ it still loads the shared skills here because `~/.claude/skills/` is populated with symlinks into `~/.agents/skills/` — i.e. transitively, unlike droid which reads `~/.agents/skills/` directly.

> **Observed nuance:** "support" above describes what each tool reads *by directory name*. Two different mechanisms produce the same apparent result on this machine: (a) reading `~/.agents/skills/` **directly** (droid — confirmed; and the natively-`.agents` tools), vs. (b) reading `~/.claude/skills/`, a symlink farm pointing into `~/.agents/skills/`, and following the links (**Claude Code**, Amp). Only an isolation test (skill in one dir, no symlink) distinguishes the two. See [Observed on this machine](#observed-on-this-machine-2026-07-04).

### Two competing "shared" conventions

1. **`.agents/skills/` + `~/.agents/skills/`** — the broad agent standard, documented by 7 of the 9 installed tools and read by 8 in practice (Factory/droid reads `~/.agents/skills/` directly too, just undocumented).
2. **`.claude/skills/`** — Claude Code's own layout, which several _other_ tools (Amp, Cursor, Copilot, OpenCode, plus Codex/Pi via the shared agents dir) also read for compatibility — even though Claude Code itself ignores `.agents/`.

### Bottom line

**The highest-leverage place to install global skills is `~/.agents/skills/`.** By documentation, seven tools discover it out of the box — Amp, Codex, Cursor, Gemini CLI, GitHub Copilot, OpenCode, and Pi. Empirically the count is **eight**: **Factory CLI (droid) also reads `~/.agents/skills/` directly** — undocumented, but confirmed by isolation probe (see [Observed](#observed-on-this-machine-2026-07-04)). Only one tool genuinely misses it:

- **Claude Code** → does not read any `.agents/` dir; also install to `~/.claude/skills/` (or symlink `~/.agents/skills/` entries into it, which is how this machine is set up).

So `~/.agents/skills/` reaches eight of nine tools; adding `~/.claude/skills/` covers Claude Code and reaches all nine. (Because Factory's `~/.agents/skills/` support is undocumented, treat `~/.factory/skills/` as the safe belt-and-suspenders path if you don't want to depend on it.)

### Precedence: documented vs. undocumented

Of the 9 tools, only 4 publish a full cross-scope precedence order: **Amp**, **Claude Code**, and **Gemini CLI** (strict override, first/highest wins), and **OpenAI Codex** (documented discovery order, but explicitly _not_ an override rule — duplicate names coexist). The remaining 5 — **Cursor**, **Factory CLI**, **GitHub Copilot**, **OpenCode**, **Pi** — list their search locations but don't document what happens when a skill name collides across them. Where a collision matters for these five, don't rely on directory order — use distinct skill names instead.

---

## Observed on this machine (2026-07-04)

Everything above is the tools' documented behavior. This section records what was actually verified loading on this machine, and how. Two methods gave authoritative resolved lists (a tool dumping its own skills with source paths); the rest were traced via directory enumeration, `plugin list` subcommands, and — for Factory — analysis of the compiled binary's baked-in path strings.

### The symlink topology (why the tools converge)

`~/.agents/skills/` is the **physical source of truth**: 50 real skill directories, each with a `SKILL.md`. `~/.claude/skills/` is *not* a separate copy — it is mostly **symlinks** back into `~/.agents/skills/` (e.g. `~/.claude/skills/blueprint → ../../.agents/skills/blueprint`), plus a handful of `ui-*` skills that are real directories. So one physical skill set is exposed under both the `.agents` and `.claude` global path names.

```
~/.agents/skills/blueprint/SKILL.md      ← real file (source of truth)
        ▲
        └── ~/.claude/skills/blueprint   ← symlink
```

This is why nearly every tool loads the same ~50 skills: tools that read `.agents/skills/` natively get them directly; tools that only read `.claude`-flavored paths get the identical files through the symlinks (they all follow symlinks). It also means a plain non-symlink-following `find` under `~/.claude/skills/` sees only the ~9 real `ui-*` dirs, while the tools themselves see all ~50.

### What each tool actually loaded

| Tool | How verified | Actually loaded from |
| --- | --- | --- |
| **Amp** | Resolved list (`amp`, see `docs/amp-skills.md`) — **authoritative** | 132 total: 50 `~/.agents/skills/` + 79 `~/.claude/plugins/cache/` (compound-engineering 39, vercel 27, valtown 9, codex 3, impeccable 1) + 3 Amp built-in |
| **Gemini CLI** | Resolved list (`gemini skills list --all`) — **authoritative** | 52 total: 50 `~/.agents/skills/` + 2 npm-bundled built-ins (skill-creator, antigravity-support) |
| **Claude Code** | Dir + plugin-cache enumeration vs. session skill list | ~150 total: ~53 `~/.claude/skills/` (symlinks → `~/.agents/skills/` + real `ui-*`) + 97 `~/.claude/plugins/cache/` (vercel 45, compound-engineering 39, valtown 9, codex 3, impeccable 1) |
| **OpenAI Codex** | `codex plugin list` + dir enumeration | 50 `~/.agents/skills/` + 5 `~/.codex/skills/.system/` + 8 enabled plugins (documents, pdf, spreadsheets, presentations, template-creator, browser, vals, github) |
| **Factory CLI (droid)** | Binary analysis + isolation probe + droid self-report | 53 — reads `~/.agents/skills/` **directly** (binary joins `homedir()` with `.factory`/`.agents`/`.agent`/`.claude` + `skills`; probe: count 53→54 with a skill in `~/.agents/skills/` only). All roots but `~/.factory/skills/` are undocumented |
| **Cursor** | Dir enumeration (TUI needs workspace trust) | 50 `~/.agents/skills/` + `~/.claude/skills/` + 5 `~/.codex/skills/` (legacy compat) |
| **OpenCode** | Dir enumeration (no skills subcommand) | 50 `~/.agents/skills/` + `~/.claude/skills/` (compat) |
| **Pi** | `pi list` + dir enumeration | 50 `~/.agents/skills/`; `~/.pi/agent/skills/` empty; 1 package (pi-cursor-sdk) with no skills |
| **GitHub Copilot (cloud)** | Not locally introspectable | none observable here — cloud agent runs server-side; `~/.copilot/skills` and repo dirs all absent |

### Plugin skills — the real per-tool picture

Confirming and correcting the earlier research against what actually loads:

- **Do bundle skills into the load path (verified):** Claude Code (97 plugin skills loaded), OpenAI Codex (8 enabled plugins), Amp (79 — but from **Claude Code's** plugin caches, since Amp's own plugins are TS-only and can't ship skills).
- **Bundle skills by design, none installed here:** Cursor, Factory CLI, Gemini CLI (extension tier).
- **Do NOT contribute skills:** OpenCode (plugins are hooks/tools only) and the GitHub Copilot **cloud agent** surface.
- **Cross-tool plugin-cache reading:** Amp reads `~/.claude/plugins/cache/` but **not** `~/.codex/plugins/`. Gemini reads neither. So "plugins in the skill path" is not uniform — for Amp specifically it means *ingesting another tool's (Claude Code's) plugin skills*, not emitting its own.

### Corrections this surfaced vs. the documented data

1. **Factory CLI** — docs list only `~/.factory/skills/` globally (plus the `.agent/skills` project compat dir). The `droid` binary actually reads **four** home-dir roots: `~/.factory/skills/`, `~/.agents/skills/`, `~/.agent/skills/`, and `~/.claude/skills/`. The latter three are undocumented. Added to the global paths above and in `skill-data.json`.
2. **Factory reads `~/.agents/skills/` directly** (confirmed by isolation probe, binary join tokens, and droid's own `docs/droid-skill-discovery-report.md`). This **overturns an earlier false negative** in this doc that claimed droid only loads those skills via `~/.claude/skills/` symlinks — that conclusion came from grepping the binary for the slashed literal `.agents/skills`, which never appears because the path is built by joining separate `[".agents","skills"]` tokens.
3. **OpenAI Codex** — the documented REPO/USER/ADMIN/SYSTEM scope list omits the **plugin** source; enabled Codex plugins contribute skills (a 5th source).
4. **Amp** — the "Plugins" precedence entry is Claude-Code-plugin-cache interop, not Amp-native plugin skills.

### How to test skill discovery yourself (isolation probe)

The general method for any tool, when you can't trust the docs and symlinks confound direct observation:

1. **Find a "loaded skills" signal.** For droid it's the TUI header `Skills (N)` (printed even at the login screen, so no auth needed). For others: `gemini skills list`, `codex plugin list`, Amp's resolved list, or the agent's own "list your skills" in a headless run.
2. **Baseline** the count/list from a clean, non-repo working directory (so project-scoped dirs don't interfere with a global-path test).
3. **Create one uniquely-named throwaway skill in exactly one candidate directory** — crucially with **no symlink or copy** in any other candidate dir. A skill is just a folder with a minimal `SKILL.md` (YAML frontmatter: `name`, `description`).
4. **Re-read** the signal. If the count/list gains your probe, that directory is scanned directly. If not, it isn't.
5. **Remove** the probe and repeat per candidate directory.

The confound to avoid is exactly what tripped up the first `droid-skill-discovery-report.md`: it checked only whether skills had `~/.factory/skills/` symlinks and never checked `~/.claude/skills/`, so "available without a factory symlink" couldn't distinguish a direct `~/.agents/skills/` scan from a `~/.claude/skills/` symlink. The isolation probe (one dir, no symlinks) removes that ambiguity — and here it confirmed the direct `~/.agents/skills/` scan (`Skills (53)` → `Skills (54)`).
