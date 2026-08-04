/**
 * Shared types for the Discover marketplace catalog.
 * Prefer hermes-marketplace (`HERMES_CATALOG_BASE_URL`); GitHub registry is fallback.
 */

export type RegistryKind =
  | "skills"
  | "mcps"
  | "agents"
  | "workflows"
  | "a2aServices"
  | "plugins"
  | "apps";

export interface RegistryItem {
  /** Stable identifier, unique within its kind. */
  id: string;
  name: string;
  description: string;
  author?: string;
  category?: string;
  tags?: string[];
  homepage?: string;
  version?: string;
  license?: string;
  platforms?: string[];
  /** Folder for this entry within a git-backed registry (legacy). */
  path?: string;
  /** Bundled skills only: install identifier for `hermes skills install`. */
  source?: string;
  /** Direct archive download URL. */
  archiveUrl?: string;
  /** Expected sha256 of the archive. */
  archiveSha256?: string;
  /** GitHub repo `owner/name`. */
  githubRepo?: string;
  /** Git ref (branch/tag/sha). */
  githubRef?: string;
  /** Subdirectory inside the repo/zip. */
  githubPath?: string;
  /** Local filesystem path (dev catalog / link). */
  localPath?: string;
  /** Absolute URL of the entry's icon. */
  icon?: string;
  /** Routing hint from marketplace. */
  when_to_use?: string;
  invocation?: "in_process" | "delegate" | "open_ui";
  /** Marketplace pricing; paid installs require entitlement. */
  pricing?: {
    model: "free" | "paid" | "subscription";
    priceId?: string;
  };
}

export interface RegistryCatalog {
  skills: RegistryItem[];
  mcps: RegistryItem[];
  agents: RegistryItem[];
  workflows: RegistryItem[];
  a2aServices: RegistryItem[];
  plugins: RegistryItem[];
  apps: RegistryItem[];
}

export interface InstalledRegistry {
  skills: string[];
  mcps: string[];
  workflows: string[];
  a2aServices: string[];
  plugins: string[];
  apps: string[];
}

/** One labeled row in a structured (non-prose) detail view. */
export interface RegistryDetailRow {
  label: string;
  /** Plain or monospace value. */
  value?: string;
  mono?: boolean;
  /** Pill chips (e.g. tags, env keys, permissions). */
  chips?: string[];
}

/**
 * Detail shown in the item modal: either a prose doc (markdown) or a
 * structured spec (lead paragraph + labeled rows) for manifest-only entries.
 */
export interface RegistryDetail {
  markdown?: string;
  description?: string;
  rows?: RegistryDetailRow[];
}

/**
 * Model registry (models.json) types. Served from the hermes-registry repo and
 * consumed by the Models screen to let users pick curated models.
 */
export interface RegistryModel {
  name: string;
  label?: string;
  description?: string;
  context?: number;
  maxOutput?: number;
  modalities?: { input?: string[]; output?: string[] };
  capabilities?: string[];
}

export interface RegistryModelProvider {
  id: string;
  name: string;
  description?: string;
  homepage?: string;
  docs?: string;
  apiBase?: string;
  envKey?: string;
  models: RegistryModel[];
}

export interface ModelRegistry {
  schemaVersion?: string;
  generated?: string;
  providerCount?: number;
  modelCount?: number;
  providers: RegistryModelProvider[];
  error?: string;
}
