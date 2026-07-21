/**
 * Update channel for installed A2A agent services.
 * Compares local manifest.version to a catalog entry (bundled or remote).
 */

import { readManifest } from "./catalog";
import type { RegistryItem } from "../../shared/registry";

export interface AgentServiceUpdateInfo {
  id: string;
  currentVersion: string | null;
  availableVersion: string | null;
  updateAvailable: boolean;
  archiveUrl?: string;
  archiveSha256?: string;
  githubRepo?: string;
  githubRef?: string;
  githubPath?: string;
}

function parseSemverParts(v: string): number[] | null {
  const m = v.trim().match(/^v?(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** Return true when available is newer than current (semver-ish). */
export function isNewerVersion(current: string, available: string): boolean {
  const a = parseSemverParts(current);
  const b = parseSemverParts(available);
  if (!a || !b) return available.trim() !== current.trim();
  for (let i = 0; i < 3; i++) {
    if (b[i] > a[i]) return true;
    if (b[i] < a[i]) return false;
  }
  return false;
}

/**
 * Compare an installed service against a Discover/registry catalog item.
 */
export function checkAgentServiceUpdate(
  catalogItem: RegistryItem,
): AgentServiceUpdateInfo {
  // @lat: [[lat.md/agent-services#Agent services#Ecosystem#Update channel]]
  const id = catalogItem.id;
  const installed = readManifest(id);
  const currentVersion = installed?.version ?? null;
  const availableVersion = catalogItem.version ?? null;
  const updateAvailable =
    !!currentVersion &&
    !!availableVersion &&
    isNewerVersion(currentVersion, availableVersion);

  return {
    id,
    currentVersion,
    availableVersion,
    updateAvailable,
    archiveUrl: catalogItem.archiveUrl,
    archiveSha256: catalogItem.archiveSha256,
    githubRepo: catalogItem.githubRepo,
    githubRef: catalogItem.githubRef,
    githubPath: catalogItem.githubPath,
  };
}

export function listAgentServiceUpdates(
  catalogItems: RegistryItem[],
): AgentServiceUpdateInfo[] {
  return catalogItems.map(checkAgentServiceUpdate).filter((u) => u.updateAvailable);
}
