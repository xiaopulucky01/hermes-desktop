/**
 * Discover feed: scan hermes-ecosystem/agents/packages/<id>/manifest.json.
 * Third-party A2A agents live under ecosystem only — no agent-services.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { getEcosystemRoot } from "../ecosystem/paths";
import type { AgentServiceManifest } from "./types";

export interface LocalA2aCatalogEntry {
  id: string;
  type: "a2a-service";
  name: string;
  version: string;
  description: string;
  category?: string;
  tags?: string[];
  localPath: string;
  platforms: Array<"win32" | "darwin" | "linux">;
}

/** Source packages available to install (not the runtime installed/ copies). */
export function ecosystemAgentPackagesRoot(): string {
  return join(getEcosystemRoot(), "agents", "packages");
}

export function resolveEcosystemAgentPackageRoots(): string[] {
  const root = ecosystemAgentPackagesRoot();
  if (existsSync(root) && statSync(root).isDirectory()) return [root];
  return [];
}

function manifestToEntry(
  packageDir: string,
  manifest: AgentServiceManifest,
): LocalA2aCatalogEntry | null {
  const id = (manifest.id || "").trim();
  if (!id || id === "agents-template") return null;
  if (!/^[a-z][a-z0-9-]{1,62}$/.test(id)) return null;

  const tags = (manifest.skills_hint || [])
    .map((s) => s.id)
    .filter(Boolean)
    .slice(0, 8);
  if (!tags.includes("a2a")) tags.push("a2a");

  return {
    id,
    type: "a2a-service",
    name: manifest.name || id,
    version: manifest.version || "0.0.0",
    description:
      manifest.description?.trim() ||
      `${manifest.name || id} — A2A agent (ecosystem)`,
    category: tags[0] || "agent",
    tags,
    // Absolute path so install does not depend on agent-services layout.
    localPath: packageDir,
    platforms: ["win32", "darwin", "linux"],
  };
}

/**
 * Scan hermes-ecosystem/agents/packages for installable A2A agents.
 */
export function scanLocalA2aAgentCatalog(): LocalA2aCatalogEntry[] {
  // @lat: [[lat.md/agent-services#Agent services#Discover catalog#Local agents scan]]
  const entries: LocalA2aCatalogEntry[] = [];
  const seenIds = new Set<string>();

  for (const agentsRoot of resolveEcosystemAgentPackageRoots()) {
    let names: string[];
    try {
      names = readdirSync(agentsRoot);
    } catch {
      continue;
    }
    for (const name of names) {
      const packageDir = join(agentsRoot, name);
      try {
        if (!statSync(packageDir).isDirectory()) continue;
      } catch {
        continue;
      }
      const manifestPath = join(packageDir, "manifest.json");
      if (!existsSync(manifestPath)) continue;
      try {
        const manifest = JSON.parse(
          readFileSync(manifestPath, "utf-8"),
        ) as AgentServiceManifest;
        const entry = manifestToEntry(packageDir, manifest);
        if (!entry || seenIds.has(entry.id)) continue;
        seenIds.add(entry.id);
        entries.push(entry);
      } catch {
        /* skip bad manifest */
      }
    }
  }

  return entries;
}

/** @deprecated Use resolveEcosystemAgentPackageRoots — agent-services removed. */
export function resolveAgentServicesAgentsRoots(): string[] {
  return resolveEcosystemAgentPackageRoots();
}
