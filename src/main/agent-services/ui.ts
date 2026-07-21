import { join } from "path";
import { pathToFileURL } from "url";
import { existsSync } from "fs";
import { BrowserWindow, shell } from "electron";
import { getAgentServiceWorkDir } from "./installer";
import { readManifest, readState } from "./catalog";

/** Resolve openable UI URL for a running/stopped agent service. */
export function resolveAgentServiceUiUrl(id: string): {
  success: boolean;
  url?: string;
  title?: string;
  error?: string;
} {
  const manifest = readManifest(id);
  if (!manifest) return { success: false, error: "Agent not installed" };
  const ui = manifest.ui;
  if (!ui || !ui.type || ui.type === "none") {
    return { success: false, error: "No UI declared for this agent" };
  }
  const state = readState(id);
  const title = ui.title || manifest.name;

  if (ui.type === "webview") {
    const port = state.port;
    if (!port) {
      return { success: false, error: "Agent is not running (no port)" };
    }
    const template = ui.url || "http://127.0.0.1:${PORT}/";
    const url = template.replace(/\$\{PORT\}/g, String(port));
    return { success: true, url, title };
  }

  if (ui.type === "static") {
    const workDir = getAgentServiceWorkDir(id);
    if (!workDir || !ui.path) {
      return { success: false, error: "Static UI path missing" };
    }
    const abs = join(workDir, ui.path);
    if (!existsSync(abs)) {
      return { success: false, error: `UI file not found: ${ui.path}` };
    }
    return { success: true, url: pathToFileURL(abs).href, title };
  }

  return { success: false, error: `Unsupported UI type: ${ui.type}` };
}

/**
 * Open the agent service UI: localhost HTTP via system browser,
 * `file://` static UIs in a dedicated BrowserWindow.
 */
export async function openAgentServiceUi(id: string): Promise<{
  success: boolean;
  url?: string;
  title?: string;
  error?: string;
}> {
  // @lat: [[lat.md/agent-services#Agent services#IPC and preload#Open agent UI]]
  const resolved = resolveAgentServiceUiUrl(id);
  if (!resolved.success || !resolved.url) return resolved;

  try {
    if (resolved.url.startsWith("file:")) {
      const win = new BrowserWindow({
        width: 960,
        height: 720,
        title: resolved.title || "Agent UI",
        autoHideMenuBar: true,
        webPreferences: {
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
        },
      });
      await win.loadURL(resolved.url);
    } else {
      // Only allow loopback HTTP(S) for agent UIs.
      const u = new URL(resolved.url);
      if (
        u.protocol !== "http:" &&
        u.protocol !== "https:"
      ) {
        return { success: false, error: `Blocked UI protocol: ${u.protocol}` };
      }
      const host = u.hostname;
      if (host !== "127.0.0.1" && host !== "localhost" && host !== "[::1]") {
        return { success: false, error: "Agent UI must be on localhost" };
      }
      await shell.openExternal(resolved.url);
    }
    return { success: true, url: resolved.url, title: resolved.title };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to open UI",
    };
  }
}
