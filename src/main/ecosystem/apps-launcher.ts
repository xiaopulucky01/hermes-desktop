/**
 * Start/stop OSS apps installed under hermes-ecosystem/apps using their
 * upstream launch commands (pnpm/npm/uv).
 */

import { spawn, type ChildProcess } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
import { getEnhancedPath } from "../installer";
import { HIDDEN_SUBPROCESS_OPTIONS } from "../process-options";
import { readAppManifest, ecosystemAppsRoot, type AppManifest } from "./apps-catalog";
import { listRuntimePools } from "./runtime-pool";
import { readCapabilities } from "./capabilities";

const running = new Map<string, ChildProcess>();

function resolveAppDir(appId: string): string | null {
  const cap = readCapabilities().capabilities.find(
    (c) => c.kind === "app" && c.id === appId,
  );
  if (cap?.path && existsSync(cap.path)) return cap.path;
  const dir = join(ecosystemAppsRoot(), appId);
  return existsSync(dir) ? dir : null;
}

function resolveManifest(appDir: string, appId: string): AppManifest {
  return (
    readAppManifest(appDir) || {
      id: appId,
      start: { command: "npm", args: ["start"] },
    }
  );
}

/**
 * Launch an app with its hermes-app.json start command.
 */
// @lat: [[lat.md/ecosystem#Hermes ecosystem#Apps#Start]]
export function startEcosystemApp(
  appId: string,
): { success: boolean; error?: string; pid?: number } {
  if (running.get(appId) && !running.get(appId)?.killed) {
    return { success: true, pid: running.get(appId)?.pid };
  }
  const appDir = resolveAppDir(appId);
  if (!appDir) {
    return { success: false, error: `App not found: ${appId}` };
  }
  const manifest = resolveManifest(appDir, appId);
  const start = manifest.start;
  if (!start?.command) {
    return { success: false, error: "App has no start command" };
  }
  const cwd = start.cwd
    ? join(appDir, start.cwd)
    : appDir;
  if (!existsSync(cwd)) {
    return { success: false, error: `Start cwd missing: ${cwd}` };
  }

  const env = {
    ...process.env,
    PATH: getEnhancedPath(),
    ...(start.env || {}),
  };
  // Prefer shared node pool bins when present.
  const pools = listRuntimePools();
  for (const pool of Object.values(pools)) {
    if (pool.runtime !== "node") continue;
    const nmBin = join(pool.path, "node_modules", ".bin");
    if (existsSync(nmBin)) {
      env.PATH = `${nmBin}${process.platform === "win32" ? ";" : ":"}${env.PATH}`;
      break;
    }
  }

  try {
    const child = spawn(start.command, start.args || [], {
      ...HIDDEN_SUBPROCESS_OPTIONS,
      cwd,
      env,
      shell: process.platform === "win32",
      detached: false,
      stdio: "ignore",
    });
    running.set(appId, child);
    child.on("exit", () => {
      if (running.get(appId) === child) running.delete(appId);
    });
    return { success: true, pid: child.pid };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function stopEcosystemApp(
  appId: string,
): { success: boolean; error?: string } {
  const child = running.get(appId);
  if (!child) return { success: true };
  try {
    child.kill();
    running.delete(appId);
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function isEcosystemAppRunning(appId: string): boolean {
  const child = running.get(appId);
  return !!(child && !child.killed);
}

export function listRunningEcosystemApps(): string[] {
  return [...running.keys()].filter((id) => isEcosystemAppRunning(id));
}
