import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { afterEach, describe, expect, it } from "vitest";
import { buildDirectorySkillArchive } from "../server/directory-skill-archive.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "intent-skill-"));
  roots.push(root);
  await fs.mkdir(path.join(root, "references"));
  await fs.writeFile(path.join(root, "SKILL.md"), "# Skill\nRead references/output-contract.md and references/new-rule.md.\n");
  await fs.writeFile(path.join(root, "references/output-contract.md"), "Return a JSON payload.\n");
  return root;
}
function build(root: string) {
  return buildDirectorySkillArchive({
    name: "test", version: "1", directoryCandidates: [root],
    files: ["SKILL.md", "references/output-contract.md"],
  });
}

describe("module-owned Intent Skill resources", () => {
  it("ships new nested resources and agent metadata, and binds their contents to the task hash", async () => {
    const root = await fixture();
    await fs.mkdir(path.join(root, "agents"));
    await fs.writeFile(path.join(root, "agents/openai.yaml"), "interface:\n  display_name: Test\n");
    await fs.writeFile(path.join(root, "references/new-rule.md"), "Rule one.\n");
    const first = await build(root);
    const repeated = await build(root);
    expect(repeated.bytes.equals(first.bytes)).toBe(true);
    const zip = await JSZip.loadAsync(first.bytes);
    expect(await zip.file("agents/openai.yaml")!.async("string")).toContain("display_name");
    expect(await zip.file("references/new-rule.md")!.async("string")).toBe("Rule one.\n");
    const manifest = JSON.parse(await zip.file("MANIFEST.json")!.async("string"));
    expect(manifest.files.map((file: { path: string }) => file.path)).toContain("references/new-rule.md");
    await fs.writeFile(path.join(root, "references/new-rule.md"), "Rule two.\n");
    expect((await build(root)).contentHash).not.toBe(first.contentHash);
  });

  it("keeps a Skill-authored manifest and excludes generated interpreter caches", async () => {
    const root = await fixture();
    await fs.writeFile(path.join(root, "MANIFEST.json"), '{"sourceVersion":2}\n');
    const before = await build(root);
    await fs.mkdir(path.join(root, "__pycache__"));
    await fs.writeFile(path.join(root, "__pycache__/helper.pyc"), "cache");
    await fs.writeFile(path.join(root, ".DS_Store"), "finder");
    const after = await build(root);
    expect(after.bytes.equals(before.bytes)).toBe(true);
    const zip = await JSZip.loadAsync(after.bytes);
    expect(JSON.parse(await zip.file("MANIFEST.json")!.async("string"))).toEqual({ sourceVersion: 2 });
    expect(zip.file("FRONTMIND_SKILL_MANIFEST.json")).not.toBeNull();
    expect(zip.file("__pycache__/helper.pyc")).toBeNull();
  });

  it("reports missing required files in the selected source instead of falling back to an old Skill", async () => {
    const root = await fixture();
    const fallback = await fixture();
    await fs.rm(path.join(root, "references/output-contract.md"));
    await expect(buildDirectorySkillArchive({ name: "test", version: "1", directoryCandidates: [root, fallback], files: ["references/output-contract.md"] }))
      .rejects.toThrow("missing or empty: references/output-contract.md");
  });

  it("rejects linked resources and environment files", async () => {
    const root = await fixture();
    const linkedResources = path.join(root, "linked-resources");
    await fs.symlink(path.join(root, "references"), linkedResources, process.platform === "win32" ? "junction" : "dir");
    await expect(build(root)).rejects.toThrow("non-regular entry");
    await fs.unlink(linkedResources);
    await fs.writeFile(path.join(root, ".env"), "PLACEHOLDER=value\n");
    await expect(build(root)).rejects.toThrow("environment file");
  });
});
