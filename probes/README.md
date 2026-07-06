# Probes

Reusable probe scripts for verifying agent skill-resolution behavior — seeds for
the drift harness ([`docs/agent-skill-resolution.md`](../docs/agent-skill-resolution.md),
open question 6). Each script extracts a "loaded skills" signal from one agent so
the isolation-probe method can be automated and re-run when tools update.

## droid-header.py

Reads Factory droid's TUI `Skills (N)` header count via a pty (droid has no
skills-list command; this count is its only query-free signal).

```bash
python3 probes/droid-header.py <cwd>   # prints N, exits 1 if no header seen
```

Method notes: 200×60 pty winsize (plain `script` fails — 1-column pty), ANSI
stripped, 60s timeout, droid killed after the header renders. The count does
**not** dedup name collisions and does **not** count symlinked skill dirs, even
though the loader loads both — see the droid section of
`docs/agent-skill-resolution.md`.

## Other agents

No scripts needed yet — they have query surfaces (see the per-agent table in
`docs/agent-skill-resolution.md`). The two worth scripting next:

- **Claude Code** (bogus-key debug harness, free, no model call):
  `ANTHROPIC_API_KEY=sk-ant-bogus claude -p hi --debug --debug-file <f>` — scan
  set + counts in the log, full `name: description` list in the run's transcript
  under `~/.claude/projects/<munged-cwd>/`. Clean up the junk transcript after.
- **Cursor** (paid — one headless model call): `cursor-agent --print --trust
  --mode ask` asking the model to enumerate probe skills; include distinct-named
  control skills, since Cursor truncates the prompt's skill list.
