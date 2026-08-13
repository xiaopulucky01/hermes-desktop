import { describe, expect, it } from "vitest";
import {
  buildLocalDashboardCliArgs,
  buildTuiGatewayCliArgs,
} from "../src/main/dashboard-launch";

describe("local dashboard launch args", () => {
  it("keeps the browser-dashboard command shape for non-chat surfaces", () => {
    expect(buildLocalDashboardCliArgs(undefined, 9123)).toEqual([
      "dashboard",
      "--isolated",
      "--no-open",
      "--host",
      "127.0.0.1",
      "--port",
      "9123",
    ]);
  });

  it("preserves profile and prebuilt web-dist support without the legacy --tui flag", () => {
    const args = buildLocalDashboardCliArgs("work", 9123, { skipBuild: true });

    expect(args).toEqual([
      "--profile",
      "work",
      "dashboard",
      "--isolated",
      "--no-open",
      "--host",
      "127.0.0.1",
      "--port",
      "9123",
      "--skip-build",
    ]);
    expect(args).not.toContain("--tui");
  });
});

// @lat: [[main-process#Local TUI gateway]]
describe("local TUI gateway launch args", () => {
  it("uses headless hermes serve so chat never waits on the SPA npm build", () => {
    expect(buildTuiGatewayCliArgs(9124)).toEqual([
      "serve",
      "--no-open",
      "--host",
      "127.0.0.1",
      "--port",
      "9124",
    ]);
    expect(buildTuiGatewayCliArgs(9124)).not.toContain("dashboard");
  });
});
