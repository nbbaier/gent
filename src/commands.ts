import type { Io } from "./io.ts";

export interface CommandContext {
	args: string[];
	io: Io;
}

export interface Command {
	name: string;
	aliases: string[];
	summary: string;
	run: (ctx: CommandContext) => number | Promise<number>;
}

function stub(name: string, aliases: string[], summary: string): Command {
	return {
		name,
		aliases,
		summary,
		run({ io }) {
			io.error(`gent ${name}: not implemented yet`);
			return 1;
		},
	};
}

export const commands: Command[] = [
	stub("add", ["a", "install", "i"], "Add skills from a source to a manifest and materialize them"),
	stub("remove", ["rm", "r", "uninstall"], "Remove a managed skill from the manifest and disk"),
	stub("sync", [], "Reconcile disk to the manifest (materialize, repair, warn on drift)"),
	stub("update", [], "Re-resolve branch/tag refs and re-materialize"),
	stub("list", ["ls"], "List managed skills"),
	stub("adopt", [], "Pull an unmanaged skill into the manifest"),
];

export function resolveCommand(name: string): Command | undefined {
	return commands.find((c) => c.name === name || c.aliases.includes(name));
}
