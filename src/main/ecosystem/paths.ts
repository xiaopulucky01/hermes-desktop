/**
 * Resolve the local hermes-ecosystem root and per-kind paths.
 * Agents (A2A) install under `<root>/agents/` — not under HERMES_HOME.
 */

import { existsSync } from "fs";
import { homedir } from "os";
import { join, resolve } from "path";
import type { EcosystemKind, EcosystemPackageKind } from "../../shared/ecosystem";
import { packageKindToDir } from "../../shared/ecosystem";

const IS_WINDOWS = process.platform === "win32";

/**
 * Default user-scoped ecosystem root when no env / sibling checkout exists.
 */
export function defaultUserEcosystemRoot(): string {
  if (IS_WINDOWS && process.env.LOCALAPPDATA) {
    return join(process.env.LOCALAPPDATA, "hermes-ecosystem");
  }
  return join(homedir(), ".hermes-ecosystem");
}

/** Sibling `hermes-ecosystem` next to hermes-desktop (dev layout). */
export function resolveSiblingEcosystemRoot(
  fromCwd = process.cwd(),
  fromDirname = __dirname,
): string | null {
  const candidates = [
    join(fromCwd, "../hermes-ecosystem"),
    join(fromDirname, "../../../hermes-ecosystem"), // out/main → repo → private
    join(fromDirname, "../../hermes-ecosystem"),
  ];
  for (const c of candidates) {
    const abs = resolve(c);
    if (existsSync(abs)) return abs;
  }
  return null;
}

/**
 * Local install root for marketplace / linked packages.
 * Precedence: HERMES_ECOSYSTEM_ROOT → sibling checkout → user data default.
 */
// @lat: [[lat.md/ecosystem#Hermes ecosystem#Paths]]
export function resolveEcosystemRoot(): string {
  const env = process.env.HERMES_ECOSYSTEM_ROOT?.trim();
  if (env) return resolve(env);

  const sibling = resolveSiblingEcosystemRoot();
  if (sibling) return sibling;

  return defaultUserEcosystemRoot();
}

/** Cached at first read; tests may call [[resetEcosystemRootCache]]. */
let cachedRoot: string | null = null;

export function getEcosystemRoot(): string {
  if (!cachedRoot) cachedRoot = resolveEcosystemRoot();
  return cachedRoot;
}

/** Test helper — clear memoized root. */
export function resetEcosystemRootCache(): void {
  cachedRoot = null;
}

export function ecosystemKindRoot(kind: EcosystemKind): string {
  return join(getEcosystemRoot(), kind);
}

export function ecosystemPackageDir(
  kind: EcosystemPackageKind,
  publisher: string,
  id: string,
): string {
  const dir = packageKindToDir(kind);
  if (kind === "agent") {
    // Supervised agents keep the installed/<id> layout under agents/.
    return join(getEcosystemRoot(), "agents", "installed", id);
  }
  return join(getEcosystemRoot(), dir, publisher, id);
}

export function ecosystemCapabilitiesPath(): string {
  return join(getEcosystemRoot(), "capabilities.json");
}

export function ecosystemLinksPath(): string {
  return join(getEcosystemRoot(), "links.json");
}

export function ecosystemCatalogCacheDir(): string {
  return join(getEcosystemRoot(), "catalog-cache");
}

export function ecosystemRuntimesRoot(): string {
  return join(getEcosystemRoot(), "runtimes");
}

/** Phase-1 shared Python venv for A2A agents. */
export function ecosystemSharedPythonVenvRoot(): string {
  return join(ecosystemRuntimesRoot(), "python", "shared-venv");
}

/**
 * A2A agent-services root: `<ecosystem>/agents`.
 * Override with HERMES_AGENT_SERVICES_ROOT (no HERMES_HOME fallback).
 */
export function resolveAgentServicesRoot(): string {
  const override = process.env.HERMES_AGENT_SERVICES_ROOT?.trim();
  if (override) return resolve(override);
  return join(getEcosystemRoot(), "agents");
}
