import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../src/main/config", () => ({
  getModelConfig: vi.fn(),
  readEnv: vi.fn(),
}));

vi.mock("../src/main/installer", () => ({
  expectedEnvKeyForModel: vi.fn(),
}));

vi.mock("../src/main/host-derived-env", () => ({
  hostDerivedEnvKeyForUrl: vi.fn(() => null),
}));

vi.mock("../src/main/models", () => ({
  readModels: vi.fn(() => []),
}));

vi.mock("../src/main/provider-registry", () => ({
  canonicalProviderBaseUrl: vi.fn(() => null),
}));

vi.mock("../src/main/secrets", () => ({
  providerListSafe: vi.fn(() => ({})),
}));

vi.mock("../src/main/utils", () => ({
  getActiveProfileNameSync: vi.fn(() => "default"),
}));

import { getModelConfig, readEnv } from "../src/main/config";
import { expectedEnvKeyForModel } from "../src/main/installer";
import { hostDerivedEnvKeyForUrl } from "../src/main/host-derived-env";
import { canonicalProviderBaseUrl } from "../src/main/provider-registry";
import { resolveHermesLlmEnvForAgents } from "../src/main/agent-services/llm-env";

const mockedGetModelConfig = vi.mocked(getModelConfig);
const mockedReadEnv = vi.mocked(readEnv);
const mockedExpectedKey = vi.mocked(expectedEnvKeyForModel);
const mockedHostKey = vi.mocked(hostDerivedEnvKeyForUrl);
const mockedCanonical = vi.mocked(canonicalProviderBaseUrl);

describe("resolveHermesLlmEnvForAgents", () => {
  const prev = process.env.HERMES_AGENT_SERVICES_INHERIT_LLM;

  beforeEach(() => {
    delete process.env.HERMES_AGENT_SERVICES_INHERIT_LLM;
    mockedGetModelConfig.mockReturnValue({
      provider: "custom",
      model: "qwen2.7-plus",
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    });
    mockedReadEnv.mockReturnValue({
      DASHSCOPE_API_KEY: "sk-hermes-dashscope",
    });
    mockedExpectedKey.mockReturnValue("DASHSCOPE_API_KEY");
    mockedHostKey.mockReturnValue("DASHSCOPE_API_KEY");
    mockedCanonical.mockReturnValue(null);
  });

  afterEach(() => {
    if (prev === undefined) delete process.env.HERMES_AGENT_SERVICES_INHERIT_LLM;
    else process.env.HERMES_AGENT_SERVICES_INHERIT_LLM = prev;
    vi.clearAllMocks();
  });

  // @lat: [[lat.md/agent-services#Agent services#Supervisor#Inherits Hermes LLM]]
  it("maps the active Hermes model into OpenAI + InkOS + CrewAI env aliases", () => {
    const env = resolveHermesLlmEnvForAgents("default");
    expect(env.OPENAI_API_KEY).toBe("sk-hermes-dashscope");
    expect(env.OPENAI_BASE_URL).toBe(
      "https://dashscope.aliyuncs.com/compatible-mode/v1",
    );
    expect(env.OPENAI_MODEL).toBe("qwen2.7-plus");
    expect(env.CREWAI_BRIDGE_MODEL).toBe("qwen2.7-plus");
    expect(env.INKOS_LLM_PROVIDER).toBe("custom");
    expect(env.INKOS_LLM_API_KEY).toBe("sk-hermes-dashscope");
    expect(env.INKOS_LLM_BASE_URL).toBe(
      "https://dashscope.aliyuncs.com/compatible-mode/v1",
    );
    expect(env.INKOS_LLM_MODEL).toBe("qwen2.7-plus");
    expect(env.DASHSCOPE_API_KEY).toBe("sk-hermes-dashscope");
  });

  it("can be disabled via HERMES_AGENT_SERVICES_INHERIT_LLM", () => {
    process.env.HERMES_AGENT_SERVICES_INHERIT_LLM = "0";
    expect(resolveHermesLlmEnvForAgents()).toEqual({});
  });

  it("emits anthropic aliases when the active provider is anthropic", () => {
    mockedGetModelConfig.mockReturnValue({
      provider: "anthropic",
      model: "claude-sonnet-4",
      baseUrl: "",
    });
    mockedReadEnv.mockReturnValue({ ANTHROPIC_API_KEY: "sk-ant" });
    mockedExpectedKey.mockReturnValue("ANTHROPIC_API_KEY");
    mockedHostKey.mockReturnValue(null);
    mockedCanonical.mockReturnValue("https://api.anthropic.com");

    const env = resolveHermesLlmEnvForAgents();
    expect(env.ANTHROPIC_API_KEY).toBe("sk-ant");
    expect(env.ANTHROPIC_BASE_URL).toBe("https://api.anthropic.com");
    expect(env.INKOS_LLM_PROVIDER).toBe("anthropic");
    expect(env.INKOS_LLM_API_KEY).toBe("sk-ant");
    expect(env.CREWAI_BRIDGE_MODEL).toBe("claude-sonnet-4");
  });
});
