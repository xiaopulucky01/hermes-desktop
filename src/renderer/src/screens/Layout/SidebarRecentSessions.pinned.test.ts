import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  countSidebarChats,
  mergePinnedIntoSessionPage,
  PINNED_IDS_KEY,
  readPinnedIdsForProfile,
  sortPinnedByRecency,
  storePinnedIdsForProfile,
} from "./SidebarRecentSessions";

// @lat: [[sidebar-navigation#Pinned sessions on open]]
describe("mergePinnedIntoSessionPage", () => {
  it("prepends pinned sessions that fall outside the first recent page", () => {
    const page = [
      { id: "recent-1", title: "New", startedAt: 200, contextFolder: null },
      { id: "recent-2", title: "Also new", startedAt: 150, contextFolder: null },
    ];
    const pool = [
      ...page,
      {
        id: "old-pinned",
        title: "Pinned old",
        startedAt: 50,
        contextFolder: "/proj",
      },
    ];
    const merged = mergePinnedIntoSessionPage(
      page,
      new Set(["old-pinned"]),
      pool,
    );
    expect(merged.map((s) => s.id)).toEqual([
      "old-pinned",
      "recent-1",
      "recent-2",
    ]);
    expect(merged[0].contextFolder).toBe("/proj");
    expect(merged[0].startedAt).toBe(50);
  });

  it("does not duplicate a pin already on the page", () => {
    const page = [
      { id: "p1", title: "Pinned", startedAt: 100, contextFolder: null },
    ];
    const merged = mergePinnedIntoSessionPage(page, new Set(["p1"]), page);
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe("p1");
  });
});

describe("sortPinnedByRecency", () => {
  it("orders pinned rows by startedAt descending regardless of list order", () => {
    const rows = [
      { id: "old", title: "Old", startedAt: 10, contextFolder: null },
      { id: "new", title: "New", startedAt: 30, contextFolder: null },
      { id: "mid", title: "Mid", startedAt: 20, contextFolder: null },
    ];
    expect(sortPinnedByRecency(rows).map((s) => s.id)).toEqual([
      "new",
      "mid",
      "old",
    ]);
  });
});

describe("countSidebarChats", () => {
  it("counts only unpinned non-project sessions", () => {
    const pool = [
      { id: "c1", contextFolder: null },
      { id: "c2", contextFolder: null },
      { id: "p1", contextFolder: null },
      { id: "proj", contextFolder: "/work" },
    ];
    expect(countSidebarChats(pool, new Set(["p1"]))).toBe(2);
  });
});

describe("readPinnedIdsForProfile / storePinnedIdsForProfile", () => {
  const memory = new Map<string, string>();

  beforeEach(() => {
    memory.clear();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => memory.get(key) ?? null,
        setItem: (key: string, value: string) => {
          memory.set(key, value);
        },
        removeItem: (key: string) => {
          memory.delete(key);
        },
      },
    });
  });

  afterEach(() => {
    memory.clear();
  });

  it("stores and reads pins scoped to a profile", () => {
    storePinnedIdsForProfile("agent-a", new Set(["s1", "s2"]));
    storePinnedIdsForProfile("agent-b", new Set(["s9"]));
    expect(Array.from(readPinnedIdsForProfile("agent-a")).sort()).toEqual([
      "s1",
      "s2",
    ]);
    expect(Array.from(readPinnedIdsForProfile("agent-b"))).toEqual(["s9"]);
    expect(readPinnedIdsForProfile("other").size).toBe(0);
  });

  it("migrates a legacy flat id list into the profile that first reads it", () => {
    localStorage.setItem(
      PINNED_IDS_KEY,
      JSON.stringify(["legacy-1", "legacy-2"]),
    );
    expect(Array.from(readPinnedIdsForProfile("coder")).sort()).toEqual([
      "legacy-1",
      "legacy-2",
    ]);
    const stored = JSON.parse(
      localStorage.getItem(PINNED_IDS_KEY) || "{}",
    ) as Record<string, string[]>;
    expect(stored).toEqual({ coder: ["legacy-1", "legacy-2"] });
    expect(readPinnedIdsForProfile("default").size).toBe(0);
  });

  it("does not clobber another profile when updating pins", () => {
    storePinnedIdsForProfile("a", new Set(["keep-me"]));
    storePinnedIdsForProfile("b", new Set(["temp"]));
    storePinnedIdsForProfile("b", new Set(["updated"]));
    expect(Array.from(readPinnedIdsForProfile("a"))).toEqual(["keep-me"]);
    expect(Array.from(readPinnedIdsForProfile("b"))).toEqual(["updated"]);
  });
});
