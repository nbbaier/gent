import { commands, resolveCommand, type CommandContext } from "./commands.ts";
import { defaultIo, type Io } from "./io.ts";
import pkg from "../package.json";

export function usage(): string {
	const rows = commands.map((c) => {
		const names = [c.name, ...c.aliases].join(", ");
		return `  ${names.padEnd(28)}${c.summary}`;
	});
	return [
		"Usage: gent <command> [options]",
		"",
		"Commands:",
		...rows,
		"",
		"Options:",
		"  -h, --help                  Show this help",
		"  -v, --version               Show version",
	].join("\n");
}

export async function run(
	argv: string[],
	io: Io = defaultIo,
	ctx: Partial<Pick<CommandContext, "env" | "cwd" | "interactive">> = {},
): Promise<number> {
	const [first, ...rest] = argv;

	if (first === undefined || first === "-h" || first === "--help" || first === "help") {
		io.print(usage());
		return first === undefined ? 1 : 0;
	}
	if (first === "-v" || first === "--version" || first === "version") {
		io.print(pkg.version);
		return 0;
	}

	const command = resolveCommand(first);
	if (!command) {
		io.error(`gent: unknown command '${first}'`);
		io.error(usage());
		return 1;
	}
	const env = ctx.env ?? process.env;
	const cwd = ctx.cwd ?? process.cwd();
	const interactive = ctx.interactive ?? Boolean(process.stdin.isTTY && process.stdout.isTTY);
	return command.run({ args: rest, io, env, cwd, interactive });
}
