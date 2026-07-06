import { join } from "node:path";
import { walkFiles } from "./fs-util.ts";

/**
 * "sha256:<hex>" over a folder's contents — the one hashing strategy for
 * every source kind. Per-file sha256 digests combined over sorted relative
 * paths, so the hash is independent of file creation order but sensitive to
 * renames and content changes. .git is excluded (walkFiles).
 */
export async function hashFolder(dir: string): Promise<string> {
	const files = await walkFiles(dir);
	const outer = new Bun.CryptoHasher("sha256");
	for (const rel of files) {
		const inner = new Bun.CryptoHasher("sha256");
		inner.update(await Bun.file(join(dir, rel)).arrayBuffer());
		outer.update(`${rel}\0${inner.digest("hex")}\n`);
	}
	return `sha256:${outer.digest("hex")}`;
}
