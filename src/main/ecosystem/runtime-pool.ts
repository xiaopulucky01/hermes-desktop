/**
 * Content-addressed shared runtimes under hermes-ecosystem/runtimes/.
 */

import { createHash } from "crypto";
import { execFileSync } from "child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import type { RuntimeKind, RuntimesFile } from "../../shared/ecosystem";
import { getEnhancedPath, getHermesPythonSpawnPath } from "../installer";
import { HIDDEN_SUBPROCESS_OPTIONS } from "../process-options";
import { safeWriteFile } from "../utils";
import { ecosystemRuntimesRoot } from "./paths";
import { readCapabilities } from "./capabilities";

const LOCK_FILES: Record<RuntimeKind, string[]> = {
  python: ["requirements.txt", "requirements.lock", "uv.lock"],
  node: ["package-lock.json", "pnpm-lock.yaml", "yarn.lock"],
};

const READY_MARKER = ".hermes-ready";

const EMPTY_RUNTIMES: RuntimesFile = {
  schema: "hermes.ecosystem/v1",
  pools: {},
};

function runtimesFilePath(): string {
  return join(ecosystemRuntimesRoot(), "runtimes.json");
}

export function readRuntimes(): RuntimesFile {
  const path = runtimesFilePath();
  try {
    if (!existsSync(path)) return { ...EMPTY_RUNTIMES, pools: {} };
    const raw = JSON.parse(readFileSync(path, "utf-8")) as RuntimesFile;
    return {
      schema: "hermes.ecosystem/v1",
      pools: raw.pools && typeof raw.pools === "object" ? raw.pools : {},
    };
  } catch {
    return { ...EMPTY_RUNTIMES, pools: {} };
  }
}

export function writeRuntimes(file: RuntimesFile): void {
  safeWriteFile(
    runtimesFilePath(),
    JSON.stringify(
      { schema: "hermes.ecosystem/v1", pools: file.pools },
      null,
      2,
    ) + "\n",
  );
}

export function hashLockContent(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

export function runtimePoolKey(runtime: RuntimeKind, lockHash: string): string {
  return `${runtime}:${lockHash}`;
}

export function runtimePoolDir(runtime: RuntimeKind, lockHash: string): string {
  return join(ecosystemRuntimesRoot(), runtime, lockHash);
}

/** Detect the first lockfile in a package directory. */
export function detectPackageRuntime(
  packageDir: string,
): { runtime: RuntimeKind; lockFile: string; lockHash: string } | null {
  if (!existsSync(packageDir)) return null;
  for (const runtime of Object.keys(LOCK_FILES) as RuntimeKind[]) {
    for (const name of LOCK_FILES[runtime]) {
      const file = join(packageDir, name);
      if (!existsSync(file)) continue;
      try {
        const content = readFileSync(file, "utf-8");
        if (!content.trim()) continue;
        return {
          runtime,
          lockFile: name,
          lockHash: hashLockContent(content),
        };
      } catch {
        continue;
      }
    }
  }
  return null;
}

export function packageRef(kind: string, id: string): string {
  return `${kind}:${id}`;
}

export function isRuntimePoolReady(poolPath: string): boolean {
  return existsSync(join(poolPath, READY_MARKER));
}

function markRuntimePoolReady(
  poolPath: string,
  meta: Record<string, string>,
): void {
  writeFileSync(
    join(poolPath, READY_MARKER),
    JSON.stringify({ ...meta, readyAt: new Date().toISOString() }, null, 2) +
      "\n",
  );
}

function resolvePoolPython(poolPath: string): string | null {
  const candidates =
    process.platform === "win32"
      ? [
          join(poolPath, "Scripts", "python.exe"),
          join(poolPath, "Scripts", "python"),
        ]
      : [join(poolPath, "bin", "python"), join(poolPath, "bin", "python3")];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

function resolvePoolNode(poolPath: string): string | null {
  // Node pools keep deps under node_modules; interpreter is usually system node.
  // Prefer a pool-local node only if present (rare custom layouts).
  const candidates =
    process.platform === "win32"
      ? [join(poolPath, "node.exe"), join(poolPath, "bin", "node.exe")]
      : [join(poolPath, "bin", "node"), join(poolPath, "node")];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

/** Absolute interpreter for a materialized pool, or null. */
export function resolvePoolInterpreter(
  poolPath: string,
  runtime: RuntimeKind,
): string | null {
  if (runtime === "python") return resolvePoolPython(poolPath);
  return resolvePoolNode(poolPath);
}

/** PATH entry that should precede the process PATH for this pool. */
export function resolvePoolPathPrefix(
  poolPath: string,
  runtime: RuntimeKind,
): string[] {
  const parts: string[] = [];
  if (runtime === "python") {
    const scripts =
      process.platform === "win32"
        ? join(poolPath, "Scripts")
        : join(poolPath, "bin");
    if (existsSync(scripts)) parts.push(scripts);
  } else {
    const nmBin = join(poolPath, "node_modules", ".bin");
    if (existsSync(nmBin)) parts.push(nmBin);
    const bin = join(poolPath, "bin");
    if (existsSync(bin)) parts.push(bin);
  }
  return parts;
}

/**
 * Rewrite a bare python/node command to the shared pool interpreter and
 * prepend pool bins to PATH for MCP stdio servers.
 */
// @lat: [[lat.md/ecosystem#Hermes ecosystem#Runtime pool#Bind to MCP]]
export function bindCommandToRuntimePool(
  command: string | undefined,
  args: string[] | undefined,
  env: Record<string, string> | undefined,
  runtimeKey: string | undefined,
): {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
} {
  if (!runtimeKey || !command?.trim()) {
    return { command, args, env };
  }
  const pool = readRuntimes().pools[runtimeKey];
  if (!pool?.path || !isRuntimePoolReady(pool.path)) {
    return { command, args, env };
  }

  const bare = command.trim().toLowerCase();
  let nextCmd = command;
  const interp = resolvePoolInterpreter(pool.path, pool.runtime);

  if (
    pool.runtime === "python" &&
    interp &&
    (bare === "python" || bare === "python3" || bare === "python.exe")
  ) {
    nextCmd = interp;
  } else if (
    pool.runtime === "node" &&
    (bare === "node" || bare === "nodejs" || bare === "node.exe")
  ) {
    nextCmd = interp || command;
  } else if (pool.runtime === "node" && (bare === "npx" || bare === "npx.cmd")) {
    const nmNpx =
      process.platform === "win32"
        ? join(pool.path, "node_modules", ".bin", "npx.cmd")
        : join(pool.path, "node_modules", ".bin", "npx");
    if (existsSync(nmNpx)) nextCmd = nmNpx;
  }

  const pathPrefix = resolvePoolPathPrefix(pool.path, pool.runtime);
  const nextEnv: Record<string, string> = { ...(env || {}) };
  if (pathPrefix.length) {
    const prev = nextEnv.PATH || nextEnv.Path || process.env.PATH || "";
    const merged = [...pathPrefix, prev].join(process.platform === "win32" ? ";" : ":");
    nextEnv.PATH = merged;
    if (process.platform === "win32") nextEnv.Path = merged;
  }
  if (pool.runtime === "python") {
    nextEnv.VIRTUAL_ENV = pool.path;
    nextEnv.HERMES_RUNTIME_POOL = pool.path;
  } else {
    nextEnv.HERMES_RUNTIME_POOL = pool.path;
    // Prefer package resolution from the shared pool.
    nextEnv.NODE_PATH = [
      join(pool.path, "node_modules"),
      nextEnv.NODE_PATH || "",
    ]
      .filter(Boolean)
      .join(process.platform === "win32" ? ";" : ":");
  }

  return { command: nextCmd, args, env: nextEnv };
}

/**
 * Materialize deps into a content-addressed pool (venv + pip, or npm ci).
 * Idempotent when `.hermes-ready` exists.
 */
// @lat: [[lat.md/ecosystem#Hermes ecosystem#Runtime pool#Materialize deps]]
export function materializeRuntimePool(
  packageDir: string,
  runtime: RuntimeKind,
  lockHash: string,
  lockFile: string,
): { path: string; created: boolean } {
  const dir = runtimePoolDir(runtime, lockHash);
  mkdirSync(dir, { recursive: true });
  if (isRuntimePoolReady(dir)) {
    return { path: dir, created: false };
  }

  const env = { ...process.env, PATH: getEnhancedPath() };
  const lockSrc = join(packageDir, lockFile);
  if (!existsSync(lockSrc)) {
    throw new Error(`Lockfile missing: ${lockSrc}`);
  }
  copyFileSync(lockSrc, join(dir, lockFile));

  if (runtime === "python") {
    const bootstrap = getHermesPythonSpawnPath();
    if (!resolvePoolPython(dir)) {
      execFileSync(bootstrap, ["-m", "venv", dir], {
        ...HIDDEN_SUBPROCESS_OPTIONS,
        env,
      });
    }
    const py = resolvePoolPython(dir);
    if (!py) throw new Error(`Failed to create runtime venv at ${dir}`);
    execFileSync(py, ["-m", "pip", "install", "-U", "pip"], {
      ...HIDDEN_SUBPROCESS_OPTIONS,
      env,
      cwd: dir,
    });
    if (lockFile === "uv.lock") {
      try {
        execFileSync("uv", ["sync", "--frozen", "--directory", dir], {
          ...HIDDEN_SUBPROCESS_OPTIONS,
          env,
        });
      } catch {
        // uv may be absent; leave pool without deps rather than fail install.
      }
    } else {
      execFileSync(py, ["-m", "pip", "install", "-r", join(dir, lockFile)], {
        ...HIDDEN_SUBPROCESS_OPTIONS,
        env,
        cwd: dir,
      });
    }
  } else {
    const pkgJson = join(packageDir, "package.json");
    if (existsSync(pkgJson)) {
      copyFileSync(pkgJson, join(dir, "package.json"));
    }
    const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
    const useCi =
      lockFile === "package-lock.json" && existsSync(join(dir, "package.json"));
    execFileSync(
      npmCmd,
      useCi ? ["ci", "--omit=dev"] : ["install", "--omit=dev"],
      {
        ...HIDDEN_SUBPROCESS_OPTIONS,
        env,
        cwd: dir,
      },
    );
  }

  markRuntimePoolReady(dir, { runtime, lockHash, lockFile });
  return { path: dir, created: true };
}

/**
 * Register or increment a shared runtime pool for an installed package.
 * Materializes deps on first acquire for a given lock hash.
 */
// @lat: [[lat.md/ecosystem#Hermes ecosystem#Runtime pool]]
export function acquireRuntimeForPackage(
  packageDir: string,
  kind: string,
  id: string,
  opts: { materialize?: boolean } = {},
): { runtimeKey?: string; runtime?: RuntimeKind; error?: string } {
  const detected = detectPackageRuntime(packageDir);
  if (!detected) return {};

  const key = runtimePoolKey(detected.runtime, detected.lockHash);
  const dir = runtimePoolDir(detected.runtime, detected.lockHash);
  mkdirSync(dir, { recursive: true });

  const file = readRuntimes();
  const ref = packageRef(kind, id);
  const existing = file.pools[key];
  if (existing) {
    if (!existing.refs.includes(ref)) existing.refs.push(ref);
    existing.path = dir;
    file.pools[key] = existing;
  } else {
    file.pools[key] = {
      runtime: detected.runtime,
      lockHash: detected.lockHash,
      lockFile: detected.lockFile,
      path: dir,
      refs: [ref],
    };
  }
  writeRuntimes(file);

  if (opts.materialize !== false) {
    try {
      materializeRuntimePool(
        packageDir,
        detected.runtime,
        detected.lockHash,
        detected.lockFile,
      );
    } catch (err) {
      return {
        runtimeKey: key,
        runtime: detected.runtime,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  return { runtimeKey: key, runtime: detected.runtime };
}

/** Drop a package ref; remove empty pools (never removes shared-venv). */
export function releaseRuntimeForPackage(
  kind: string,
  id: string,
  runtimeKey?: string,
): void {
  const ref = packageRef(kind, id);
  const file = readRuntimes();
  const keys = runtimeKey
    ? [runtimeKey]
    : Object.keys(file.pools).filter((k) => file.pools[k]?.refs.includes(ref));

  for (const key of keys) {
    const pool = file.pools[key];
    if (!pool) continue;
    pool.refs = pool.refs.filter((r) => r !== ref);
    if (pool.refs.length === 0) {
      if (!pool.path.includes("shared-venv")) {
        try {
          rmSync(pool.path, { recursive: true, force: true });
        } catch {
          /* ignore */
        }
      }
      delete file.pools[key];
    } else {
      file.pools[key] = pool;
    }
  }
  writeRuntimes(file);
}

/** Remove pools with zero refs and delete on-disk dirs. */
export function gcUnusedRuntimes(): { removed: string[] } {
  const file = readRuntimes();
  const removed: string[] = [];
  for (const [key, pool] of Object.entries(file.pools)) {
    if (pool.refs.length > 0) continue;
    if (pool.path.includes("shared-venv")) continue;
    try {
      if (existsSync(pool.path))
        rmSync(pool.path, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    delete file.pools[key];
    removed.push(key);
  }
  writeRuntimes(file);
  return { removed };
}

export function listRuntimePools(): RuntimesFile["pools"] {
  return readRuntimes().pools;
}

/**
 * Re-materialize a pool if `.hermes-ready` is missing (e.g. after partial GC
 * or interrupted install). Requires the original package dir for lockfiles.
 */
// @lat: [[lat.md/ecosystem#Hermes ecosystem#Runtime pool#Ensure ready]]
export function ensureRuntimePoolReady(
  runtimeKey: string,
  packageDir: string,
): { ok: boolean; error?: string; created?: boolean } {
  const pool = readRuntimes().pools[runtimeKey];
  if (!pool) {
    const detected = detectPackageRuntime(packageDir);
    if (!detected) {
      return { ok: true }; // no lockfile — nothing to ensure
    }
    try {
      const result = materializeRuntimePool(
        packageDir,
        detected.runtime,
        detected.lockHash,
        detected.lockFile,
      );
      return { ok: true, created: result.created };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
  if (isRuntimePoolReady(pool.path)) {
    return { ok: true, created: false };
  }
  try {
    const result = materializeRuntimePool(
      packageDir,
      pool.runtime,
      pool.lockHash,
      pool.lockFile,
    );
    return { ok: true, created: result.created };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Ensure the runtime pool for an installed MCP capability is ready. */
export function ensureMcpRuntimeReady(mcpId: string): {
  ok: boolean;
  error?: string;
} {
  const cap = readCapabilities().capabilities.find(
    (c) => c.kind === "mcp" && c.id === mcpId,
  );
  if (!cap?.path) return { ok: true };
  if (!cap.runtimeKey) {
    const detected = detectPackageRuntime(cap.path);
    if (!detected) return { ok: true };
    const acquired = acquireRuntimeForPackage(cap.path, "mcp", mcpId);
    if (acquired.error) return { ok: false, error: acquired.error };
    return { ok: true };
  }
  return ensureRuntimePoolReady(cap.runtimeKey, cap.path);
}

export function runtimePoolDiskBytes(key: string): number {
  const pool = readRuntimes().pools[key];
  if (!pool?.path || !existsSync(pool.path)) return 0;
  return dirSize(pool.path);
}

function dirSize(dir: string): number {
  let total = 0;
  try {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      const st = statSync(p);
      if (st.isDirectory()) total += dirSize(p);
      else total += st.size;
    }
  } catch {
    /* ignore */
  }
  return total;
}
