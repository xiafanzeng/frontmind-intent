import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";

const ARCHIVE_DATE = new Date("1980-01-01T00:00:00.000Z");
const CACHE_DIRECTORIES = new Set([
  ".git", ".pytest_cache", ".mypy_cache", ".ruff_cache", "__pycache__", "node_modules",
]);

async function readSkillFiles(directory: string, prefix = "") {
  const files: Array<{ path: string; content: Buffer }> = [];
  const entries = await fs.readdir(path.join(directory, prefix), { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name, "en"))) {
    const relativePath = path.posix.join(prefix, entry.name);
    if (entry.name === ".DS_Store" || /\.py[co]$/u.test(entry.name) || CACHE_DIRECTORIES.has(entry.name)) continue;
    if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile())) {
      throw new Error(`Skill contains a non-regular entry: ${relativePath}`);
    }
    if (/^\.env(?:\.|$)/u.test(entry.name)) {
      throw new Error(`Skill contains an environment file: ${relativePath}`);
    }
    if (entry.isDirectory()) {
      files.push(...await readSkillFiles(directory, relativePath));
    } else {
      files.push({ path: relativePath, content: await fs.readFile(path.join(directory, relativePath)) });
    }
  }
  return files;
}

/** The module owns its complete Skill source. Required files validate the
 * contract; they are not an allowlist that silently drops new resources. */
export async function buildDirectorySkillArchive(input: {
  name: string;
  version: string;
  directoryCandidates: readonly string[];
  files: readonly string[];
}) {
  let selectedDirectory: string | undefined;
  for (const candidate of input.directoryCandidates) {
    try {
      selectedDirectory = await fs.realpath(candidate);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  if (!selectedDirectory) throw new Error(`Could not load Skill ${input.name}`);
  const files = (await readSkillFiles(selectedDirectory))
    .sort((left, right) => left.path.localeCompare(right.path, "en"));
  for (const required of new Set(["SKILL.md", ...input.files])) {
    const file = files.find((item) => item.path === required);
    if (!file?.content.byteLength) throw new Error(`Skill ${input.name} is missing or empty: ${required}`);
  }
  const fileManifest = files.map((file) => ({
    path: file.path,
    bytes: file.content.byteLength,
    sha256: createHash("sha256").update(file.content).digest("hex"),
  }));
  const contentHash = createHash("sha256").update(JSON.stringify(fileManifest)).digest("hex");
  const zip = new JSZip();
  for (const file of files) {
    zip.file(file.path, file.content, { date: ARCHIVE_DATE, unixPermissions: 0o100644, createFolders: false });
  }
  // Preserve a module-authored MANIFEST.json if present, while still recording
  // the exact source inventory used for this task attachment.
  const manifestPath = files.some((file) => file.path === "MANIFEST.json")
    ? "FRONTMIND_SKILL_MANIFEST.json" : "MANIFEST.json";
  if (files.some((file) => file.path === manifestPath)) {
    throw new Error(`Skill contains reserved package metadata: ${manifestPath}`);
  }
  zip.file(manifestPath, `${JSON.stringify({
    schemaVersion: 1, name: input.name, entrypoint: "SKILL.md", contentHash,
    files: fileManifest, metadata: { version: input.version },
  }, null, 2)}\n`, { date: ARCHIVE_DATE, unixPermissions: 0o100644, createFolders: false });
  const bytes = await zip.generateAsync({
    type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 }, platform: "UNIX",
  });
  return { bytes, contentHash, version: input.version };
}
