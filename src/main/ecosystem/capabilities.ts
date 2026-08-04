/**
 * Read/write ecosystem capabilities.json and links.json.
 */

import { existsSync, readFileSync } from "fs";
import { safeWriteFile } from "../utils";
import type {
  CapabilitiesFile,
  InstalledCapability,
  LinksFile,
  LocalLinkEntry,
} from "../../shared/ecosystem";
import {
  ecosystemCapabilitiesPath,
  ecosystemLinksPath,
} from "./paths";

const EMPTY_CAPABILITIES: CapabilitiesFile = {
  schema: "hermes.ecosystem/v1",
  capabilities: [],
};

const EMPTY_LINKS: LinksFile = {
  schema: "hermes.ecosystem/v1",
  links: [],
};

function readJsonFile<T>(path: string, fallback: T): T {
  try {
    if (!existsSync(path)) return fallback;
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

// @lat: [[lat.md/ecosystem#Hermes ecosystem#Capabilities index]]
export function readCapabilities(): CapabilitiesFile {
  const data = readJsonFile(ecosystemCapabilitiesPath(), EMPTY_CAPABILITIES);
  return {
    schema: "hermes.ecosystem/v1",
    capabilities: Array.isArray(data.capabilities) ? data.capabilities : [],
  };
}

export function writeCapabilities(file: CapabilitiesFile): void {
  safeWriteFile(
    ecosystemCapabilitiesPath(),
    JSON.stringify(
      { schema: "hermes.ecosystem/v1", capabilities: file.capabilities },
      null,
      2,
    ) + "\n",
  );
}

export function upsertCapability(cap: InstalledCapability): void {
  const file = readCapabilities();
  const idx = file.capabilities.findIndex(
    (c) => c.kind === cap.kind && c.id === cap.id,
  );
  if (idx >= 0) file.capabilities[idx] = cap;
  else file.capabilities.push(cap);
  writeCapabilities(file);
}

export function removeCapability(kind: string, id: string): void {
  const file = readCapabilities();
  file.capabilities = file.capabilities.filter(
    (c) => !(c.kind === kind && c.id === id),
  );
  writeCapabilities(file);
}

export function readLinks(): LinksFile {
  const data = readJsonFile(ecosystemLinksPath(), EMPTY_LINKS);
  return {
    schema: "hermes.ecosystem/v1",
    links: Array.isArray(data.links) ? data.links : [],
  };
}

export function writeLinks(file: LinksFile): void {
  safeWriteFile(
    ecosystemLinksPath(),
    JSON.stringify(
      { schema: "hermes.ecosystem/v1", links: file.links },
      null,
      2,
    ) + "\n",
  );
}

export function upsertLocalLink(entry: LocalLinkEntry): void {
  const file = readLinks();
  const idx = file.links.findIndex(
    (l) => l.kind === entry.kind && l.id === entry.id,
  );
  const next = { ...entry, linkedAt: entry.linkedAt || new Date().toISOString() };
  if (idx >= 0) file.links[idx] = next;
  else file.links.push(next);
  writeLinks(file);
}
