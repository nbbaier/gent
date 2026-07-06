import { readdir } from "node:fs/promises";
import { basename, join } from "node:path";

export interface DiscoveredSkill {
	name: string;
	/** Absolute path to the skill directory (the one containing SKILL.md). */
	dir: string;
	/** dir relative to the searched root; "" when the root itself is the skill. */
	relDir: string;
}

/**
 * Locate SKILL.md directories under root, sorted by name. Reading the name
 * from frontmatter (falling back to the directory name) is the only content
 * inspection gent performs (ADR-0003). Does not descend into a found skill
 * dir — nested SKILL.md files are that skill's assets.
 */
export async function discoverSkills(root: string): Promise<DiscoveredSkill[]> {
	const found: DiscoveredSkill[] = [];

	async function visit(rel: string): Promise<void> {
		const dir = rel ? join(root, rel) : root;
		const entries = await readdir(dir, { withFileTypes: true });
		if (entries.some((e) => e.isFile() && e.name === "SKILL.md")) {
			const markdown = await Bun.file(join(dir, "SKILL.md")).text();
			found.push({
				name: frontmatterName(markdown) ?? basename(dir),
				dir,
				relDir: rel,
			});
			return;
		}
		for (const entry of entries) {
			if (entry.isDirectory() && entry.name !== ".git") {
				await visit(rel ? `${rel}/${entry.name}` : entry.name);
			}
		}
	}

	await visit("");
	return found.sort((a, b) => a.name.localeCompare(b.name));
}

/** Read `name:` from a SKILL.md frontmatter block; null when absent. */
export function frontmatterName(markdown: string): string | null {
	const block = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
	if (!block || block[1] === undefined) return null;
	const line = block[1].split(/\r?\n/).find((l) => /^name\s*:/.test(l));
	if (!line) return null;
	const value = line
		.slice(line.indexOf(":") + 1)
		.trim()
		.replace(/^(["'])(.*)\1$/, "$2");
	return value || null;
}
