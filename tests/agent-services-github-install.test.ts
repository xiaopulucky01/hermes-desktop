import { describe, it, expect } from "vitest";
import { installAgentServiceFromGitHub } from "../src/main/agent-services/installer";

describe("installAgentServiceFromGitHub", () => {
  // @lat: [[lat.md/agent-services#Agent services#Installation#Install from GitHub]]
  it("rejects invalid repo names before download", async () => {
    const res = await installAgentServiceFromGitHub("not-a-repo");
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/Invalid GitHub repo/i);
  });
});
