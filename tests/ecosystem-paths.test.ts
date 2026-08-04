import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  getEcosystemRoot,
  resetEcosystemRootCache,
  resolveAgentServicesRoot,
  resolveEcosystemRoot,
  ecosystemSharedPythonVenvRoot,
} from "../src/main/ecosystem/paths";

describe("ecosystem paths", () => {
  const prevEco = process.env.HERMES_ECOSYSTEM_ROOT;
  const prevAgents = process.env.HERMES_AGENT_SERVICES_ROOT;
  let root: string;

  beforeEach(() => {
    root = join(tmpdir(), `hermes-eco-${Date.now()}`);
    mkdirSync(root, { recursive: true });
    process.env.HERMES_ECOSYSTEM_ROOT = root;
    delete process.env.HERMES_AGENT_SERVICES_ROOT;
    resetEcosystemRootCache();
  });

  afterEach(() => {
    if (prevEco === undefined) delete process.env.HERMES_ECOSYSTEM_ROOT;
    else process.env.HERMES_ECOSYSTEM_ROOT = prevEco;
    if (prevAgents === undefined) delete process.env.HERMES_AGENT_SERVICES_ROOT;
    else process.env.HERMES_AGENT_SERVICES_ROOT = prevAgents;
    resetEcosystemRootCache();
    rmSync(root, { recursive: true, force: true });
  });

  // @lat: [[lat.md/ecosystem#Hermes ecosystem#Paths]]
  it("honors HERMES_ECOSYSTEM_ROOT", () => {
    expect(resolveEcosystemRoot()).toBe(root);
    expect(getEcosystemRoot()).toBe(root);
  });

  // @lat: [[lat.md/ecosystem#Hermes ecosystem#Agents root]]
  it("places agent services under ecosystem/agents", () => {
    expect(resolveAgentServicesRoot().replace(/\\/g, "/")).toMatch(
      /hermes-eco-.*\/agents$/i,
    );
    expect(ecosystemSharedPythonVenvRoot().replace(/\\/g, "/")).toMatch(
      /runtimes\/python\/shared-venv$/i,
    );
  });
});

describe("ecosystem capabilities file", () => {
  const prevEco = process.env.HERMES_ECOSYSTEM_ROOT;
  let root: string;

  beforeEach(() => {
    root = join(tmpdir(), `hermes-eco-cap-${Date.now()}`);
    mkdirSync(root, { recursive: true });
    writeFileSync(
      join(root, "capabilities.json"),
      JSON.stringify({ schema: "hermes.ecosystem/v1", capabilities: [] }),
    );
    process.env.HERMES_ECOSYSTEM_ROOT = root;
    resetEcosystemRootCache();
  });

  afterEach(() => {
    if (prevEco === undefined) delete process.env.HERMES_ECOSYSTEM_ROOT;
    else process.env.HERMES_ECOSYSTEM_ROOT = prevEco;
    resetEcosystemRootCache();
    rmSync(root, { recursive: true, force: true });
  });

  // @lat: [[lat.md/ecosystem#Hermes ecosystem#Capabilities index]]
  it("upserts and reads capabilities", async () => {
    const { upsertCapability, readCapabilities, removeCapability } =
      await import("../src/main/ecosystem/capabilities");
    upsertCapability({
      kind: "skill",
      id: "demo.skill",
      name: "Demo",
      origin: "ecosystem",
      when_to_use: "testing",
      invocation: "in_process",
    });
    const file = readCapabilities();
    expect(file.capabilities).toHaveLength(1);
    expect(file.capabilities[0]?.id).toBe("demo.skill");
    removeCapability("skill", "demo.skill");
    expect(readCapabilities().capabilities).toHaveLength(0);
  });
});
