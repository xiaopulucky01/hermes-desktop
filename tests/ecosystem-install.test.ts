import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { resetEcosystemRootCache } from "../src/main/ecosystem/paths";

describe("ecosystem package install", () => {
  const prevEco = process.env.HERMES_ECOSYSTEM_ROOT;
  const prevHome = process.env.HERMES_HOME;
  let root: string;
  let hermesHome: string;

  beforeEach(() => {
    root = join(tmpdir(), `hermes-eco-install-${Date.now()}`);
    hermesHome = join(root, "hermes-home");
    mkdirSync(hermesHome, { recursive: true });
    writeFileSync(join(hermesHome, "config.yaml"), "");
    process.env.HERMES_ECOSYSTEM_ROOT = root;
    process.env.HERMES_HOME = hermesHome;
    resetEcosystemRootCache();
  });

  afterEach(() => {
    if (prevEco === undefined) delete process.env.HERMES_ECOSYSTEM_ROOT;
    else process.env.HERMES_ECOSYSTEM_ROOT = prevEco;
    if (prevHome === undefined) delete process.env.HERMES_HOME;
    else process.env.HERMES_HOME = prevHome;
    resetEcosystemRootCache();
    rmSync(root, { recursive: true, force: true });
  });

  // @lat: [[lat.md/ecosystem#Hermes ecosystem#Package install]]
  it("installs a skill folder locally and registers capability", async () => {
    vi.resetModules();
    const src = join(root, "src-skill");
    mkdirSync(src, { recursive: true });
    writeFileSync(
      join(src, "SKILL.md"),
      "---\nname: demo-skill\ndescription: demo\n---\n",
    );

    const { installEcosystemPackage } = await import(
      "../src/main/ecosystem/installer"
    );
    const result = await installEcosystemPackage(
      "skill",
      {
        id: "demo-skill",
        name: "Demo Skill",
        description: "demo",
        localPath: src,
      },
      { origin: "local-link" },
    );
    expect(result.success).toBe(true);

    const { readCapabilities } = await import(
      "../src/main/ecosystem/capabilities"
    );
    const caps = readCapabilities().capabilities;
    expect(caps.some((c) => c.id === "demo-skill" && c.kind === "skill")).toBe(
      true,
    );
  });

  // @lat: [[lat.md/ecosystem#Hermes ecosystem#Plugin linker]]
  it("wires MCP manifest into profile config on local link", async () => {
    vi.resetModules();
    const src = join(root, "src-mcp");
    mkdirSync(src, { recursive: true });
    writeFileSync(
      join(src, "manifest.json"),
      JSON.stringify({
        command: "node",
        args: ["./server.js"],
      }),
    );
    writeFileSync(join(src, "server.js"), "// stub");

    const { installEcosystemPackage } = await import(
      "../src/main/ecosystem/installer"
    );
    const result = await installEcosystemPackage(
      "mcp",
      {
        id: "demo-mcp",
        name: "Demo MCP",
        description: "demo",
        localPath: src,
      },
      { profile: undefined, origin: "local-link" },
    );
    expect(result.success).toBe(true);

    const cfg = readFileSync(join(hermesHome, "config.yaml"), "utf-8");
    expect(cfg).toContain("demo-mcp:");
    expect(cfg).toContain("server.js");
  });
});
