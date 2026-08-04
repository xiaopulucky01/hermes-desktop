import { existsSync, readFileSync } from "fs";
import { join, resolve } from "path";
import { safeWriteFile } from "./utils";
import { installSkill, listInstalledSkills, uninstallSkill } from "./skills";
import { createProfile } from "./profiles";
import { writeSoul } from "./soul";
import { listMcpServers } from "./installer";
import {
  installAgentServiceFromArchive,
  installAgentServiceFromGitHub,
  installAgentServiceFromPath,
  listInstalledAgentIds,
  startAgentService,
} from "./agent-services";
import { scanLocalA2aAgentCatalog } from "./agent-services/local-catalog";
import { scanLocalAppCatalog } from "./ecosystem/apps-catalog";
import {
  installEcosystemPackage,
  listInstalledEcosystemIds,
  linkLocalEcosystemPackage,
  uninstallEcosystemPackage,
} from "./ecosystem/installer";
import { registryKindToPackageKind } from "../shared/ecosystem";
import type {
  RegistryKind,
  RegistryItem,
  RegistryCatalog,
  InstalledRegistry,
  RegistryDetail,
  RegistryDetailRow,
  ModelRegistry,
} from "../shared/registry";

export type {
  RegistryKind,
  RegistryItem,
  RegistryCatalog,
} from "../shared/registry";

/**
 * Discover catalog: prefer hermes-marketplace (`HERMES_CATALOG_BASE_URL`),
 * fall back to the public GitHub hermes-registry mirror.
 *
 * `index.json` is a flat list of entries, each with a `type`
 * (agent|mcp|skill|workflow|plugin|app|a2a-service). "Set up" actions install
 * into hermes-ecosystem (agents) or the active profile (legacy skill/mcp/workflow).
 */
const REGISTRY_REPO = "fathah/hermes-registry";
const REGISTRY_BRANCH = "main";
const REGISTRY_RAW_BASE = `https://raw.githubusercontent.com/${REGISTRY_REPO}/refs/heads/${REGISTRY_BRANCH}`;
const REGISTRY_REPO_BASE = `https://github.com/${REGISTRY_REPO}/tree/${REGISTRY_BRANCH}`;
// Icons are served by the registry web service (from its DB), not raw GitHub —
// e.g. https://registry.hermesone.org/registry-icon/mcp/aws/icon.svg.
const REGISTRY_ICON_BASE = "https://registry.hermesone.org/registry-icon";

/** Catalog API base (marketplace). Empty → GitHub raw fallback. */
function catalogBaseUrl(): string {
  return (
    process.env.HERMES_CATALOG_BASE_URL?.trim() ||
    process.env.MAIN_VITE_HERMES_CATALOG_BASE_URL?.trim() ||
    ""
  ).replace(/\/$/, "");
}

/** URL for Discover "Open Registry" — marketplace root or GitHub registry. */
export function getCatalogOpenUrl(): string {
  const base = catalogBaseUrl();
  if (base) return base;
  return `https://github.com/${REGISTRY_REPO}`;
}

function indexUrl(): string {
  const base = catalogBaseUrl();
  if (base) return `${base}/index.json`;
  return `${REGISTRY_RAW_BASE}/index.json`;
}

const MODELS_URL = `${REGISTRY_RAW_BASE}/models.json`;
const TREE_URL = `https://api.github.com/repos/${REGISTRY_REPO}/git/trees/${REGISTRY_BRANCH}?recursive=1`;

/** index.json entry shape. */
interface IndexEntry {
  id: string;
  type:
    | "agent"
    | "mcp"
    | "skill"
    | "workflow"
    | "a2a-service"
    | "plugin"
    | "app";
  category?: string;
  name: string;
  version?: string;
  description?: string;
  tags?: string[];
  author?: string | { name?: string };
  license?: string;
  platforms?: string[];
  path?: string;
  archiveUrl?: string;
  archive_url?: string;
  archiveSha256?: string;
  sha256?: string;
  githubRepo?: string;
  github?: { repo?: string; ref?: string; path?: string };
  githubRef?: string;
  githubPath?: string;
  localPath?: string;
  local_path?: string;
  /** Repo-relative path to the entry's icon, e.g. "mcp/ableton/icon.svg". */
  icon?: string;
  when_to_use?: string;
  invocation?: "in_process" | "delegate" | "open_ui";
  pricing?: {
    model: "free" | "paid" | "subscription";
    priceId?: string;
  };
}

/** Per-entry manifest.json (mcp / agent / workflow / a2a-service). */
interface EntryManifest {
  description?: string;
  // Matches the engine's accepted transports. "sse" must be preserved in the
  // written config — the engine only selects its SSE client when it sees it.
  transport?: "stdio" | "http" | "sse";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  permissions?: string[];
  entry?: string;
  requires?: string[];
  model?: string;
  tools?: string[];
  license?: string;
  compatibility?: { hermes?: string; desktop?: string } | null;
}

const TYPE_TO_KIND: Record<IndexEntry["type"], RegistryKind> = {
  skill: "skills",
  mcp: "mcps",
  // Marketplace / legacy "agent" means installable A2A agent package.
  agent: "a2aServices",
  workflow: "workflows",
  "a2a-service": "a2aServices",
  plugin: "plugins",
  app: "apps",
};

// Short-lived cache so flipping between Discover sub-tabs doesn't refetch.
// Covers the raw.githubusercontent fetches (index + models), which are
// CDN-backed and not subject to the api.github.com rate limit — so this stays
// short to keep the catalog/model list fresh. The rate-limited git-tree fetch
// caches separately for far longer (see TREE_CACHE_TTL_MS).
let cache: { at: number; data: RegistryCatalog } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min

function authorName(author: IndexEntry["author"]): string | undefined {
  if (!author) return undefined;
  return typeof author === "string" ? author : author.name;
}

function toItem(e: IndexEntry): RegistryItem {
  const gh = e.github;
  return {
    id: e.id,
    name: e.name || e.id,
    description: e.description || "",
    author: authorName(e.author),
    category: e.category,
    tags: e.tags,
    version: e.version,
    license: e.license,
    platforms: e.platforms,
    path: e.path,
    homepage: e.path ? `${REGISTRY_REPO_BASE}/${e.path}` : undefined,
    archiveUrl: e.archiveUrl || e.archive_url,
    archiveSha256: e.archiveSha256 || e.sha256,
    githubRepo: e.githubRepo || gh?.repo,
    githubRef: e.githubRef || gh?.ref || "main",
    githubPath: e.githubPath || gh?.path,
    localPath: e.localPath || e.local_path,
    // Resolve the repo-relative icon path to the registry service's icon URL,
    // loaded as an <img> on a white tile — see the registry web UI's EntryIcon.
    icon: e.icon
      ? e.icon.startsWith("http")
        ? e.icon
        : `${REGISTRY_ICON_BASE}/${e.icon}`
      : undefined,
    when_to_use: e.when_to_use,
    invocation: e.invocation,
    pricing: e.pricing,
  };
}

function emptyCatalog(): RegistryCatalog {
  return {
    skills: [],
    mcps: [],
    agents: [],
    workflows: [],
    a2aServices: [],
    plugins: [],
    apps: [],
  };
}

function mergeCatalog(into: RegistryCatalog, from: RegistryCatalog): void {
  for (const kind of Object.keys(into) as RegistryKind[]) {
    const existing = new Set(into[kind].map((i) => i.id));
    for (const item of from[kind]) {
      if (!existing.has(item.id)) into[kind].push(item);
    }
  }
}

function loadBundledA2aCatalog(): RegistryCatalog {
  const data = emptyCatalog();
  const candidates = [
    join(__dirname, "../../resources/a2a-services-catalog.json"),
    join(process.cwd(), "resources/a2a-services-catalog.json"),
  ];
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    try {
      const raw = JSON.parse(readFileSync(file, "utf-8")) as {
        entries?: IndexEntry[];
      };
      for (const entry of raw.entries ?? []) {
        if (entry.type !== "a2a-service" || !entry.id) continue;
        data.a2aServices.push(toItem(entry));
      }
      break;
    } catch {
      /* ignore */
    }
  }
  return data;
}

/** Auto-discover A2A packages under hermes-ecosystem/agents/packages/. */
function loadScannedLocalA2aCatalog(): RegistryCatalog {
  const data = emptyCatalog();
  for (const entry of scanLocalA2aAgentCatalog()) {
    data.a2aServices.push(toItem(entry as IndexEntry));
  }
  return data;
}

/** Auto-discover OSS apps under hermes-ecosystem/apps/. */
function loadScannedLocalAppCatalog(): RegistryCatalog {
  const data = emptyCatalog();
  for (const entry of scanLocalAppCatalog()) {
    data.apps.push(
      toItem({
        ...entry,
        type: "app",
        when_to_use: entry.description,
        invocation: "open_ui",
      } as IndexEntry),
    );
  }
  return data;
}

/** Bundled overrides + filesystem scan of ecosystem agents/apps. */
function loadDevLocalCatalog(): RegistryCatalog {
  const data = emptyCatalog();
  mergeCatalog(data, loadBundledA2aCatalog());
  mergeCatalog(data, loadScannedLocalA2aCatalog());
  mergeCatalog(data, loadScannedLocalAppCatalog());
  return data;
}

/**
 * Fetch and normalise the community catalog. Network/parse failures resolve to
 * an empty catalog (with `error` set) rather than throwing, so the screen can
 * render an empty state instead of crashing.
 */
export async function fetchRegistry(
  force = false,
): Promise<RegistryCatalog & { error?: string }> {
  if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.data;
  }
  try {
    const res = await fetch(indexUrl(), {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      return {
        ...loadDevLocalCatalog(),
        error: `Registry returned ${res.status}`,
      };
    }
    const raw = (await res.json()) as { entries?: IndexEntry[] };
    const data: RegistryCatalog = emptyCatalog();
    for (const entry of raw.entries ?? []) {
      const kind = TYPE_TO_KIND[entry.type];
      if (kind && entry.id) data[kind].push(toItem(entry));
    }
    mergeCatalog(data, loadDevLocalCatalog());
    cache = { at: Date.now(), data };
    return data;
  } catch (err) {
    return {
      ...loadDevLocalCatalog(),
      error: err instanceof Error ? err.message : "Failed to load registry",
    };
  }
}

// Short-lived cache for the model catalog (models.json).
let modelCache: { at: number; data: ModelRegistry } | null = null;

/**
 * Fetch the curated model catalog (models.json) from the registry. Network /
 * parse failures resolve to an empty provider list (with `error` set) so the
 * Models screen can render a graceful empty state.
 */
export async function fetchModelRegistry(
  force = false,
): Promise<ModelRegistry> {
  if (!force && modelCache && Date.now() - modelCache.at < CACHE_TTL_MS) {
    return modelCache.data;
  }
  try {
    const res = await fetch(MODELS_URL, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      return { providers: [], error: `Registry returned ${res.status}` };
    }
    const raw = (await res.json()) as ModelRegistry;
    const data: ModelRegistry = {
      schemaVersion: raw.schemaVersion,
      generated: raw.generated,
      providerCount: raw.providerCount,
      modelCount: raw.modelCount,
      providers: Array.isArray(raw.providers) ? raw.providers : [],
    };
    modelCache = { at: Date.now(), data };
    return data;
  } catch (err) {
    return {
      providers: [],
      error: err instanceof Error ? err.message : "Failed to load models",
    };
  }
}

/**
 * Names already present in the active profile, per kind, so the UI can mark
 * catalog items as "Installed".
 */
export function listInstalledRegistry(profile?: string): InstalledRegistry {
  let skills: string[] = [];
  let mcps: string[] = [];
  let workflows: string[] = [];
  let a2aServices: string[] = [];
  try {
    skills = listInstalledSkills(profile).map((s) => s.name);
  } catch {
    /* ignore */
  }
  try {
    mcps = listMcpServers(profile).map((s) => s.name);
  } catch {
    /* ignore */
  }
  try {
    a2aServices = listInstalledAgentIds();
  } catch {
    /* ignore */
  }
  try {
    workflows = listInstalledEcosystemIds("workflow");
    const plugins = listInstalledEcosystemIds("plugin");
    // Apps already under hermes-ecosystem/apps count as present (OSS checkouts).
    const apps = [
      ...listInstalledEcosystemIds("app"),
      ...scanLocalAppCatalog().map((a) => a.id),
    ];
    const ecoSkills = listInstalledEcosystemIds("skill");
    const ecoMcps = listInstalledEcosystemIds("mcp");
    skills = [...new Set([...skills, ...ecoSkills])];
    mcps = [...new Set([...mcps, ...ecoMcps])];
    return {
      skills,
      mcps,
      workflows,
      a2aServices,
      plugins,
      apps: [...new Set(apps)],
    };
  } catch {
    return { skills, mcps, workflows, a2aServices, plugins: [], apps: [] };
  }
}

export interface InstallResult {
  success: boolean;
  error?: string;
  /** Machine-readable reason for UI (e.g. open sign-in modal). */
  code?: "needs_sign_in" | "needs_entitlement" | "checkout_failed";
}

async function tryFetchText(path: string): Promise<string> {
  try {
    const res = await fetch(`${REGISTRY_RAW_BASE}/${path}`);
    if (!res.ok) return "";
    const text = await res.text();
    return text.trim() ? text : "";
  } catch {
    return "";
  }
}

/** Build a structured spec (lead + labeled rows) from an entry's manifest. */
function buildSpec(
  kind: RegistryKind,
  item: RegistryItem,
  m: EntryManifest | null,
): RegistryDetail {
  const rows: RegistryDetailRow[] = [];

  if (kind === "mcps" && m) {
    rows.push({
      label: "Transport",
      value: m.transport || (m.url ? "http" : "stdio"),
    });
    if (m.url) rows.push({ label: "URL", value: m.url, mono: true });
    if (m.command) {
      rows.push({
        label: "Command",
        value: [m.command, ...(m.args ?? [])].join(" "),
        mono: true,
      });
    }
    if (m.env && Object.keys(m.env).length) {
      rows.push({ label: "Environment", chips: Object.keys(m.env) });
    }
    if (m.permissions?.length) {
      rows.push({ label: "Permissions", chips: m.permissions });
    }
  } else if (kind === "agents" && m) {
    if (m.model) rows.push({ label: "Model", value: m.model, mono: true });
    if (m.tools?.length) rows.push({ label: "Tools", chips: m.tools });
  } else if (kind === "a2aServices") {
    if (item.localPath) {
      rows.push({ label: "Local path", value: item.localPath, mono: true });
    }
    if (item.archiveUrl) {
      rows.push({ label: "Archive", value: item.archiveUrl, mono: true });
    }
    if (item.githubRepo) {
      rows.push({
        label: "GitHub",
        value: `${item.githubRepo}@${item.githubRef || "main"}${item.githubPath ? `:${item.githubPath}` : ""}`,
        mono: true,
      });
    }
  } else if (kind === "workflows" && m) {
    if (m.entry) rows.push({ label: "Entry", value: m.entry, mono: true });
    if (m.requires?.length) rows.push({ label: "Requires", chips: m.requires });
  }

  if (item.category) rows.push({ label: "Category", value: item.category });
  if (item.platforms?.length) {
    rows.push({ label: "Platforms", chips: item.platforms });
  }
  if (item.tags?.length) rows.push({ label: "Tags", chips: item.tags });
  const license = m?.license || item.license;
  if (license) rows.push({ label: "License", value: license });
  if (item.author) rows.push({ label: "Author", value: item.author });
  if (item.version) rows.push({ label: "Version", value: item.version });
  const compat = m?.compatibility;
  if (compat?.hermes) {
    rows.push({ label: "Requires Hermes", value: compat.hermes, mono: true });
  }

  return { description: m?.description || item.description || "", rows };
}

/**
 * Detail for an item's modal. For skills, the prose doc (SKILL.md/README) is
 * the content. For mcp/agent/workflow we always build the structured spec from
 * the manifest and attach a prose doc (AGENT.md/README) as extra context when
 * present — so the modal is never just a one-line description.
 */
export async function fetchRegistryDetail(
  kind: RegistryKind,
  item: RegistryItem,
): Promise<RegistryDetail> {
  if (kind === "a2aServices" && !item.path) {
    return buildSpec(kind, item, null);
  }
  if (!item.path) return { description: item.description || "" };

  if (kind === "skills") {
    for (const file of ["SKILL.md", "README.md"]) {
      const text = await tryFetchText(`${item.path}/${file}`);
      if (text) return { markdown: text };
    }
    return { description: item.description || "" };
  }

  const m = await fetchManifest(item.path);
  const detail = buildSpec(kind, item, m);
  const docFile = kind === "agents" ? "AGENT.md" : "README.md";
  const doc = await tryFetchText(`${item.path}/${docFile}`);
  if (doc) detail.markdown = doc;
  return detail;
}

async function fetchManifest(path: string): Promise<EntryManifest | null> {
  try {
    const res = await fetch(`${REGISTRY_RAW_BASE}/${path}/manifest.json`);
    if (!res.ok) return null;
    return (await res.json()) as EntryManifest;
  } catch {
    return null;
  }
}

/** One blob in the repo's recursive git tree. */
interface TreeBlob {
  path: string;
  type: string;
}
let treeCache: { at: number; blobs: TreeBlob[] } | null = null;
// The recursive git tree is fetched from api.github.com, which rate-limits
// anonymous callers at 60 req/h (token auth below raises that ceiling). Cache
// it far longer than the CDN-backed raw fetches to keep that pressure low.
const TREE_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

/** All file paths under a folder, via the cached recursive git tree. */
async function listFolderFiles(folder: string): Promise<string[]> {
  if (!treeCache || Date.now() - treeCache.at >= TREE_CACHE_TTL_MS) {
    // Use GITHUB_TOKEN / GH_TOKEN when available to avoid anonymous
    // rate limits (60 req/h) on api.github.com.  Authenticated requests
    // get 5 000 req/h instead.
    const ghToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
    };
    if (ghToken) headers.Authorization = `Bearer ${ghToken}`;
    const res = await fetch(TREE_URL, { headers });
    if (!res.ok) throw new Error(`Tree fetch failed (${res.status})`);
    const json = (await res.json()) as { tree?: TreeBlob[] };
    treeCache = { at: Date.now(), blobs: json.tree ?? [] };
  }
  const prefix = `${folder}/`;
  return treeCache.blobs
    .filter((b) => b.type === "blob" && b.path.startsWith(prefix))
    .map((b) => b.path);
}

/** Download every file under an entry's repo folder into a local directory. */
async function downloadFolder(
  repoFolder: string,
  destDir: string,
): Promise<InstallResult> {
  const files = await listFolderFiles(repoFolder);
  if (files.length === 0) {
    return { success: false, error: "No files found for this entry" };
  }
  for (const file of files) {
    const rel = file.slice(repoFolder.length + 1);
    const res = await fetch(`${REGISTRY_RAW_BASE}/${file}`);
    if (!res.ok) return { success: false, error: `Fetch failed: ${rel}` };
    const body = await res.text();
    safeWriteFile(join(destDir, rel), body);
  }
  return { success: true };
}

/**
 * Install a registry agent as a new profile. Cloning alone copies the default
 * persona, so the imported agent looked identical to default — the bug. We
 * fetch the agent's entry markdown (AGENT.md per the manifest) from the
 * registry and write it as the new profile's SOUL.md so the persona reflects
 * the published agent.
 */
async function installAgent(item: RegistryItem): Promise<InstallResult> {
  const created = createProfile(item.id, "default");
  if (!created.success) return created;
  if (item.path) {
    const m = await fetchManifest(item.path);
    const entry = m?.entry || "AGENT.md";
    const md = await tryFetchText(`${item.path}/${entry}`);
    if (md && !writeSoul(md, item.id)) {
      return {
        success: false,
        error: "Failed to write agent persona (SOUL.md)",
      };
    }
  }
  return { success: true };
}

/**
 * Install/"set up" a catalog item.
 *   - skill/mcp/workflow/plugin/app → hermes-ecosystem (bundled skills without path still use CLI → profile)
 *   - agent (legacy) → clone profile + SOUL
 *   - a2aServices → ecosystem/agents + start
 */
export async function installRegistryItem(
  kind: RegistryKind,
  item: RegistryItem,
  profile?: string,
): Promise<InstallResult> {
  try {
    const {
      checkInstallEntitlement,
      purchaseRegistryItem,
      resolveAccountId,
    } = await import("./ecosystem/entitlements");

    let entitlement = await checkInstallEntitlement(item, {
      localLink: !!item.localPath,
      profile,
    });

    // Paid package without entitlement: attempt stub checkout when signed in.
    if (
      !entitlement.allowed &&
      (item.pricing?.model === "paid" ||
        item.pricing?.model === "subscription") &&
      !item.localPath
    ) {
      const purchased = await purchaseRegistryItem(item, { profile });
      if (!purchased.success) {
        return {
          success: false,
          code: purchased.code || "needs_entitlement",
          error:
            purchased.error ||
            entitlement.reason ||
            `Entitlement required to install paid package "${item.id}"`,
        };
      }
      entitlement = await checkInstallEntitlement(item, {
        localLink: false,
        profile,
      });
    }

    if (!entitlement.allowed) {
      const needsSignIn =
        /sign in|account required/i.test(entitlement.reason || "") ||
        !resolveAccountId(profile);
      return {
        success: false,
        code: needsSignIn ? "needs_sign_in" : "needs_entitlement",
        error:
          entitlement.reason ||
          `Entitlement required to install paid package "${item.id}"`,
      };
    }

    if (kind === "agents") return await installAgent(item);
    if (kind === "a2aServices") return await installA2aService(item);

    const pkgKind = registryKindToPackageKind(kind);
    if (!pkgKind) {
      return { success: false, error: "Unknown item kind" };
    }

    if (
      kind === "skills" &&
      item.source &&
      !item.path &&
      !item.archiveUrl &&
      !item.githubRepo &&
      !item.localPath
    ) {
      return installSkill(item.source || item.id, profile);
    }

    const installed = await installEcosystemPackage(pkgKind, item, {
      profile,
      listRegistryFolderFiles: listFolderFiles,
      registryRawBase: REGISTRY_RAW_BASE,
    });
    if (installed.success && kind === "apps") {
      try {
        const { startEcosystemApp } = await import("./ecosystem/apps-launcher");
        const started = startEcosystemApp(item.id);
        if (!started.success) {
          return {
            success: true,
            error: started.error
              ? `Installed, but start failed: ${started.error}`
              : undefined,
          };
        }
      } catch {
        /* start is best-effort */
      }
    }
    return installed;
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Install failed",
    };
  }
}

/** Remove an installed Discover item (ecosystem kinds + MCP config). */
export async function uninstallRegistryItem(
  kind: RegistryKind,
  item: RegistryItem,
  profile?: string,
): Promise<InstallResult> {
  const pkgKind = registryKindToPackageKind(kind);
  if (kind === "skills") {
    const eco = uninstallEcosystemPackage("skill", item.id, profile);
    if (eco.success) return eco;
    const byName = uninstallSkill(item.name, profile);
    if (byName.success) return byName;
    return uninstallSkill(item.id, profile);
  }
  if (pkgKind && kind !== "a2aServices" && kind !== "agents") {
    return uninstallEcosystemPackage(pkgKind, item.id, profile);
  }
  if (kind === "a2aServices") {
    const { stopAgentService } = await import("./agent-services");
    const stopped = stopAgentService(item.id);
    if (!stopped.success) {
      return { success: false, error: stopped.error || "Failed to stop agent" };
    }
    const { agentServiceInstalledDir } = await import("./agent-services/paths");
    const { rmSync } = await import("fs");
    try {
      rmSync(agentServiceInstalledDir(item.id), { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    const { removeCapability } = await import("./ecosystem/capabilities");
    removeCapability("agent", item.id);
    return { success: true };
  }
  return { success: false, error: "Uninstall not supported for this kind" };
}

export { linkLocalEcosystemPackage };

/**
 * Resolve catalog `localPath`. Prefer absolute ecosystem paths; relative
 * paths are tried against the desktop app root and cwd.
 */
function resolveA2aLocalPath(localPath: string): string {
  const trimmed = localPath.trim();
  if (trimmed.match(/^[a-zA-Z]:[\\/]/) || trimmed.startsWith("/")) {
    return trimmed;
  }
  // Bundled catalog paths are relative to hermes-desktop (not HERMES_HOME).
  const bases = [
    join(__dirname, "../.."), // out/main → project root (dev / electron-vite)
    process.cwd(),
    join(__dirname, "../../.."),
  ];
  for (const base of bases) {
    const candidate = resolve(base, trimmed);
    if (existsSync(candidate)) return candidate;
  }
  return resolve(bases[0] || process.cwd(), trimmed);
}

/** Install an A2A service from local path, archive URL, GitHub, or registry folder. */
async function installA2aService(item: RegistryItem): Promise<InstallResult> {
  // @lat: [[lat.md/agent-services#Agent services#Discover catalog#Install A2A service]]
  let installed: { success: boolean; error?: string; id?: string };

  if (item.localPath?.trim()) {
    const catalogPath = item.localPath.trim();
    const source = resolveA2aLocalPath(catalogPath);
    if (!existsSync(source)) {
      return {
        success: false,
        error: `Source path not found for catalog localPath "${catalogPath}" (resolved: ${source}). Update resources/a2a-services-catalog.json after moving an agent.`,
      };
    }
    installed = await installAgentServiceFromPath(source, { link: true });
  } else if (item.archiveUrl?.trim()) {
    installed = await installAgentServiceFromArchive(item.archiveUrl.trim(), {
      expectedId: item.id,
      expectedSha256: item.archiveSha256,
    });
  } else if (item.githubRepo?.trim()) {
    installed = await installAgentServiceFromGitHub(
      item.githubRepo.trim(),
      item.githubRef || "main",
      item.githubPath,
      item.id,
    );
  } else if (item.path?.trim()) {
    const { agentServicesCacheDir } = await import("./agent-services/paths");
    const dest = join(agentServicesCacheDir(), `registry-${item.id}`);
    const downloaded = await downloadFolder(item.path, dest);
    if (!downloaded.success) return downloaded;
    installed = await installAgentServiceFromPath(dest);
  } else {
    return {
      success: false,
      error: "A2A service entry has no localPath, archiveUrl, githubRepo, or path",
    };
  }

  if (!installed.success || !installed.id) {
    return { success: false, error: installed.error || "Install failed" };
  }

  const started = await startAgentService(installed.id);
  if (!started.success) {
    return {
      success: false,
      error: `Installed but start failed: ${started.error}`,
    };
  }
  return { success: true };
}
