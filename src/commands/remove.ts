import type { Command } from "../commands.ts";
import type { Manifest } from "../manifest.ts";
import { dematerializeSkill } from "../materialize.ts";
import { buildGlobalPlacement, loadGlobalManifest, saveGlobalManifest } from "./shared.ts";

export const removeCommand: Command = {
	name: "remove",
	aliases: ["rm", "r", "uninstall"],
	summary: "Remove a managed skill from the manifest and disk",
	async run(ctx) {
		const name = ctx.args[0];
		if (!name) {
			ctx.io.error("usage: gent remove <name>");
			return 1;
		}

		const { path: manifestPath, manifest } = await loadGlobalManifest(ctx);
		if (manifest.skills[name] === undefined) {
			ctx.io.error(`gent remove: no managed skill '${name}'`);
			return 1;
		}

		const placement = buildGlobalPlacement(ctx, manifest);
		const report = await dematerializeSkill({ name, placement });

		const newManifest: Manifest = { ...manifest, skills: { ...manifest.skills } };
		delete newManifest.skills[name];
		await saveGlobalManifest(manifestPath, newManifest);

		ctx.io.print(`removed ${name}`);
		for (const conflict of report.conflicts) {
			ctx.io.error(
				`gent remove: warning: '${conflict}' exists and is not gent's symlink; left untouched`,
			);
		}
		return 0;
	},
};
