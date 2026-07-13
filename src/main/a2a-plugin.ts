/**
 * Resolve and link the standalone hermes-a2a platform plugin into HERMES_HOME.
 */
// @lat: [[a2a-integration#A2A integration]]
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
} from "fs";
import { dirname, join, resolve } from "path";
import { randomBytes } from "crypto";
import { app } from "electron";
import { readEnv, setEnvValue } from "./config";
import { profilePaths, safeWriteFile } from "./utils";

const PLUGIN_REL = join("plugins", "platforms", "a2a");
export const A2A_PLUGIN_NAME = "a2a-platform";
export const A2A_TOOLSET_NAME = "a2a";
export const A2A_DEFAULT_PORT = 9900;

function pluginYamlPath(dir: string): string {
  return join(dir, "plugin.yaml");
}

function isPluginDir(dir: string): boolean {
  return existsSync(pluginYamlPath(dir));
}

function hasYamlListItem(content: string, item: string): boolean {
  return new RegExp(
    `^\\s+-\\s+["']?${item.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']?\\s*(?:#.*)?$`,
    "m",
  ).test(content);
}

function ensureYamlListItemUnderBlock(
  content: string,
  blockName: string,
  subBlock: string,
  item: string,
): { content: string; changed: boolean } {
  if (hasYamlListItem(content, item)) {
    return { content, changed: false };
  }

  const lines = content.split("\n");
  let inBlock = false;
  let inSubBlock = false;
  let listIndent = "    ";
  let insertAt = -1;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimEnd();
    if (new RegExp(`^${blockName}:\\s*(?:#.*)?$`).test(trimmed)) {
      inBlock = true;
      inSubBlock = false;
      continue;
    }
    if (inBlock && /^\S/.test(trimmed) && trimmed !== "") {
      if (inSubBlock && insertAt >= 0) {
        break;
      }
      inBlock = false;
      inSubBlock = false;
    }
    if (!inBlock) continue;

    if (new RegExp(`^\\s+${subBlock}:\\s*(?:\\[\\])?\\s*(?:#.*)?$`).test(trimmed)) {
      inSubBlock = true;
      const subIndent = lines[i].match(/^(\s+)/)?.[1] ?? "  ";
      listIndent = `${subIndent}  `;
      insertAt = i + 1;
      while (insertAt < lines.length && /^\s+-\s/.test(lines[insertAt])) {
        insertAt++;
      }
      continue;
    }

    if (inSubBlock && /^\s+\S/.test(trimmed) && !/^\s+-\s/.test(trimmed)) {
      insertAt = i;
      break;
    }
  }

  if (inSubBlock && insertAt >= 0) {
    const next = [...lines];
    next.splice(insertAt, 0, `${listIndent}- ${item}`);
    return { content: next.join("\n"), changed: true };
  }

  if (inBlock) {
    const blockIndent = "  ";
    const next = [...lines];
    let blockEnd = lines.length;
    for (let i = 0; i < lines.length; i++) {
      if (new RegExp(`^${blockName}:\\s*(?:#.*)?$`).test(lines[i].trimEnd())) {
        for (let j = i + 1; j < lines.length; j++) {
          const t = lines[j].trimEnd();
          if (/^\S/.test(t) && t !== "") {
            blockEnd = j;
            break;
          }
        }
        break;
      }
    }
    next.splice(
      blockEnd,
      0,
      `${blockIndent}${subBlock}:`,
      `${listIndent}- ${item}`,
    );
    return { content: next.join("\n"), changed: true };
  }

  const sep = content === "" || content.endsWith("\n") ? "" : "\n";
  const addition =
    `${sep}# Desktop app A2A (auto-configured)\n` +
    `${blockName}:\n  ${subBlock}:\n    - ${item}\n`;
  return { content: `${content}${addition}`, changed: true };
}

function hasPlatformsA2aEnabled(content: string): boolean {
  const lines = content.split("\n");
  let inPlatforms = false;
  let inA2a = false;

  for (const line of lines) {
    const trimmed = line.trimEnd();
    if (/^platforms\s*:/.test(trimmed)) {
      inPlatforms = true;
      inA2a = false;
      continue;
    }
    if (inPlatforms && /^\S/.test(trimmed) && trimmed !== "") {
      inPlatforms = false;
      inA2a = false;
    }
    if (!inPlatforms) continue;

    if (/^\s+a2a\s*:/.test(trimmed)) {
      inA2a = true;
      continue;
    }
    if (inA2a && /^\s+enabled:\s*true\s*(?:#.*)?$/.test(trimmed)) {
      return true;
    }
    if (inA2a && /^\s+\S/.test(trimmed) && !/^\s+enabled:/.test(trimmed)) {
      inA2a = false;
    }
  }
  return false;
}

function ensurePlatformsA2a(content: string): { content: string; changed: boolean } {
  if (hasPlatformsA2aEnabled(content)) {
    return { content, changed: false };
  }
  if (/^\s+a2a\s*:/m.test(content)) {
    return { content, changed: false };
  }

  const a2aBlock = [
    "  a2a:",
    "    enabled: true",
    "    extra:",
    `      port: ${A2A_DEFAULT_PORT}`,
  ];

  if (/^platforms\s*:/m.test(content)) {
    const lines = content.split("\n");
    const result: string[] = [];
    let inPlatforms = false;
    let inserted = false;

    for (const line of lines) {
      const trimmed = line.trimEnd();
      if (/^platforms\s*:/.test(trimmed)) {
        inPlatforms = true;
        result.push(line);
        continue;
      }
      if (inPlatforms && /^\S/.test(trimmed) && trimmed !== "") {
        if (!inserted) {
          result.push(...a2aBlock);
          inserted = true;
        }
        inPlatforms = false;
      }
      result.push(line);
    }
    if (inPlatforms && !inserted) {
      result.push(...a2aBlock);
    }
    return { content: result.join("\n"), changed: true };
  }

  const sep = content === "" || content.endsWith("\n") ? "" : "\n";
  const addition =
    `${sep}# Desktop app A2A (auto-configured)\nplatforms:\n` +
    `${a2aBlock.join("\n")}\n`;
  return { content: `${content}${addition}`, changed: true };
}

function ensureOptionalToolsetList(
  content: string,
  blockName: string,
  platform: string,
  item: string,
): { content: string; changed: boolean } {
  if (!content.includes(`${blockName}:`)) {
    return { content, changed: false };
  }
  return ensureYamlListItemUnderBlock(content, blockName, platform, item);
}

function hasDisplayPlatformSetting(
  content: string,
  platform: string,
  key: string,
  value: string,
): boolean {
  return new RegExp(
    `^\\s+${platform}:\\s*\\r?\\n(?:\\s+.*\\r?\\n)*?\\s+${key}:\\s*${value}\\b`,
    "m",
  ).test(content);
}

function ensureDisplayA2aStreaming(content: string): {
  content: string;
  changed: boolean;
} {
  if (hasDisplayPlatformSetting(content, "a2a", "streaming", "true")) {
    return { content, changed: false };
  }
  const sep = content === "" || content.endsWith("\n") ? "" : "\n";
  const addition =
    `${sep}# Desktop app A2A streaming (auto-configured)\n` +
    "display:\n  platforms:\n    a2a:\n      streaming: true\n";
  return { content: `${content}${addition}`, changed: true };
}

/** Candidate roots that contain `plugins/platforms/a2a/plugin.yaml`. */
export function resolveHermesA2aPluginDir(): string | null {
  const candidates: string[] = [];

  const fromEnv = process.env.HERMES_A2A_ROOT?.trim();
  if (fromEnv) {
    candidates.push(join(fromEnv, PLUGIN_REL));
  }

  try {
    if (app.isPackaged) {
      candidates.push(join(process.resourcesPath, "hermes-a2a", PLUGIN_REL));
    }
  } catch {
    /* app not ready in some tests */
  }

  try {
    candidates.push(join(app.getAppPath(), "resources", "hermes-a2a", PLUGIN_REL));
  } catch {
    /* ignore */
  }

  // electron-vite dev / packaged asar: out/main → project root
  const desktopRoot = resolve(join(__dirname, "..", ".."));
  candidates.push(join(desktopRoot, "resources", "hermes-a2a", PLUGIN_REL));
  candidates.push(join(dirname(desktopRoot), "hermes-a2a", PLUGIN_REL));

  for (const candidate of candidates) {
    const resolved = resolve(candidate);
    if (isPluginDir(resolved)) return resolved;
  }
  return null;
}

function linkTargetMatches(linkPath: string, source: string): boolean {
  try {
    const stat = lstatSync(linkPath);
    if (!stat.isSymbolicLink()) return false;
    return resolve(readlinkSync(linkPath)) === resolve(source);
  } catch {
    return false;
  }
}

/**
 * Junction/symlink `%HERMES_HOME%/plugins/platforms/a2a` → resolved plugin dir.
 * Idempotent. Returns false when no plugin source is found.
 */
export function ensureA2aPluginLinked(hermesHome: string): boolean {
  const source = resolveHermesA2aPluginDir();
  if (!source) {
    console.warn(
      "[a2a] Plugin source not found — set HERMES_A2A_ROOT or place hermes-a2a next to the app",
    );
    return false;
  }

  const linkPath = join(hermesHome, PLUGIN_REL);
  mkdirSync(dirname(linkPath), { recursive: true });

  if (linkTargetMatches(linkPath, source)) {
    return true;
  }

  if (existsSync(linkPath)) {
    if (isPluginDir(linkPath) && !lstatSync(linkPath).isSymbolicLink()) {
      // User copied the plugin in place — keep it.
      return true;
    }
    rmSync(linkPath, { recursive: true, force: true });
  }

  symlinkSync(
    source,
    linkPath,
    process.platform === "win32" ? "junction" : "dir",
  );
  console.log(`[a2a] Linked ${linkPath} → ${source}`);
  return true;
}

export function isA2aPluginAvailable(hermesHome: string): boolean {
  return (
    resolveHermesA2aPluginDir() !== null ||
    isPluginDir(join(hermesHome, PLUGIN_REL))
  );
}

/**
 * Write the A2A plugin enablement block into config.yaml when the bundled
 * plugin is present. Idempotent — users never edit YAML by hand.
 */
export function ensureA2aConfig(profile?: string): boolean {
  const { configFile } = profilePaths(profile);
  if (!existsSync(configFile)) return false;

  let content = readFileSync(configFile, "utf-8");
  let changed = false;

  const steps = [
    () => ensureYamlListItemUnderBlock(content, "plugins", "enabled", A2A_PLUGIN_NAME),
    () => ensurePlatformsA2a(content),
    () => ensureDisplayA2aStreaming(content),
    () => ensureOptionalToolsetList(content, "platform_toolsets", "cli", A2A_TOOLSET_NAME),
    () =>
      ensureOptionalToolsetList(
        content,
        "known_plugin_toolsets",
        "cli",
        A2A_TOOLSET_NAME,
      ),
  ];

  for (const step of steps) {
    const result = step();
    content = result.content;
    changed ||= result.changed;
  }

  if (!changed) return false;

  safeWriteFile(configFile, content);
  console.log("[a2a] Auto-configured A2A in config.yaml");
  return true;
}

/**
 * Provision A2A bearer auth and remote bind defaults in `.env`.
 * Generates `A2A_BEARER_TOKEN` when missing and sets `A2A_HOST=0.0.0.0`
 * so inbound A2A is reachable from other machines (token required).
 */
export function ensureA2aEnv(profile?: string): boolean {
  const env = readEnv(profile);
  let changed = false;

  if (!env.A2A_BEARER_TOKEN?.trim()) {
    setEnvValue(
      "A2A_BEARER_TOKEN",
      randomBytes(32).toString("base64url"),
      profile,
    );
    changed = true;
  }

  if (!env.A2A_HOST?.trim()) {
    setEnvValue("A2A_HOST", "0.0.0.0", profile);
    changed = true;
  }

  if (changed) {
    console.log("[a2a] Auto-configured A2A bearer token and bind host in .env");
  }
  return changed;
}
