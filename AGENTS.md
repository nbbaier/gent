## Source Code Reference

Source code for dependencies is cached at `~/.opensrc/`.

Use `opensrc path` inside other commands to read source:

\`\`\`bash
rg "pattern" $(opensrc path <package>)
cat $(opensrc path <package>)/path/to/file
\`\`\`
