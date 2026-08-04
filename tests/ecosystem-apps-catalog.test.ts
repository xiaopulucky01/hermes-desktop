import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { resetEcosystemRootCache } from "../src/main/ecosystem/paths";

describe("scanLocalAppCatalog", () => {
  const prevEco = process.env.HERMES_ECOSYSTEM_ROOT;
  let root: string;

  beforeEach(() => {
    root = join(tmpdir(), `hermes-eco-apps-${Date.now()}`);
    mkdirSync(join(root, "apps"), { recursive: true });
    process.env.HERMES_ECOSYSTEM_ROOT = root;
    resetEcosystemRootCache();
  });

  afterEach(() => {
    if (prevEco === undefined) delete process.env.HERMES_ECOSYSTEM_ROOT;
    else process.env.HERMES_ECOSYSTEM_ROOT = prevEco;
    resetEcosystemRootCache();
    rmSync(root, { recursive: true, force: true });
  });

  // @lat: [[lat.md/ecosystem#Hermes ecosystem#Apps]]
  it("lists OSS apps under hermes-ecosystem/apps with type app", async () => {
    const appDir = join(root, "apps", "demo-app");
    mkdirSync(appDir, { recursive: true });
    writeFileSync(
      join(appDir, "hermes-app.json"),
      JSON.stringify({
        id: "demo-app",
        name: "Demo App",
        version: "1.0.0",
        description: "upstream oss",
        start: { command: "pnpm", args: ["dev"] },
      }),
    );

    const { scanLocalAppCatalog } = await import(
      "../src/main/ecosystem/apps-catalog"
    );
    const found = scanLocalAppCatalog();
    const demo = found.find((e) => e.id === "demo-app");
    expect(demo).toBeTruthy();
    expect(demo!.type).toBe("app");
    expect(demo!.localPath.replace(/\\/g, "/")).toContain("apps/demo-app");
  });
});
