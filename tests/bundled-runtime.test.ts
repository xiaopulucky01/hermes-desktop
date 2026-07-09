import { describe, it, expect, afterEach } from "vitest";
import { join } from "path";
import { existsSync } from "fs";
import {
  defaultBundledHermesHome,
  resolveBundledPythonDir,
  resolveBundledSpawnExecutable,
} from "../src/main/bundled-runtime";

describe("bundled runtime", () => {
  const prevBundled = process.env.HERMES_BUNDLED_PYTHON;
  const prevDisable = process.env.HERMES_BUNDLED_RUNTIME;

  afterEach(() => {
    if (prevBundled === undefined) delete process.env.HERMES_BUNDLED_PYTHON;
    else process.env.HERMES_BUNDLED_PYTHON = prevBundled;
    if (prevDisable === undefined) delete process.env.HERMES_BUNDLED_RUNTIME;
    else process.env.HERMES_BUNDLED_RUNTIME = prevDisable;
  });

  it("resolves prepare-runtime python via HERMES_BUNDLED_PYTHON", () => {
    const root = join(process.cwd(), "resources", "python");
    if (!existsSync(join(root, "python.exe")) && !existsSync(join(root, "pythonw.exe"))) {
      return;
    }
    process.env.HERMES_BUNDLED_PYTHON = root;
    expect(resolveBundledPythonDir()).toBe(root);
    const exe = resolveBundledSpawnExecutable(root);
    expect(existsSync(exe)).toBe(true);
    expect(exe.endsWith(".exe")).toBe(process.platform === "win32");
  });

  it("defaults bundled user home to AI-Compartner under LOCALAPPDATA on Windows", () => {
    if (process.platform !== "win32") return;
    const localApp = process.env.LOCALAPPDATA;
    if (!localApp) return;
    expect(defaultBundledHermesHome()).toBe(join(localApp, "AI-Compartner"));
  });
});
