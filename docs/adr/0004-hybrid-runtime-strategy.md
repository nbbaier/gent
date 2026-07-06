# Hybrid runtime strategy: query agents that can be queried, model the rest

When gent needs an agent's resolved skill view (`gent list --agent`, unmanaged-skill detection for `adopt`), it uses a per-agent strategy recorded in the tool registry: **shell out to the agent's query surface where an authoritative, free, side-effect-free one exists; use the modeled resolver otherwise.** Every query result is post-processed by the model where the research showed raw output is incomplete.

Per-agent assignment (from the query-interface table in [`agent-skill-resolution.md`](../agent-skill-resolution.md)):

- **Query at runtime** — Copilot CLI, Amp, OpenCode (JSON), Pi (JSONL over RPC), Codex and Gemini (text/prompt-render, parsed).
- **Query + modeled correction** — Gemini and Pi are trust-gated: in an untrusted folder their query output silently omits project skills. gent checks trust state first (e.g. `~/.gemini/trustedFolders.json`); when untrusted it must not present query output as complete — it supplements from the modeled resolver and flags the affected skills as trust-blocked.
- **Model only** — droid and Cursor (no local query surface; Cursor's only signal costs a paid model call), and **Claude Code**: its bogus-key debug harness is authoritative and free, but it relies on an undocumented log format and leaves junk transcripts under `~/.claude/projects/` on every run. Side effects in a read-only listing command are unacceptable, so Claude Code runs on the modeled resolver at runtime; the harness is reserved for verification (the drift harness, open question 6).

Two hard rules regardless of assignment:

1. **Never invoke a surface that can trigger a model call or spend money.** `cursor-agent skills` and `codex skills` are paid-prompt traps; only the verified no-model-call surfaces qualify.
2. **Query failure degrades, never breaks.** Undocumented surfaces (`codex debug prompt-input`, `opencode debug skill`) can drift; on nonzero exit or unparseable output, fall back to the modeled resolver and warn that the result is modeled, not queried.

## Considered Options

- **Always query** (rejected) — droid and Cursor have no usable surface at all, and trust gates mean even real query output can be silently incomplete. Not achievable as a uniform path.
- **Always model** (rejected) — one uniform code path, but modeled resolvers go stale invisibly: Amp's resolved count drifted 132→135 in a single day (2026-07-04→05). Querying absorbs tool drift automatically wherever it's available; giving that up makes every finding a liability that only the drift harness can service.
- **Hybrid, query-first** (chosen) — cheapest authoritative method per agent, modeled resolver as the universal fallback and corrector.

## Consequences

- **The modeled specs are load-bearing at runtime, not just documentation.** The modeled resolver must be implemented for all nine agents anyway (droid, Cursor, Claude Code natively; everyone else as fallback; Gemini/Pi as trust correction) — hybrid adds query parsers on top of that work rather than replacing it. `docs/skill-data.json` ships as the registry that drives both.
- The tool registry gains per-tool runtime fields: the query command and parse format (or `model`), and how to check trust state where relevant.
- Output should carry provenance — whether each agent's list was queried, modeled, or queried-with-correction — so a fallback is visible rather than silent.
- The drift harness (open question 6) remains necessary: it is the only guard for the model-only agents and for the parse formats of the undocumented query surfaces.
- Six external command invocations per full `gent list --agent` sweep is accepted; each verified surface runs locally in under a second with no network or key.
