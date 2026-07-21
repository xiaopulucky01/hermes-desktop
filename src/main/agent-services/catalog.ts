import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
} from "fs";
import { join } from "path";
import { safeWriteFile } from "../utils";
import {
  agentServiceInstalledDir,
  agentServiceManifestPath,
  agentServiceStatePath,
  agentServicesCatalogPath,
  agentServicesInstalledRoot,
} from "./paths";
import type {
  AgentServiceCatalog,
  AgentServiceCatalogEntry,
  AgentServiceManifest,
  AgentServiceState,
  AgentServiceStatus,
} from "./types";
import { hasRuntimeVenv } from "./python-runtime";

function agentServicesRootEnsure(): void {
  mkdirSync(agentServicesInstalledRoot(), { recursive: true });
}

export { agentServicesRootEnsure };

function readJsonFile<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

export function readCatalog(): AgentServiceCatalog {
  return readJsonFile<AgentServiceCatalog>(agentServicesCatalogPath(), {
    agents: [],
  });
}

export function writeCatalog(catalog: AgentServiceCatalog): void {
  agentServicesRootEnsure();
  safeWriteFile(
    agentServicesCatalogPath(),
    `${JSON.stringify(catalog, null, 2)}\n`,
  );
}

export function readManifest(id: string): AgentServiceManifest | null {
  const path = agentServiceManifestPath(id);
  if (!existsSync(path)) return null;
  try {
    const data = JSON.parse(readFileSync(path, "utf-8")) as AgentServiceManifest;
    if (!data.id) data.id = id;
    return data;
  } catch {
    return null;
  }
}

export function writeManifest(id: string, manifest: AgentServiceManifest): void {
  agentServicesRootEnsure();
  mkdirSync(agentServiceInstalledDir(id), { recursive: true });
  safeWriteFile(
    agentServiceManifestPath(id),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}

export function readState(id: string): AgentServiceState {
  return readJsonFile<AgentServiceState>(agentServiceStatePath(id), {
    status: "stopped",
    last_error: null,
  });
}

export function writeState(id: string, state: AgentServiceState): void {
  agentServicesRootEnsure();
  mkdirSync(agentServiceInstalledDir(id), { recursive: true });
  safeWriteFile(agentServiceStatePath(id), `${JSON.stringify(state, null, 2)}\n`);
}

export function upsertCatalogEntry(
  manifest: AgentServiceManifest,
  patch: Partial<AgentServiceCatalogEntry> = {},
): AgentServiceCatalogEntry {
  const catalog = readCatalog();
  const idx = catalog.agents.findIndex((a) => a.id === manifest.id);
  const entry: AgentServiceCatalogEntry = {
    id: manifest.id,
    version: manifest.version,
    name: manifest.name,
    enabled:
      patch.enabled ?? (idx >= 0 ? catalog.agents[idx].enabled : true),
    port: patch.port ?? (idx >= 0 ? catalog.agents[idx].port : undefined),
    base_url:
      patch.base_url ?? (idx >= 0 ? catalog.agents[idx].base_url : undefined),
    status:
      patch.status ??
      (idx >= 0 ? catalog.agents[idx].status : undefined) ??
      "stopped",
  };
  if (idx >= 0) catalog.agents[idx] = entry;
  else catalog.agents.push(entry);
  writeCatalog(catalog);
  return entry;
}

export function listInstalledAgentIds(): string[] {
  const root = agentServicesInstalledRoot();
  if (!existsSync(root)) return [];
  try {
    return readdirSync(root).filter((name) => {
      try {
        return (
          statSync(join(root, name)).isDirectory() &&
          existsSync(agentServiceManifestPath(name))
        );
      } catch {
        return false;
      }
    });
  } catch {
    return [];
  }
}

export function listAgentServiceStatuses(): AgentServiceStatus[] {
  const catalog = readCatalog();
  const byId = new Map(catalog.agents.map((a) => [a.id, a]));
  const ids = new Set([...listInstalledAgentIds(), ...catalog.agents.map((a) => a.id)]);

  const out: AgentServiceStatus[] = [];
  for (const id of ids) {
    const manifest = readManifest(id);
    if (!manifest) continue;
    const state = readState(id);
    const cat = byId.get(id);
    const workDir =
      state.link_path && existsSync(state.link_path)
        ? state.link_path
        : agentServiceInstalledDir(id);
    out.push({
      id,
      name: manifest.name,
      version: manifest.version,
      description: manifest.description,
      enabled: cat?.enabled ?? true,
      status: state.status,
      port: state.port ?? cat?.port,
      base_url: state.base_url ?? cat?.base_url,
      card_url: state.card_url,
      last_error: state.last_error ?? null,
      link_path: state.link_path,
      ui: manifest.ui,
      has_venv: hasRuntimeVenv(workDir, manifest),
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

export function readAllStates(): AgentServiceState[] {
  return listInstalledAgentIds().map((id) => readState(id));
}
