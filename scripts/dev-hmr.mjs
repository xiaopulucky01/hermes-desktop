/**
 * Opt-in Vite HMR for active coding. Default `npm run dev` keeps sessions
 * stable across sleep/resume (no HMR client, no chokidar watch).
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const child = spawn(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["electron-vite", "dev"],
  {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, HERMES_DEV_HMR: "1" },
    shell: process.platform === "win32",
  },
);

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
