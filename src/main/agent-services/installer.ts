import { createHash } from "crypto";
import {
  cpSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "fs";
import { join } from "path";
import { pipeline } from "stream/promises";
import { execFileSync } from "child_process";
import {
  agentServiceEnvPath,
  agentServiceInstalledDir,
  agentServicesCacheDir,
} from "./paths";
import {
  agentServicesRootEnsure,
  readManifest,
  readState,
  upsertCatalogEntry,
  writeManifest,
  writeState,
} from "./catalog";
import { sha256File } from "./bootstrap-a2a";
import type {
  AgentServiceInstallResult,
  AgentServiceManifest,
} from "./types";
import { getEnhancedPath, getHermesPythonSpawnPath } from "../installer";
import { HIDDEN_SUBPROCESS_OPTIONS } from "../process-options";
import { safeWriteFile } from "../utils";

function readManifestFromPath(dir: string): AgentServiceManifest {
  const manifestPath = join(dir, "manifest.json");
  if (!existsSync(manifestPath)) {
    throw new Error(`manifest.json not found in ${dir}`);
  }
  const manifest = JSON.parse(
    readFileSync(manifestPath, "utf-8"),
  ) as AgentServiceManifest;
  if (!manifest.id?.trim()) throw new Error("manifest.json missing id");
  if (!manifest.entrypoint?.command?.length) {
    throw new Error("manifest.json missing entrypoint.command");
  }
  return manifest;
}

function findManifestDir(root: string): string {
  if (existsSync(join(root, "manifest.json"))) return root;
  for (const entry of readdirSync(root)) {
    const sub = join(root, entry);
    try {
      if (statSync(sub).isDirectory() && existsSync(join(sub, "manifest.json"))) {
        return sub;
      }
    } catch {
      /* skip */
    }
  }
  throw new Error("manifest.json not found in archive");
}

function copyTree(src: string, dest: string): void {
  rmSync(dest, { recursive: true, force: true });
  cpSync(src, dest, {
    recursive: true,
    filter: (source) => {
      const base = source.replace(/\\/g, "/");
      if (base.includes("/.git/") || base.endsWith("/.git")) return false;
      if (base.includes("/__pycache__/")) return false;
      if (base.includes("/.venv/") || base.endsWith("/.venv")) return false;
      return true;
    },
  });
}

async function downloadToFile(url: string, dest: string): Promise<void> {
  mkdirSync(agentServicesCacheDir(), { recursive: true });
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(`Download failed (${res.status}) from ${url}`);
  }
  await pipeline(res.body as unknown as NodeJS.ReadableStream, createWriteStream(dest));
}

function extractArchive(archivePath: string, destDir: string): void {
  mkdirSync(destDir, { recursive: true });
  if (process.platform === "win32" && archivePath.toLowerCase().endsWith(".zip")) {
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
  execFileSync("tar", ["-xf", archivePath, "-C", destDir], HIDDEN_SUBPROCESS_OPTIONS);
}

function runPostInstall(
  manifest: AgentServiceManifest,
  workDir: string,
): void {
  const steps = manifest.install?.post_install;
  if (!steps?.length) return;
  const env = {
    ...process.env,
    PATH: getEnhancedPath(),
    HERMES_HOME: process.env.HERMES_HOME,
  };
  for (const step of steps) {
    const parts = step.trim().split(/\s+/);
    if (!parts.length) continue;
    let cmd = parts[0];
    let args = parts.slice(1);
    if (cmd === "python") {
      cmd = getHermesPythonSpawnPath();
    }
    execFileSync(cmd, args, {
      ...HIDDEN_SUBPROCESS_OPTIONS,
      cwd: workDir,
      env,
    });
  }
}

function ensureServiceEnv(id: string, token?: string): void {
  const envPath = agentServiceEnvPath(id);
  const tokenEnv = "AUTH_TOKEN";
  const lines: string[] = [];
  if (existsSync(envPath)) {
    lines.push(...readFileSync(envPath, "utf-8").split("\n").filter(Boolean));
  }
  const hasToken = lines.some((l) => l.startsWith(`${tokenEnv}=`));
  if (!hasToken) {
    const value =
      token ||
      createHash("sha256")
        .update(`${id}:${Date.now()}:${Math.random()}`)
        .digest("hex")
        .slice(0, 48);
    lines.push(`${tokenEnv}=${value}`);
  }
  safeWriteFile(envPath, `${lines.join("\n")}\n`);
}

/** Install or refresh an agent service from a local directory (copy or dev link). */
export async function installAgentServiceFromPath(
  sourcePath: string,
  options: { link?: boolean } = {},
): Promise<AgentServiceInstallResult> {
  // @lat: [[lat.md/agent-services#Agent services#Installation#Install from local path]]
  try {
    agentServicesRootEnsure();
    const resolved = join(sourcePath);
    if (!existsSync(resolved)) {
      return { success: false, error: `Source path not found: ${resolved}` };
    }
    const manifest = readManifestFromPath(resolved);
    const dest = agentServiceInstalledDir(manifest.id);
    mkdirSync(dest, { recursive: true });

    if (options.link) {
      writeManifest(manifest.id, manifest);
      writeState(manifest.id, {
        status: "stopped",
        last_error: null,
        link_path: resolved,
      });
    } else {
      copyTree(resolved, dest);
      writeManifest(manifest.id, manifest);
      writeState(manifest.id, { status: "stopped", last_error: null });
      runPostInstall(manifest, dest);
    }

    ensureServiceEnv(manifest.id);
    upsertCatalogEntry(manifest, { enabled: true, status: "stopped" });
    return { success: true, id: manifest.id };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Install failed",
    };
  }
}

/** Download an archive and install it under %HERMES_HOME%/agent-services/installed/. */
export async function installAgentServiceFromArchive(
  archiveUrl: string,
  expectedId?: string,
): Promise<AgentServiceInstallResult> {
  // @lat: [[lat.md/agent-services#Agent services#Installation#Install from archive URL]]
  try {
    agentServicesRootEnsure();
    const hash = createHash("sha256").update(archiveUrl).digest("hex").slice(0, 12);
    const archiveName = archiveUrl.split("/").pop() || `agent-${hash}.zip`;
    const archivePath = join(agentServicesCacheDir(), archiveName);
    const staging = join(agentServicesCacheDir(), `staging-${hash}`);

    await downloadToFile(archiveUrl, archivePath);

    const manifestOnDisk = readManifest(expectedId || "");
    const expectedSha = manifestOnDisk?.install?.sha256?.trim();
    if (expectedSha) {
      const actual = sha256File(archivePath);
      if (actual !== expectedSha) {
        return {
          success: false,
          error: `Archive sha256 mismatch (expected ${expectedSha}, got ${actual})`,
        };
      }
    }

    rmSync(staging, { recursive: true, force: true });
    mkdirSync(staging, { recursive: true });
    extractArchive(archivePath, staging);

    const manifestRoot = findManifestDir(staging);
    const manifest = readManifestFromPath(manifestRoot);
    if (expectedId && manifest.id !== expectedId) {
      return {
        success: false,
        error: `Manifest id "${manifest.id}" does not match expected "${expectedId}"`,
      };
    }

    const dest = agentServiceInstalledDir(manifest.id);
    copyTree(manifestRoot, dest);
    rmSync(staging, { recursive: true, force: true });

    if (manifest.install?.sha256) {
      const actual = sha256File(archivePath);
      if (actual !== manifest.install.sha256) {
        return { success: false, error: "Archive sha256 mismatch" };
      }
    }

    writeManifest(manifest.id, manifest);
    writeState(manifest.id, { status: "stopped", last_error: null });
    runPostInstall(manifest, dest);
    ensureServiceEnv(manifest.id);
    upsertCatalogEntry(manifest, { enabled: true, status: "stopped" });
    return { success: true, id: manifest.id };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Archive install failed",
    };
  }
}

export function getAgentServiceWorkDir(id: string): string | null {
  if (!readManifest(id)) return null;
  const st = readState(id);
  if (st.link_path && existsSync(st.link_path)) return st.link_path;
  const dir = agentServiceInstalledDir(id);
  return existsSync(dir) ? dir : null;
}
