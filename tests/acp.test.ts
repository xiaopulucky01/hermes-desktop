import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  isRemoteMode: vi.fn(() => false),
}));

vi.mock("../src/main/hermes", () => ({
  isRemoteMode: mocks.isRemoteMode,
}));

vi.mock("../src/main/installer", () => ({
  buildHermesChildEnv: () => ({
    HERMES_HOME: "C:\\Users\\test\\.hermes",
    PYTHONPATH: "C:\\site-packages",
    PYTHONUNBUFFERED: "1",
  }),
  getHermesCliSpawnError: () => null,
  getHermesPythonSpawnPath: () => "C:\\Python\\python.exe",
  hermesCliArgs: (args: string[]) => ["-m", "hermes_cli.main", ...args],
  hermesPythonSourceRoot: () => "C:\\site-packages",
  HERMES_HOME: "C:\\Users\\test\\.hermes",
  isBundledEngineActive: () => true,
}));

import {
  buildAcpLauncherScript,
  getAcpLaunchInfo,
} from "../src/main/acp";

const IS_WINDOWS = process.platform === "win32";

describe("ACP integration", () => {
  beforeEach(() => {
    mocks.isRemoteMode.mockReturnValue(false);
  });

  it("builds a launcher script with env and acp subcommand", () => {
    const content = buildAcpLauncherScript(
      IS_WINDOWS ? "C:\\Python\\python.exe" : "/usr/bin/python3",
      ["-m", "hermes_cli.main", "acp"],
      {
        HERMES_HOME: IS_WINDOWS ? "C:\\Users\\test\\.hermes" : "/home/test/.hermes",
        PYTHONPATH: IS_WINDOWS ? "C:\\site-packages" : "/site-packages",
        PYTHONUNBUFFERED: "1",
      },
    );

    expect(content).toContain("HERMES_HOME");
    expect(content).toContain("hermes_cli.main");
    expect(content).toContain("acp");
    if (IS_WINDOWS) {
      expect(content).toContain("@echo off");
    } else {
      expect(content).toContain("#!/bin/sh");
    }
  });

  it("returns remote_mode when not in local mode", () => {
    mocks.isRemoteMode.mockReturnValue(true);
    const info = getAcpLaunchInfo();
    expect(info.available).toBe(false);
    expect(info.unavailableReason).toBe("remote_mode");
  });
});
