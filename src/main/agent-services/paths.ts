import { join } from "path";
import { HERMES_HOME } from "../installer";

/** User-writable root for cloud-downloaded and locally registered A2A agent services. */
// @lat: [[lat.md/agent-services#Agent services]]
export const AGENT_SERVICES_ROOT =
  process.env.HERMES_AGENT_SERVICES_ROOT?.trim() ||
  join(HERMES_HOME, "agent-services");

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
