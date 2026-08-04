/**
 * Hermes ecosystem — local install root for user/marketplace packages.
 * Bundled engine skills and desktop-shipped plugins stay outside this tree.
 */

export type EcosystemKind =
  | "skills"
  | "mcps"
  | "agents"
  | "workflows"
  | "plugins"
  | "apps";

/** Singular marketplace / manifest kind. */
export type EcosystemPackageKind =
  | "skill"
  | "mcp"
  | "agent"
  | "workflow"
  | "plugin"
  | "app";

export type CapabilityOrigin = "bundled" | "ecosystem" | "local-link";

export type CapabilityInvocation = "in_process" | "delegate" | "open_ui";

export interface InstalledCapability {
  kind: EcosystemPackageKind;
  id: string;
  name: string;
  publisher?: string;
  version?: string;
  description?: string;
  when_to_use?: string;
  tags?: string[];
  examples?: string[];
  not_for?: string[];
  invocation?: CapabilityInvocation;
  origin: CapabilityOrigin;
  /** Absolute path on disk when origin is ecosystem or local-link. */
  path?: string;
  /** Shared runtime pool key, e.g. `python:abc123`. */
  runtimeKey?: string;
  runtime?: RuntimeKind;
  pricingModel?: "free" | "paid" | "subscription";
}

export interface CapabilitiesFile {
  schema: "hermes.ecosystem/v1";
  capabilities: InstalledCapability[];
}

export interface LocalLinkEntry {
  kind: EcosystemPackageKind;
  id: string;
  path: string;
  linkedAt?: string;
}

export interface LinksFile {
  schema: "hermes.ecosystem/v1";
  links: LocalLinkEntry[];
}

export type RuntimeKind = "python" | "node";

export interface RuntimePoolEntry {
  runtime: RuntimeKind;
  lockHash: string;
  lockFile: string;
  path: string;
  /** Package refs as `kind:id`. */
  refs: string[];
}

export interface RuntimesFile {
  schema: "hermes.ecosystem/v1";
  pools: Record<string, RuntimePoolEntry>;
}

export interface RankedCapability extends InstalledCapability {
  score: number;
}

export const ECOSYSTEM_KINDS: EcosystemKind[] = [
  "skills",
  "mcps",
  "agents",
  "workflows",
  "plugins",
  "apps",
];

export function packageKindToDir(kind: EcosystemPackageKind): EcosystemKind {
  switch (kind) {
    case "skill":
      return "skills";
    case "mcp":
      return "mcps";
    case "agent":
      return "agents";
    case "workflow":
      return "workflows";
    case "plugin":
      return "plugins";
    case "app":
      return "apps";
  }
}

export function registryKindToPackageKind(
  kind: string,
): EcosystemPackageKind | null {
  switch (kind) {
    case "skills":
      return "skill";
    case "mcps":
      return "mcp";
    case "a2aServices":
      return "agent";
    case "workflows":
      return "workflow";
    case "plugins":
      return "plugin";
    case "apps":
      return "app";
    default:
      return null;
  }
}

export function packageKindToRegistryKind(
  kind: EcosystemPackageKind,
): string {
  switch (kind) {
    case "skill":
      return "skills";
    case "mcp":
      return "mcps";
    case "agent":
      return "a2aServices";
    case "workflow":
      return "workflows";
    case "plugin":
      return "plugins";
    case "app":
      return "apps";
  }
}
