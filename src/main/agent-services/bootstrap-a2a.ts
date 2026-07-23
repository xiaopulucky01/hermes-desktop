import { createHash, randomBytes } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";
import { setEnvValue } from "../config";
import { HERMES_HOME } from "../installer";
import { safeWriteFile } from "../utils";

interface AgentCard {
  name?: string;
  description?: string;
  url?: string;
  capabilities?: { streaming?: boolean };
  skills?: unknown[];
  security?: unknown;
  securitySchemes?: unknown;
}

interface RegistryEntry {
  key: string;
  name: string;
  description: string;
  endpoint: string;
  card_url: string;
  rpc_url: string;
  skills: unknown[];
  streaming: boolean;
  auth_required: boolean;
  /** Hermes Desktop agent-services catalog id when known. */
  service_id?: string;
  discovered_at: number;
  updated_at: number;
}

function registryPath(): string {
  return join(HERMES_HOME, "a2a_registry.json");
}

function loadRegistry(): { agents: Record<string, RegistryEntry> } {
  try {
    const raw = readFileSync(registryPath(), "utf-8");
    const data = JSON.parse(raw) as { agents?: Record<string, RegistryEntry> };
    if (data.agents && typeof data.agents === "object") return { agents: data.agents };
  } catch {
    /* missing or invalid */
  }
  return { agents: {} };
}

function saveRegistry(data: { agents: Record<string, RegistryEntry> }): void {
  safeWriteFile(registryPath(), `${JSON.stringify(data, null, 2)}\n`);
}

function registryKey(endpoint: string, card: AgentCard): string {
  const cardUrl = (card.url || "").trim();
  if (cardUrl) {
    try {
      const u = new URL(cardUrl);
      return u.host || cardUrl;
    } catch {
      return cardUrl;
    }
  }
  try {
    const u = new URL(endpoint);
    return u.host || endpoint.replace(/\/$/, "");
  } catch {
    return endpoint.replace(/\/$/, "");
  }
}

function tokenEnvForHost(host: string): string {
  return `A2A_TOKEN_${host.replace(/[^a-zA-Z0-9]+/g, "_").toUpperCase()}`;
}

export function ensureAgentServiceAuthToken(
  _host: string,
  tokenEnv: string,
  existingToken?: string,
): string {
  const token =
    existingToken?.trim() ||
    randomBytes(24).toString("hex");
  setEnvValue(tokenEnv, token);
  return token;
}

export async function fetchAgentCard(
  baseUrl: string,
  cardPaths: string[],
  headers: Record<string, string> = {},
  timeoutMs = 5000,
): Promise<{ card: AgentCard; cardUrl: string }> {
  const base = baseUrl.replace(/\/$/, "");
  const paths =
    cardPaths.length > 0
      ? cardPaths
      : ["/.well-known/agent.json", "/.well-known/agent-card.json"];

  let lastErr: Error | null = null;
  for (const suffix of paths) {
    const url = `${base}${suffix.startsWith("/") ? suffix : `/${suffix}`}`;
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) {
        lastErr = new Error(`HTTP ${res.status} from ${url}`);
        continue;
      }
      const card = (await res.json()) as AgentCard;
      if (card && typeof card.name === "string") {
        return { card, cardUrl: url };
      }
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
    }
  }
  throw lastErr ?? new Error(`Could not fetch Agent Card from ${baseUrl}`);
}

export async function waitForAgentCard(
  baseUrl: string,
  cardPaths: string[],
  headers: Record<string, string> = {},
  timeoutMs = 60_000,
  intervalMs = 500,
): Promise<{ card: AgentCard; cardUrl: string }> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: Error | null = null;
  while (Date.now() < deadline) {
    try {
      return await fetchAgentCard(baseUrl, cardPaths, headers, Math.min(5000, timeoutMs));
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
  throw lastErr ?? new Error(`Agent Card not ready at ${baseUrl}`);
}

export function upsertA2aRegistryEntry(
  endpoint: string,
  card: AgentCard,
  cardUrl: string,
  serviceId?: string,
): RegistryEntry {
  // @lat: [[lat.md/agent-services#Agent services#A2A bootstrap#Registry upsert]]
  const key = registryKey(endpoint, card);
  const caps = card.capabilities || {};
  const now = Date.now() / 1000;
  const data = loadRegistry();
  const prev = data.agents[key];
  const entry: RegistryEntry = {
    key,
    name: card.name || key,
    description: card.description || "",
    endpoint: endpoint.trim(),
    card_url: cardUrl,
    rpc_url: (card.url || endpoint).trim(),
    skills: card.skills || [],
    streaming: Boolean(caps.streaming),
    auth_required: Boolean(card.security || card.securitySchemes),
    service_id: serviceId || prev?.service_id,
    discovered_at: prev?.discovered_at ?? now,
    updated_at: now,
  };
  data.agents[key] = entry;
  saveRegistry(data);
  return entry;
}

export function listA2aRegistryExperts(): Array<{
  key: string;
  name: string;
  description: string;
  endpoint: string;
  service_id?: string;
  skills: unknown[];
  streaming: boolean;
}> {
  const data = loadRegistry();
  return Object.values(data.agents).map((a) => ({
    key: a.key,
    name: a.name,
    description: a.description,
    endpoint: a.endpoint,
    service_id: a.service_id,
    skills: a.skills,
    streaming: a.streaming,
  }));
}

/** Latest mid-delegate A2A stage line written by the outbound plugin. */
export function readA2aLiveProgress(): {
  peer: string;
  line: string;
  task_id: string;
  endpoint: string;
  ts: number;
} | null {
  try {
    const path = join(HERMES_HOME, "a2a_tasks", "_live.json");
    const raw = readFileSync(path, "utf-8");
    const data = JSON.parse(raw) as Record<string, unknown>;
    const line = typeof data.line === "string" ? data.line.trim() : "";
    if (!line) return null;
    const ts = typeof data.ts === "number" ? data.ts : 0;
    // Ignore stale snapshots left behind if a crash skipped clear_live_progress.
    if (ts > 0 && Date.now() / 1000 - ts > 600) return null;
    return {
      peer: typeof data.peer === "string" ? data.peer : "",
      line,
      task_id: typeof data.task_id === "string" ? data.task_id : "",
      endpoint: typeof data.endpoint === "string" ? data.endpoint : "",
      ts,
    };
  } catch {
    return null;
  }
}

export async function bootstrapAgentServiceA2a(options: {
  baseUrl: string;
  cardPaths?: string[];
  authToken?: string;
  authTokenEnv?: string;
  serviceId?: string;
}): Promise<{ cardUrl: string; registryKey: string; tokenEnv?: string }> {
  const cardPaths = options.cardPaths ?? [
    "/.well-known/agent.json",
    "/.well-known/agent-card.json",
  ];
  const host = new URL(options.baseUrl).host;
  const headers: Record<string, string> = {};
  let token = options.authToken?.trim();
  const tokenEnv = options.authTokenEnv?.trim() || tokenEnvForHost(host);

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const { card, cardUrl } = await waitForAgentCard(
    options.baseUrl,
    cardPaths,
    headers,
  );

  const authRequired = Boolean(card.security || card.securitySchemes);
  if (authRequired && !token) {
    token = ensureAgentServiceAuthToken(host, tokenEnv);
    headers.Authorization = `Bearer ${token}`;
    await fetchAgentCard(options.baseUrl, cardPaths, headers);
  } else if (token) {
    ensureAgentServiceAuthToken(host, tokenEnv, token);
  }

  const entry = upsertA2aRegistryEntry(
    options.baseUrl,
    card,
    cardUrl,
    options.serviceId,
  );
  return { cardUrl, registryKey: entry.key, tokenEnv: token ? tokenEnv : undefined };
}

export function sha256File(path: string): string {
  const data = readFileSync(path);
  return createHash("sha256").update(data).digest("hex");
}
