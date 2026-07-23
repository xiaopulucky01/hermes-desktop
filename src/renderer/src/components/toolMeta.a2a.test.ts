import { describe, expect, it } from "vitest";
import {
  extractA2aLastProgressLine,
  extractA2aProgressLines,
} from "./toolMeta";

describe("A2A progress parsing", () => {
  it("extracts progress timeline lines", () => {
    const content = `[InkOS Agent · context c · task t · completed]
final body

--- progress ---
[InkOS Agent · working] Connecting…
[InkOS Agent · working] InkOS · 开始
[InkOS Agent · completed] done
`;
    expect(extractA2aProgressLines(content)).toEqual([
      "[InkOS Agent · working] Connecting…",
      "[InkOS Agent · working] InkOS · 开始",
      "[InkOS Agent · completed] done",
    ]);
    expect(extractA2aLastProgressLine(content)).toBe(
      "[InkOS Agent · completed] done",
    );
  });

  it("returns empty when no progress block", () => {
    expect(extractA2aProgressLines("just text")).toEqual([]);
  });
});
