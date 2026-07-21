import { existsSync } from "fs";
import { join, resolve } from "path";
import { HERMES_HOME } from "../installer";

/** User-writable root for cloud-downloaded and locally registered A2A agent services. */
// @lat: [[lat.md/agent-services#Agent services]]
export const AGENT_SERVICES_ROOT =
  process.env.HERMES_AGENT_SERVICES_ROOT?.trim() ||
  join(HERMES_HOME, "agent-services");

/** Directory name for the multi-agent shared venv under AGENT_SERVICES_ROOT. */
export const SHARED_VENV_DIRNAME = "shared-venv";

export function agentServicesCatalogPath(): string {
  return join(AGENT_SERVICES_ROOT, "catalog.json");
}

export function agentServicesCacheDir(): string {
  return join(AGENT_SERVICES_ROOT, "cache");
}

export function agentServicesInstalledRoot(): string {
  return join(AGENT_SERVICES_ROOT, "installed");
}

export function agentServiceInstalledDir(id: string): string {
  return join(agentServicesInstalledRoot(), id);
}

export function agentServiceManifestPath(id: string): string {
  return join(agentServiceInstalledDir(id), "manifest.json");
}

export function agentServiceStatePath(id: string): string {
  return join(agentServiceInstalledDir(id), "state.json");
}

export function agentServiceEnvPath(id: string): string {
  return join(agentServiceInstalledDir(id), ".env");
}

export function agentServiceLogsDir(id: string): string {
  return join(agentServiceInstalledDir(id), "logs");
}

/**
 * Root directory of the shared multi-agent venv (never Hermes resources/python).
 * Override with HERMES_AGENT_SERVICES_SHARED_VENV.
 */
export function resolveSharedVenvRoot(workDir?: string): string {
  // @lat: [[lat.md/agent-services#Agent services#Shared Python runtime#Shared venv path]]
  const override = process.env.HERMES_AGENT_SERVICES_SHARED_VENV?.trim();
  if (override) return resolve(override);

  if (workDir) {
    const normalized = workDir.replace(/\\/g, "/");
    const idx = normalized.toLowerCase().lastIndexOf("/agent-services/agents/");
    if (idx >= 0) {
      const repoServices = normalized.slice(0, idx + "/agent-services".length);
      return resolve(
        repoServices.replace(/\//g, process.platform === "win32" ? "\\" : "/"),
        SHARED_VENV_DIRNAME,
      );
    }
  }

  return join(AGENT_SERVICES_ROOT, SHARED_VENV_DIRNAME);
}

export function sharedVenvPythonCandidates(venvRoot: string): string[] {
  return process.platform === "win32"
    ? [
        join(venvRoot, "Scripts", "python.exe"),
        join(venvRoot, "Scripts", "python"),
      ]
    : [join(venvRoot, "bin", "python"), join(venvRoot, "bin", "python3")];
}

export function resolveSharedVenvPython(workDir?: string): string | null {
  const root = resolveSharedVenvRoot(workDir);
  for (const c of sharedVenvPythonCandidates(root)) {
    if (existsSync(c)) return c;
  }
  return null;
}

export function hasSharedVenv(workDir?: string): boolean {
  return resolveSharedVenvPython(workDir) !== null;
}
