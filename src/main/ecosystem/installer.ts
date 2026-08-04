/**
 * Install marketplace / linked packages into hermes-ecosystem and wire Hermes.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "fs";
import { join, resolve, isAbsolute } from "path";
import type { RegistryItem } from "../../shared/registry";
import type {
  CapabilityInvocation,
  CapabilityOrigin,
  EcosystemPackageKind,
  InstalledCapability,
} from "../../shared/ecosystem";
import { HERMES_HOME } from "../installer";
import { installSkill } from "../skills";
import { profileHome, safeWriteFile } from "../utils";
import {
  copyTree,
  downloadRegistryFolder,
  downloadToFile,
  extractArchive,
  findManifestDir,
  type InstallResult,
  resolveGitHubTagZipball,
  resolveGitHubZipball,
  sha256File,
} from "./download";
import {
  linkEcosystemPlugin,
  linkPluginFromPath,
  resolvePluginLinkId,
  unlinkEcosystemPlugin,
} from "./linker";
import {
  ecosystemCatalogCacheDir,
  ecosystemKindRoot,
  ecosystemPackageDir,
} from "./paths";
import {
  readCapabilities,
  removeCapability,
  upsertCapability,
  upsertLocalLink,
} from "./capabilities";
import {
  acquireRuntimeForPackage,
  bindCommandToRuntimePool,
  releaseRuntimeForPackage,
} from "./runtime-pool";

export interface EcosystemInstallContext {
  profile?: string;
  /** Registry git-tree folder fetcher (legacy GitHub catalog). */
  listRegistryFolderFiles?: (folder: string) => Promise<string[]>;
  registryRawBase?: string;
  origin?: CapabilityOrigin;
}

export interface EcosystemPackageManifest {
  description?: string;
  transport?: "stdio" | "http" | "sse";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  entry?: string;
  when_to_use?: string;
  invocation?: CapabilityInvocation;
}

export function resolvePublisher(item: {
  id: string;
  author?: string;
}): string {
  if (item.author?.trim()) {
    return item.author
      .trim()
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .toLowerCase();
  }
  const dot = item.id.indexOf(".");
  if (dot > 0) return item.id.slice(0, dot).toLowerCase();
  return "community";
}

function packageInstallDir(
  kind: EcosystemPackageKind,
  publisher: string,
  packageId: string,
): string {
  return ecosystemPackageDir(kind, publisher, packageId);
}

function readPackageManifest(dir: string): EcosystemPackageManifest | null {
  const file = join(dir, "manifest.json");
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf-8")) as EcosystemPackageManifest;
  } catch {
    return null;
  }
}

function capabilityFromItem(
  kind: EcosystemPackageKind,
  item: RegistryItem,
  publisher: string,
  installPath: string,
  origin: CapabilityOrigin,
  manifest: EcosystemPackageManifest | null,
): InstalledCapability {
  return {
    kind,
    id: item.id,
    name: item.name,
    publisher,
    version: item.version,
    description: manifest?.description || item.description,
    when_to_use: item.when_to_use || manifest?.when_to_use,
    tags: item.tags,
    invocation: item.invocation || manifest?.invocation,
    origin,
    path: installPath,
    pricingModel: undefined,
  };
}

function registerInstalledCapability(
  kind: EcosystemPackageKind,
  item: RegistryItem,
  publisher: string,
  installPath: string,
  origin: CapabilityOrigin,
  manifest: EcosystemPackageManifest | null,
  opts: { runtimeKey?: string; runtime?: import("../../shared/ecosystem").RuntimeKind; skipAcquire?: boolean } = {},
): { runtimeKey?: string } {
  const cap = capabilityFromItem(
    kind,
    item,
    publisher,
    installPath,
    origin,
    manifest,
  );
  if (opts.skipAcquire) {
    if (opts.runtimeKey) {
      cap.runtimeKey = opts.runtimeKey;
      cap.runtime = opts.runtime;
    }
    upsertCapability(cap);
    return { runtimeKey: opts.runtimeKey };
  }
  const runtimeInfo = acquireRuntimeForPackage(installPath, kind, item.id);
  if (runtimeInfo.runtimeKey) {
    cap.runtimeKey = runtimeInfo.runtimeKey;
    cap.runtime = runtimeInfo.runtime;
  }
  if (runtimeInfo.error) {
    console.warn(
      `[ecosystem] runtime pool materialize failed for ${kind}:${item.id}: ${runtimeInfo.error}`,
    );
  }
  upsertCapability(cap);
  return { runtimeKey: runtimeInfo.runtimeKey };
}

function ensureSkillMarker(dir: string, item: RegistryItem): void {
  const skillMd = join(dir, "SKILL.md");
  if (existsSync(skillMd)) return;
  const stub = `---
name: ${item.name}
description: ${item.description || item.name}
---

${item.description || ""}
`;
  safeWriteFile(skillMd, stub);
}

function yamlScalar(value: string): string {
  return /[:#{}[\],&*?|<>=!%@`"']/.test(value) || value.trim() !== value
    ? JSON.stringify(value)
    : value;
}

function absolutizePackagePath(base: string, value: string): string {
  if (!value?.trim()) return value;
  if (isAbsolute(value)) return value;
  if (value.includes("/") || value.includes("\\") || value.startsWith(".")) {
    return resolve(base, value);
  }
  return value;
}

function renderMcpYamlBlock(
  serverId: string,
  m: EcosystemPackageManifest,
  packageDir: string,
  runtimeKey?: string,
): string {
  const lines: string[] = [`  ${serverId}:`];
  const remote = !!m.url || m.transport === "http" || m.transport === "sse";
  if (remote) {
    if (m.url) lines.push(`    url: ${yamlScalar(m.url)}`);
    if (m.transport === "sse") lines.push(`    transport: sse`);
    if (m.headers && Object.keys(m.headers).length) {
      lines.push(`    headers:`);
      for (const [k, v] of Object.entries(m.headers)) {
        lines.push(`      ${k}: ${yamlScalar(String(v))}`);
      }
    }
  } else {
    const bound = bindCommandToRuntimePool(
      m.command,
      m.args,
      m.env,
      runtimeKey,
    );
    const cmdOut = bound.command
      ? isAbsolute(bound.command)
        ? bound.command
        : absolutizePackagePath(packageDir, bound.command)
      : bound.command;
    if (cmdOut) lines.push(`    command: ${yamlScalar(cmdOut)}`);
    if (bound.args?.length) {
      lines.push(`    args:`);
      for (const a of bound.args) {
        lines.push(
          `      - ${yamlScalar(absolutizePackagePath(packageDir, String(a)))}`,
        );
      }
    }
    if (bound.env && Object.keys(bound.env).length) {
      lines.push(`    env:`);
      for (const [k, v] of Object.entries(bound.env)) {
        lines.push(`      ${k}: ${yamlScalar(String(v))}`);
      }
    }
  }
  lines.push(`    enabled: true`);
  return lines.join("\n") + "\n";
}

function appendMcpServerToConfig(
  serverId: string,
  manifest: EcosystemPackageManifest,
  packageDir: string,
  profile?: string,
  runtimeKey?: string,
): InstallResult {
  if (!manifest.url && !manifest.command) {
    return { success: false, error: "MCP manifest has no connection config" };
  }
  const configPath = join(profileHome(profile), "config.yaml");
  let content = existsSync(configPath) ? readFileSync(configPath, "utf-8") : "";
  const block = renderMcpYamlBlock(serverId, manifest, packageDir, runtimeKey);
  const sectionRe = /^mcp_servers:\s*\n/m;
  if (sectionRe.test(content)) {
    if (new RegExp(`^[ ]{2}${serverId}:\\s*$`, "m").test(content)) {
      return { success: false, error: "Already configured" };
    }
    content = content.replace(sectionRe, (mm) => mm + block);
  } else {
    if (content.length && !content.endsWith("\n")) content += "\n";
    content += `mcp_servers:\n${block}`;
  }
  try {
    safeWriteFile(configPath, content);
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to write config",
    };
  }
}

function removeMcpServerFromConfig(
  serverId: string,
  profile?: string,
): InstallResult {
  const configPath = join(profileHome(profile), "config.yaml");
  if (!existsSync(configPath)) return { success: true };
  let content = readFileSync(configPath, "utf-8");
  const re = new RegExp(`^[ ]{2}${serverId}:[\\s\\S]*?(?=^[ ]{2}\\w|$)`, "m");
  if (!re.test(content)) return { success: true };
  content = content.replace(re, "");
  safeWriteFile(configPath, content);
  return { success: true };
}

async function materializeFromRegistryPath(
  item: RegistryItem,
  dest: string,
  ctx: EcosystemInstallContext,
): Promise<InstallResult> {
  if (!item.path?.trim()) {
    return { success: false, error: "Catalog entry has no path" };
  }
  if (!ctx.listRegistryFolderFiles || !ctx.registryRawBase) {
    return { success: false, error: "Registry folder download not configured" };
  }
  return downloadRegistryFolder(
    ctx.registryRawBase,
    item.path,
    dest,
    ctx.listRegistryFolderFiles,
  );
}

async function materializeFromArchive(
  item: RegistryItem,
  dest: string,
): Promise<InstallResult> {
  const url = item.archiveUrl?.trim();
  if (!url) return { success: false, error: "No archiveUrl" };
  const cache = join(
    ecosystemCatalogCacheDir(),
    `pkg-${item.id.replace(/[^a-z0-9.-]+/gi, "_")}.zip`,
  );
  mkdirSync(ecosystemCatalogCacheDir(), { recursive: true });
  await downloadToFile(url, cache);
  if (item.archiveSha256) {
    const actual = sha256File(cache);
    if (actual !== item.archiveSha256) {
      return { success: false, error: "Archive sha256 mismatch" };
    }
  }
  const staging = join(ecosystemCatalogCacheDir(), `staging-${item.id}`);
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  extractArchive(cache, staging);
  const root = findManifestDir(staging);
  copyTree(root, dest);
  rmSync(staging, { recursive: true, force: true });
  return { success: true };
}

async function materializeFromGitHub(
  item: RegistryItem,
  dest: string,
): Promise<InstallResult> {
  const repo = item.githubRepo?.trim();
  if (!repo) return { success: false, error: "No githubRepo" };
  const ref = item.githubRef || "main";
  const cache = join(
    ecosystemCatalogCacheDir(),
    `gh-${item.id.replace(/[^a-z0-9.-]+/gi, "_")}.zip`,
  );
  mkdirSync(ecosystemCatalogCacheDir(), { recursive: true });
  let lastErr = "";
  for (const url of [
    resolveGitHubZipball(repo, ref),
    resolveGitHubTagZipball(repo, ref),
  ]) {
    try {
      await downloadToFile(url, cache);
      lastErr = "";
      break;
    } catch (err) {
      lastErr = err instanceof Error ? err.message : "GitHub download failed";
    }
  }
  if (lastErr) return { success: false, error: lastErr };
  const staging = join(ecosystemCatalogCacheDir(), `gh-staging-${item.id}`);
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  extractArchive(cache, staging);
  let root = findManifestDir(staging);
  if (item.githubPath?.trim()) {
    const parts = item.githubPath.split(/[/\\]/).filter(Boolean);
    const top = readdirSync(staging).find((e) => {
      try {
        return statSync(join(staging, e)).isDirectory();
      } catch {
        return false;
      }
    });
    const candidates = [
      top ? join(staging, top, ...parts) : null,
      join(staging, ...parts),
    ].filter((p): p is string => !!p);
    const match = candidates.find((c) => existsSync(c));
    if (match) root = match;
  }
  copyTree(root, dest);
  rmSync(staging, { recursive: true, force: true });
  return { success: true };
}

async function materializePackage(
  item: RegistryItem,
  dest: string,
  ctx: EcosystemInstallContext,
): Promise<InstallResult> {
  if (item.path?.trim()) {
    return materializeFromRegistryPath(item, dest, ctx);
  }
  if (item.archiveUrl?.trim()) {
    return materializeFromArchive(item, dest);
  }
  if (item.githubRepo?.trim()) {
    return materializeFromGitHub(item, dest);
  }
  return { success: false, error: "Package has no path, archiveUrl, or githubRepo" };
}

export function resolveLocalPackagePath(localPath: string): string {
  const trimmed = localPath.trim();
  if (trimmed.match(/^[a-zA-Z]:[\\/]/) || trimmed.startsWith("/")) {
    return trimmed;
  }
  const bases = [
    join(__dirname, "../.."),
    process.cwd(),
    join(__dirname, "../../.."),
  ];
  for (const base of bases) {
    const candidate = resolve(base, trimmed);
    if (existsSync(candidate)) return candidate;
  }
  return resolve(bases[0] || process.cwd(), trimmed);
}

/**
 * Install a catalog item into hermes-ecosystem and register in capabilities.json.
 */
// @lat: [[lat.md/ecosystem#Hermes ecosystem#Package install]]
export async function installEcosystemPackage(
  kind: EcosystemPackageKind,
  item: RegistryItem,
  ctx: EcosystemInstallContext = {},
): Promise<InstallResult> {
  const publisher = resolvePublisher(item);
  const origin = ctx.origin || (item.localPath ? "local-link" : "ecosystem");

  if (kind === "skill" && item.source && !item.path && !item.archiveUrl && !item.githubRepo && !item.localPath) {
    const cli = installSkill(item.source || item.id, ctx.profile);
    if (!cli.success) {
      return { success: false, error: cli.error || "Skill install failed" };
    }
    upsertCapability(
      capabilityFromItem(kind, item, publisher, destPlaceholder(kind, publisher, item.id), "ecosystem", null),
    );
    return { success: true };
  }

  if (item.localPath?.trim()) {
    const src = resolveLocalPackagePath(item.localPath);
    if (!existsSync(src)) {
      return { success: false, error: `Local path not found: ${src}` };
    }
    const manifest = readPackageManifest(src);
    let runtimeKey: string | undefined;
    let runtime: import("../../shared/ecosystem").RuntimeKind | undefined;
    if (kind === "mcp") {
      const m = manifest || {};
      if (!m.url && !m.command) {
        return { success: false, error: "MCP package missing manifest connection" };
      }
      const acquired = acquireRuntimeForPackage(src, kind, item.id);
      runtimeKey = acquired.runtimeKey;
      runtime = acquired.runtime;
      if (acquired.error) {
        console.warn(
          `[ecosystem] runtime pool materialize failed for mcp:${item.id}: ${acquired.error}`,
        );
      }
      const wired = appendMcpServerToConfig(
        item.id,
        m,
        src,
        ctx.profile,
        runtimeKey,
      );
      if (!wired.success) return wired;
    }
    if (kind === "plugin") {
      const linkId = resolvePluginLinkId(publisher, item.id);
      const linked = linkPluginFromPath(src, linkId, HERMES_HOME);
      if (!linked.success) return linked;
    }
    registerInstalledCapability(
      kind,
      item,
      publisher,
      src,
      "local-link",
      manifest,
      kind === "mcp"
        ? { skipAcquire: true, runtimeKey, runtime }
        : {},
    );
    upsertLocalLink({ kind, id: item.id, path: src });
    return { success: true };
  }

  const dest = packageInstallDir(kind, publisher, item.id);
  mkdirSync(join(dest, ".."), { recursive: true });
  const materialized = await materializePackage(item, dest, ctx);
  if (!materialized.success) return materialized;

  const manifest = readPackageManifest(dest);

  if (kind === "skill") {
    ensureSkillMarker(dest, item);
  }

  let runtimeKey: string | undefined;
  let runtime: import("../../shared/ecosystem").RuntimeKind | undefined;
  if (kind === "mcp") {
    const m = manifest || {};
    if (!m.url && !m.command) {
      return { success: false, error: "MCP package missing manifest connection" };
    }
    const acquired = acquireRuntimeForPackage(dest, kind, item.id);
    runtimeKey = acquired.runtimeKey;
    runtime = acquired.runtime;
    if (acquired.error) {
      console.warn(
        `[ecosystem] runtime pool materialize failed for mcp:${item.id}: ${acquired.error}`,
      );
    }
    const wired = appendMcpServerToConfig(
      item.id,
      m,
      dest,
      ctx.profile,
      runtimeKey,
    );
    if (!wired.success) return wired;
  }

  if (kind === "plugin") {
    const linked = linkEcosystemPlugin(publisher, item.id, HERMES_HOME);
    if (!linked.success) return linked;
  }

  registerInstalledCapability(
    kind,
    item,
    publisher,
    dest,
    origin,
    manifest,
    kind === "mcp" ? { skipAcquire: true, runtimeKey, runtime } : {},
  );

  return { success: true };
}

function destPlaceholder(
  kind: EcosystemPackageKind,
  publisher: string,
  id: string,
): string {
  return packageInstallDir(kind, publisher, id);
}

export function listInstalledEcosystemIds(
  kind: EcosystemPackageKind,
): string[] {
  return readCapabilities()
    .capabilities.filter((c) => c.kind === kind && c.origin !== "bundled")
    .map((c) => c.id);
}

function publisherFromCapabilityPath(
  capPath: string | undefined,
  kind: EcosystemPackageKind,
): string {
  if (!capPath) return "community";
  const parts = capPath.replace(/\\/g, "/").split("/");
  const kindDir = kind === "plugin" ? "plugins" : `${kind}s`;
  if (kind === "workflow") {
    const idx = parts.lastIndexOf("workflows");
    if (idx >= 0 && parts[idx + 1]) return parts[idx + 1];
  }
  if (kind === "skill") {
    const idx = parts.lastIndexOf("skills");
    if (idx >= 0 && parts[idx + 1]) return parts[idx + 1];
  }
  if (kind === "mcp") {
    const idx = parts.lastIndexOf("mcps");
    if (idx >= 0 && parts[idx + 1]) return parts[idx + 1];
  }
  if (kind === "plugin") {
    const idx = parts.lastIndexOf("plugins");
    if (idx >= 0 && parts[idx + 1]) return parts[idx + 1];
  }
  if (kind === "app") {
    const idx = parts.lastIndexOf("apps");
    if (idx >= 0 && parts[idx + 1]) return parts[idx + 1];
  }
  void kindDir;
  return "community";
}

export function uninstallEcosystemPackage(
  kind: EcosystemPackageKind,
  packageId: string,
  profile?: string,
): InstallResult {
  const cap = readCapabilities().capabilities.find(
    (c) => c.kind === kind && c.id === packageId,
  );
  if (!cap) {
    return { success: false, error: "Package not installed in ecosystem" };
  }

  if (kind === "mcp") {
    const removed = removeMcpServerFromConfig(packageId, profile);
    if (!removed.success) return removed;
  }

  if (kind === "plugin") {
    const publisher = publisherFromCapabilityPath(cap.path, kind);
    const linkId = resolvePluginLinkId(publisher, packageId);
    const unlinked = unlinkEcosystemPlugin(linkId, HERMES_HOME);
    if (!unlinked.success) return unlinked;
  }

  if (cap.path && existsSync(cap.path) && cap.origin !== "local-link") {
    try {
      rmSync(cap.path, { recursive: true, force: true });
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : "Failed to remove files",
      };
    }
  }

  releaseRuntimeForPackage(kind, packageId, cap.runtimeKey);
  removeCapability(kind, packageId);
  return { success: true };
}

export function linkLocalEcosystemPackage(
  kind: EcosystemPackageKind,
  localPath: string,
  opts: { id?: string; name?: string; profile?: string } = {},
): Promise<InstallResult> {
  const abs = resolveLocalPackagePath(localPath);
  const manifest = readPackageManifest(abs);
  const id =
    opts.id?.trim() ||
    (manifest as { id?: string } | null)?.id ||
    abs.replace(/\\/g, "/").split("/").pop() ||
    "local-package";
  const item: RegistryItem = {
    id,
    name: opts.name?.trim() || id,
    description: manifest?.description || "",
    localPath,
  };
  return installEcosystemPackage(kind, item, {
    profile: opts.profile,
    origin: "local-link",
  });
}

export function scanEcosystemSkillDirs(): Array<{
  name: string;
  category: string;
  description: string;
  path: string;
}> {
  const root = ecosystemKindRoot("skills");
  if (!existsSync(root)) return [];
  const out: Array<{
    name: string;
    category: string;
    description: string;
    path: string;
  }> = [];
  try {
    for (const publisher of readdirSync(root)) {
      const pubDir = join(root, publisher);
      if (!statSync(pubDir).isDirectory()) continue;
      for (const pkg of readdirSync(pubDir)) {
        const pkgDir = join(pubDir, pkg);
        if (!statSync(pkgDir).isDirectory()) continue;
        const skillFile = join(pkgDir, "SKILL.md");
        if (!existsSync(skillFile)) continue;
        const content = readFileSync(skillFile, "utf-8").slice(0, 2000);
        const nameMatch = content.match(/^name:\s*(.+)$/m);
        const descMatch = content.match(/^description:\s*(.+)$/m);
        out.push({
          name: nameMatch?.[1]?.trim() || pkg,
          category: publisher,
          description: descMatch?.[1]?.trim() || "",
          path: pkgDir,
        });
      }
    }
  } catch {
    /* ignore */
  }
  return out;
}
