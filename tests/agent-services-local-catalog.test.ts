import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { resetEcosystemRootCache } from "../src/main/ecosystem/paths";

describe("scanLocalA2aAgentCatalog (ecosystem packages)", () => {
  const prevEco = process.env.HERMES_ECOSYSTEM_ROOT;
  let root: string;

  beforeEach(() => {
    root = join(tmpdir(), `hermes-eco-agents-${Date.now()}`);
    mkdirSync(join(root, "agents", "packages"), { recursive: true });
    process.env.HERMES_ECOSYSTEM_ROOT = root;
    resetEcosystemRootCache();
  });

  afterEach(() => {
    if (prevEco === undefined) delete process.env.HERMES_ECOSYSTEM_ROOT;
    else process.env.HERMES_ECOSYSTEM_ROOT = prevEco;
    resetEcosystemRootCache();
    rmSync(root, { recursive: true, force: true });
  });

  // @lat: [[lat.md/agent-services#Agent services#Discover catalog#Local agents scan]]
  it("scans hermes-ecosystem/agents/packages and uses absolute localPath", async () => {
    const pkg = join(root, "agents", "packages", "demo-agent");
    mkdirSync(pkg, { recursive: true });
    writeFileSync(
      join(pkg, "manifest.json"),
      JSON.stringify({
        id: "demo-agent",
        name: "Demo Agent",
        version: "1.0.0",
        description: "demo",
        entrypoint: { command: ["shared:python", "-m", "app.server"] },
        skills_hint: [{ id: "research", description: "r" }],
      }),
    );

    const { scanLocalA2aAgentCatalog } = await import(
      "../src/main/agent-services/local-catalog"
    );
    const found = scanLocalA2aAgentCatalog();
    const demo = found.find((e) => e.id === "demo-agent");
    expect(demo).toBeTruthy();
    expect(demo!.localPath.replace(/\\/g, "/")).toContain(
      "agents/packages/demo-agent",
    );
    expect(demo!.localPath.includes("agent-services")).toBe(false);
  });
});
