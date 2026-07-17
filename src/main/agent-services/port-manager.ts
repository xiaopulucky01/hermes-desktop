import { createConnection } from "net";
import { A2A_DEFAULT_PORT } from "../a2a-plugin";
import { DEFAULT_API_SERVER_PORT } from "../gateway-ports";
import type { AgentServiceManifest, AgentServiceState } from "./types";

export const DEFAULT_AGENT_SERVICE_PORT = 9910;
export const DEFAULT_AGENT_PORT_RANGE: [number, number] = [9910, 9999];

const HERMES_INBOUND_A2A_PORT = A2A_DEFAULT_PORT;

function envPort(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw || !/^\d+$/.test(raw.trim())) return fallback;
  const port = parseInt(raw.trim(), 10);
  return port > 0 && port < 65536 ? port : fallback;
}

export const AGENT_SERVICE_PORT_RANGE: [number, number] = [
  envPort("HERMES_AGENT_SERVICES_PORT_START", DEFAULT_AGENT_PORT_RANGE[0]),
  Math.max(
    envPort("HERMES_AGENT_SERVICES_PORT_START", DEFAULT_AGENT_PORT_RANGE[0]),
    envPort("HERMES_AGENT_SERVICES_PORT_END", DEFAULT_AGENT_PORT_RANGE[1]),
  ),
];

/** TCP connect probe — true when something is already listening. */
export function probeTcp(
  port: number,
  host = "127.0.0.1",
  timeoutMs = 300,
): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host });
    socket.setTimeout(timeoutMs);
    socket.on("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.on("error", () => {
      socket.destroy();
      resolve(false);
    });
    socket.on("timeout", () => {
      socket.destroy();
      resolve(false);
    });
  });
}

function reservedPorts(): Set<number> {
  const reserved = new Set<number>([
    HERMES_INBOUND_A2A_PORT,
    DEFAULT_API_SERVER_PORT,
  ]);
  const extra = process.env.HERMES_AGENT_SERVICES_RESERVED_PORTS?.trim();
  if (extra) {
    for (const part of extra.split(",")) {
      const n = parseInt(part.trim(), 10);
      if (n > 0 && n < 65536) reserved.add(n);
    }
  }
  return reserved;
}

function manifestPortRange(manifest: AgentServiceManifest): [number, number] {
  const range = manifest.a2a?.port_range;
  if (
    range &&
    range.length === 2 &&
    range[0] > 0 &&
    range[1] >= range[0] &&
    range[1] < 65536
  ) {
    return range;
  }
  return AGENT_SERVICE_PORT_RANGE;
}

function manifestDefaultPort(manifest: AgentServiceManifest): number {
  const port = manifest.a2a?.default_port;
  if (typeof port === "number" && port > 0 && port < 65536) return port;
  return DEFAULT_AGENT_SERVICE_PORT;
}

/**
 * Pick a free port for an agent service, reusing a previous assignment when
 * still available and avoiding conflicts with Hermes gateway/A2A ports.
 */
export async function allocateAgentServicePort(
  manifest: AgentServiceManifest,
  options: {
    previousPort?: number;
    claimedPorts?: Iterable<number>;
  } = {},
  probe: (port: number) => Promise<boolean> = probeTcp,
): Promise<number> {
  // @lat: [[lat.md/agent-services#Agent services#Port allocation]]
  const [start, end] = manifestPortRange(manifest);
  const reserved = reservedPorts();
  const claimed = new Set<number>(options.claimedPorts ?? []);
  for (const port of reserved) claimed.add(port);

  const candidates: number[] = [];
  if (
    typeof options.previousPort === "number" &&
    options.previousPort >= start &&
    options.previousPort <= end
  ) {
    candidates.push(options.previousPort);
  }
  const preferred = manifestDefaultPort(manifest);
  if (!candidates.includes(preferred)) candidates.push(preferred);
  for (let port = start; port <= end; port++) {
    if (!candidates.includes(port)) candidates.push(port);
  }

  for (const port of candidates) {
    if (claimed.has(port)) continue;
    if (await probe(port)) continue;
    return port;
  }

  throw new Error(
    `No free port in range ${start}-${end} for agent "${manifest.id}"`,
  );
}

/** Collect ports assigned to other running/stopped agent service states. */
export function collectClaimedPorts(
  states: AgentServiceState[],
  exceptPort?: number,
): Set<number> {
  const used = new Set<number>();
  for (const state of states) {
    if (typeof state.port === "number" && state.port !== exceptPort) {
      used.add(state.port);
    }
  }
  return used;
}
