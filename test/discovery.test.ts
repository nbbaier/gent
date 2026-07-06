import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverSkills, frontmatterName } from "../src/discovery.ts";

async function makeTree(files: Record<string, string>): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "gent-disc-"));
	for (const [rel, content] of Object.entries(files)) {
		await mkdir(join(dir, rel, ".."), { recursive: true });
		await Bun.write(join(dir, rel), content);
	}
	return dir;
}

describe("frontmatterName", () => {
	test("reads name from frontmatter", () => {
		expect(frontmatterName("---\nname: my-skill\ndescription: d\n---\nbody")).toBe("my-skill");
	});

	test("strips quotes", () => {
		expect(frontmatterName('---\nname: "quoted"\n---\n')).toBe("quoted");
		expect(frontmatterName("---\nname: 'single'\n---\n")).toBe("single");
	});

	test("handles crlf and closing fence at EOF", () => {
		expect(frontmatterName("---\r\nname: crlf\r\n---")).toBe("crlf");
	});

	test("null without frontmatter, name line, or value", () => {
		expect(frontmatterName("# just markdown")).toBeNull();
		expect(frontmatterName("---\ndescription: d\n---\n")).toBeNull();
		expect(frontmatterName("---\nname:\n---\n")).toBeNull();
	});

	test("ignores name: outside the frontmatter block", () => {
		expect(frontmatterName("body\nname: not-me\n")).toBeNull();
	});
});

describe("discoverSkills", () => {
	test("finds nested skills sorted by name", async () => {
		const root = await makeTree({
			"skills/zeta/SKILL.md": "---\nname: zeta\n---\n",
			"skills/alpha/SKILL.md": "---\nname: alpha\n---\n",
			"README.md": "not a skill",
		});
		const found = await discoverSkills(root);
		expect(found.map((s) => s.name)).toEqual(["alpha", "zeta"]);
		expect(found.map((s) => s.relDir)).toEqual(["skills/alpha", "skills/zeta"]);
		expect(found[0]?.dir).toBe(join(root, "skills/alpha"));
	});

	test("the root itself can be the skill", async () => {
		const root = await makeTree({ "SKILL.md": "---\nname: solo\n---\n" });
		expect(await discoverSkills(root)).toEqual([{ name: "solo", dir: root, relDir: "" }]);
	});

	test("falls back to the directory name when frontmatter has no name", async () => {
		const root = await makeTree({ "skills/dirname/SKILL.md": "no frontmatter" });
		expect((await discoverSkills(root)).map((s) => s.name)).toEqual(["dirname"]);
	});

	test("does not descend into a found skill dir", async () => {
		const root = await makeTree({
			"outer/SKILL.md": "---\nname: outer\n---\n",
			"outer/examples/inner/SKILL.md": "---\nname: inner\n---\n",
		});
		expect((await discoverSkills(root)).map((s) => s.name)).toEqual(["outer"]);
	});

	test("empty tree finds nothing", async () => {
		const root = await mkdtemp(join(tmpdir(), "gent-disc-empty-"));
		expect(await discoverSkills(root)).toEqual([]);
	});
});
