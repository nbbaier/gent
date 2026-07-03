# Gent Brainstorming

## Problem

Agent skills are hard to install consistently and hard to keep aligned across projects and environments. There is not a single canonical location for skills; they are scattered across the filesystem in various locations. They have user/project level scopes.

There is a need for a standard tool that lets users install skills from common sources, invoke them on demand, and keep them synchronized over time. The solution should work from the command line, support multiple skill sources and formats, and provide a predictable local management model so skills can be reused reliably across different workflows, environments, and tools.

## Solution

Build a tool that allows a user to install skills from common sources; keep skills synchronized and updated over time; manage local skills inventories; and normalize skill structure across agents/tools.

### Why not vercel-labs/skills?

The tool described above is a subset of what vercel-labs/skills is trying to achieve. It's a good starting point but it has to keep up with all the tools that people use. I don't use all those and would like a tool that I control and is limited to the tools I use.

## Some ideas

- Should be able to read skills that are packaged with plugins
- Should be able to read skills installed wiht packages with something like TanStack Intent
- For skill discovery during install, should respect `.claude-plugin/plugin.json` (see [this section](https://github.com/vercel-labs/skills#plugin-manifest-discovery) of vercel-labs/skills)
- Should be able to discover skills that were installed in another way but not managed with gent
- Should start as a CLI but doesn't necessarily have to stay that way (eventually could expand into a desktop app)
