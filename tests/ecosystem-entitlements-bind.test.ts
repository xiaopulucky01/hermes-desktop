import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { resetEcosystemRootCache } from "../src/main/ecosystem/paths";

describe("bindCommandToRuntimePool", () => {
  const prevEco = process.env.HERMES_ECOSYSTEM_ROOT;
  let root: string;

  beforeEach(() => {
    root = join(tmpdir(), `hermes-eco-bind-${Date.now()}`);
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

  // @lat: [[lat.md/ecosystem#Hermes ecosystem#Runtime pool#Bind to MCP]]
  it("rewrites bare python to pool interpreter and sets VIRTUAL_ENV", async () => {
    const {
      acquireRuntimeForPackage,
      bindCommandToRuntimePool,
      runtimePoolDir,
      hashLockContent,
    } = await import("../src/main/ecosystem/runtime-pool");

    const pkg = join(root, "pkg");
    mkdirSync(pkg, { recursive: true });
    writeFileSync(join(pkg, "requirements.txt"), "six==1.16.0\n");
    const acquired = acquireRuntimeForPackage(pkg, "mcp", "demo", {
      materialize: false,
    });
    expect(acquired.runtimeKey).toBeTruthy();

    const hash = hashLockContent("six==1.16.0\n");
    const poolPath = runtimePoolDir("python", hash);
    const scripts =
      process.platform === "win32"
        ? join(poolPath, "Scripts")
        : join(poolPath, "bin");
    mkdirSync(scripts, { recursive: true });
    const py = join(
      scripts,
      process.platform === "win32" ? "python.exe" : "python",
    );
    writeFileSync(py, "");
    writeFileSync(join(poolPath, ".hermes-ready"), "{}\n");

    const bound = bindCommandToRuntimePool(
      "python",
      ["-m", "server"],
      { FOO: "1" },
      acquired.runtimeKey,
    );
    expect(bound.command).toBe(py);
    expect(bound.env?.VIRTUAL_ENV).toBe(poolPath);
    expect(bound.env?.PATH || bound.env?.Path).toContain(scripts);
  });
});

describe("checkInstallEntitlement", () => {
  // @lat: [[lat.md/ecosystem#Hermes ecosystem#Entitlements]]
  it("allows free and local-link packages without marketplace", async () => {
    const { checkInstallEntitlement } = await import(
      "../src/main/ecosystem/entitlements"
    );
    const free = await checkInstallEntitlement({
      id: "x",
      name: "x",
      description: "",
      pricing: { model: "free" },
    });
    expect(free.allowed).toBe(true);

    const local = await checkInstallEntitlement(
      {
        id: "y",
        name: "y",
        description: "",
        pricing: { model: "paid" },
        localPath: "C:/tmp/pkg",
      },
      { localLink: true },
    );
    expect(local.allowed).toBe(true);
  });

  it("skips paid gate when marketplace URL is unset", async () => {
    const prev = process.env.HERMES_CATALOG_BASE_URL;
    delete process.env.HERMES_CATALOG_BASE_URL;
    delete process.env.MAIN_VITE_HERMES_CATALOG_BASE_URL;
    const { checkInstallEntitlement } = await import(
      "../src/main/ecosystem/entitlements"
    );
    const paid = await checkInstallEntitlement({
      id: "paid.pkg",
      name: "Paid",
      description: "",
      pricing: { model: "paid" },
    });
    expect(paid.allowed).toBe(true);
    expect(paid.reason).toMatch(/not configured/i);
    if (prev === undefined) delete process.env.HERMES_CATALOG_BASE_URL;
    else process.env.HERMES_CATALOG_BASE_URL = prev;
  });

  // @lat: [[lat.md/ecosystem#Hermes ecosystem#Entitlements#Checkout]]
  it("purchase returns needs_sign_in when marketplace set but no account", async () => {
    const prev = process.env.HERMES_CATALOG_BASE_URL;
    const prevAcct = process.env.HERMES_ACCOUNT_ID;
    process.env.HERMES_CATALOG_BASE_URL = "http://127.0.0.1:3040";
    delete process.env.HERMES_ACCOUNT_ID;

    const { purchaseRegistryItem } = await import(
      "../src/main/ecosystem/entitlements"
    );
    const result = await purchaseRegistryItem({
      id: "example.paid-plugin",
      name: "Paid",
      description: "",
      pricing: { model: "paid" },
    });
    expect(result.success).toBe(false);
    expect(result.code).toBe("needs_sign_in");

    if (prev === undefined) delete process.env.HERMES_CATALOG_BASE_URL;
    else process.env.HERMES_CATALOG_BASE_URL = prev;
    if (prevAcct === undefined) delete process.env.HERMES_ACCOUNT_ID;
    else process.env.HERMES_ACCOUNT_ID = prevAcct;
  });
});

describe("ensureRuntimePoolReady", () => {
  const prevEco = process.env.HERMES_ECOSYSTEM_ROOT;
  let root: string;

  beforeEach(() => {
    root = join(tmpdir(), `hermes-eco-ensure-${Date.now()}`);
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

  // @lat: [[lat.md/ecosystem#Hermes ecosystem#Runtime pool#Ensure ready]]
  it("returns ok when pool already has .hermes-ready", async () => {
    const pkg = join(root, "pkg");
    mkdirSync(pkg, { recursive: true });
    writeFileSync(join(pkg, "requirements.txt"), "six==1.16.0\n");

    const {
      acquireRuntimeForPackage,
      ensureRuntimePoolReady,
      hashLockContent,
      runtimePoolDir,
    } = await import("../src/main/ecosystem/runtime-pool");

    const acquired = acquireRuntimeForPackage(pkg, "mcp", "x", {
      materialize: false,
    });
    const hash = hashLockContent("six==1.16.0\n");
    const dir = runtimePoolDir("python", hash);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, ".hermes-ready"), "{}\n");

    const result = ensureRuntimePoolReady(acquired.runtimeKey!, pkg);
    expect(result.ok).toBe(true);
    expect(result.created).toBe(false);
  });
});
