import { execFileSync } from "child_process";
import { mkdirSync, writeFileSync, chmodSync } from "fs";
import { join } from "path";
import { app } from "electron";
import type { AcpLaunchInfo, AcpUnavailableReason } from "../shared/acp";
import { isRemoteMode } from "./hermes";
import {
  buildHermesChildEnv,
  getHermesCliSpawnError,
  getHermesPythonSpawnPath,
  hermesCliArgs,
  HERMES_HOME,
  isBundledEngineActive,
} from "./installer";
import { HIDDEN_SUBPROCESS_OPTIONS } from "./process-options";

const IS_WINDOWS = process.platform === "win32";

function acpLauncherDir(): string {
  return join(app.getPath("userData"), "acp");
}

function acpLauncherPath(): string {
  return join(
    acpLauncherDir(),
    IS_WINDOWS ? "hermes-acp.cmd" : "hermes-acp.sh",
  );
}

/** True when Hermes can start in ACP mode (adapter + agent-client-protocol). */
// @lat: [[lat.md/acp-integration#ACP integration#ACP availability]]
export function isAcpModuleInstalled(): boolean {
  const spawnError = getHermesCliSpawnError();
  if (spawnError) return false;
  try {
    execFileSync(
      getHermesPythonSpawnPath(),
      hermesCliArgs(["acp", "--check"]),
      {
        env: buildHermesChildEnv(),
        stdio: "ignore",
        timeout: 15_000,
        ...HIDDEN_SUBPROCESS_OPTIONS,
      },
    );
    return true;
  } catch {
    return false;
  }
}

const ACP_LAUNCHER_ENV_KEYS = [
  "HERMES_HOME",
  "PYTHONPATH",
  "PYTHONUNBUFFERED",
  "HERMES_DESKTOP",
  "HERMES_BUNDLED_RUNTIME",
  "HERMES_PYTHON_SRC_ROOT",
  "PLAYWRIGHT_BROWSERS_PATH",
  "PATH",
  "HOME",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
] as const;

function acpLauncherEnv(): Record<string, string> {
  const full = buildHermesChildEnv();
  const env: Record<string, string> = {};
  for (const key of ACP_LAUNCHER_ENV_KEYS) {
    const value = full[key];
    if (value) env[key] = value;
  }
  return env;
}

function formatEnvForBatch(env: Record<string, string>): string {
  return Object.entries(env)
    .filter(([key]) => key !== "PATH")
    .map(([key, value]) => `set "${key}=${value.replace(/"/g, '""')}"`)
    .join("\r\n");
}

function formatEnvForShell(env: Record<string, string>): string {
  return Object.entries(env)
    .filter(([key]) => key !== "PATH")
    .map(([key, value]) => {
      const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      return `export ${key}="${escaped}"`;
    })
    .join("\n");
}

/** Build the desktop-owned ACP launcher script contents (testable without I/O). */
export function buildAcpLauncherScript(
  command: string,
  args: string[],
  env: Record<string, string>,
): string {
  const quotedCommand = IS_WINDOWS
    ? `"${command.replace(/"/g, '""')}"`
    : `"${command.replace(/"/g, '\\"')}"`;
  const quotedArgs = args.map((arg) =>
    IS_WINDOWS ? `"${arg.replace(/"/g, '""')}"` : `"${arg.replace(/"/g, '\\"')}"`,
  );
  const invocation = [quotedCommand, ...quotedArgs].join(IS_WINDOWS ? " " : " ");

  if (IS_WINDOWS) {
    return (
      "@echo off\r\n" +
      "setlocal\r\n" +
      `${formatEnvForBatch(env)}\r\n` +
      `${invocation}\r\n`
    );
  }

  return (
    "#!/bin/sh\n" +
    "set -eu\n" +
    `${formatEnvForShell(env)}\n` +
    `exec ${invocation}\n`
  );
}

/** Write or refresh the desktop-owned ACP launcher script under userData. */
// @lat: [[lat.md/acp-integration#ACP integration#Launcher script]]
export function ensureAcpLauncherScript(): string {
  const command = getHermesPythonSpawnPath();
  const args = hermesCliArgs(["acp"]);
  const env = acpLauncherEnv();
  const dir = acpLauncherDir();
  mkdirSync(dir, { recursive: true });
  const path = acpLauncherPath();
  writeFileSync(path, buildAcpLauncherScript(command, args, env), "utf-8");
  if (!IS_WINDOWS) {
    try {
      chmodSync(path, 0o755);
    } catch {
      /* best effort */
    }
  }
  return path;
}

function unavailable(reason: AcpUnavailableReason): AcpLaunchInfo {
  const installHint =
    reason === "no_acp_extra"
      ? isBundledEngineActive()
        ? "Re-run `npm run prepare-runtime` in the Hermes Desktop source tree, then restart the app."
        : "Install ACP extras with: pip install 'hermes-agent[acp]'"
      : undefined;
  return { available: false, unavailableReason: reason, installHint };
}

function zedAgentJson(launcherPath: string): string {
  return JSON.stringify(
    {
      agent_servers: {
        Hermes: {
          type: "custom",
          command: launcherPath,
        },
      },
    },
    null,
    2,
  );
}

/** Resolve ACP launch metadata for Settings and IDE copy-paste snippets. */
// @lat: [[lat.md/acp-integration#ACP integration#Launch info IPC]]
export function getAcpLaunchInfo(): AcpLaunchInfo {
  if (isRemoteMode()) {
    return unavailable("remote_mode");
  }

  const spawnError = getHermesCliSpawnError();
  if (spawnError) {
    return { ...unavailable("no_python"), installHint: spawnError };
  }

  if (!isAcpModuleInstalled()) {
    return unavailable("no_acp_extra");
  }

  const command = getHermesPythonSpawnPath();
  const args = hermesCliArgs(["acp"]);
  const env = buildHermesChildEnv();
  const launcherPath = ensureAcpLauncherScript();

  return {
    available: true,
    launcherPath,
    command,
    args,
    env,
    hermesHome: HERMES_HOME,
    zedAgentJson: zedAgentJson(launcherPath),
  };
}

/** Install the upstream `[acp]` extra into the active Hermes Python env. */
export function installAcpExtra(): { ok: boolean; message: string } {
  if (isRemoteMode()) {
    return {
      ok: false,
      message: "ACP requires a local Hermes engine. Switch to local mode first.",
    };
  }
  if (isBundledEngineActive()) {
    return {
      ok: false,
      message:
        "Install ACP extras into the bundled Python with:\n" +
        `\`${getHermesPythonSpawnPath()} -m pip install "hermes-agent[acp]"\`\n` +
        "Then refresh the launcher in Settings → IDE Integration.",
    };
  }
  const spawnError = getHermesCliSpawnError();
  if (spawnError) {
    return { ok: false, message: spawnError };
  }
  try {
    execFileSync(
      getHermesPythonSpawnPath(),
      ["-m", "pip", "install", "hermes-agent[acp]"],
      {
        env: buildHermesChildEnv(),
        stdio: "pipe",
        timeout: 300_000,
        ...HIDDEN_SUBPROCESS_OPTIONS,
      },
    );
    if (!isAcpModuleInstalled()) {
      return {
        ok: false,
        message: "Install finished but the ACP adapter is still missing.",
      };
    }
    ensureAcpLauncherScript();
    return { ok: true, message: "ACP extras installed." };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, message: `Failed to install ACP extras: ${message}` };
  }
}
