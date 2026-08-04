/**
 * Junction/symlink Hermes platform plugins from hermes-ecosystem into HERMES_HOME.
 */

import { existsSync, lstatSync, mkdirSync, readlinkSync, rmSync, symlinkSync } from "fs";
import { dirname, join, resolve } from "path";
import { ecosystemPackageDir } from "./paths";

function isPluginDir(dir: string): boolean {
  return (
    existsSync(join(dir, "plugin.yaml")) ||
    existsSync(join(dir, "plugins", "platforms"))
  );
}

function linkTargetMatches(linkPath: string, source: string): boolean {
  if (!existsSync(linkPath)) return false;
  try {
    const stat = lstatSync(linkPath);
    if (!stat.isSymbolicLink()) return resolve(linkPath) === resolve(source);
    return resolve(readlinkSync(linkPath)) === resolve(source);
  } catch {
    return false;
  }
}

/**
 * Link `<ecosystem>/plugins/<publisher>/<id>` → `%HERMES_HOME%/plugins/platforms/<id>`.
 */
// @lat: [[lat.md/ecosystem#Hermes ecosystem#Plugin linker]]
export function linkEcosystemPlugin(
  publisher: string,
  id: string,
  hermesHome: string,
): { success: boolean; error?: string } {
  const source = ecosystemPackageDir("plugin", publisher, id);
  if (!existsSync(source)) {
    return { success: false, error: `Plugin package not found: ${source}` };
  }
  if (!isPluginDir(source)) {
    return {
      success: false,
      error: "Plugin package must contain plugin.yaml or plugins/platforms/",
    };
  }

  const linkPath = join(hermesHome, "plugins", "platforms", id);
  mkdirSync(dirname(linkPath), { recursive: true });

  if (linkTargetMatches(linkPath, source)) {
    return { success: true };
  }

  if (existsSync(linkPath)) {
    if (isPluginDir(linkPath) && !lstatSync(linkPath).isSymbolicLink()) {
      return {
        success: false,
        error: `Plugin slot "${id}" already exists at ${linkPath}`,
      };
    }
    rmSync(linkPath, { recursive: true, force: true });
  }

  try {
    symlinkSync(
      source,
      linkPath,
      process.platform === "win32" ? "junction" : "dir",
    );
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to link plugin",
    };
  }
}

export function unlinkEcosystemPlugin(
  id: string,
  hermesHome: string,
): { success: boolean; error?: string } {
  const linkPath = join(hermesHome, "plugins", "platforms", id);
  if (!existsSync(linkPath)) return { success: true };
  try {
    rmSync(linkPath, { recursive: true, force: true });
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to unlink plugin",
    };
  }
}

export function pluginSlotName(publisher: string, id: string): string {
  const safePub = publisher.replace(/[^a-z0-9-]/gi, "-").toLowerCase();
  const safeId = id.replace(/[^a-z0-9-]/gi, "-").toLowerCase();
  if (safeId.includes(".")) return safeId.split(".").pop() || safeId;
  return `${safePub}-${safeId}`.replace(/^-+|-+$/g, "") || id;
}

/** Resolve plugin id segment used under plugins/platforms/. */
export function resolvePluginLinkId(
  publisher: string,
  packageId: string,
): string {
  if (packageId.includes(".")) {
    const tail = packageId.split(".").pop();
    if (tail && /^[a-z][a-z0-9-]{0,62}$/i.test(tail)) return tail.toLowerCase();
  }
  return pluginSlotName(publisher, packageId);
}

/** Link a plugin directory directly into HERMES_HOME (local path). */
export function linkPluginFromPath(
  source: string,
  linkId: string,
  hermesHome: string,
): { success: boolean; error?: string } {
  if (!existsSync(source)) {
    return { success: false, error: `Plugin path not found: ${source}` };
  }
  if (!isPluginDir(source)) {
    return {
      success: false,
      error: "Path must contain plugin.yaml or plugins/platforms/",
    };
  }
  const linkPath = join(hermesHome, "plugins", "platforms", linkId);
  mkdirSync(dirname(linkPath), { recursive: true });
  if (linkTargetMatches(linkPath, source)) return { success: true };
  if (existsSync(linkPath)) {
    if (isPluginDir(linkPath) && !lstatSync(linkPath).isSymbolicLink()) {
      return { success: false, error: `Plugin slot "${linkId}" already exists` };
    }
    rmSync(linkPath, { recursive: true, force: true });
  }
  try {
    symlinkSync(
      source,
      linkPath,
      process.platform === "win32" ? "junction" : "dir",
    );
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to link plugin",
    };
  }
}
