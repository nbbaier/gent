# Gent — Initial Implementation Plan

An implementation plan for **gent**, a CLI that installs agent skills from common sources, keeps them synchronized, and places them where each agent tool looks — under one local management model the user controls.

See [`CONTEXT.md`](../CONTEXT.md) for vocabulary and `docs/adr/` for the decisions behind the shape below.

## Design decisions (settled)

| Area             | Decision                                                                                                                           |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Source of truth  | Declarative single `gent.json` **manifest** per scope — intent + resolved hash in one file (ADR-0001)                              |
| Scopes           | **Global** (personal, `~/.config/gent/gent.json`) and **Project** (committed, `<repo>/gent.json`)                                  |
| Placement        | **Canonical store** at `.agents/skills`; **symlinks** to detected **holdouts** (Claude Code, Factory) (ADR-0002)                   |
| Target discovery | Auto-detect installed tools via a shipped **tool registry** (derived from `docs/skill-data.json`); `targets` block can add/exclude |
| Sources (v1)     | git, local path, plugin manifest — behind one **Source Resolver** interface. npm/JSR deferred                                      |
| Normalization    | Location-only; contents never transformed (ADR-0003)                                                                               |
| Versioning       | Pinned + explicit `update`. `sync` never changes a ref                                                                             |
| Drift            | Warn, never clobber; `--force` / `restore` overwrites back to recorded hash                                                        |
| Unmanaged skills | Reported, never mutated; `adopt` pulls them in                                                                                     |
| Project files    | Only `gent.json` committed; materialized dirs gitignored (gent-managed block), reproduced by `sync`                                |
| Hashing          | One strategy — SHA-256 over skill-folder contents — for every source kind                                                          |
| Runtime          | TypeScript on **Bun**, shipped as a single compiled binary; `bunx`/`npx` fallback                                                  |
| Git access       | Shell out to system `git` (sparse partial checkout + `rev-parse`)                                                                  |
| Commands (v1)    | `add` (`a`/`i`/`install`), `remove` (`rm`/`r`), `sync`, `update`, `list` (`ls`), `adopt`                                           |
| Runtime strategy | **Hybrid** — query agents with a free, side-effect-free surface at runtime; modeled resolver for droid, Cursor, Claude Code, and as universal fallback + trust-gate corrector (ADR-0004) |

## v1 command surface

Scope resolution is uniform across every command: **project if a `gent.json` exists in cwd/ancestors, else global**; `-p/--project`, `-g/--global` force a scope, `--all` spans both.

- `gent add <source>` — discover skills in the source; if ambiguous and interactive, show a multiselect, then prompt for scope; a subpath (`github:o/r/skill`) or `--all`/`-p`/`-g` skips the prompts. Records the entry, resolves the ref to a hash, materializes.
   - aliases: `add`, `a`, `install`, `i`
- `gent remove <name>` — drop from the manifest, prune the canonical store and its symlinks (managed only).
   - aliases: `remove`, `rm`, `r`, `uninstall`
- `gent sync` — reconcile disk to the manifest: materialize missing, repair broken symlinks, warn on drift (`--force` restores), prune managed orphans.
- `gent update [name]` — re-resolve branch/tag refs, record new hashes, re-materialize. No-op for SHA-pinned skills.
- `gent list` — managed inventory; `--json` for scripting.
- `gent adopt [name]` — bare: list adoptable unmanaged skills found in target dirs. Named: pull one in as `source: local` (best-guess origin recorded when derivable).

**Deferred to v1.1+:** `status`/`doctor`, npm/JSR resolver, ephemeral `use`, any registry search/`find`.

## Phases

### Phase 0 — De-risk & scaffold

1. **Symlink spike (gate).** Confirm Claude Code and Factory actually discover a skill through a symlinked _directory_ in their skills dir. If a tool ignores symlinks, mark it a copy-fallback holdout. Everything downstream assumes the outcome of this spike.
2. Bun + TypeScript project scaffold: CLI entry, lightweight arg dispatch (a small command switch, not a heavy framework), `bun build --compile` to a binary, `bun test` wired up.

### Phase 1 — Manifest & resolvers (global scope only)

3. **Manifest module.** `gent.json` schema (versioned, sorted keys, no timestamps); read/write; per-scope path resolution.
4. **Source model + resolver interface.** One contract: `resolve(ref) -> {files, resolvedRef, subpath}`. Implement the **git resolver** (sparse partial clone + `rev-parse`) and the **local resolver**.
5. **Skill discovery** within a fetched source (locate `SKILL.md` dirs, read name from frontmatter) and **SHA-256 folder hashing**.

### Phase 2 — Placement

6. **Tool registry + detection.** Embed a registry from `docs/skill-data.json`; detect installed tools (PATH, known config dirs, `/Applications`); resolve the effective target set with `targets` add/exclude overrides.
7. **Materialize / de-materialize.** Write canonical store; create/repair/remove holdout symlinks (copy fallback per Phase 0). Idempotent.

### Phase 3 — Global commands

8. `add`, `remove`, `list` against global scope (multiselect + subpath forms).
9. `sync` (materialize-missing, repair-links, drift-warn, orphan-prune) and `update` (ref re-resolution). `--force` restore path.

### Phase 4 — Project scope

10. Project manifest resolution (walk up for `gent.json`); the uniform scope rule and `-p`/`-g`/`--all` flags; the interactive scope prompt in `add`.
11. Project materialization into `<repo>/.agents/skills` + holdout links; managed `.gitignore` block.

### Phase 5 — Adopt & plugin resolver

12. `adopt` — scan target dirs for unmanaged skills, list candidates, pull one in as `source: local`.
13. **Plugin-manifest resolver** — discover skills via `.claude-plugin/plugin.json`, layered on the git/local fetch path.

### Phase 6 — Polish

14. Non-interactive/agent-mode behavior (no prompts; require subpath/`--all`/scope flags), atomic writes, clear errors, `--json` outputs, README/usage.

## Key risks & open questions

- **Symlink discovery (highest risk).** The whole placement model rests on holdout tools following symlinked directories — Phase 0 gate.
- **Name collisions within a scope.** Two sources contributing the same skill name to one manifest: v1 treats this as an error at `add` time (skill name is the key).
- **Plugin-manifest layout stability.** `.claude-plugin/plugin.json` discovery depends on a convention that may drift; isolated in its own resolver.
- **`source: local` skills authored in-repo** are naturally committed as their own source; only their materialized copies are gitignored — no separate `vendor` flag in v1.

## Testing

Follow vercel-labs/skills' example of heavy unit coverage: resolver parsing, hashing, manifest read/write/merge, materialization (against a temp HOME + fake tool dirs), and each command's scope resolution. `bun test`.
