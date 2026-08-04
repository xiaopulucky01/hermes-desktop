/**
 * Shared download helpers for marketplace installs into hermes-ecosystem.
 */

import { createHash } from "crypto";
import { execFileSync } from "child_process";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import { pipeline } from "stream/promises";
import { safeWriteFile } from "../utils";
import { HIDDEN_SUBPROCESS_OPTIONS } from "../process-options";

export interface InstallResult {
  success: boolean;
  error?: string;
}

export function sha256File(filePath: string): string {
  const data = readFileSync(filePath);
  return createHash("sha256").update(data).digest("hex");
}

export async function downloadToFile(url: string, destPath: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Download failed (${res.status})`);
  }
  mkdirSync(join(destPath, ".."), { recursive: true });
  const body = res.body;
  if (!body) {
    writeFileSync(destPath, Buffer.from(await res.arrayBuffer()));
    return;
  }
  await pipeline(body as unknown as NodeJS.ReadableStream, createWriteStream(destPath));
}

export function extractArchive(archivePath: string, destDir: string): void {
  mkdirSync(destDir, { recursive: true });
  const lower = archivePath.toLowerCase();
  if (lower.endsWith(".zip")) {
    if (process.platform === "win32") {
      execFileSync(
        "powershell",
        [
          "-NoProfile",
          "-Command",
          `Expand-Archive -LiteralPath '${archivePath.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force`,
        ],
        HIDDEN_SUBPROCESS_OPTIONS,
      );
      return;
    }
    execFileSync("unzip", ["-q", archivePath, "-d", destDir], HIDDEN_SUBPROCESS_OPTIONS);
    return;
  }
  execFileSync("tar", ["-xf", archivePath, "-C", destDir], HIDDEN_SUBPROCESS_OPTIONS);
}

export function copyTree(src: string, dest: string): void {
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src)) {
    const from = join(src, entry);
    const to = join(dest, entry);
    const st = statSync(from);
    if (st.isDirectory()) copyTree(from, to);
    else writeFileSync(to, readFileSync(from));
  }
}

export function findManifestDir(root: string): string {
  if (existsSync(join(root, "manifest.json"))) return root;
  for (const entry of readdirSync(root)) {
    const p = join(root, entry);
    try {
      if (statSync(p).isDirectory() && existsSync(join(p, "manifest.json"))) {
        return p;
      }
    } catch {
      /* skip */
    }
  }
  return root;
}

export function resolveGitHubZipball(repo: string, ref: string): string {
  const trimmed = repo
    .trim()
    .replace(/^https?:\/\/github\.com\//i, "")
    .replace(/\.git$/, "");
  return `https://codeload.github.com/${trimmed}/zip/refs/heads/${encodeURIComponent(ref)}`;
}

export function resolveGitHubTagZipball(repo: string, ref: string): string {
  const trimmed = repo
    .trim()
    .replace(/^https?:\/\/github\.com\//i, "")
    .replace(/\.git$/, "");
  return `https://codeload.github.com/${trimmed}/zip/refs/tags/${encodeURIComponent(ref)}`;
}

/** Copy a single file from URL into destDir (registry git-tree path). */
export async function downloadRegistryFolder(
  rawBase: string,
  repoFolder: string,
  destDir: string,
  listFiles: (folder: string) => Promise<string[]>,
): Promise<InstallResult> {
  const files = await listFiles(repoFolder);
  if (files.length === 0) {
    return { success: false, error: "No files found for this entry" };
  }
  mkdirSync(destDir, { recursive: true });
  for (const file of files) {
    const rel = file.slice(repoFolder.length + 1);
    const res = await fetch(`${rawBase}/${file}`);
    if (!res.ok) return { success: false, error: `Fetch failed: ${rel}` };
    const body = await res.text();
    safeWriteFile(join(destDir, rel), body);
  }
  return { success: true };
}
