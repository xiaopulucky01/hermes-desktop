/** Manifest shipped inside a downloadable or linkable A2A agent service package. */

export interface AgentServiceA2aConfig {
  default_port?: number;
  port_range?: [number, number];
  card_paths?: string[];
  health_path?: string;
  auth?: {
    type?: string;
    token_env?: string;
  };
}

export interface AgentServicePythonConfig {
  /**
   * Package-local venv dir (default `.venv`), or `"shared"` for multi-agent
   * shared-venv under agent-services (not Hermes resources/python).
   */
  venv?: string;
  /** Prefer shared multi-agent venv (same as venv: "shared"). */
  shared_venv?: boolean;
  /** Who creates the venv: hermes bundled python (default). */
  bootstrap?: "hermes";
  requires?: string;
}

export type AgentServiceUiType = "none" | "webview" | "static";

export interface AgentServiceUiConfig {
  type?: AgentServiceUiType;
  /** URL template; `${PORT}` is replaced at runtime. */
  url?: string;
  /** Relative path for static UI (type=static). */
  path?: string;
  title?: string;
}

export interface AgentServiceSkillHint {
  id: string;
  description: string;
}

export interface AgentServiceManifest {
  id: string;
  version: string;
  name: string;
  description?: string;
  runtime?: "python";
  python?: AgentServicePythonConfig;
  install?: {
    archive_url?: string;
    sha256?: string;
    /**
     * Commands run after extract/copy. Prefixes:
     * - `bootstrap:python …` → Hermes bundled Python (venv creation only)
     * - `shared:ensure-venv` / `shared:python …` → multi-agent shared-venv
     * - `venv:python …` → package-local `.venv` (isolation escape hatch)
     * Bare `python` is treated as bootstrap for backward compatibility during install.
     */
    post_install?: string[];
  };
  entrypoint: {
    /**
     * Prefer `["shared:python", "-m", "app.server"]` (multi-agent shared env)
     * or `["venv:python", …]` for an isolated package venv.
     */
    command: string[];
    cwd?: string;
  };
  a2a?: AgentServiceA2aConfig;
  ui?: AgentServiceUiConfig;
  skills_hint?: AgentServiceSkillHint[];
}

export interface AgentServiceState {
  status: "stopped" | "starting" | "running" | "error";
  pid?: number;
  port?: number;
  base_url?: string;
  card_url?: string;
  started_at?: string;
  last_error?: string | null;
  /** Dev link mode — run entrypoint from this directory instead of installed copy. */
  link_path?: string;
}

export interface AgentServiceCatalogEntry {
  id: string;
  version: string;
  name: string;
  enabled: boolean;
  port?: number;
  base_url?: string;
  status?: AgentServiceState["status"];
}

export interface AgentServiceCatalog {
  agents: AgentServiceCatalogEntry[];
}

export interface AgentServiceInstallResult {
  success: boolean;
  error?: string;
  id?: string;
}

export interface AgentServiceStatus {
  id: string;
  name: string;
  version: string;
  description?: string;
  enabled: boolean;
  status: AgentServiceState["status"];
  port?: number;
  base_url?: string;
  card_url?: string;
  last_error?: string | null;
  link_path?: string;
  ui?: AgentServiceUiConfig;
  has_venv?: boolean;
}

export interface AgentServiceStartResult {
  success: boolean;
  error?: string;
  port?: number;
  base_url?: string;
  card_url?: string;
}
