import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { resetEcosystemRootCache } from "../src/main/ecosystem/paths";

describe("ecosystem runtime pool", () => {
  const prevEco = process.env.HERMES_ECOSYSTEM_ROOT;
  let root: string;

  beforeEach(() => {
    root = join(tmpdir(), `hermes-eco-runtime-${Date.now()}`);
    mkdirSync(root, { recursive: true });
    process.env.HERMES_ECOSYSTEM_ROOT = root;
    resetEcosystemRootCache();
  });

  afterEach(() => {
    if (prevEco === undefined) delete process.env.HERMES_ECOSYSTEM_ROOT;
    else process.env.HERMES_ECOSYSTEM_ROOT = prevEco;
    resetEcosystemRootCache();
    rmSync(root, { recursive: true, force: true });
  });

  // @lat: [[lat.md/ecosystem#Hermes ecosystem#Runtime pool]]
  it("acquires shared python pool from requirements.txt and releases on uninstall ref drop", async () => {
    const pkgDir = join(root, "pkg-a");
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(join(pkgDir, "requirements.txt"), "requests==2.31.0\n");

    const {
      acquireRuntimeForPackage,
      readRuntimes,
      releaseRuntimeForPackage,
      runtimePoolKey,
      hashLockContent,
    } = await import("../src/main/ecosystem/runtime-pool");

    const hash = hashLockContent("requests==2.31.0\n");
    const info = acquireRuntimeForPackage(pkgDir, "mcp", "demo-mcp", {
      materialize: false,
    });
    expect(info.runtime).toBe("python");
    expect(info.runtimeKey).toBe(runtimePoolKey("python", hash));

    const pools = readRuntimes().pools;
    expect(pools[info.runtimeKey!]?.refs).toContain("mcp:demo-mcp");

    releaseRuntimeForPackage("mcp", "demo-mcp", info.runtimeKey);
    expect(readRuntimes().pools[info.runtimeKey!]).toBeUndefined();
  });

  // @lat: [[lat.md/ecosystem#Hermes ecosystem#Runtime pool#Reference counting]]
  it("increments refs for two packages sharing the same lock hash", async () => {
    const a = join(root, "pkg-a");
    const b = join(root, "pkg-b");
    mkdirSync(a, { recursive: true });
    mkdirSync(b, { recursive: true });
    const lock = "flask==3.0.0\n";
    writeFileSync(join(a, "requirements.txt"), lock);
    writeFileSync(join(b, "requirements.txt"), lock);

    const { acquireRuntimeForPackage, readRuntimes, releaseRuntimeForPackage } =
      await import("../src/main/ecosystem/runtime-pool");

    const first = acquireRuntimeForPackage(a, "skill", "skill-a", {
      materialize: false,
    });
    acquireRuntimeForPackage(b, "skill", "skill-b", { materialize: false });
    const key = first.runtimeKey!;
    expect(readRuntimes().pools[key].refs).toHaveLength(2);

    releaseRuntimeForPackage("skill", "skill-a", key);
    expect(readRuntimes().pools[key].refs).toEqual(["skill:skill-b"]);

    releaseRuntimeForPackage("skill", "skill-b", key);
    expect(readRuntimes().pools[key]).toBeUndefined();
  });

  // @lat: [[lat.md/ecosystem#Hermes ecosystem#Runtime pool#Materialize deps]]
  it("skips materialize when .hermes-ready already exists", async () => {
    const pkgDir = join(root, "pkg-mat");
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(join(pkgDir, "requirements.txt"), "six==1.16.0\n");

    const {
      materializeRuntimePool,
      isRuntimePoolReady,
      hashLockContent,
      runtimePoolDir,
    } = await import("../src/main/ecosystem/runtime-pool");

    const hash = hashLockContent("six==1.16.0\n");
    const dir = runtimePoolDir("python", hash);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, ".hermes-ready"), "{}\n");

    const result = materializeRuntimePool(
      pkgDir,
      "python",
      hash,
      "requirements.txt",
    );
    expect(result.created).toBe(false);
    expect(result.path).toBe(dir);
    expect(isRuntimePoolReady(result.path)).toBe(true);
  });
});
