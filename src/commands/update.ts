import { lstat } from "node:fs/promises";
import { join } from "node:path";
import type { Command } from "../commands.ts";
import { hashFolder } from "../hash.ts";
import { materializeSkill } from "../materialize.ts";
import { parseSourceRef } from "../sources/index.ts";
import {
	buildGlobalPlacement,
	loadGlobalManifest,
	reportHoldoutConflicts,
	refetchSkill,
	resolveHome,
	saveGlobalManifest,
} from "./shared.ts";

function isFullSha(ref: string | undefined): ref is string {
	return ref !== undefined && /^[0-9a-f]{40}$/i.test(ref);
}

async function currentStoreHash(storeDir: string): Promise<string | null> {
	const stat = await lstat(storeDir).catch((err: unknown) => {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw err;
	});
	if (!stat) return null;
	if (!stat.isDirectory() || stat.isSymbolicLink()) {
		throw new Error(`store entry is not a directory at ${storeDir}`);
	}
	return hashFolder(storeDir);
}

function parseName(args: string[]): string | undefined {
	return args.find((arg) => arg !== "--force");
}

export const updateCommand: Command = {
	name: "update",
	aliases: [],
	summary: "Re-resolve branch/tag refs and re-materialize",
	async run(ctx) {
		const force = ctx.args.includes("--force");
		const name = parseName(ctx.args);
		const { path: manifestPath, manifest } = await loadGlobalManifest(ctx);
		if (name !== undefined && manifest.skills[name] === undefined) {
			ctx.io.error(`gent update: no managed skill '${name}'`);
			return 1;
		}

		const placement = buildGlobalPlacement(ctx, manifest);
		const names = name === undefined ? Object.keys(manifest.skills).sort() : [name];
		const nextManifest = { ...manifest, skills: { ...manifest.skills } };
		let manifestChanged = false;
		let hadErrors = false;

		for (const skillName of names) {
			const entry = manifest.skills[skillName];
			if (!entry) continue;
			try {
				const source = parseSourceRef(entry.source, {
					cwd: ctx.cwd,
					home: resolveHome(ctx.env),
				});
				if (source.kind === "git" && isFullSha(entry.ref)) {
					ctx.io.print(`pinned ${skillName} (${entry.ref})`);
					continue;
				}

				const storeDir = join(placement.storeRoot, skillName);
				const storeHash = await currentStoreHash(storeDir);
				const drifted = storeHash !== null && storeHash !== entry.hash;
				if (drifted && !force) {
					ctx.io.error(
						`warning: ${skillName} has drifted; 'gent update --force ${skillName}' discards the local edits`,
					);
					continue;
				}

				const refetched = await refetchSkill(entry, skillName, {
					cwd: ctx.cwd,
					home: resolveHome(ctx.env),
					gitRef: source.kind === "git" ? (entry.ref ?? null) : undefined,
				});
				const nextHash = await hashFolder(refetched.skill.dir);

				if (source.kind === "local") {
					if (nextHash === entry.hash && !drifted) {
						ctx.io.print(`up to date ${skillName}`);
						continue;
					}
					const report = await materializeSkill({
						name: skillName,
						srcDir: refetched.skill.dir,
						placement,
						expectHash: nextHash,
					});
					reportHoldoutConflicts(ctx.io.error, report.conflicts);
					if (nextHash !== entry.hash) {
						nextManifest.skills[skillName] = { ...entry, hash: nextHash };
						manifestChanged = true;
					}
					ctx.io.print(`updated ${skillName}`);
					continue;
				}

				if (refetched.resolved.resolvedRef === entry.resolvedRef && !drifted) {
					ctx.io.print(`up to date ${skillName}`);
					continue;
				}

				const report = await materializeSkill({
					name: skillName,
					srcDir: refetched.skill.dir,
					placement,
					expectHash: nextHash,
				});
				reportHoldoutConflicts(ctx.io.error, report.conflicts);
				const nextResolvedRef = refetched.resolved.resolvedRef;
				if (nextResolvedRef === null) {
					throw new Error(`git source for '${skillName}' did not resolve to a commit`);
				}
				if (nextResolvedRef !== entry.resolvedRef || nextHash !== entry.hash) {
					nextManifest.skills[skillName] = {
						...entry,
						resolvedRef: nextResolvedRef,
						hash: nextHash,
					};
					manifestChanged = true;
				}
				if (nextResolvedRef === entry.resolvedRef) {
					ctx.io.print(`updated ${skillName}`);
				} else {
					const oldRef = entry.resolvedRef?.slice(0, 8) ?? "unknown";
					ctx.io.print(`updated ${skillName} (${oldRef}..${nextResolvedRef.slice(0, 8)})`);
				}
			} catch (err) {
				hadErrors = true;
				ctx.io.error(`gent update: ${skillName}: ${err instanceof Error ? err.message : String(err)}`);
			}
		}

		if (manifestChanged) await saveGlobalManifest(manifestPath, nextManifest);
		return hadErrors ? 1 : 0;
	},
};
