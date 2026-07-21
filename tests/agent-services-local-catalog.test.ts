import { describe, it, expect } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { scanLocalA2aAgentCatalog } from "../src/main/agent-services/local-catalog";

describe("scanLocalA2aAgentCatalog", () => {
  // @lat: [[lat.md/agent-services#Agent services#Discover catalog#Local agents scan]]
  it("discovers agents/*/manifest.json without a fixed catalog file", () => {
    const root = join(tmpdir(), `hermes-local-a2a-${Date.now()}`);
    const agents = join(root, "agent-services", "agents", "demo-agent");
    mkdirSync(agents, { recursive: true });
    writeFileSync(
      join(agents, "manifest.json"),
      JSON.stringify({
        id: "demo-agent",
        version: "0.1.0",
        name: "Demo Agent",
        description: "Local scan demo agent for Discover A2A services",
        skills_hint: [{ id: "demo", description: "Handles demo tasks from Hermes" }],
      }),
      "utf-8",
    );
    try {
      const desktopCwd = join(root, "hermes-desktop");
      mkdirSync(desktopCwd, { recursive: true });
      const found = scanLocalA2aAgentCatalog(desktopCwd, join(desktopCwd, "out", "main"));
      expect(found.some((e) => e.id === "demo-agent")).toBe(true);
      const demo = found.find((e) => e.id === "demo-agent")!;
      expect(demo.localPath).toBe("../agent-services/agents/demo-agent");
      expect(demo.tags).toContain("local");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("skips agents-template id", () => {
    const root = join(tmpdir(), `hermes-local-a2a-skip-${Date.now()}`);
    const agents = join(root, "agent-services", "agents", "oops");
    mkdirSync(agents, { recursive: true });
    writeFileSync(
      join(agents, "manifest.json"),
      JSON.stringify({
        id: "agents-template",
        version: "0.3.0",
        name: "Template",
        description: "Should not appear in Discover scan results at all",
      }),
      "utf-8",
    );
    try {
      const desktopCwd = join(root, "hermes-desktop");
      mkdirSync(desktopCwd, { recursive: true });
      const found = scanLocalA2aAgentCatalog(desktopCwd, join(desktopCwd, "out", "main"));
      expect(found.some((e) => e.id === "agents-template")).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
