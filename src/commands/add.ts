import type { Command } from "../commands.ts";
import type { DiscoveredSkill } from "../discovery.ts";
import { discoverSkills } from "../discovery.ts";
import { hashFolder } from "../hash.ts";
import type { Manifest, SkillEntry } from "../manifest.ts";
import { materializeSkill } from "../materialize.ts";
import { parseSourceRef, resolveSource } from "../sources/index.ts";
import { buildGlobalPlacement, loadGlobalManifest, resolveHome, saveGlobalManifest } from "./shared.ts";

function parseAddArgs(args: string[]): { source: string | null; all: boolean } {
	let source: string | null = null;
	let all = false;
	for (const arg of args) {
		if (arg === "--all") {
			all = true;
			continue;
		}
		if (source === null) source = arg;
	}
	return { source, all };
}

/** Parse "1,3" or "a" (case-insensitive) against a 1-based, sorted-by-discovery listing. */
function parseSelection(answer: string, discovered: DiscoveredSkill[]): DiscoveredSkill[] {
	const trimmed = answer.trim();
	if (trimmed.toLowerCase() === "a") return discovered;
	const indices = new Set(
		trimmed
			.split(",")
			.map((part) => Number.parseInt(part.trim(), 10))
			.filter((n) => Number.isInteger(n) && n >= 1 && n <= discovered.length),
	);
	return discovered.filter((_, i) => indices.has(i + 1));
}

export const addCommand: Command = {
	name: "add",
	aliases: ["a", "install", "i"],
	summary: "Add skills from a source to a manifest and materialize them",
	async run(ctx) {
		const { source: raw, all } = parseAddArgs(ctx.args);
		if (!raw) {
			ctx.io.error("usage: gent add <source> [--all]");
			return 1;
		}

		let ref: ReturnType<typeof parseSourceRef>;
		try {
			ref = parseSourceRef(raw, { cwd: ctx.cwd, home: resolveHome(ctx.env) });
		} catch (err) {
			ctx.io.error(`gent add: ${(err as Error).message}`);
			return 1;
		}

		let resolved: Awaited<ReturnType<typeof resolveSource>>;
		try {
			resolved = await resolveSource(ref);
		} catch (err) {
			ctx.io.error(`gent add: ${(err as Error).message}`);
			return 1;
		}

		const discovered = await discoverSkills(resolved.root);
		if (discovered.length === 0) {
			ctx.io.error(`gent add: no skills found in '${raw}'`);
			return 1;
		}

		let selected: DiscoveredSkill[];
		if (discovered.length === 1 || all) {
			selected = discovered;
		} else if (ctx.interactive) {
			ctx.io.print("Multiple skills found:");
			for (const [i, skill] of discovered.entries()) {
				ctx.io.print(`  ${i + 1}. ${skill.name}`);
			}
			const answer = await ctx.io.ask('Select skills to add (e.g. "1,3", "a" for all): ');
			selected = parseSelection(answer, discovered);
			if (selected.length === 0) {
				ctx.io.error("gent add: no skills selected");
				return 1;
			}
		} else {
			const names = discovered.map((s) => s.name).join(", ");
			ctx.io.error(
				`gent add: multiple skills found in '${raw}' (${names}) — use --all or a subpath source to select one`,
			);
			return 1;
		}

		const { path: manifestPath, manifest } = await loadGlobalManifest(ctx);

		const collisions = selected.filter((s) => manifest.skills[s.name] !== undefined);
		if (collisions.length > 0) {
			for (const s of collisions) {
				const existing = (manifest.skills[s.name] as SkillEntry).source;
				ctx.io.error(`gent add: skill '${s.name}' already managed (from ${existing})`);
			}
			return 1;
		}

		const placement = buildGlobalPlacement(ctx, manifest);
		const hashAt = raw.indexOf("#");
		const source = ref.kind === "git" && hashAt !== -1 ? raw.slice(0, hashAt) : raw;
		const declaredRef = ref.kind === "git" ? (ref.ref ?? undefined) : undefined;

		// Materialize first, write the manifest once at the end: a failure
		// partway through leaves no manifest entry for any skill in this add
		// (rather than a manifest that claims a skill was materialized when it
		// wasn't). Store/holdout state from skills materialized before a
		// mid-batch failure may remain on disk; `sync` reconciles that later.
		const added: Array<{ name: string; entry: SkillEntry }> = [];
		const conflicts: string[] = [];
		for (const skill of selected) {
			const hash = await hashFolder(skill.dir);
			const entry: SkillEntry = {
				source,
				...(declaredRef !== undefined && { ref: declaredRef }),
				...(resolved.resolvedRef !== null && { resolvedRef: resolved.resolvedRef }),
				hash,
			};
			const report = await materializeSkill({
				name: skill.name,
				srcDir: skill.dir,
				placement,
				expectHash: hash,
			});
			conflicts.push(...report.conflicts);
			added.push({ name: skill.name, entry });
		}

		const newManifest: Manifest = { ...manifest, skills: { ...manifest.skills } };
		for (const { name, entry } of added) {
			newManifest.skills[name] = entry;
		}
		await saveGlobalManifest(manifestPath, newManifest);

		for (const { name } of added) {
			ctx.io.print(`added ${name} (${source})`);
		}
		for (const conflict of conflicts) {
			ctx.io.error(`gent add: warning: '${conflict}' exists and is not gent's symlink; left untouched`);
		}

		return 0;
	},
};
