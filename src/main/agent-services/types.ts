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

export interface AgentServiceManifest {
  id: string;
  version: string;
  name: string;
  runtime?: "python";
  install?: {
    archive_url?: string;
    sha256?: string;
    post_install?: string[];
  };
  entrypoint: {
    command: string[];
    cwd?: string;
  };
  a2a?: AgentServiceA2aConfig;
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
  enabled: boolean;
  status: AgentServiceState["status"];
  port?: number;
  base_url?: string;
  card_url?: string;
  last_error?: string | null;
  link_path?: string;
}

export interface AgentServiceStartResult {
  success: boolean;
  error?: string;
  port?: number;
  base_url?: string;
  card_url?: string;
}
