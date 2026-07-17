import { spawn, type ChildProcess } from "child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
} from "fs";
import { join } from "path";
import { bootstrapAgentServiceA2a } from "./bootstrap-a2a";
import {
  readAllStates,
  readCatalog,
  readManifest,
  readState,
  upsertCatalogEntry,
  writeState,
} from "./catalog";
import { getAgentServiceWorkDir } from "./installer";
import {
  agentServiceEnvPath,
  agentServiceLogsDir,
} from "./paths";
import {
  allocateAgentServicePort,
  collectClaimedPorts,
} from "./port-manager";
import type { AgentServiceStartResult, AgentServiceState } from "./types";
import { getEnhancedPath, getHermesPythonSpawnPath, HERMES_HOME } from "../installer";
import { HIDDEN_SUBPROCESS_OPTIONS } from "../process-options";

const processes = new Map<string, ChildProcess>();

function parseEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return out;
}

function resolveCommand(command: string[]): { cmd: string; args: string[] } {
  if (!command.length) throw new Error("Empty entrypoint.command");
  let cmd = command[0];
  const args = command.slice(1);
  if (cmd === "python" || cmd === "python3") {
    cmd = getHermesPythonSpawnPath();
  }
  return { cmd, args };
}

function readServiceAuthToken(id: string, tokenEnv: string): string | undefined {
  const local = parseEnvFile(agentServiceEnvPath(id))[tokenEnv];
  if (local) return local;
  return process.env[tokenEnv];
}

export function isAgentServiceRunning(id: string): boolean {
  const proc = processes.get(id);
  return !!proc && proc.exitCode === null && !proc.killed;
}

export async function startAgentService(id: string): Promise<AgentServiceStartResult> {
  // @lat: [[lat.md/agent-services#Agent services#Supervisor#Start agent service]]
  const manifest = readManifest(id);
  if (!manifest) {
    return { success: false, error: `Agent service "${id}" is not installed` };
  }

  if (isAgentServiceRunning(id)) {
    const state = readState(id);
    return {
      success: true,
      port: state.port,
      base_url: state.base_url,
      card_url: state.card_url,
    };
  }

  const workDir = getAgentServiceWorkDir(id);
  if (!workDir) {
    return { success: false, error: `Work directory missing for "${id}"` };
  }

  const prior = readState(id);
  writeState(id, {
    ...prior,
    status: "starting",
    last_error: null,
  });

  try {
    const claimed = collectClaimedPorts(readAllStates(), prior.port);
    const port = await allocateAgentServicePort(manifest, {
      previousPort: prior.port,
      claimedPorts: claimed,
    });
    const host = "127.0.0.1";
    const baseUrl = `http://${host}:${port}`;
    const tokenEnv = manifest.a2a?.auth?.token_env || "AUTH_TOKEN";
    const authToken = readServiceAuthToken(id, tokenEnv);

    mkdirSync(agentServiceLogsDir(id), { recursive: true });
    const logPath = join(agentServiceLogsDir(id), "stdout.log");
    const { cmd, args } = resolveCommand(manifest.entrypoint.command);
    const cwd = join(workDir, manifest.entrypoint.cwd || ".");

    const env = {
      ...process.env,
      PATH: getEnhancedPath(),
      HERMES_HOME,
      A2A_HOST: host,
      A2A_PORT: String(port),
      A2A_PUBLIC_URL: `${baseUrl}/`,
      ...(authToken ? { [tokenEnv]: authToken, AUTH_TOKEN: authToken } : {}),
      ...parseEnvFile(agentServiceEnvPath(id)),
    };

    const child = spawn(cmd, args, {
      ...HIDDEN_SUBPROCESS_OPTIONS,
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    processes.set(id, child);

    child.stdout?.on("data", (chunk: Buffer) => {
      appendFileSync(logPath, chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      appendFileSync(logPath, chunk);
    });

    child.on("exit", (code, signal) => {
      processes.delete(id);
      const current = readState(id);
      if (current.status === "running" || current.status === "starting") {
        writeState(id, {
          ...current,
          status: "error",
          pid: undefined,
          last_error: `Process exited (code=${code ?? "null"}, signal=${signal ?? "null"})`,
        });
        upsertCatalogEntry(manifest, { status: "error" });
      }
    });

    const cardPaths = manifest.a2a?.card_paths ?? [
      "/.well-known/agent.json",
      "/.well-known/agent-card.json",
    ];

    const bootstrap = await bootstrapAgentServiceA2a({
      baseUrl,
      cardPaths,
      authToken,
      authTokenEnv: tokenEnv,
    });

    const running: AgentServiceState = {
      status: "running",
      pid: child.pid,
      port,
      base_url: baseUrl,
      card_url: bootstrap.cardUrl,
      started_at: new Date().toISOString(),
      last_error: null,
      link_path: prior.link_path,
    };
    writeState(id, running);
    upsertCatalogEntry(manifest, {
      enabled: true,
      status: "running",
      port,
      base_url: baseUrl,
    });

    return { success: true, port, base_url: baseUrl, card_url: bootstrap.cardUrl };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    writeState(id, {
      ...readState(id),
      status: "error",
      last_error: message,
    });
    upsertCatalogEntry(manifest, { status: "error" });
    const proc = processes.get(id);
    if (proc && !proc.killed) {
      proc.kill();
    }
    processes.delete(id);
    return { success: false, error: message };
  }
}

export function stopAgentService(id: string): { success: boolean; error?: string } {
  const proc = processes.get(id);
  const manifest = readManifest(id);
  if (!proc) {
    const state = readState(id);
    if (state.status !== "stopped") {
      writeState(id, { ...state, status: "stopped", pid: undefined });
      if (manifest) upsertCatalogEntry(manifest, { status: "stopped" });
    }
    return { success: true };
  }
  try {
    proc.kill();
    processes.delete(id);
    const state = readState(id);
    writeState(id, { ...state, status: "stopped", pid: undefined });
    if (manifest) upsertCatalogEntry(manifest, { status: "stopped" });
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Stop failed",
    };
  }
}

export async function bootAgentServicesOnAppStart(): Promise<void> {
  // @lat: [[lat.md/agent-services#Agent services#Supervisor#Boot on app start]]
  const devLink = process.env.HERMES_AGENT_SERVICES_DEV_LINK?.trim();
  if (devLink) {
    const linked = await installAndStartAgentServiceFromPath(devLink, {
      link: true,
      start: true,
    });
    if (!linked.success) {
      console.warn(`[agent-services] Dev link failed (${devLink}): ${linked.error}`);
    }
    return;
  }
  await bootInstalledAgentServices();
}

export async function bootInstalledAgentServices(): Promise<void> {
  const catalog = readCatalog();
  for (const entry of catalog.agents) {
    if (!entry.enabled) continue;
    if (!readManifest(entry.id)) continue;
    const result = await startAgentService(entry.id);
    if (!result.success) {
      console.warn(
        `[agent-services] Failed to start "${entry.id}": ${result.error}`,
      );
    } else {
      console.log(
        `[agent-services] Started "${entry.id}" at ${result.base_url}`,
      );
    }
  }
}

export function stopAllAgentServices(): void {
  for (const id of [...processes.keys()]) {
    stopAgentService(id);
  }
}

export async function installAndStartAgentServiceFromPath(
  sourcePath: string,
  options: { link?: boolean; start?: boolean } = {},
): Promise<AgentServiceStartResult & { id?: string }> {
  const { installAgentServiceFromPath } = await import("./installer");
  const installed = await installAgentServiceFromPath(sourcePath, {
    link: options.link,
  });
  if (!installed.success || !installed.id) {
    return { success: false, error: installed.error };
  }
  if (options.start === false) {
    return { success: true, id: installed.id };
  }
  const started = await startAgentService(installed.id);
  return { ...started, id: installed.id };
}
