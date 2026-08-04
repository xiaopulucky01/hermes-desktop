import { existsSync } from "fs";
import { join, resolve } from "path";
import {
  ecosystemSharedPythonVenvRoot,
  resolveAgentServicesRoot,
} from "../ecosystem/paths";

/**
 * User-writable root for A2A agent services: `<hermes-ecosystem>/agents`.
 * Override with HERMES_AGENT_SERVICES_ROOT. No HERMES_HOME fallback.
 */
// @lat: [[lat.md/agent-services#Agent services]]
// @lat: [[lat.md/ecosystem#Hermes ecosystem#Agents root]]
export function getAgentServicesRoot(): string {
  return resolveAgentServicesRoot();
}

/** Resolved once at import — prefer [[getAgentServicesRoot]] when env may change. */
export const AGENT_SERVICES_ROOT = resolveAgentServicesRoot();

/** Directory name for the multi-agent shared venv under runtimes (legacy name). */
export const SHARED_VENV_DIRNAME = "shared-venv";

export function agentServicesCatalogPath(): string {
  return join(getAgentServicesRoot(), "catalog.json");
}

export function agentServicesCacheDir(): string {
  return join(getAgentServicesRoot(), "cache");
}

export function agentServicesInstalledRoot(): string {
  return join(getAgentServicesRoot(), "installed");
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
 * Shared multi-agent venv root (never Hermes resources/python).
 * Override with HERMES_AGENT_SERVICES_SHARED_VENV; else ecosystem
 * `runtimes/python/shared-venv` (from workDir under hermes-ecosystem, or default).
 */
export function resolveSharedVenvRoot(workDir?: string): string {
  // @lat: [[lat.md/agent-services#Agent services#Shared Python runtime#Shared venv path]]
  const override = process.env.HERMES_AGENT_SERVICES_SHARED_VENV?.trim();
  if (override) return resolve(override);

  if (workDir) {
    const normalized = workDir.replace(/\\/g, "/");
    const idxEco = normalized.toLowerCase().lastIndexOf("/hermes-ecosystem/");
    if (idxEco >= 0) {
      const ecoRoot = normalized.slice(0, idxEco + "/hermes-ecosystem".length);
      return resolve(
        ecoRoot.replace(/\//g, process.platform === "win32" ? "\\" : "/"),
        "runtimes",
        "python",
        SHARED_VENV_DIRNAME,
      );
    }
  }

  return ecosystemSharedPythonVenvRoot();
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
