# Normalization is location-only; skill contents are never transformed

gent treats `SKILL.md`-in-a-directory as the universal skill format. Its entire job is _placement_ — canonical store plus symlinks. It never rewrites a skill's contents or generates per-tool frontmatter variants.

## Considered Options

- **Per-tool content transforms** (rejected) — rewrite frontmatter or emit tool-specific variants. This would require a per-tool transform spec and, fatally, break the symlink strategy: a transformed copy can't be a symlink, forcing fan-out copies (see ADR-0002).
- **Location-only** (chosen) — one canonical copy, shared by symlink, byte-identical everywhere.

## Consequences

- Keeps the single-copy + symlink model intact.
- If a future tool genuinely requires a different on-disk format, it must be handled as a holdout with a generated copy — a deliberate exception, not the default.
- The only content gent inspects is enough of `SKILL.md` to locate a skill and read its name; it does not lint or validate beyond that in v1.
