/** Why Hermes ACP launch info is unavailable in the desktop app. */
export type AcpUnavailableReason =
  | "remote_mode"
  | "no_python"
  | "no_cli"
  | "no_acp_extra";

/** Launch metadata for IDE clients that spawn Hermes in ACP stdio mode. */
export interface AcpLaunchInfo {
  available: boolean;
  unavailableReason?: AcpUnavailableReason;
  /** Absolute path to a desktop-generated launcher script IDEs should spawn. */
  launcherPath?: string;
  /** Hermes Python interpreter used by the launcher. */
  command?: string;
  /** CLI args after the interpreter (e.g. `-m hermes_cli.main acp`). */
  args?: string[];
  /** Child-process env merged into IDE agent config when not using the script. */
  env?: Record<string, string>;
  hermesHome?: string;
  /** Copy-paste Zed external-agent JSON using `launcherPath`. */
  zedAgentJson?: string;
  /** Hint shown when ACP extras are missing from a traditional install. */
  installHint?: string;
}
