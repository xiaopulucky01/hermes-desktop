/**
 * Local Discover feed for apps under hermes-ecosystem/apps/<id>/.
 */

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { join } from "path";
import { getEcosystemRoot } from "./paths";

export interface LocalAppCatalogEntry {
  id: string;
  type: "app";
  name: string;
  version: string;
  description: string;
  category?: string;
  tags?: string[];
  localPath: string;
  homepage?: string;
  platforms: Array<"win32" | "darwin" | "linux">;
  invocation: "open_ui";
}

export interface AppManifest {
  id: string;
  name?: string;
  version?: string;
  description?: string;
  tags?: string[];
  homepage?: string;
  /** How to start the upstream OSS project. */
  start?: {
    command: string;
    args?: string[];
    cwd?: string;
    env?: Record<string, string>;
  };
  /** Optional install steps before first start. */
  install?: {
    command: string;
    args?: string[];
    cwd?: string;
  };
}

export function ecosystemAppsRoot(): string {
  return join(getEcosystemRoot(), "apps");
}

const DEFAULT_START: Record<string, AppManifest["start"]> = {
  "inkos-agent": { command: "pnpm", args: ["dev"] },
  "orca-agent": { command: "pnpm", args: ["dev"] },
  "meetily-agent": {
    command: "pnpm",
    args: ["dev"],
    cwd: "frontend",
  },
  "crewai-agent": {
    command: "uv",
    args: ["run", "crewai", "--help"],
  },
};

function ensureAppManifest(appDir: string, id: string): AppManifest {
  const file = join(appDir, "hermes-app.json");
  if (existsSync(file)) {
    try {
      return JSON.parse(readFileSync(file, "utf-8")) as AppManifest;
    } catch {
      /* fall through */
    }
  }

  let name = id;
  let version = "0.0.0";
  let description = `Open-source app: ${id}`;
  let homepage: string | undefined;
  const pkgPath = join(appDir, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as {
        name?: string;
        version?: string;
        description?: string;
        homepage?: string;
        repository?: { url?: string };
      };
      name = pkg.name || id;
      version = pkg.version || version;
      description = pkg.description || description;
      homepage = pkg.homepage || pkg.repository?.url;
    } catch {
      /* ignore */
    }
  }

  const manifest: AppManifest = {
    id,
    name,
    version,
    description,
    homepage,
    tags: ["app", "oss"],
    start: DEFAULT_START[id] || { command: "npm", args: ["start"] },
    install:
      id === "crewai-agent"
        ? { command: "uv", args: ["sync"] }
        : { command: "pnpm", args: ["install"] },
  };
  try {
    writeFileSync(file, JSON.stringify(manifest, null, 2) + "\n", "utf-8");
  } catch {
    /* read-only junction may still work for start */
  }
  return manifest;
}

/**
 * Scan hermes-ecosystem/apps for Discover Apps tab.
 */
// @lat: [[lat.md/ecosystem#Hermes ecosystem#Apps]]
export function scanLocalAppCatalog(): LocalAppCatalogEntry[] {
  const root = ecosystemAppsRoot();
  if (!existsSync(root)) return [];
  const out: LocalAppCatalogEntry[] = [];
  for (const name of readdirSync(root)) {
    if (name.startsWith(".")) continue;
    const appDir = join(root, name);
    try {
      if (!statSync(appDir).isDirectory()) continue;
    } catch {
      continue;
    }
    const m = ensureAppManifest(appDir, name);
    out.push({
      id: m.id || name,
      type: "app",
      name: m.name || name,
      version: m.version || "0.0.0",
      description: m.description || "",
      category: "app",
      tags: m.tags || ["app"],
      localPath: appDir,
      homepage: m.homepage,
      platforms: ["win32", "darwin", "linux"],
      invocation: "open_ui",
    });
  }
  return out;
}

export function readAppManifest(appDir: string): AppManifest | null {
  const file = join(appDir, "hermes-app.json");
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf-8")) as AppManifest;
  } catch {
    return null;
  }
}
