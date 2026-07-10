import { addCommand } from "./commands/add.ts";
import { listCommand } from "./commands/list.ts";
import { removeCommand } from "./commands/remove.ts";
import type { Io } from "./io.ts";

export interface CommandContext {
	args: string[];
	io: Io;
	env: Record<string, string | undefined>;
	cwd: string;
	interactive: boolean;
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
	addCommand,
	removeCommand,
	stub("sync", [], "Reconcile disk to the manifest (materialize, repair, warn on drift)"),
	stub("update", [], "Re-resolve branch/tag refs and re-materialize"),
	listCommand,
	stub("adopt", [], "Pull an unmanaged skill into the manifest"),
];

export function resolveCommand(name: string): Command | undefined {
	return commands.find((c) => c.name === name || c.aliases.includes(name));
}
