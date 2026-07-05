# Canonical store at `.agents/skills` with symlinks to holdouts

A managed skill has exactly one real copy on disk, in the canonical store at `~/.agents/skills/<name>` (global) or `<repo>/.agents/skills/<name>` (project). Tools that don't read `.agents/skills` — the holdouts, Claude Code and Factory — receive a symlink pointing back at that copy. gent detects which holdout tools are actually installed and only links for those; a `targets` block in the manifest can force-add or exclude locations.

## Considered Options

- **Fan-out copies** (rejected) — copy the skill into every tool directory. Robust against symlink-unaware tools, but N duplicated copies and every update rewrites all of them.
- **Single dir, rely on each tool's compatibility reading** (rejected) — write only `.agents/skills`. Fails outright: Claude Code and Factory never read it.
- **Canonical store + symlinks** (chosen) — one real copy that already satisfies the seven `.agents/skills`-reading tools; minimal symlinks for the two holdouts.

## Consequences

- The approach assumes holdout tools follow a symlinked skill _directory_ during discovery. This is verified by a spike before the rest is built; if a tool ignores symlinks, that specific holdout falls back to a copy.
- Choosing `.agents/skills` as the store (not a private dir) means the store is simultaneously the primary target — no extra copy or link for the majority case.
