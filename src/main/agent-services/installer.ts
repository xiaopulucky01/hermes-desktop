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
  resolveSharedVenvPython,
  resolveSharedVenvRoot,
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
import {
  defaultPostInstallSteps,
  hasRuntimeVenv,
  resolveBootstrapPython,
  resolvePythonArgv0,
  usesSharedVenv,
} from "./python-runtime";
import type {
  AgentServiceInstallResult,
  AgentServiceManifest,
} from "./types";
import { getEnhancedPath } from "../installer";
import { HIDDEN_SUBPROCESS_OPTIONS } from "../process-options";
import { safeWriteFile } from "../utils";

// --- ensure imports at top of file are fixed via fuller replace of runPostInstall section ---


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
  await pipeline(
    res.body as unknown as NodeJS.ReadableStream,
    createWriteStream(dest),
  );
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

/**
 * Create the multi-agent shared-venv with Hermes python (bootstrap only).
 * Does not install Hermes site-packages into the shared env.
 */
export function ensureSharedVenv(workDir?: string): string {
  // @lat: [[lat.md/agent-services#Agent services#Shared Python runtime#Ensure shared venv]]
  const existing = resolveSharedVenvPython(workDir);
  if (existing) return existing;

  const root = resolveSharedVenvRoot(workDir);
  mkdirSync(root, { recursive: true });
  const bootstrap = resolveBootstrapPython();
  execFileSync(bootstrap, ["-m", "venv", root], {
    ...HIDDEN_SUBPROCESS_OPTIONS,
    env: { ...process.env, PATH: getEnhancedPath() },
  });
  const created = resolveSharedVenvPython(workDir);
  if (!created) {
    throw new Error(`Failed to create shared-venv at ${root}`);
  }

  // Optional baseline requirements next to shared-venv (dev repo) or sibling.
  const reqCandidates = [
    join(root, "..", "requirements-shared.txt"),
    join(process.cwd(), "../agent-services/requirements-shared.txt"),
    join(process.cwd(), "resources/agent-services-requirements-shared.txt"),
  ];
  for (const req of reqCandidates) {
    if (!existsSync(req)) continue;
    execFileSync(
      created,
      ["-m", "pip", "install", "-r", req],
      {
        ...HIDDEN_SUBPROCESS_OPTIONS,
        env: { ...process.env, PATH: getEnhancedPath() },
      },
    );
    break;
  }
  return created;
}

/**
 * Run post_install with bootstrap:/venv:/shared: prefixes.
 * Default is shared multi-agent venv (not per-package .venv).
 */
export function runPostInstall(
  manifest: AgentServiceManifest,
  workDir: string,
): void {
  // @lat: [[lat.md/agent-services#Agent services#Per-agent Python#Post-install venv]]
  const steps =
    manifest.install?.post_install?.length
      ? manifest.install.post_install
      : defaultPostInstallSteps(manifest);

  const env = {
    ...process.env,
    PATH: getEnhancedPath(),
    HERMES_HOME: process.env.HERMES_HOME,
  };

  for (const step of steps) {
    const parts = step.trim().split(/\s+/).filter(Boolean);
    if (!parts.length) continue;
    if (parts[0] === "shared:ensure-venv") {
      ensureSharedVenv(workDir);
      continue;
    }
    const cmd = resolvePythonArgv0(parts[0], workDir, manifest, "install");
    const args = parts.slice(1);
    execFileSync(cmd, args, {
      ...HIDDEN_SUBPROCESS_OPTIONS,
      cwd: workDir,
      env,
    });
  }

  if (!hasRuntimeVenv(workDir, manifest)) {
    const where = usesSharedVenv(manifest)
      ? resolveSharedVenvRoot(workDir)
      : join(workDir, ".venv");
    throw new Error(
      `post_install finished but runtime venv is missing for "${manifest.id}" (expected at ${where})`,
    );
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

/** Ensure link-mode packages also have a local .venv under the source tree. */
function ensureLinkedVenv(
  manifest: AgentServiceManifest,
  sourcePath: string,
): void {
  if (hasRuntimeVenv(sourcePath, manifest)) return;
  runPostInstall(manifest, sourcePath);
}

/** Install or refresh an agent service from a local directory (copy or dev link). */
export async function installAgentServiceFromPath(
  sourcePath: string,
  options: { link?: boolean; skipPostInstall?: boolean } = {},
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
      if (!options.skipPostInstall) {
        ensureLinkedVenv(manifest, resolved);
      }
    } else {
      copyTree(resolved, dest);
      writeManifest(manifest.id, manifest);
      writeState(manifest.id, { status: "stopped", last_error: null });
      if (!options.skipPostInstall) {
        runPostInstall(manifest, dest);
      }
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

export interface ArchiveInstallOptions {
  expectedId?: string;
  expectedSha256?: string;
  /** When set, prefer this subdirectory inside the extracted archive. */
  subPath?: string;
}

/** Download an archive and install it under %HERMES_HOME%/agent-services/installed/. */
export async function installAgentServiceFromArchive(
  archiveUrl: string,
  expectedIdOrOptions?: string | ArchiveInstallOptions,
): Promise<AgentServiceInstallResult> {
  // @lat: [[lat.md/agent-services#Agent services#Installation#Install from archive URL]]
  const options: ArchiveInstallOptions =
    typeof expectedIdOrOptions === "string"
      ? { expectedId: expectedIdOrOptions }
      : expectedIdOrOptions ?? {};
  const { expectedId, expectedSha256, subPath } = options;

  try {
    agentServicesRootEnsure();
    const hash = createHash("sha256").update(archiveUrl).digest("hex").slice(0, 12);
    const archiveName = archiveUrl.split("/").pop() || `agent-${hash}.zip`;
    const archivePath = join(agentServicesCacheDir(), archiveName);
    const staging = join(agentServicesCacheDir(), `staging-${hash}`);

    await downloadToFile(archiveUrl, archivePath);

    const manifestOnDisk = expectedId ? readManifest(expectedId) : null;
    const expectedSha =
      expectedSha256?.trim() ||
      manifestOnDisk?.install?.sha256?.trim() ||
      undefined;

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

    let manifestRoot = findManifestDir(staging);
    if (subPath?.trim()) {
      const parts = subPath.split(/[/\\]/).filter(Boolean);
      // GitHub zipballs wrap contents in `<repo>-<ref>/`.
      const top = readdirSync(staging).find((e) => {
        try {
          return statSync(join(staging, e)).isDirectory();
        } catch {
          return false;
        }
      });
      const candidates = [
        top ? join(staging, top, ...parts) : null,
        join(staging, ...parts),
      ].filter((p): p is string => !!p);
      const match = candidates.find((c) =>
        existsSync(join(c, "manifest.json")),
      );
      if (match) manifestRoot = match;
    }

    const manifest = readManifestFromPath(manifestRoot);
    if (expectedId && manifest.id !== expectedId) {
      return {
        success: false,
        error: `Manifest id "${manifest.id}" does not match expected "${expectedId}"`,
      };
    }

    if (manifest.install?.sha256 && !expectedSha256) {
      const actual = sha256File(archivePath);
      if (actual !== manifest.install.sha256) {
        return { success: false, error: "Archive sha256 mismatch" };
      }
    }

    const dest = agentServiceInstalledDir(manifest.id);
    copyTree(manifestRoot, dest);
    rmSync(staging, { recursive: true, force: true });

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

/**
 * Download a GitHub repo zipball and install the package (optional subdirectory).
 */
export async function installAgentServiceFromGitHub(
  repo: string,
  ref = "main",
  subPath?: string,
  expectedId?: string,
): Promise<AgentServiceInstallResult> {
  // @lat: [[lat.md/agent-services#Agent services#Installation#Install from GitHub]]
  const trimmed = repo.trim().replace(/^https?:\/\/github\.com\//i, "").replace(/\.git$/, "");
  if (!/^[\w.-]+\/[\w.-]+$/.test(trimmed)) {
    return { success: false, error: `Invalid GitHub repo: ${repo}` };
  }
  const archiveUrl = `https://codeload.github.com/${trimmed}/zip/refs/heads/${encodeURIComponent(ref)}`;
  // Fallback tag/sha URL if branch zip 404s is handled by retry below.
  const primary = await installAgentServiceFromArchive(archiveUrl, {
    expectedId,
    subPath,
  });
  if (primary.success) return primary;
  if (!/Download failed \(404\)/i.test(primary.error || "")) return primary;
  const tagUrl = `https://codeload.github.com/${trimmed}/zip/refs/tags/${encodeURIComponent(ref)}`;
  return installAgentServiceFromArchive(tagUrl, { expectedId, subPath });
}

export function getAgentServiceWorkDir(id: string): string | null {
  if (!readManifest(id)) return null;
  const st = readState(id);
  if (st.link_path && existsSync(st.link_path)) return st.link_path;
  const dir = agentServiceInstalledDir(id);
  return existsSync(dir) ? dir : null;
}
