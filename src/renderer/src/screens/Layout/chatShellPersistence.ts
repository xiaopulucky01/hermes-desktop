import type { ChatRun } from "./chatRuns";
import { mintRun } from "./chatRuns";

/** Survive soft remounts (sleep/wake renderer reload) without losing open tabs. */
// @lat: [[lat.md/sidebar-navigation#Open chat tabs]]
const CHAT_SHELL_KEY = "hermes.desktop.chatShell";

export interface PersistedChatShell {
  activeProfile: string;
  activeRunId: string;
  runs: Array<{
    profile: string;
    runId: string;
    sessionId: string | null;
    title?: string;
  }>;
}

export function loadPersistedChatShell(): PersistedChatShell | null {
  try {
    const raw = sessionStorage.getItem(CHAT_SHELL_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedChatShell;
    if (
      !parsed ||
      typeof parsed.activeProfile !== "string" ||
      typeof parsed.activeRunId !== "string" ||
      !Array.isArray(parsed.runs) ||
      parsed.runs.length === 0
    ) {
      return null;
    }
    const runs = parsed.runs.filter(
      (r) =>
        r &&
        typeof r.runId === "string" &&
        typeof r.profile === "string" &&
        (r.sessionId === null || typeof r.sessionId === "string"),
    );
    if (runs.length === 0) return null;
    const activeRunId = runs.some((r) => r.runId === parsed.activeRunId)
      ? parsed.activeRunId
      : runs[0]!.runId;
    return {
      activeProfile: parsed.activeProfile || "default",
      activeRunId,
      runs,
    };
  } catch {
    return null;
  }
}

export function persistChatShell(shell: PersistedChatShell): void {
  try {
    const payload: PersistedChatShell = {
      activeProfile: shell.activeProfile,
      activeRunId: shell.activeRunId,
      runs: shell.runs.map((r) => ({
        runId: r.runId,
        profile: r.profile,
        sessionId: r.sessionId,
        ...(r.title ? { title: r.title } : {}),
      })),
    };
    sessionStorage.setItem(CHAT_SHELL_KEY, JSON.stringify(payload));
  } catch {
    /* sessionStorage may be unavailable */
  }
}

/** Restore ChatRun objects from a persisted shell (empty transcripts; hydrate later). */
export function chatRunsFromPersistedShell(
  shell: PersistedChatShell,
): { activeRunId: string; runs: ChatRun[] } {
  const runs: ChatRun[] = shell.runs.map((r) => ({
    runId: r.runId,
    profile: r.profile,
    sessionId: r.sessionId,
    loading: false,
    ...(r.title ? { title: r.title } : {}),
  }));
  if (runs.length === 0) {
    const fallback = mintRun(shell.activeProfile || "default");
    return { activeRunId: fallback.runId, runs: [fallback] };
  }
  return { activeRunId: shell.activeRunId, runs };
}
