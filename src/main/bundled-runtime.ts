/**
 * Resolve the prepare-runtime Python tree for out-of-box desktop use.
 */
// @lat: [[bundled-runtime#Bundled engine detection]]
import { existsSync, mkdirSync, realpathSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { homedir } from "os";
import { app } from "electron";

const IS_WINDOWS = process.platform === "win32";

export interface BundledRuntimeLayout {
  root: string;
  sitePackages: string;
  skillsDir: string;
  webDistDir: string;
  playwrightBrowsersDir: string | null;
}

function bundledPythonExeCandidates(root: string): string[] {
  return IS_WINDOWS
    ? [join(root, "python.exe"), join(root, "pythonw.exe")]
    : [join(root, "bin", "python3")];
}

/** Normalize a bundled interpreter path for reliable Windows CreateProcess. */
// @lat: [[bundled-runtime#Spawn executable]]
export function resolveBundledSpawnExecutable(root: string): string {
  for (const candidate of bundledPythonExeCandidates(root)) {
    const resolved = resolve(candidate);
    if (!existsSync(resolved)) continue;
    try {
      return IS_WINDOWS ? realpathSync.native(resolved) : realpathSync(resolved);
    } catch {
      return resolved;
    }
  }
  return resolve(bundledPythonExeCandidates(root)[0]);
}

function bundledHermesCliMain(root: string): string {
  return join(root, "Lib", "site-packages", "hermes_cli", "main.py");
}

export function resolveBundledPythonDir(): string | null {
  if (process.env.HERMES_BUNDLED_RUNTIME?.trim() === "0") {
    return null;
  }

  const candidates: string[] = [];
  const fromEnv = process.env.HERMES_BUNDLED_PYTHON?.trim();
  if (fromEnv) candidates.push(fromEnv);

  try {
    if (app.isPackaged) {
      candidates.push(join(process.resourcesPath, "python"));
    }
  } catch {
    /* app not ready in some tests */
  }

  try {
    candidates.push(join(app.getAppPath(), "resources", "python"));
  } catch {
    /* ignore */
  }

  // electron-vite dev: out/main → ../../resources/python
  candidates.push(join(__dirname, "..", "..", "resources", "python"));

  for (const candidate of candidates) {
    const root = resolve(candidate);
    const hasPython = bundledPythonExeCandidates(root).some((exe) =>
      existsSync(exe),
    );
    if (hasPython && existsSync(bundledHermesCliMain(root))) {
      return root;
    }
  }
  return null;
}

export function getBundledRuntimeLayout(): BundledRuntimeLayout | null {
  const root = resolveBundledPythonDir();
  if (!root) return null;

  const sitePackages = join(root, "Lib", "site-packages");
  const resourcesDir = dirname(root);
  const browsersDir = join(resourcesDir, "playwright-browsers");

  return {
    root,
    sitePackages,
    skillsDir: join(root, "skills"),
    webDistDir: join(sitePackages, "hermes_cli", "web_dist"),
    playwrightBrowsersDir: existsSync(browsersDir) ? browsersDir : null,
  };
}

export function defaultBundledHermesHome(): string {
  const localApp = process.env.LOCALAPPDATA
    ? join(process.env.LOCALAPPDATA, "AI-Compartner")
    : null;
  return localApp ?? join(homedir(), ".hermes");
}

export function ensureBundledUserHome(home: string): void {
  mkdirSync(home, { recursive: true });

  const desktopConfig = join(home, "desktop.json");
  if (!existsSync(desktopConfig)) {
    writeFileSync(
      desktopConfig,
      JSON.stringify(
        {
          connectionMode: "local",
          remoteUrl: "",
          remoteApiKey: "",
        },
        null,
        2,
      ),
      "utf-8",
    );
  }
}

export function bundledRuntimeEnv(
  layout: BundledRuntimeLayout,
): Record<string, string> {
  const env: Record<string, string> = {
    HERMES_DESKTOP: "1",
    HERMES_BUNDLED_RUNTIME: "1",
  };
  if (layout.playwrightBrowsersDir) {
    env.PLAYWRIGHT_BROWSERS_PATH = layout.playwrightBrowsersDir;
  }
  return env;
}
