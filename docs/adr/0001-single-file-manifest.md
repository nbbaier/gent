# Single-file manifest, no separate lockfile

gent records managed skills in one `gent.json` per scope that carries both intent
(`source`, `ref`) and resolved state (content `hash`) in the same entry, rather
than splitting a hand-edited manifest from a generated lockfile as npm does.

## Considered Options

- **`gent.json` + `gent.lock`** (rejected) — the npm model. The manifest/lock split
  earns its keep when a lock captures a *resolved transitive dependency graph* the
  manifest doesn't express. Skills have no dependency graph, so the lock would only
  duplicate the manifest plus a hash. The closest prior art, `vercel-labs/skills`,
  reached the same conclusion and uses a single file.
- **Single `gent.json`** (chosen) — one file holds source + ref + resolved hash.

## Consequences

- The project `gent.json` is committed. To keep it merge-friendly it is written with
  sorted keys and no timestamps, so non-overlapping additions on two branches
  auto-merge (a technique taken from vercel's project lock).
- `ref` may still be a branch or tag (not only a pinned SHA); the recorded hash is
  what makes `sync` reproducible and drift detectable.
