/**
 * Dev-time Discover feed: scan sibling agent-services/agents/<id>/manifest.json
 * so new local agents appear without editing resources/a2a-services-catalog.json.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join, resolve } from "path";
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

/** Candidate roots for …/agent-services/agents (sibling of hermes-desktop). */
export function resolveAgentServicesAgentsRoots(
  fromCwd = process.cwd(),
  fromDirname = __dirname,
): string[] {
  const candidates = [
    join(fromDirname, "../../../agent-services/agents"), // out/main → ../../.. = repo parent? out/main -> ../.. = project, ../../.. = private
    join(fromDirname, "../../agent-services/agents"),
    join(fromCwd, "../agent-services/agents"),
    join(fromCwd, "agent-services/agents"),
  ];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const c of candidates) {
    const abs = resolve(c);
    if (seen.has(abs.toLowerCase())) continue;
    seen.add(abs.toLowerCase());
    if (existsSync(abs) && statSync(abs).isDirectory()) out.push(abs);
  }
  return out;
}

function relativeLocalPath(agentsRoot: string, packageDir: string): string {
  // Prefer portable catalog form relative to hermes-desktop cwd.
  const name = packageDir.replace(/\\/g, "/").split("/").pop() || "";
  void agentsRoot;
  return `../agent-services/agents/${name}`;
}

function manifestToEntry(
  agentsRoot: string,
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
  tags.push("local");

  return {
    id,
    type: "a2a-service",
    name: manifest.name || id,
    version: manifest.version || "0.0.0",
    description:
      manifest.description?.trim() ||
      `${manifest.name || id} — local A2A agent (shared-venv)`,
    category: tags[0] || "local",
    tags,
    localPath: relativeLocalPath(agentsRoot, packageDir),
    platforms: ["win32", "darwin", "linux"],
  };
}

/**
 * Scan agent-services/agents for installable packages.
 * Does not include agents-template (lives outside agents/).
 */
export function scanLocalA2aAgentCatalog(
  fromCwd = process.cwd(),
  fromDirname = __dirname,
): LocalA2aCatalogEntry[] {
  // @lat: [[lat.md/agent-services#Agent services#Discover catalog#Local agents scan]]
  const entries: LocalA2aCatalogEntry[] = [];
  const seenIds = new Set<string>();

  for (const agentsRoot of resolveAgentServicesAgentsRoots(fromCwd, fromDirname)) {
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
        const entry = manifestToEntry(agentsRoot, packageDir, manifest);
        if (!entry || seenIds.has(entry.id)) continue;
        seenIds.add(entry.id);
        entries.push(entry);
      } catch {
        /* skip bad manifests */
      }
    }
  }

  entries.sort((a, b) => a.name.localeCompare(b.name));
  return entries;
}
