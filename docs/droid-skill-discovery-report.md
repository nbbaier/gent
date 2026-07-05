# Undocumented Skill Discovery from `~/.agents/skills/`

## Summary

Droid discovers and loads skills from `~/.agents/skills/` even when those skills are **not symlinked** into the documented `~/.factory/skills/` directory. This behavior is not covered in the official documentation.

## Official documentation

The [skills docs](https://docs.factory.ai/cli/configuration/skills) list these discovery locations:

| Scope | Location |
|-------|----------|
| Workspace | `<repo>/.factory/skills/` |
| Personal | `~/.factory/skills/` |
| Compatibility | `<repo>/.agent/skills/` |

No mention of `~/.agents/skills/`.

## Observed behavior

Using `bunx skills@latest list -g -a droid`, 53 skills are installed at `~/.agents/skills/`. Only 26 of those have symlinks in `~/.factory/skills/`. The remaining 27 have no symlink, yet are fully available in the Droid session.

### Skills available WITHOUT a `~/.factory/skills/` symlink

```
agent-ci, blueprint, cloudflare, code-refactor-review, goal-refiner,
hallmark, html-tools, ideation, implementation-guide, improve, knip,
logging-best-practices, react-effect-patterns, shadcn, tufte-viz,
ui-add-dark-mode, ui-brand-kit, ui-canonicalize-tailwind, ui-componentize,
ui-dark-mode-image, ui-design, ui-ideas, ui-make-responsive,
ui-markup-from-image, ultracite, workers-best-practices, wrangler
```

### Skills with a `~/.factory/skills/` symlink (pointing to `~/.agents/skills/`)

```
ask-matt, caveman, code-review, codebase-design, diagnose, diagnosing-bugs,
domain-modeling, find-skills, grill-me, grill-with-docs, grilling, handoff,
implement, improve-codebase-architecture, npm-deps-cleanup, prototype,
research, setup-matt-pocock-skills, tdd, teach, to-issues, to-prd, triage,
write-a-skill, writing-great-skills, zoom-out
```

## Conclusion

Droid scans `~/.agents/skills/` as an additional (undocumented) skill discovery path. The symlinks in `~/.factory/skills/` are not required for a skill to be loaded. This should either be documented or treated as an implementation detail that users should not rely on.

## Environment

- macOS (darwin 24.6.0)
- Date observed: 2026-07-04
