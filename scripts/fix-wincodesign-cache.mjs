/**
 * Pre-seed electron-builder's winCodeSign cache so Windows packaging does not
 * fail extracting macOS .dylib symlinks ("客户端没有所需的特权").
 *
 * The Go `app-builder rcedit` path always downloads legacy winCodeSign-2.6.0
 * (toolsets.winCodeSign in electron-builder.yml does not affect that call).
 * Once `%LOCALAPPDATA%/electron-builder/Cache/winCodeSign/winCodeSign-2.6.0`
 * exists as a directory, DownloadArtifact skips download+extract.
 *
 * @see https://github.com/electron-userland/electron-builder/issues/8149
 */
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const VERSION = "2.6.0";
const ARCHIVE_NAME = `winCodeSign-${VERSION}.7z`;
const URL = `https://github.com/electron-userland/electron-builder-binaries/releases/download/winCodeSign-${VERSION}/${ARCHIVE_NAME}`;
const WIN_CODE_SIGN_CACHE = process.env.ELECTRON_BUILDER_CACHE
  ? join(process.env.ELECTRON_BUILDER_CACHE, "winCodeSign")
  : join(process.env.LOCALAPPDATA, "electron-builder", "Cache", "winCodeSign");
const FINAL_DIR = join(WIN_CODE_SIGN_CACHE, `winCodeSign-${VERSION}`);
const SEVEN_ZA = join(ROOT, "node_modules", "7zip-bin", "win", "x64", "7za.exe");

function log(msg) {
  console.log(`[fix-wincodesign-cache] ${msg}`);
}

function ensureDylibPlaceholders(extractDir) {
  const libDir = join(extractDir, "darwin", "10.12", "lib");
  if (!existsSync(libDir)) return;
  for (const [link, target] of [
    ["libcrypto.dylib", "libcrypto.1.0.0.dylib"],
    ["libssl.dylib", "libssl.1.0.0.dylib"],
  ]) {
    const linkPath = join(libDir, link);
    const targetPath = join(libDir, target);
    if (existsSync(targetPath)) {
      try {
        copyFileSync(targetPath, linkPath);
      } catch {
        writeFileSync(linkPath, "");
      }
    } else if (!existsSync(linkPath)) {
      writeFileSync(linkPath, "");
    }
  }
}

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(`Download failed: ${res.status} ${res.statusText} (${url})`);
  }
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
}

async function main() {
  if (process.platform !== "win32") {
    log("skip (not Windows)");
    return;
  }
  if (!process.env.LOCALAPPDATA && !process.env.ELECTRON_BUILDER_CACHE) {
    throw new Error("LOCALAPPDATA / ELECTRON_BUILDER_CACHE is unset");
  }
  if (existsSync(join(FINAL_DIR, "rcedit-x64.exe"))) {
    log(`already ready: ${FINAL_DIR}`);
    return;
  }

  mkdirSync(WIN_CODE_SIGN_CACHE, { recursive: true });
  const archivePath = join(WIN_CODE_SIGN_CACHE, ARCHIVE_NAME);
  if (!existsSync(archivePath)) {
    log(`downloading ${URL}`);
    await download(URL, archivePath);
  } else {
    log(`using cached archive ${archivePath}`);
  }

  if (!existsSync(SEVEN_ZA)) {
    throw new Error(`7za not found at ${SEVEN_ZA}`);
  }

  const staging = join(WIN_CODE_SIGN_CACHE, `winCodeSign-${VERSION}.staging`);
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });

  log("extracting (symlink errors are expected and ignored)");
  const extracted = spawnSync(
    SEVEN_ZA,
    ["x", "-bd", archivePath, `-o${staging}`],
    { encoding: "utf8" },
  );
  // Exit 2 = warnings (symlink privilege). Still OK if rcedit landed.
  if (!existsSync(join(staging, "rcedit-x64.exe"))) {
    console.error(extracted.stdout || "");
    console.error(extracted.stderr || "");
    throw new Error(
      `Extract failed (exit ${extracted.status}); rcedit-x64.exe missing`,
    );
  }

  ensureDylibPlaceholders(staging);
  rmSync(FINAL_DIR, { recursive: true, force: true });
  renameSync(staging, FINAL_DIR);
  log(`seeded ${FINAL_DIR}`);
}

main().catch((err) => {
  console.error(
    `[fix-wincodesign-cache] ${err instanceof Error ? err.message : err}`,
  );
  process.exit(1);
});
