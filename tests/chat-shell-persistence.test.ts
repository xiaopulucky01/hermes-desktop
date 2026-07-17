import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  chatRunsFromPersistedShell,
  loadPersistedChatShell,
  persistChatShell,
  type PersistedChatShell,
} from "../src/renderer/src/screens/Layout/chatShellPersistence";

describe("chatShellPersistence", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  // @lat: [[lat.md/sidebar-navigation#Open chat tabs]]
  it("round-trips open chat tabs for sleep remount restore", () => {
    const shell: PersistedChatShell = {
      activeProfile: "work",
      activeRunId: "run-1",
      runs: [
        {
          runId: "run-1",
          profile: "work",
          sessionId: "sess-abc",
          title: "Hello",
        },
        { runId: "run-2", profile: "default", sessionId: null },
      ],
    };
    persistChatShell(shell);
    expect(loadPersistedChatShell()).toEqual(shell);
    const restored = chatRunsFromPersistedShell(shell);
    expect(restored.activeRunId).toBe("run-1");
    expect(restored.runs).toHaveLength(2);
    expect(restored.runs[0]).toMatchObject({
      runId: "run-1",
      sessionId: "sess-abc",
      title: "Hello",
      loading: false,
    });
  });

  it("rejects corrupt shells", () => {
    sessionStorage.setItem("hermes.desktop.chatShell", "{nope");
    expect(loadPersistedChatShell()).toBeNull();
  });
});
