import { readdir } from "node:fs/promises";
import { join } from "node:path";

/**
 * Recursively list files under root as sorted, "/"-separated relative paths.
 * Skips .git directories.
 */
export async function walkFiles(root: string): Promise<string[]> {
	const out: string[] = [];
	async function walk(rel: string): Promise<void> {
		const entries = await readdir(rel ? join(root, rel) : root, {
			withFileTypes: true,
		});
		for (const entry of entries) {
			if (entry.name === ".git") continue;
			const childRel = rel ? `${rel}/${entry.name}` : entry.name;
			if (entry.isSymbolicLink()) {
				throw new Error(`symlinks are not allowed in source trees: ${childRel}`);
			}
			if (entry.isDirectory()) {
				await walk(childRel);
			} else {
				out.push(childRel);
			}
		}
	}
	await walk("");
	return out.sort();
}
