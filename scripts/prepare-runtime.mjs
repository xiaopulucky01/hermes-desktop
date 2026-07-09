#!/usr/bin/env node
/**
 * Prepare the bundled Python runtime + Playwright Chromium under resources/.
 * Run once per release before `electron-builder --win`. Idempotent: skips
 * the download when resources/python/python.exe already exists.
 *
 * Steps:
 *   1. Download python-build-standalone tarball, extract to resources/python/
 *   2. pip install hermes-agent + core (from local desktop-core/) + playwright
 *   3. copy hermes-agent skills + overlay custom-skills → resources/python/skills
 *   4. playwright install chromium → resources/playwright-browsers/
 *
 * After this runs, `npm run build:win` produces an open-the-box installer
 * with no user-side environment install required.
 *
 * If GitHub download fails (ECONNRESET, firewall), either retry or place the
 * tarball manually — see MANUAL_TAR_NAME below and PBS_LOCAL_TAR env var.
 */
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  rmSync,
  createWriteStream,
  statSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import https from "node:https";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const RESOURCES = join(ROOT, "resources");
const PYTHON_DIR = join(RESOURCES, "python");
const PYTHON_EXE = join(PYTHON_DIR, "python.exe");
const BROWSERS_DIR = join(RESOURCES, "playwright-browsers");
const CORE_ARCHIVE_PATH = join(RESOURCES, "core.7z");
const EXTRAS_ARCHIVE_PATH = join(RESOURCES, "extras.7z");
const ARCHIVE_PATH = join(RESOURCES, "runtime.7z");
const DESKTOP_CORE = join(ROOT, "desktop-core");

// Pin the python-build-standalone release used. Update by hand for new
// CPython patch versions; older releases stay reproducible until then.
const PYTHON_VERSION = "3.11.15";
const PBS_TAG = "20251008"; // python-build-standalone release date
const PBS_ARTIFACT = `cpython-${PYTHON_VERSION}+${PBS_TAG}-x86_64-pc-windows-msvc-install_only.tar.gz`;
const PBS_URL_DEFAULT =
  `https://github.com/astral-sh/python-build-standalone/releases/download/` +
  `${PBS_TAG}/${PBS_ARTIFACT}`;
/** Override when GitHub is blocked (mirror / internal cache). */
const PBS_URL = process.env.PBS_URL?.trim() || PBS_URL_DEFAULT;
/** Drop a manual download here to skip GitHub (see log on network failure). */
const MANUAL_TAR_NAME = "python-build-standalone.tar.gz";
const MANUAL_TAR_PATH = join(RESOURCES, MANUAL_TAR_NAME);

const DOWNLOAD_RETRIES = Number(process.env.PBS_DOWNLOAD_RETRIES || 6);
const DOWNLOAD_TIMEOUT_MS = Number(process.env.PBS_DOWNLOAD_TIMEOUT_MS || 120_000);

function log(msg) {
  console.log(`[prepare-runtime] ${msg}`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function run(cmd, args, opts = {}) {
  log(`$ ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: false, ...opts });
  if (r.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} exited ${r.status}`);
  }
}

function tarballLooksValid(path) {
  if (!existsSync(path)) return false;
  try {
    const size = statSync(path).size;
    // install_only tarball is ~40MB+; reject obvious partial downloads
    return size > 20 * 1024 * 1024;
  } catch {
    return false;
  }
}

function printManualDownloadHelp() {
  console.error("");
  console.error("[prepare-runtime] GitHub download failed. Options:");
  console.error(`  1. Retry: npm run prepare-runtime`);
  console.error(`  2. Manual: download (browser / IDM / proxy / VPN):`);
  console.error(`     ${PBS_URL_DEFAULT}`);
  console.error(`     (or set PBS_URL to a mirror URL and retry)`);
  console.error(`     Save as: ${MANUAL_TAR_PATH}`);
  console.error(`     Or set PBS_LOCAL_TAR to the full path of the .tar.gz`);
  console.error(`  3. Then run: npm run prepare-runtime`);
  console.error("");
}

function downloadFileOnce(url, dest) {
  return new Promise((resolveP, rejectP) => {
    const out = createWriteStream(dest);
    let received = 0;

    const onFailure = (err) => {
      out.destroy();
      try {
        rmSync(dest, { force: true });
      } catch {
        /* ignore */
      }
      rejectP(err);
    };

    const follow = (u, redirects = 0) => {
      if (redirects > 12) {
        onFailure(new Error("too many redirects"));
        return;
      }
      const req = https.get(
        u,
        {
          timeout: DOWNLOAD_TIMEOUT_MS,
          headers: {
            "User-Agent": "hermes-desktop-prepare-runtime",
            Accept: "*/*",
          },
        },
        (res) => {
          if (
            res.statusCode === 301 ||
            res.statusCode === 302 ||
            res.statusCode === 307 ||
            res.statusCode === 308
          ) {
            const next = res.headers.location;
            if (!next) {
              onFailure(new Error(`HTTP ${res.statusCode} without Location`));
              return;
            }
            res.resume();
            follow(new URL(next, u).href, redirects + 1);
            return;
          }
          if (res.statusCode !== 200) {
            onFailure(new Error(`HTTP ${res.statusCode} for ${u}`));
            return;
          }
          const total = Number(res.headers["content-length"] || 0);
          res.on("data", (chunk) => {
            received += chunk.length;
            if (total > 0 && received % (5 * 1024 * 1024) < chunk.length) {
              const pct = Math.min(100, Math.round((received / total) * 100));
              log(`  … ${(received / 1024 / 1024).toFixed(1)} MiB (${pct}%)`);
            }
          });
          res.pipe(out);
        },
      );
      req.on("timeout", () => {
        req.destroy(new Error(`timeout after ${DOWNLOAD_TIMEOUT_MS}ms`));
      });
      req.on("error", onFailure);
    };

    out.on("finish", () => out.close(resolveP));
    out.on("error", onFailure);
    follow(url);
  });
}

async function downloadFile(url, dest) {
  log(`download ${url}`);
  let lastErr;
  for (let attempt = 1; attempt <= DOWNLOAD_RETRIES; attempt++) {
    try {
      await downloadFileOnce(url, dest);
      if (!tarballLooksValid(dest)) {
        throw new Error(
          `downloaded file too small (${statSync(dest).size} bytes) — likely incomplete`,
        );
      }
      log(`download OK (${(statSync(dest).size / 1024 / 1024).toFixed(1)} MiB)`);
      return;
    } catch (err) {
      lastErr = err;
      const code = err && typeof err === "object" && "code" in err ? err.code : "";
      log(
        `download attempt ${attempt}/${DOWNLOAD_RETRIES} failed` +
          (code ? ` (${code})` : `: ${err.message}`),
      );
      if (attempt < DOWNLOAD_RETRIES) {
        const delay = 2000 * attempt;
        log(`retrying in ${delay / 1000}s…`);
        await sleep(delay);
      }
    }
  }
  throw lastErr;
}

function resolveTarballPath() {
  const fromEnv = process.env.PBS_LOCAL_TAR?.trim();
  if (fromEnv && existsSync(fromEnv)) {
    if (!tarballLooksValid(fromEnv)) {
      throw new Error(
        `PBS_LOCAL_TAR exists but looks too small: ${fromEnv} — need full ${PBS_ARTIFACT}`,
      );
    }
    log(`using PBS_LOCAL_TAR=${fromEnv}`);
    return fromEnv;
  }
  if (tarballLooksValid(MANUAL_TAR_PATH)) {
    log(`using manual tarball ${MANUAL_TAR_PATH}`);
    return MANUAL_TAR_PATH;
  }
  return null;
}

async function ensurePython() {
  if (existsSync(PYTHON_EXE)) {
    log(`python already extracted at ${PYTHON_EXE}, skipping download`);
    return;
  }
  mkdirSync(RESOURCES, { recursive: true });

  let tarPath = resolveTarballPath();
  const downloaded = join(RESOURCES, ".python-download.tar.gz");

  if (!tarPath) {
    try {
      await downloadFile(PBS_URL, downloaded);
      tarPath = downloaded;
    } catch (err) {
      printManualDownloadHelp();
      throw err;
    }
  }

  log(`extracting ${tarPath} → ${PYTHON_DIR}`);
  // python-build-standalone tarball already contains a `python/` top-level
  // directory, so extract straight into resources/.
  run("tar", ["-xzf", tarPath, "-C", RESOURCES]);

  if (tarPath === downloaded) {
    rmSync(downloaded, { force: true });
  }

  if (!existsSync(PYTHON_EXE)) {
    throw new Error(
      `expected ${PYTHON_EXE} after extraction — tarball layout may have changed`,
    );
  }
}

function desktopCoreConfigured() {
  return existsSync(join(DESKTOP_CORE, "pyproject.toml"));
}

function desktopCoreInstalled() {
  try {
    execFileSync(PYTHON_EXE, ["-c", "import core"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function pipInstall() {
  log("upgrading pip");
  run(PYTHON_EXE, ["-m", "pip", "install", "--upgrade", "pip"]);

  log("installing hermes-agent");
  // PyPI release. Swap to a local path if you need to ship an unreleased
  // hermes-agent build:  [PYTHON_EXE, "-m", "pip", "install", "C:/Users/MI/.hermes/hermes-agent"]
  run(PYTHON_EXE, ["-m", "pip", "install", "hermes-agent"]);

  if (desktopCoreConfigured()) {
    log(`installing core from ${DESKTOP_CORE}`);
    run(PYTHON_EXE, ["-m", "pip", "install", DESKTOP_CORE]);
  } else {
    log(
      "desktop-core/ not found — skipping core install (OCR/onnx extras unavailable)",
    );
  }

  log("installing playwright + pymupdf (knowledge-distill PDF extraction)");
  run(PYTHON_EXE, ["-m", "pip", "install", "playwright", "pymupdf"]);
}

function patchBundledSoulBranding() {
  const soulTemplatePath = join(RESOURCES, "SOUL.md");
  const defaultSoulPy = join(
    PYTHON_DIR,
    "Lib",
    "site-packages",
    "hermes_cli",
    "default_soul.py",
  );
  if (!existsSync(soulTemplatePath) || !existsSync(defaultSoulPy)) {
    log("SOUL branding patch skipped (template or default_soul.py missing)");
    return;
  }
  const soulText = readFileSync(soulTemplatePath, "utf-8").trim();
  const escaped = soulText.replace(/\\/g, "\\\\").replace(/"""/g, '\\"""');
  const content = readFileSync(defaultSoulPy, "utf-8");
  const updated = content.replace(
    /DEFAULT_SOUL_MD = (?:\([\s\S]*?\)|"""[\s\S]*?""")/,
    `DEFAULT_SOUL_MD = """${escaped}"""`,
  );
  if (updated === content) {
    log("default_soul.py already patched or pattern not found");
    return;
  }
  writeFileSync(defaultSoulPy, updated, "utf-8");
  log("patched hermes_cli/default_soul.py with AI Compartner SOUL.md");
}

function playwrightBrowsers() {
  if (existsSync(BROWSERS_DIR) && existsSync(join(BROWSERS_DIR, "chromium-1223"))) {
    log("playwright chromium already present, skipping");
    return;
  }
  mkdirSync(BROWSERS_DIR, { recursive: true });
  log("downloading playwright chromium into resources/playwright-browsers/");
  run(PYTHON_EXE, ["-m", "playwright", "install", "chromium"], {
    env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: BROWSERS_DIR },
  });
}

function verify() {
  const baseImports =
    "import hermes_cli, playwright, pymupdf; print('runtime OK')";
  const coreImports =
    "import hermes_cli, core, playwright, pymupdf; import onnxruntime; from rapidocr_onnxruntime import RapidOCR; print('runtime OK')";

  if (desktopCoreInstalled()) {
    log("verifying bundled runtime (hermes-agent + desktop-core)");
    execFileSync(PYTHON_EXE, ["-c", coreImports], { stdio: "inherit" });
    return;
  }

  log("verifying bundled runtime (hermes-agent base packages)");
  if (desktopCoreConfigured()) {
    throw new Error(
      "desktop-core is present but `import core` failed — check desktop-core install output",
    );
  }
  execFileSync(PYTHON_EXE, ["-c", baseImports], { stdio: "inherit" });
}

async function prepareBundledSkills() {
  log("bundling hermes-agent skills into resources/python/skills");
  const script = join(ROOT, "scripts", "prepare-bundled-skills.mjs");
  run(process.execPath, [script]);
}

async function patchBundledPython() {
  log("installing desktop relay plugins + Windows subprocess patches");
  const script = join(ROOT, "scripts", "patch-bundled-python.mjs");
  run(process.execPath, [script]);
}

async function main() {
  // Skip the whole prepare step when layered archives already exist — it means
  // resources/python + resources/playwright-browsers were prepared before and
  // packed into core.7z + extras.7z. Re-running pip install / patch steps would
  // touch mtimes and force pack-runtime to rebuild needlessly.
  // Delete resources/core.7z (or set HERMES_FORCE_PREPARE=1) to force re-prepare.
  const forcePrepare = process.env.HERMES_FORCE_PREPARE === "1";
  if (
    !forcePrepare &&
    existsSync(CORE_ARCHIVE_PATH) &&
    existsSync(EXTRAS_ARCHIVE_PATH) &&
    existsSync(PYTHON_EXE) &&
    existsSync(BROWSERS_DIR)
  ) {
    log(
      `core.7z + extras.7z already exist — skipping prepare-runtime. ` +
        `Delete resources/core.7z or set HERMES_FORCE_PREPARE=1 to force re-prepare.`,
    );
    await patchBundledPython();
    return;
  }

  await ensurePython();
  pipInstall();
  await prepareBundledSkills();
  patchBundledSoulBranding();
  playwrightBrowsers();
  await patchBundledPython();
  verify();
  log("done — ready for `electron-builder --win`");
}

main().catch((err) => {
  console.error("[prepare-runtime] FAILED:", err);
  process.exit(1);
});
