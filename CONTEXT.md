# Gent

A CLI that installs agent skills from common sources, keeps them synchronized over
time, and places them where each agent tool expects to find them — under a single
local management model the user controls.

## Language

**Skill**:
A directory containing a `SKILL.md` (plus optional assets) that an agent tool can
discover and invoke. The atomic unit gent manages.

**Manifest**:
The single per-scope file (`gent.json`) that declares which skills are managed,
each skill's source and ref, the targets configuration, and each skill's resolved
content hash. It is both declared intent and resolved state — there is no separate
lockfile.
_Avoid_: lockfile, lock, config, gent.lock

**Scope**:
The level a manifest governs. **Global** — personal skills shared across all
projects, manifest in the user config dir. **Project** — skills a repo needs,
manifest committed at the repo root. The two never write to the same location.

**Source**:
Where a skill's bytes come from — a git repo, a local path, or a plugin manifest.
Each source kind is handled by a Source Resolver behind a common contract.

**Source Resolver**:
The component that turns a source reference into fetched skill files plus the
metadata to record (resolved ref, subpath, hash).

**Canonical store**:
The single real on-disk copy of a managed skill. `~/.agents/skills/<name>` at
global scope, `<repo>/.agents/skills/<name>` at project scope. Every other tool
location points back to it.
_Avoid_: cache

**Target**:
A tool-specific skills directory gent writes into. The canonical store doubles as
the primary target (the seven tools that read `.agents/skills`); holdout targets
receive symlinks.

**Holdout**:
An agent tool that does not read `.agents/skills` and needs its own directory —
Claude Code (`~/.claude/skills`) and Factory (`~/.factory/skills`). Holdouts get a
symlink back to the canonical store.

**Tool registry**:
Shipped data mapping each known agent tool to its skill directories. Detection
consults it to decide which holdout symlinks are worth creating.

**Materialize**:
To place a managed skill on disk: write the canonical store, then create the
holdout symlinks.

**Managed skill**:
A skill recorded in a manifest and owned by gent.

**Unmanaged skill**:
A skill found in a target directory that gent did not place there. gent reports it
but never mutates or deletes it.

**Adopt**:
To pull an unmanaged skill into a manifest so gent begins managing it.

**Drift**:
The state where a managed skill's on-disk content no longer matches the hash
recorded in its manifest (usually a hand edit).

**Sync**:
To reconcile disk to the manifest — materialize missing skills, repair broken
symlinks, warn on drift, prune managed orphans. Never changes which ref a skill is
pinned to.

**Update**:
To move a skill's ref forward — re-resolve the ref, record the new hash, then
re-materialize. Only meaningful for skills tracking a branch or tag.
