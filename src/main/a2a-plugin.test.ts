import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockApp = {
  isPackaged: false,
  getAppPath: () => "/fake/app",
};

const profileMocks = vi.hoisted(() => ({
  configFile: "",
  home: "",
}));

vi.mock("electron", () => ({ app: mockApp }));
vi.mock("./config", () => ({
  readEnv: vi.fn(() => ({})),
  setEnvValue: vi.fn(),
}));
vi.mock("./utils", () => ({
  profilePaths: () => ({
    home: profileMocks.home,
    configFile: profileMocks.configFile,
    envFile: join(profileMocks.home, ".env"),
    profile: "default",
  }),
  safeWriteFile: (filePath: string, content: string) => {
    writeFileSync(filePath, content, "utf-8");
  },
}));

describe("a2a-plugin", () => {
  let tempDir: string;
  let hermesHome: string;

  beforeEach(() => {
    vi.resetModules();
    tempDir = mkdtempSync(join(tmpdir(), "hermes-a2a-test-"));
    hermesHome = join(tempDir, "hermes-home");
    mkdirSync(hermesHome, { recursive: true });
    profileMocks.home = hermesHome;
    profileMocks.configFile = join(hermesHome, "config.yaml");
    delete process.env.HERMES_A2A_ROOT;
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function writePluginTree(a2aRoot: string): string {
    const pluginDir = join(a2aRoot, "plugins", "platforms", "a2a");
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(join(pluginDir, "plugin.yaml"), "name: a2a-platform\n");
    return pluginDir;
  }

  it("resolves plugin dir from HERMES_A2A_ROOT", async () => {
    const a2aRoot = join(tempDir, "hermes-a2a");
    const pluginDir = writePluginTree(a2aRoot);
    process.env.HERMES_A2A_ROOT = a2aRoot;

    const { resolveHermesA2aPluginDir } = await import("./a2a-plugin");
    expect(resolveHermesA2aPluginDir()).toBe(pluginDir);
  });

  // @lat: [[a2a-integration#A2A integration#Junction layout]]
  it("junctions plugin into HERMES_HOME idempotently", async () => {
    const a2aRoot = join(tempDir, "hermes-a2a");
    const pluginDir = writePluginTree(a2aRoot);
    process.env.HERMES_A2A_ROOT = a2aRoot;

    const { ensureA2aPluginLinked } = await import("./a2a-plugin");
    expect(ensureA2aPluginLinked(hermesHome)).toBe(true);
    expect(ensureA2aPluginLinked(hermesHome)).toBe(true);

    const link = join(hermesHome, "plugins", "platforms", "a2a");
    expect(existsSync(link)).toBe(true);
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(resolve(readlinkSync(link))).toBe(pluginDir);
  });

  // @lat: [[a2a-integration#A2A integration#Enablement]]
  it("auto-configures A2A in config.yaml when plugin is present", async () => {
    const a2aRoot = join(tempDir, "hermes-a2a");
    writePluginTree(a2aRoot);
    process.env.HERMES_A2A_ROOT = a2aRoot;

    writeFileSync(
      profileMocks.configFile,
      `model:
  provider: alibaba
  default: qwen

# Desktop app API server (auto-configured)
platforms:
  api_server:
    enabled: true
    extra:
      port: 8642
      host: "127.0.0.1"
`,
    );

    const { ensureA2aConfig } = await import("./a2a-plugin");
    expect(ensureA2aConfig()).toBe(true);
    expect(ensureA2aConfig()).toBe(false);

    const updated = readFileSync(profileMocks.configFile, "utf-8");
    expect(updated).toContain("a2a-platform");
    expect(updated).toMatch(/^\s+a2a:\s*$/m);
    expect(updated).toContain("port: 9900");
    expect(updated).toContain("streaming: true");
  });

  // @lat: [[a2a-integration#A2A integration#Remote access]]
  it("auto-configures A2A bearer token and bind host in .env", async () => {
    const { readEnv, setEnvValue } = await import("./config");
    const mockedReadEnv = vi.mocked(readEnv);
    const mockedSetEnvValue = vi.mocked(setEnvValue);
    mockedReadEnv.mockReturnValue({});

    const { ensureA2aEnv } = await import("./a2a-plugin");
    expect(ensureA2aEnv()).toBe(true);
    expect(mockedSetEnvValue).toHaveBeenCalledWith(
      "A2A_BEARER_TOKEN",
      expect.any(String),
      undefined,
    );
    expect(mockedSetEnvValue).toHaveBeenCalledWith(
      "A2A_HOST",
      "0.0.0.0",
      undefined,
    );
    mockedReadEnv.mockReturnValue({
      A2A_BEARER_TOKEN: "existing",
      A2A_HOST: "127.0.0.1",
    });
    expect(ensureA2aEnv()).toBe(false);
  });
});
