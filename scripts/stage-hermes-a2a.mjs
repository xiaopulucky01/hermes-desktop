#!/usr/bin/env node
/**
 * Ensure resources/hermes-a2a/ is ready before electron-builder packages the app.
 *
 * Default: if resources/hermes-a2a already contains the A2A plugin, keep it
 * (dev and release both use this tree as the single source of truth).
 *
 * Override:
 *   HERMES_A2A_ROOT=<path>   — copy from an external tree (e.g. sibling repo)
 *   HERMES_A2A_FORCE_STAGE=1 — overwrite resources/hermes-a2a even when present
 */
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DEST = join(ROOT, "resources", "hermes-a2a");

function pluginYamlPath(root) {
  return join(root, "plugins", "platforms", "a2a", "plugin.yaml");
}

function isForceStage() {
  const v = process.env.HERMES_A2A_FORCE_STAGE?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

function resolveSourceRoot() {
  const fromEnv = process.env.HERMES_A2A_ROOT?.trim();
  if (fromEnv) return resolve(fromEnv);
  return resolve(dirname(ROOT), "hermes-a2a");
}

const destPlugin = pluginYamlPath(DEST);
const destReady = existsSync(destPlugin);
const force = isForceStage();

if (destReady && !force && !process.env.HERMES_A2A_ROOT?.trim()) {
  console.log(
    `[stage-hermes-a2a] Using existing ${DEST} ` +
      "(set HERMES_A2A_FORCE_STAGE=1 or HERMES_A2A_ROOT to overwrite)",
  );
  process.exit(0);
}

const sourceRoot = resolveSourceRoot();

if (resolve(sourceRoot) === resolve(DEST)) {
  console.log(`[stage-hermes-a2a] HERMES_A2A_ROOT points at destination; nothing to copy.`);
  process.exit(0);
}

const sourcePlugin = pluginYamlPath(sourceRoot);

if (!existsSync(sourcePlugin)) {
  if (destReady) {
    console.log(
      `[stage-hermes-a2a] External source missing at ${sourcePlugin}; keeping ${DEST}`,
    );
    process.exit(0);
  }
  console.warn(
    `[stage-hermes-a2a] Skipping — no plugin at ${sourcePlugin} and ${destPlugin} is missing. ` +
      "Add resources/hermes-a2a or set HERMES_A2A_ROOT / clone ../hermes-a2a.",
  );
  process.exit(0);
}

if (destReady && !force) {
  console.log(
    `[stage-hermes-a2a] Keeping existing ${DEST} ` +
      `(HERMES_A2A_ROOT set but HERMES_A2A_FORCE_STAGE not set)`,
  );
  process.exit(0);
}

if (existsSync(DEST)) {
  rmSync(DEST, { recursive: true, force: true });
}
mkdirSync(dirname(DEST), { recursive: true });

cpSync(sourceRoot, DEST, { recursive: true });
console.log(`[stage-hermes-a2a] Staged ${sourceRoot} → ${DEST}`);
