import { stat } from "node:fs/promises";
import { join } from "node:path";
import type { Command } from "../commands.ts";
import { hashFolder } from "../hash.ts";
import type { SkillEntry } from "../manifest.ts";
import { buildGlobalPlacement, loadGlobalManifest } from "./shared.ts";

type Status = "ok" | "drifted" | "missing";

interface Row {
	name: string;
	source: string;
	ref?: string;
	resolvedRef?: string;
	hash: string;
	status: Status;
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
		throw err;
	}
}

async function computeStatus(storeRoot: string, name: string, hash: string): Promise<Status> {
	const dir = join(storeRoot, name);
	if (!(await pathExists(dir))) return "missing";
	const actual = await hashFolder(dir);
	return actual === hash ? "ok" : "drifted";
}

function refDisplay(entry: SkillEntry): string {
	return entry.ref ?? entry.resolvedRef?.slice(0, 12) ?? "local";
}

function formatTable(rows: Row[]): string[] {
	const cols = rows.map((r) => [r.name, r.source, refDisplay(r), r.status]);
	const widths = [0, 1, 2, 3].map((i) => Math.max(...cols.map((c) => (c[i] as string).length)));
	return cols.map((c) =>
		c
			.map((v, i) => (v as string).padEnd(widths[i] as number))
			.join("  ")
			.trimEnd(),
	);
}

export const listCommand: Command = {
	name: "list",
	aliases: ["ls"],
	summary: "List managed skills",
	async run(ctx) {
		const jsonMode = ctx.args.includes("--json");
		const { manifest } = await loadGlobalManifest(ctx);
		const placement = buildGlobalPlacement(ctx, manifest);
		const names = Object.keys(manifest.skills).sort();

		const rows: Row[] = await Promise.all(
			names.map(async (name) => {
				const entry = manifest.skills[name] as SkillEntry;
				const status = await computeStatus(placement.storeRoot, name, entry.hash);
				return { name, ...entry, status };
			}),
		);

		if (jsonMode) {
			ctx.io.print(JSON.stringify(rows, null, "\t"));
			return 0;
		}

		if (rows.length === 0) {
			ctx.io.print("no managed skills");
			return 0;
		}

		for (const line of formatTable(rows)) {
			ctx.io.print(line);
		}
		return 0;
	},
};
