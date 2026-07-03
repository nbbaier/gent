# Agent Skill Locations by Tool

A reference for where each coding agent discovers skills, synthesized from `skill-data.json`. Each section lists the project-level (workspace/repo) and global (user/home) search paths, the tool-specific notes on precedence and compatibility, and — where the source documents it — the full precedence order across all scopes combined (highest priority first). Where a source does not state a collision-resolution order, that's called out explicitly rather than guessed at.

This dataset only covers tools actually installed on this machine (verified via `PATH`, package manager globals, and `/Applications`): Amp, Claude Code, OpenAI Codex, Cursor, Factory CLI (Droid), Gemini CLI, GitHub Copilot, OpenCode, and Pi.

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

---

## Claude Code

**Source:** [https://code.claude.com/docs/en/skills#where-skills-live](https://code.claude.com/docs/en/skills#where-skills-live)

**Project search paths**

- `.claude/skills/<skill-name>/SKILL.md`

**Global search paths**

- `~/.claude/skills/<skill-name>/SKILL.md`

**Notes:** Also supports enterprise and plugin scopes. Same-name precedence is enterprise > personal > project. Plugin skills are namespaced (`plugin-name:skill-name`) so they cannot conflict. Project skills also load from `.claude/skills/` in every parent directory up to the repository root.

**Precedence order (highest to lowest):**

1. Enterprise (managed settings)
2. `~/.claude/skills/` (Personal)
3. `.claude/skills/` (Project)
4. Bundled/built-in skills

Plugin skills sit outside this chain — their `plugin-name:skill-name` namespace means they never collide with the levels above.

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

---

## Factory CLI

**Source:** [https://docs.factory.ai/cli/configuration/skills#where-skills-live](https://docs.factory.ai/cli/configuration/skills#where-skills-live)

**Project search paths**

- `<repo>/.factory/skills/`
- `<repo>/.agent/skills/`

**Global search paths**

- `~/.factory/skills/`

**Notes:** `<repo>/.agent/skills/` is a compatibility location discovered for the `.agent` folder convention. Each skill lives in its own directory containing a `SKILL.md`. Precedence when a skill name collides across workspace/personal/compatibility locations is not documented.

**Precedence order:** Not documented in source.

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

### Variant support — uses a near-but-different path

- **Factory CLI** — uses the **singular** `.agent/skills/` (no `s`), a related but distinct "`.agent` folder" convention, with no global agents directory.

### No support

- **Claude Code** — only `.claude/skills/` (project) and `~/.claude/skills/` (global). It does not read any `.agents/` directory.

### Two competing "shared" conventions

1. **`.agents/skills/` + `~/.agents/skills/`** — the broad agent standard, honored cleanly by 7 of the 9 installed tools.
2. **`.claude/skills/`** — Claude Code's own layout, which several _other_ tools (Amp, Cursor, Copilot, OpenCode, plus Codex/Pi via the shared agents dir) also read for compatibility — even though Claude Code itself ignores `.agents/`.

### Bottom line

**The highest-leverage place to install global skills is `~/.agents/skills/`.** A single skill dropped there is discovered by seven tools out of the box — Amp, Codex, Cursor, Gemini CLI, GitHub Copilot, OpenCode, and Pi. Only two tools miss it, each for a specific, known reason:

- **Claude Code** → also install to `~/.claude/skills/`
- **Factory CLI** → uses `.agent/skills/` (singular) and has no global agents path

Covering `~/.agents/skills/` plus those two fallbacks reaches every tool in this dataset globally.

### Precedence: documented vs. undocumented

Of the 9 tools, only 4 publish a full cross-scope precedence order: **Amp**, **Claude Code**, and **Gemini CLI** (strict override, first/highest wins), and **OpenAI Codex** (documented discovery order, but explicitly _not_ an override rule — duplicate names coexist). The remaining 5 — **Cursor**, **Factory CLI**, **GitHub Copilot**, **OpenCode**, **Pi** — list their search locations but don't document what happens when a skill name collides across them. Where a collision matters for these five, don't rely on directory order — use distinct skill names instead.
