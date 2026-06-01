# Agent Skill Locations by Tool

A reference for where each coding agent discovers skills, synthesized from `skill-data.json`. Each section lists the project-level (workspace/repo) and global (user/home) search paths, plus tool-specific notes on precedence and compatibility.

---

## Amp

**Source:** [https://ampcode.com/manual#agent-skills](https://ampcode.com/manual#agent-skills)

**Project search paths**

- `.agents/skills/`
- `.claude/skills/`

**Global search paths**

- `~/.config/agents/skills/`
- `~/.config/amp/skills/`
- `~/.claude/skills/`

**Notes:** Full precedence (first wins): `~/.config/agents/skills/`, `~/.config/amp/skills/`, `.agents/skills/`, `.claude/skills/`, `~/.claude/skills/`, then plugins, legacy toolbox directories, and built-in skills.

---

## Augment (Auggie CLI)

**Source:** [https://docs.augmentcode.com/cli/skills#skill-locations](https://docs.augmentcode.com/cli/skills#skill-locations)

**Project search paths**

- `<workspace>/.augment/skills/`
- `<workspace>/.claude/skills/`
- `<workspace>/.agents/skills/`

**Global search paths**

- `~/.augment/skills/`
- `~/.claude/skills/`
- `~/.agents/skills/`

**Notes:** User (home directory) locations have higher precedence than workspace locations. Skills from all locations are loaded; when names conflict, the higher-precedence location wins.

---

## Claude Code

**Source:** [https://code.claude.com/docs/en/skills#where-skills-live](https://code.claude.com/docs/en/skills#where-skills-live)

**Project search paths**

- `.claude/skills/<skill-name>/SKILL.md`

**Global search paths**

- `~/.claude/skills/<skill-name>/SKILL.md`

**Notes:** Also supports enterprise and plugin scopes. Same-name precedence is enterprise > personal > project. Plugin skills are namespaced (`plugin-name:skill-name`) so they cannot conflict. Project skills also load from `.claude/skills/` in every parent directory up to the repository root.

---

## claudOpenAI Codex

**Source:** [https://developers.openai.com/codex/skills#where-to-save-skills](https://developers.openai.com/codex/skills#where-to-save-skills)

**Project search paths**

- `$CWD/.agents/skills`
- `$CWD/../.agents/skills`
- `$REPO_ROOT/.agents/skills`

**Global search paths**

- `$HOME/.agents/skills`
- `/etc/codex/skills`
- bundled system skills

**Notes:** Scopes are REPO, USER, ADMIN (`/etc/codex/skills`), and SYSTEM (bundled with Codex). For repositories, Codex scans `.agents/skills` in every directory from the current working directory up to the repository root.

---

## Crush

**Source:** [https://github.com/charmbracelet/crush#agent-skills](https://github.com/charmbracelet/crush#agent-skills)

**Project search paths**

- `.crush/skills/`

**Global search paths**

- `~/.config/crush/skills/`
- `~/.config/agents/skills/`

**Notes:** Project-local `.crush/skills/` is prepended before the global default. The global default skills directory can be overridden via the `CRUSH_SKILLS_DIR` environment variable. On Windows the global paths are `%LOCALAPPDATA%\crush\skills\` and `%LOCALAPPDATA%\agents\skills\`.

---

## Cursor

**Source:** [https://cursor.com/docs/skills#skill-directories](https://cursor.com/docs/skills#skill-directories)

**Project search paths**

- `.agents/skills/`
- `.cursor/skills/`

**Global search paths**

- `~/.agents/skills/`
- `~/.cursor/skills/`

**Notes:** Also reads legacy compatibility directories: `.claude/skills/` and `.codex/skills/` (project), and `~/.claude/skills/` and `~/.codex/skills/` (global). Skills are not currently discovered outside the root `.cursor/skills` directory in monorepos.

---

## Factory CLI

**Source:** [https://docs.factory.ai/cli/configuration/skills#where-skills-live](https://docs.factory.ai/cli/configuration/skills#where-skills-live)

**Project search paths**

- `<repo>/.factory/skills/`
- `<repo>/.agent/skills/`

**Global search paths**

- `~/.factory/skills/`

**Notes:** `<repo>/.agent/skills/` is a compatibility location discovered for the `.agent` folder convention. Each skill lives in its own directory containing a `SKILL.md`.

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

**Notes:** Project skills are stored in the repository; personal skills are stored in the home directory and shared across projects.

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

**Notes:** `.claude/skills/` and `.agents/skills/` directories are supported for compatibility with Claude Code and the agent-standard convention.

---

## Pi

**Source:** [https://pi.dev/docs/latest/skills#locations](https://pi.dev/docs/latest/skills#locations)

**Project search paths**

- `.pi/skills/`
- `.agents/skills/`

**Global search paths**

- `~/.pi/agent/skills/`
- `~/.agents/skills/`

**Notes:** Project skills are resolved from `.pi/skills/` and `.agents/skills/` in the cwd and ancestor directories, up to the git repository root (or filesystem root when not in a repo). `~/.agents/skills/` is shared with Claude Code / OpenAI Codex.

---

## Synthesis: Can a tool use the `.agents/skills/` convention?

The dataset reveals a shared, cross-tool "agent standard" directory — `.agents/skills/` at the project level and `~/.agents/skills/` globally. Whether a tool honors it cleanly, partially, or not at all determines how portable a single skill installation can be.

### Full support — reads both `.agents/skills/` (project) and `~/.agents/skills/` (global)

| Tool | Project path | Global path |
|------|--------------|-------------|
| Augment (Auggie CLI) | `.agents/skills/` | `~/.agents/skills/` |
| OpenAI Codex | `.agents/skills` | `$HOME/.agents/skills` |
| Cursor | `.agents/skills/` | `~/.agents/skills/` |
| Gemini CLI | `.agents/skills/` | `~/.agents/skills/` |
| GitHub Copilot (cloud agent) | `.agents/skills` | `~/.agents/skills` |
| OpenCode | `.agents/skills/` | `~/.agents/skills/` |
| Pi | `.agents/skills/` | `~/.agents/skills/` |

These seven are mutually interoperable through the standard directory at both scopes.

### Variant support — uses a near-but-different path

- **Amp** — reads project `.agents/skills/`, but its global agents path is the XDG-style `~/.config/agents/skills/`, **not** `~/.agents/skills/`.
- **Crush** — has **no** project `.agents/skills/` (only `.crush/skills/`); globally it reads `~/.config/agents/skills/` (XDG variant), not `~/.agents/skills/`.
- **Factory CLI** — uses the **singular** `.agent/skills/` (no `s`), a related but distinct "`.agent` folder" convention, with no global agents directory.

### No support

- **Claude Code** — only `.claude/skills/` (project) and `~/.claude/skills/` (global). It does not read any `.agents/` directory.

### Two competing "shared" conventions

1. **`.agents/skills/` + `~/.agents/skills/`** — the broad agent standard, honored cleanly by 7 tools.
2. **`.claude/skills/`** — Claude Code's own layout, which several *other* tools (Amp, Augment, Cursor, Copilot, OpenCode, plus Codex/Pi via the shared agents dir) also read for compatibility — even though Claude Code itself ignores `.agents/`.

### Bottom line

**The highest-leverage place to install global skills is `~/.agents/skills/`.** A single skill dropped there is discovered by seven tools out of the box — Augment, Codex, Cursor, Gemini CLI, GitHub Copilot, OpenCode, and Pi. Only four tools miss it, and each for a specific, known reason:

- **Claude Code** → also install to `~/.claude/skills/`
- **Amp** and **Crush** → also install to `~/.config/agents/skills/` (XDG variant)
- **Factory CLI** → uses `.agent/skills/` (singular) and has no global agents path

Covering `~/.agents/skills/` plus those three fallbacks reaches every tool in this dataset globally.