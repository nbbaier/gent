import { mkdir, rename } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const MANIFEST_VERSION = 1;

export interface SkillEntry {
	/** The source reference as the user gave it (e.g. "github:owner/repo/skill"). */
	source: string;
	/** Declared ref pin (branch, tag, or sha), when the user gave one. */
	ref?: string;
	/** The commit sha the ref resolved to; absent for local sources. */
	resolvedRef?: string;
	/** "sha256:<hex>" over the skill folder contents. */
	hash: string;
}

export interface Targets {
	add?: string[];
	exclude?: string[];
}

export interface Manifest {
	version: number;
	skills: Record<string, SkillEntry>;
	targets?: Targets;
}

export function emptyManifest(): Manifest {
	return { version: MANIFEST_VERSION, skills: {} };
}

type Env = Record<string, string | undefined>;

/** Global-scope manifest lives in the user config dir. Project scope lands in Phase 4. */
export function globalManifestPath(env: Env = process.env): string {
	const home = env.HOME ?? homedir();
	const configRoot = env.XDG_CONFIG_HOME || join(home, ".config");
	return join(configRoot, "gent", "gent.json");
}

export async function readManifest(path: string): Promise<Manifest | null> {
	const file = Bun.file(path);
	if (!(await file.exists())) return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(await file.text());
	} catch {
		throw new Error(`${path}: not valid JSON`);
	}
	return validateManifest(parsed, path);
}

/**
 * Deterministic output: fixed key order, skills and targets sorted, tab
 * indent, trailing newline. No timestamps. Round-trips byte-identically.
 */
export function serializeManifest(manifest: Manifest): string {
	const skills: Record<string, SkillEntry> = {};
	for (const name of Object.keys(manifest.skills).sort()) {
		const entry = manifest.skills[name] as SkillEntry;
		skills[name] = {
			source: entry.source,
			...(entry.ref !== undefined && { ref: entry.ref }),
			...(entry.resolvedRef !== undefined && { resolvedRef: entry.resolvedRef }),
			hash: entry.hash,
		};
	}
	const targets = normalizeTargets(manifest.targets);
	const out = {
		version: manifest.version,
		skills,
		...(targets !== undefined && { targets }),
	};
	return `${JSON.stringify(out, null, "\t")}\n`;
}

export async function writeManifest(path: string, manifest: Manifest): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	const tmp = `${path}.tmp`;
	await Bun.write(tmp, serializeManifest(manifest));
	await rename(tmp, path);
}

function normalizeTargets(targets: Targets | undefined): Targets | undefined {
	if (!targets) return undefined;
	const add = targets.add?.length ? [...targets.add].sort() : undefined;
	const exclude = targets.exclude?.length ? [...targets.exclude].sort() : undefined;
	if (!add && !exclude) return undefined;
	return { ...(add && { add }), ...(exclude && { exclude }) };
}

function validateManifest(parsed: unknown, path: string): Manifest {
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		throw new Error(`${path}: manifest must be a JSON object`);
	}
	const obj = parsed as Record<string, unknown>;
	if (obj.version !== MANIFEST_VERSION) {
		throw new Error(
			`${path}: unsupported manifest version ${JSON.stringify(obj.version)} (expected ${MANIFEST_VERSION})`,
		);
	}
	if (typeof obj.skills !== "object" || obj.skills === null || Array.isArray(obj.skills)) {
		throw new Error(`${path}: 'skills' must be an object`);
	}
	const skills: Record<string, SkillEntry> = {};
	for (const [name, raw] of Object.entries(obj.skills)) {
		skills[name] = validateEntry(name, raw, path);
	}
	const manifest: Manifest = { version: MANIFEST_VERSION, skills };
	if (obj.targets !== undefined) {
		manifest.targets = validateTargets(obj.targets, path);
	}
	return manifest;
}

function validateEntry(name: string, raw: unknown, path: string): SkillEntry {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		throw new Error(`${path}: skill '${name}' must be an object`);
	}
	const entry = raw as Record<string, unknown>;
	if (typeof entry.source !== "string" || entry.source === "") {
		throw new Error(`${path}: skill '${name}' is missing a 'source' string`);
	}
	if (typeof entry.hash !== "string" || entry.hash === "") {
		throw new Error(`${path}: skill '${name}' is missing a 'hash' string`);
	}
	for (const key of ["ref", "resolvedRef"] as const) {
		if (entry[key] !== undefined && typeof entry[key] !== "string") {
			throw new Error(`${path}: skill '${name}' field '${key}' must be a string`);
		}
	}
	return {
		source: entry.source,
		...(entry.ref !== undefined && { ref: entry.ref as string }),
		...(entry.resolvedRef !== undefined && { resolvedRef: entry.resolvedRef as string }),
		hash: entry.hash,
	};
}

function validateTargets(raw: unknown, path: string): Targets {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		throw new Error(`${path}: 'targets' must be an object`);
	}
	const targets = raw as Record<string, unknown>;
	const result: Targets = {};
	for (const key of ["add", "exclude"] as const) {
		const value = targets[key];
		if (value === undefined) continue;
		if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
			throw new Error(`${path}: 'targets.${key}' must be an array of strings`);
		}
		result[key] = value as string[];
	}
	return result;
}
