import { describe, it, expect, vi } from "vitest";

vi.mock("../src/main/a2a-plugin", () => ({
  A2A_DEFAULT_PORT: 9900,
}));

vi.mock("../src/main/gateway-ports", () => ({
  DEFAULT_API_SERVER_PORT: 8642,
}));

import {
  allocateAgentServicePort,
  collectClaimedPorts,
} from "../src/main/agent-services/port-manager";
import type { AgentServiceManifest } from "../src/main/agent-services/types";

const manifest: AgentServiceManifest = {
  id: "test-agent",
  version: "1.0.0",
  name: "Test",
  entrypoint: { command: ["python", "-m", "app.server"] },
  a2a: { default_port: 9910, port_range: [9910, 9912] },
};

describe("allocateAgentServicePort", () => {
  // @lat: [[lat.md/agent-services#Agent services#Port allocation#Reuses previous free port]]
  it("reuses the previous port when it is still free", async () => {
    const port = await allocateAgentServicePort(
      manifest,
      { previousPort: 9911, claimedPorts: [] },
      async () => false,
    );
    expect(port).toBe(9911);
  });

  // @lat: [[lat.md/agent-services#Agent services#Port allocation#Skips occupied ports]]
  it("skips occupied ports in the range", async () => {
    const port = await allocateAgentServicePort(
      manifest,
      { claimedPorts: [] },
      async (candidate) => candidate === 9910,
    );
    expect(port).toBe(9911);
  });
});

describe("collectClaimedPorts", () => {
  it("collects ports from other agent states", () => {
    const used = collectClaimedPorts(
      [{ status: "running", port: 9915, last_error: null }],
      9915,
    );
    expect(used.size).toBe(0);
    const all = collectClaimedPorts([
      { status: "running", port: 9915, last_error: null },
      { status: "stopped", port: 9916, last_error: null },
    ]);
    expect(all.has(9915)).toBe(true);
    expect(all.has(9916)).toBe(true);
  });
});
