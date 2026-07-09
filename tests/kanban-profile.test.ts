import { describe, expect, it } from "vitest";
import { validateLocalKanbanProfile } from "../src/main/kanban";

// @lat: [[kanban#Kanban board tab]]
describe("validateLocalKanbanProfile", () => {
  it("allows default / omitted profile", () => {
    expect(validateLocalKanbanProfile()).toBeNull();
    expect(validateLocalKanbanProfile("default")).toBeNull();
  });

  it("rejects unknown named profiles before spawning the CLI", () => {
    const err = validateLocalKanbanProfile("definitely-missing-profile-xyz");
    expect(err).toMatch(/Profile 'definitely-missing-profile-xyz'/);
    expect(err).toMatch(/Agents/);
  });
});
