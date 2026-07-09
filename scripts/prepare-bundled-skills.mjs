#!/usr/bin/env node
/**
 * Populate resources/python/skills/ with the hermes-agent official skill tree.
 *
 * Out-of-box installs ship this directory via electron-builder extraResources
 * (resources/python → <Install>/resources/python). The desktop GUI and Python
 * sync_skills() both discover skills here instead of a user-side git clone.
 *
 * Source resolution (first match wins):
 *   1. HERMES_AGENT_SKILLS_SOURCE — explicit directory (dev / CI mirror)
 *   2. ~/.hermes2/hermes-agent/skills, ~/.hermes/hermes-agent/skills
 *   3. ../hermes-agent/skills (sibling git clone)
 *   4. HERMES_AGENT_SKILLS_TAR or resources/hermes-agent-skills.tar.gz (manual)
 *   5. GitHub tarball (codeload, then github.com archive fallback)
 *
 * After the official tree is in place, overlays repo `custom-skills/` (category/skill
 * layout) into resources/python/skills for out-of-box desktop-only skills.
 *
 * Idempotent: skips official re-copy when .bundled-skills-version matches installed
 * hermes-agent; custom-skills overlay always runs.
 */
import { execFileSync, spawnSync } from "node:child_process";
import dns from "node:dns";
import {
  cpSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import https from "node:https";

// Prefer IPv4 — on some Windows networks IPv6 DNS for GitHub fails while browsers work.
dns.setDefaultResultOrder("ipv4first");

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const RESOURCES = join(ROOT, "resources");
const PYTHON_DIR = join(RESOURCES, "python");
const PYTHON_EXE = join(PYTHON_DIR, "python.exe");
const SKILLS_DEST = join(PYTHON_DIR, "skills");
const CUSTOM_SKILLS_SRC = join(ROOT, "custom-skills");
const VERSION_FILE = join(SKILLS_DEST, ".bundled-skills-version");
const MANUAL_TAR_PATH = join(RESOURCES, "hermes-agent-skills.tar.gz");
const CACHE_TAR_PATH = join(RESOURCES, ".hermes-agent-skills.tar.gz");

const DOWNLOAD_RETRIES = Number(process.env.HERMES_SKILLS_DOWNLOAD_RETRIES || 6);
const DOWNLOAD_TIMEOUT_MS = Number(
  process.env.HERMES_SKILLS_DOWNLOAD_TIMEOUT_MS || 120_000,
);

const GITHUB_TARBALL_URLS = [
  process.env.HERMES_AGENT_SKILLS_URL?.trim(),
  "https://codeload.github.com/NousResearch/hermes-agent/tar.gz/main",
  "https://github.com/NousResearch/hermes-agent/archive/refs/heads/main.tar.gz",
].filter(Boolean);

function log(msg) {
  console.log(`[prepare-bundled-skills] ${msg}`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function installedHermesAgentVersion() {
  if (!existsSync(PYTHON_EXE)) return "";
  try {
    const out = execFileSync(
      PYTHON_EXE,
      [
        "-c",
        "import importlib.metadata as m; print(m.version('hermes-agent'))",
      ],
      { encoding: "utf-8", timeout: 15_000 },
    );
    return out.trim();
  } catch {
    return "";
  }
}

/** True when dir looks like hermes-agent/skills (category/skill/SKILL.md). */
function skillsTreeLooksValid(dir) {
  if (!existsSync(dir)) return false;
  try {
    for (const entry of readdirSync(dir)) {
      const catPath = join(dir, entry);
      if (!statSync(catPath).isDirectory()) continue;
      for (const skill of readdirSync(catPath)) {
        const skillPath = join(catPath, skill);
        if (
          statSync(skillPath).isDirectory() &&
          existsSync(join(skillPath, "SKILL.md"))
        ) {
          return true;
        }
      }
    }
  } catch {
    return false;
  }
  return false;
}

function resolveLocalSource() {
  const explicit = process.env.HERMES_AGENT_SKILLS_SOURCE?.trim();
  if (explicit && skillsTreeLooksValid(explicit)) {
    log(`using HERMES_AGENT_SKILLS_SOURCE=${explicit}`);
    return explicit;
  }

  const home = homedir();
  const candidates = [
    join(home, ".hermes2", "hermes-agent", "skills"),
    join(home, ".hermes", "hermes-agent", "skills"),
    join(process.env.LOCALAPPDATA || "", "AI-Compartner", "hermes-agent", "skills"),
    join(ROOT, "..", "hermes-agent", "skills"),
    join(ROOT, "hermes-agent", "skills"),
  ].filter(Boolean);

  for (const dir of candidates) {
    if (skillsTreeLooksValid(dir)) {
      log(`using local hermes-agent skills at ${dir}`);
      return dir;
    }
  }
  return null;
}

function resolveManualTarballPath() {
  const fromEnv = process.env.HERMES_AGENT_SKILLS_TAR?.trim();
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  if (existsSync(MANUAL_TAR_PATH)) return MANUAL_TAR_PATH;
  if (existsSync(CACHE_TAR_PATH)) return CACHE_TAR_PATH;
  return null;
}

function tarballLooksValid(path) {
  if (!existsSync(path)) return false;
  try {
    return statSync(path).size > 64 * 1024;
  } catch {
    return false;
  }
}

function copySkillsTree(src) {
  if (existsSync(SKILLS_DEST)) {
    rmSync(SKILLS_DEST, { recursive: true, force: true });
  }
  mkdirSync(dirname(SKILLS_DEST), { recursive: true });
  cpSync(src, SKILLS_DEST, { recursive: true, force: true });
}

/** Merge git-tracked custom-skills/<category>/<name>/ into bundled skills. */
function overlayCustomSkills() {
  if (!existsSync(CUSTOM_SKILLS_SRC)) {
    log("custom-skills/ not found — skipping overlay");
    return 0;
  }
  if (!skillsTreeLooksValid(CUSTOM_SKILLS_SRC)) {
    log("custom-skills/ has no category/skill/SKILL.md tree — skipping overlay");
    return 0;
  }
  mkdirSync(SKILLS_DEST, { recursive: true });
  let count = 0;
  for (const category of readdirSync(CUSTOM_SKILLS_SRC)) {
    const srcCategory = join(CUSTOM_SKILLS_SRC, category);
    if (!statSync(srcCategory).isDirectory()) continue;
    cpSync(srcCategory, join(SKILLS_DEST, category), {
      recursive: true,
      force: true,
    });
    count += 1;
  }
  log(`overlay ${count} custom-skills categor${count === 1 ? "y" : "ies"} → ${SKILLS_DEST}`);
  return count;
}

function downloadFileOnce(url, dest) {
  return new Promise((resolveP, rejectP) => {
    const out = createWriteStream(dest);
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
            "User-Agent": "hermes-desktop-prepare-bundled-skills",
            Accept: "*/*",
          },
        },
        (res) => {
          if ([301, 302, 307, 308].includes(res.statusCode)) {
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

async function downloadFileWithRetries(url, dest) {
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
      const code =
        err && typeof err === "object" && "code" in err ? String(err.code) : "";
      log(
        `download attempt ${attempt}/${DOWNLOAD_RETRIES} failed` +
          (code ? ` (${code})` : `: ${err instanceof Error ? err.message : String(err)}`),
      );
      if (attempt < DOWNLOAD_RETRIES) {
        const delay = 2000 * attempt;
        log(`retrying in ${delay / 1000}s…`);
        await sleep(delay);
      }
    }
  }
  throw lastErr ?? new Error("download failed");
}

async function downloadSkillsTarball(dest) {
  const manual = resolveManualTarballPath();
  if (manual) {
    log(`using manual tarball ${manual}`);
    const src = resolve(manual);
    const out = resolve(dest);
    if (src !== out) {
      cpSync(manual, dest);
    }
    if (!tarballLooksValid(out)) {
      throw new Error(`manual tarball too small: ${manual}`);
    }
    return;
  }

  let lastErr;
  for (const url of GITHUB_TARBALL_URLS) {
    try {
      await downloadFileWithRetries(url, dest);
      return;
    } catch (err) {
      lastErr = err;
      log(`URL failed: ${url}`);
    }
  }
  printManualDownloadHelp();
  throw lastErr ?? new Error("all GitHub download URLs failed");
}

function printManualDownloadHelp() {
  console.error("");
  console.error("[prepare-bundled-skills] GitHub download failed. Options:");
  console.error("  1. Retry: npm run prepare-runtime");
  console.error("  2. Manual tarball — download in browser:");
  console.error("     https://github.com/NousResearch/hermes-agent/archive/refs/heads/main.tar.gz");
  console.error(`     Save as: ${MANUAL_TAR_PATH}`);
  console.error("     Or set HERMES_AGENT_SKILLS_TAR to the full path");
  console.error("  3. Local skills tree — clone hermes-agent and set:");
  console.error("     HERMES_AGENT_SKILLS_SOURCE=C:\\path\\to\\hermes-agent\\skills");
  console.error("  4. Proxy: set HTTPS_PROXY / ALL_PROXY for Node.js");
  console.error("");
}

function extractSkillsFromTarball(tarPath) {
  const extractRoot = join(RESOURCES, ".hermes-agent-extract");
  if (existsSync(extractRoot)) {
    rmSync(extractRoot, { recursive: true, force: true });
  }
  mkdirSync(extractRoot, { recursive: true });

  const tar = spawnSync("tar", ["-xzf", tarPath, "-C", extractRoot], {
    stdio: "inherit",
    shell: false,
  });
  if (tar.status !== 0) {
    throw new Error(`tar extract failed with status ${tar.status}`);
  }

  const extracted = readdirSync(extractRoot).find((name) =>
    name.startsWith("hermes-agent"),
  );
  if (!extracted) {
    throw new Error("tarball did not contain hermes-agent-* directory");
  }
  const skillsSrc = join(extractRoot, extracted, "skills");
  if (!skillsTreeLooksValid(skillsSrc)) {
    throw new Error(`downloaded tree missing valid skills/ at ${skillsSrc}`);
  }
  copySkillsTree(skillsSrc);
  rmSync(extractRoot, { recursive: true, force: true });
  log(`extracted skills from tarball → ${SKILLS_DEST}`);
}

async function downloadSkillsFromGitHub() {
  const tarPath = CACHE_TAR_PATH;

  for (let attempt = 0; attempt < 2; attempt++) {
    await downloadSkillsTarball(tarPath);
    try {
      extractSkillsFromTarball(tarPath);
      break;
    } catch (err) {
      if (attempt === 0 && existsSync(tarPath)) {
        log(
          `tarball extract failed (${err instanceof Error ? err.message : String(err)}) — removing ${tarPath} and retrying`,
        );
        rmSync(tarPath, { force: true });
        continue;
      }
      throw err;
    }
  }

  rmSync(tarPath, { force: true });
}

function writeVersionMarker(version) {
  writeFileSync(VERSION_FILE, `${version || "unknown"}\n`, "utf-8");
}

function shouldSkip(version) {
  if (!skillsTreeLooksValid(SKILLS_DEST)) return false;
  if (!existsSync(VERSION_FILE)) return false;
  const stamped = readFileSync(VERSION_FILE, "utf-8").trim();
  if (!version) return false;
  return stamped === version;
}

async function main() {
  const version = installedHermesAgentVersion();
  if (shouldSkip(version)) {
    log(
      `skills already present for hermes-agent ${version} at ${SKILLS_DEST}, skipping official copy`,
    );
  } else {
    const local = resolveLocalSource();
    if (local) {
      copySkillsTree(local);
      writeVersionMarker(version || "local");
      log(`copied ${local} → ${SKILLS_DEST}`);
    } else {
      await downloadSkillsFromGitHub();
      writeVersionMarker(version || "github-main");
    }
  }

  overlayCustomSkills();
}

main().catch((err) => {
  console.error("[prepare-bundled-skills] FAILED:", err);
  process.exit(1);
});
