import { lstat, readdir, readlink, unlink } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import type { Command } from "../commands.ts";
import { hashFolder } from "../hash.ts";
import type { Placement } from "../materialize.ts";
import { materializeSkill, repairLinks } from "../materialize.ts";
import type { Manifest } from "../manifest.ts";
import { parseSourceRef } from "../sources/index.ts";
import {
	buildGlobalPlacement,
	loadGlobalManifest,
	reportHoldoutConflicts,
	refetchSkill,
	resolveHome,
} from "./shared.ts";

function hasForce(args: string[]): boolean {
	return args.includes("--force");
}

function isUnderStore(target: string, storeRoot: string): boolean {
	const root = resolve(storeRoot);
	const absoluteTarget = resolve(target);
	return absoluteTarget === root || absoluteTarget.startsWith(`${root}${sep}`);
}

async function pruneOrphans(
	placement: Placement,
	manifest: Manifest,
	print: (line: string) => void,
): Promise<void> {
	for (const holdoutDir of [...placement.holdoutDirs].sort()) {
		let entries;
		try {
			entries = await readdir(holdoutDir, { withFileTypes: true });
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
			throw err;
		}
		for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
			if (!entry.isSymbolicLink() || manifest.skills[entry.name] !== undefined) continue;
			const linkPath = join(holdoutDir, entry.name);
			const target = await readlink(linkPath);
			if (!isUnderStore(resolve(holdoutDir, target), placement.storeRoot)) continue;
			await unlink(linkPath);
			print(`pruned ${linkPath}`);
		}
	}

	let storeEntries;
	try {
		storeEntries = await readdir(placement.storeRoot, { withFileTypes: true });
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
		throw err;
	}
	for (const entry of storeEntries.sort((a, b) => a.name.localeCompare(b.name))) {
		if (!entry.isDirectory() || entry.isSymbolicLink() || manifest.skills[entry.name] !== undefined) {
			continue;
		}
		const path = join(placement.storeRoot, entry.name);
		print(`unmanaged: ${path} (adopt with 'gent adopt ${entry.name}')`);
	}
}

export const syncCommand: Command = {
	name: "sync",
	aliases: [],
	summary: "Reconcile disk to the manifest (materialize, repair, warn on drift)",
	async run(ctx) {
		const force = hasForce(ctx.args);
		const { manifest } = await loadGlobalManifest(ctx);
		const placement = buildGlobalPlacement(ctx, manifest);
		let hadErrors = false;

		for (const name of Object.keys(manifest.skills).sort()) {
			const entry = manifest.skills[name];
			if (!entry) continue;
			try {
				const storeDir = join(placement.storeRoot, name);
				const storeStat = await lstat(storeDir).catch((err: unknown) => {
					if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
					throw err;
				});
				if (storeStat) {
					if (!storeStat.isDirectory() || storeStat.isSymbolicLink()) {
						throw new Error(`store entry for '${name}' is not a directory`);
					}
					const actualHash = await hashFolder(storeDir);
					if (actualHash === entry.hash) {
						const report = await repairLinks({ name, placement });
						if (report.linked.length > 0) ctx.io.print(`repaired ${name}`);
						reportHoldoutConflicts(ctx.io.error, report.conflicts);
						continue;
					}
					if (!force) {
						ctx.io.error(
							`warning: ${name} has drifted from its recorded hash (hand-edited?); 'gent sync --force' restores it`,
						);
						continue;
					}
				}

				const parsed = parseSourceRef(entry.source, { cwd: ctx.cwd, home: resolveHome(ctx.env) });
				if (parsed.kind === "git" && !entry.resolvedRef) {
					throw new Error(`cannot materialize '${name}': manifest entry has no resolved ref`);
				}
				const refetched = await refetchSkill(entry, name, {
					cwd: ctx.cwd,
					home: resolveHome(ctx.env),
					gitRef: parsed.kind === "git" ? entry.resolvedRef : undefined,
				});
				const actualHash = await hashFolder(refetched.skill.dir);
				if (actualHash !== entry.hash) {
					if (refetched.sourceRef.kind === "local") {
						if (storeStat) {
							throw new Error(
								`cannot restore '${name}': local source changed since it was recorded; restoration is impossible`,
							);
						}
						ctx.io.error(
							`warning: ${name}: local source changed since it was recorded; run 'gent update ${name}'`,
						);
						continue;
					}
					const action = storeStat ? "restore" : "materialize";
					throw new Error(
						`cannot ${action} '${name}': fetched content hash ${actualHash} does not match recorded ${entry.hash}`,
					);
				}

				const report = await materializeSkill({
					name,
					srcDir: refetched.skill.dir,
					placement,
					expectHash: entry.hash,
				});
				reportHoldoutConflicts(ctx.io.error, report.conflicts);
				ctx.io.print(`${storeStat ? "restored" : "materialized"} ${name}`);
			} catch (err) {
				hadErrors = true;
				ctx.io.error(`gent sync: ${name}: ${err instanceof Error ? err.message : String(err)}`);
			}
		}

		try {
			await pruneOrphans(placement, manifest, ctx.io.print);
		} catch (err) {
			hadErrors = true;
			ctx.io.error(`gent sync: ${err instanceof Error ? err.message : String(err)}`);
		}

		return hadErrors ? 1 : 0;
	},
};
