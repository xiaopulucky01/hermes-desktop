/**
 * Python resolution for A2A agent services.
 * - shared:python → multi-agent shared-venv under agent-services (not Hermes resources/python)
 * - venv:python → optional per-package .venv (isolation escape hatch)
 * - bootstrap:python → Hermes bundled python (create venv only)
 */

import { existsSync } from "fs";
import { join } from "path";
import { getHermesPythonSpawnPath } from "../installer";
import {
  hasSharedVenv,
  resolveSharedVenvPython,
  resolveSharedVenvRoot,
} from "./paths";
import type { AgentServiceManifest } from "./types";

export const DEFAULT_VENV_DIR = ".venv";

export function manifestVenvRel(manifest: AgentServiceManifest): string {
  const rel = manifest.python?.venv?.trim() || DEFAULT_VENV_DIR;
  if (rel === "shared") return DEFAULT_VENV_DIR;
  return rel.replace(/^[\\/]+/, "").replace(/\\/g, "/");
}

export function usesSharedVenv(manifest: AgentServiceManifest): boolean {
  if (manifest.python?.shared_venv === true) return true;
  if (manifest.python?.venv?.trim() === "shared") return true;
  const cmd0 = manifest.entrypoint?.command?.[0]?.trim() || "";
  if (cmd0.startsWith("shared:")) return true;
  const steps = manifest.install?.post_install || [];
  return steps.some((s) => s.trim().startsWith("shared:"));
}

/** Absolute path to the package-local venv interpreter, or null if missing. */
export function resolveVenvPython(
  workDir: string,
  manifest: AgentServiceManifest,
): string | null {
  // @lat: [[lat.md/agent-services#Agent services#Per-agent Python#Resolve venv python]]
  const venvRel = manifestVenvRel(manifest);
  const candidates =
    process.platform === "win32"
      ? [
          join(workDir, venvRel, "Scripts", "python.exe"),
          join(workDir, venvRel, "Scripts", "python"),
        ]
      : [
          join(workDir, venvRel, "bin", "python"),
          join(workDir, venvRel, "bin", "python3"),
        ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

export function hasPackageVenv(
  workDir: string,
  manifest: AgentServiceManifest,
): boolean {
  return resolveVenvPython(workDir, manifest) !== null;
}

/** True when the runtime interpreter the agent will use exists. */
export function hasRuntimeVenv(
  workDir: string,
  manifest: AgentServiceManifest,
): boolean {
  if (usesSharedVenv(manifest)) return hasSharedVenv(workDir);
  return hasPackageVenv(workDir, manifest);
}

/** Hermes bundled/system python — only for creating venvs (bootstrap). */
export function resolveBootstrapPython(): string {
  return getHermesPythonSpawnPath();
}

export type CommandTokenKind =
  | "bootstrap"
  | "venv"
  | "shared"
  | "literal";

export function classifyCommandToken(token: string): {
  kind: CommandTokenKind;
  rest: string;
} {
  const t = token.trim();
  if (t.startsWith("bootstrap:")) {
    return { kind: "bootstrap", rest: t.slice("bootstrap:".length) };
  }
  if (t.startsWith("shared:")) {
    return { kind: "shared", rest: t.slice("shared:".length) };
  }
  if (t.startsWith("venv:")) {
    return { kind: "venv", rest: t.slice("venv:".length) };
  }
  return { kind: "literal", rest: t };
}

/**
 * Resolve the first argv token for install/start.
 * - bootstrap:python → Hermes python (venv creation only)
 * - shared:python → agent-services shared-venv (multi-agent)
 * - venv:python → package-local .venv
 * - bare python at start → shared or package venv, else error
 */
export function resolvePythonArgv0(
  token: string,
  workDir: string,
  manifest: AgentServiceManifest,
  mode: "install" | "start",
): string {
  // @lat: [[lat.md/agent-services#Agent services#Per-agent Python#Resolve command token]]
  // @lat: [[lat.md/agent-services#Agent services#Shared Python runtime#Resolve shared python]]
  const { kind, rest } = classifyCommandToken(token);
  const looksLikePython =
    rest === "python" ||
    rest === "python3" ||
    rest === "python.exe" ||
    /[/\\]python(\.exe)?$/i.test(rest) ||
    rest.includes(".venv") ||
    rest.includes("shared-venv");

  if (
    kind === "bootstrap" ||
    (kind === "literal" &&
      mode === "install" &&
      (rest === "python" || rest === "python3"))
  ) {
    return resolveBootstrapPython();
  }

  if (kind === "shared") {
    if (rest === "ensure-venv") {
      // Caller (installer) handles ensure; argv0 should not be this.
      throw new Error("shared:ensure-venv is a post_install step, not an executable");
    }
    const sharedPy = resolveSharedVenvPython(workDir);
    if (!sharedPy) {
      throw new Error(
        `Shared agent-services venv not found at ${resolveSharedVenvRoot(workDir)}. Run shared:ensure-venv / post_install first (separate from Hermes resources/python).`,
      );
    }
    if (rest === "python" || rest === "python3" || rest === "python.exe" || rest === "") {
      return sharedPy;
    }
    return sharedPy;
  }

  if (kind === "venv" || (looksLikePython && rest.includes(".venv"))) {
    const venvPy = resolveVenvPython(workDir, manifest);
    if (!venvPy) {
      throw new Error(
        `Package venv not found under ${join(workDir, manifestVenvRel(manifest))}. Run post_install first.`,
      );
    }
    if (rest === "python" || rest === "python3" || rest === "python.exe") {
      return venvPy;
    }
    const abs = join(
      workDir,
      rest.replace(/\//g, process.platform === "win32" ? "\\" : "/"),
    );
    if (existsSync(abs)) return abs;
    return venvPy;
  }

  if (kind === "literal" && (rest === "python" || rest === "python3")) {
    if (mode === "start") {
      if (usesSharedVenv(manifest)) {
        const sharedPy = resolveSharedVenvPython(workDir);
        if (!sharedPy) {
          throw new Error(
            `Agent "${manifest.id}" expects shared-venv but it is missing at ${resolveSharedVenvRoot(workDir)}.`,
          );
        }
        return sharedPy;
      }
      const venvPy = resolveVenvPython(workDir, manifest);
      if (!venvPy) {
        throw new Error(
          `Agent "${manifest.id}" has no package .venv. Entrypoint must use shared:python or venv:python after post_install.`,
        );
      }
      return venvPy;
    }
    return resolveBootstrapPython();
  }

  if (rest.includes("/") || rest.includes("\\")) {
    const abs = join(workDir, rest);
    if (existsSync(abs)) return abs;
  }
  return rest;
}

/** Default post_install: shared multi-agent venv (preferred) or private .venv. */
export function defaultPostInstallSteps(
  manifest?: AgentServiceManifest,
): string[] {
  if (!manifest || usesSharedVenv(manifest)) {
    return defaultSharedPostInstallSteps();
  }
  return [
    "bootstrap:python -m venv .venv",
    "venv:python -m pip install -U pip",
    "venv:python -m pip install -e .",
  ];
}

export function defaultSharedPostInstallSteps(): string[] {
  return [
    "shared:ensure-venv",
    "shared:python -m pip install -U pip",
    "shared:python -m pip install -e .",
  ];
}

export {
  resolveSharedVenvPython,
  resolveSharedVenvRoot,
  hasSharedVenv,
} from "./paths";
