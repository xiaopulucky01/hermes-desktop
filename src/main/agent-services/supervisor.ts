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
import { resolvePythonArgv0 } from "./python-runtime";
import type {
  AgentServiceManifest,
  AgentServiceStartResult,
  AgentServiceState,
} from "./types";
import { getEnhancedPath, HERMES_HOME } from "../installer";
import { HIDDEN_SUBPROCESS_OPTIONS } from "../process-options";

const processes = new Map<string, ChildProcess>();
/** Ids currently being stopped on purpose — skip crash auto-restart. */
const intentionalStops = new Set<string>();
const restartAttempts = new Map<string, number>();
const MAX_CRASH_RESTARTS = 5;
const CRASH_RESTART_DELAY_MS = 2_000;

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

/** Merge package/link `.env` then installed `.env` (installed wins on conflict). */
function loadAgentServiceEnv(
  id: string,
  workDir: string,
): Record<string, string> {
  return {
    ...parseEnvFile(join(workDir, ".env")),
    ...parseEnvFile(agentServiceEnvPath(id)),
  };
}

function resolveCommand(
  command: string[],
  workDir: string,
  manifest: AgentServiceManifest,
): { cmd: string; args: string[] } {
  if (!command.length) throw new Error("Empty entrypoint.command");
  const cmd = resolvePythonArgv0(command[0], workDir, manifest, "start");
  const args = command.slice(1).map((arg) => {
    if (arg.startsWith("venv:") || arg.startsWith("bootstrap:")) {
      return resolvePythonArgv0(arg, workDir, manifest, "start");
    }
    return arg;
  });
  return { cmd, args };
}

function readServiceAuthToken(
  id: string,
  workDir: string,
  tokenEnv: string,
): string | undefined {
  const merged = loadAgentServiceEnv(id, workDir);
  if (merged[tokenEnv]) return merged[tokenEnv];
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
    const authToken = readServiceAuthToken(id, workDir, tokenEnv);

    mkdirSync(agentServiceLogsDir(id), { recursive: true });
    const logPath = join(agentServiceLogsDir(id), "stdout.log");
    const { cmd, args } = resolveCommand(
      manifest.entrypoint.command,
      workDir,
      manifest,
    );
    const cwd = join(workDir, manifest.entrypoint.cwd || ".");

    const env = {
      ...process.env,
      PATH: getEnhancedPath(),
      HERMES_HOME,
      A2A_HOST: host,
      A2A_PORT: String(port),
      A2A_PUBLIC_URL: `${baseUrl}/`,
      // Package/link .env (OPENAI_API_KEY etc.) + installed .env (AUTH_TOKEN)
      ...loadAgentServiceEnv(id, workDir),
      ...(authToken ? { [tokenEnv]: authToken, AUTH_TOKEN: authToken } : {}),
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
      const wasIntentional = intentionalStops.delete(id);
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
      if (!wasIntentional) {
        scheduleCrashRestart(id);
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
      serviceId: id,
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
    restartAttempts.delete(id);

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
      intentionalStops.add(id);
      proc.kill();
    }
    processes.delete(id);
    return { success: false, error: message };
  }
}

export function stopAgentService(id: string): { success: boolean; error?: string } {
  const proc = processes.get(id);
  const manifest = readManifest(id);
  intentionalStops.add(id);
  if (!proc) {
    intentionalStops.delete(id);
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
    intentionalStops.delete(id);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Stop failed",
    };
  }
}

function scheduleCrashRestart(id: string): void {
  // @lat: [[lat.md/agent-services#Agent services#Supervisor#Crash auto-restart]]
  const catalog = readCatalog();
  const entry = catalog.agents.find((a) => a.id === id);
  if (!entry?.enabled) return;
  if (!readManifest(id)) return;

  const attempts = (restartAttempts.get(id) ?? 0) + 1;
  restartAttempts.set(id, attempts);
  if (attempts > MAX_CRASH_RESTARTS) {
    console.warn(
      `[agent-services] Giving up restart for "${id}" after ${attempts - 1} attempts`,
    );
    return;
  }

  const delay = CRASH_RESTART_DELAY_MS * attempts;
  console.warn(
    `[agent-services] Scheduling crash restart for "${id}" in ${delay}ms (attempt ${attempts})`,
  );
  setTimeout(() => {
    void startAgentService(id).then((result) => {
      if (!result.success) {
        console.warn(
          `[agent-services] Crash restart failed for "${id}": ${result.error}`,
        );
      }
    });
  }, delay);
}

/** Start the service if it is not already running (lazy start). */
export async function ensureAgentServiceRunning(
  id: string,
): Promise<AgentServiceStartResult> {
  // @lat: [[lat.md/agent-services#Agent services#Supervisor#Lazy start]]
  if (isAgentServiceRunning(id)) {
    const state = readState(id);
    return {
      success: true,
      port: state.port,
      base_url: state.base_url,
      card_url: state.card_url,
    };
  }
  return startAgentService(id);
}

/** Resolve catalog id from a registry endpoint / service_id and ensure running. */
export async function ensureAgentServiceRunningByEndpoint(
  endpointOrServiceId: string,
): Promise<AgentServiceStartResult & { id?: string }> {
  const needle = endpointOrServiceId.trim().replace(/\/$/, "");
  const catalog = readCatalog();
  const byId = catalog.agents.find((a) => a.id === needle);
  if (byId) {
    const started = await ensureAgentServiceRunning(byId.id);
    return { ...started, id: byId.id };
  }
  const byUrl = catalog.agents.find(
    (a) => (a.base_url || "").replace(/\/$/, "") === needle,
  );
  if (byUrl) {
    const started = await ensureAgentServiceRunning(byUrl.id);
    return { ...started, id: byUrl.id };
  }
  // Fall back to matching running state base_url
  for (const id of listInstalledFromStates()) {
    const st = readState(id);
    if ((st.base_url || "").replace(/\/$/, "") === needle) {
      const started = await ensureAgentServiceRunning(id);
      return { ...started, id };
    }
  }
  return { success: false, error: `No agent service matches "${needle}"` };
}

function listInstalledFromStates(): string[] {
  return readCatalog().agents.map((a) => a.id);
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
