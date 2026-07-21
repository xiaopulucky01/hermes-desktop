import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

vi.mock("../src/main/installer", () => ({
  getHermesPythonSpawnPath: () => "C:/hermes/python.exe",
  HERMES_HOME: join(tmpdir(), "hermes-home-shared-test"),
  getEnhancedPath: () => process.env.PATH || "",
}));

import {
  classifyCommandToken,
  defaultPostInstallSteps,
  defaultSharedPostInstallSteps,
  resolvePythonArgv0,
  resolveSharedVenvRoot,
  usesSharedVenv,
} from "../src/main/agent-services/python-runtime";
import type { AgentServiceManifest } from "../src/main/agent-services/types";

const sharedManifest: AgentServiceManifest = {
  id: "research-agent",
  version: "0.1.0",
  name: "Research",
  entrypoint: { command: ["shared:python", "-m", "app.server"] },
  python: { venv: "shared", shared_venv: true },
};

describe("classifyCommandToken", () => {
  it("detects shared prefix", () => {
    expect(classifyCommandToken("shared:python")).toEqual({
      kind: "shared",
      rest: "python",
    });
  });
});

describe("usesSharedVenv", () => {
  it("detects shared_venv flag and shared: entrypoint", () => {
    expect(usesSharedVenv(sharedManifest)).toBe(true);
    expect(
      usesSharedVenv({
        ...sharedManifest,
        python: { venv: ".venv" },
        entrypoint: { command: ["venv:python", "-m", "app.server"] },
      }),
    ).toBe(false);
  });
});

describe("resolveSharedVenvRoot", () => {
  // @lat: [[lat.md/agent-services#Agent services#Shared Python runtime#Shared venv path]]
  it("resolves under agent-services repo when workDir is an agents package", () => {
    const work = "D:/Project/private/agent-services/agents/research-agent";
    const root = resolveSharedVenvRoot(work).replace(/\\/g, "/");
    expect(root.toLowerCase()).toContain("/agent-services/shared-venv");
  });

  it("honors HERMES_AGENT_SERVICES_SHARED_VENV override", () => {
    const prev = process.env.HERMES_AGENT_SERVICES_SHARED_VENV;
    process.env.HERMES_AGENT_SERVICES_SHARED_VENV = "D:/custom/shared-venv";
    try {
      expect(resolveSharedVenvRoot().replace(/\\/g, "/")).toMatch(/custom\/shared-venv$/i);
    } finally {
      if (prev === undefined) delete process.env.HERMES_AGENT_SERVICES_SHARED_VENV;
      else process.env.HERMES_AGENT_SERVICES_SHARED_VENV = prev;
    }
  });
});

describe("resolvePythonArgv0 shared", () => {
  let workDir: string;
  let sharedRoot: string;

  beforeEach(() => {
    workDir = join(
      tmpdir(),
      `agent-services-${Date.now()}`,
      "agents",
      "research-agent",
    );
    mkdirSync(workDir, { recursive: true });
    sharedRoot = resolveSharedVenvRoot(workDir);
    const scripts = join(sharedRoot, "Scripts");
    mkdirSync(scripts, { recursive: true });
    writeFileSync(join(scripts, "python.exe"), "");
  });

  afterEach(() => {
    rmSync(join(workDir, "..", ".."), { recursive: true, force: true });
  });

  // @lat: [[lat.md/agent-services#Agent services#Shared Python runtime#Resolve shared python]]
  it("maps shared:python to shared-venv interpreter", () => {
    const py = resolvePythonArgv0(
      "shared:python",
      workDir,
      sharedManifest,
      "start",
    );
    expect(py.replace(/\\/g, "/").toLowerCase()).toContain("shared-venv");
    expect(existsSync(py)).toBe(true);
  });

  it("rejects shared:python when shared-venv missing", () => {
    rmSync(sharedRoot, { recursive: true, force: true });
    expect(() =>
      resolvePythonArgv0("shared:python", workDir, sharedManifest, "start"),
    ).toThrow(/shared/i);
  });
});

describe("defaultPostInstallSteps", () => {
  it("defaults to shared ensure + pip for shared manifests", () => {
    const steps = defaultPostInstallSteps(sharedManifest);
    expect(steps[0]).toBe("shared:ensure-venv");
    expect(steps.some((s) => s.startsWith("shared:python"))).toBe(true);
  });

  it("defaultSharedPostInstallSteps is stable", () => {
    expect(defaultSharedPostInstallSteps()[0]).toBe("shared:ensure-venv");
  });
});
