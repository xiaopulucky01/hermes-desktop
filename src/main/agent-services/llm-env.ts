/**
 * Resolve the active Hermes profile LLM credentials into env vars that A2A
 * agent services (CrewAI, InkOS, …) understand. Injected at spawn time so
 * multi-agents share this project's model without per-agent key setup.
 */

import { getModelConfig, readEnv } from "../config";
import { expectedEnvKeyForModel } from "../installer";
import { hostDerivedEnvKeyForUrl } from "../host-derived-env";
import { readModels } from "../models";
import { canonicalProviderBaseUrl } from "../provider-registry";
import { providerListSafe } from "../secrets";
import {
  customProviderEnvKey,
  OPENAI_COMPAT_PROVIDERS,
} from "../../shared/url-key-map";
import { getActiveProfileNameSync } from "../utils";

/** Vendor keys commonly needed by OpenAI-compat / LiteLLM-style bridges. */
const KNOWN_API_KEYS = [
  "OPENROUTER_API_KEY",
  "OPENAI_API_KEY",
  "OLLAMA_API_KEY",
  "AIMLAPI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GROQ_API_KEY",
  "DEEPSEEK_API_KEY",
  "TOGETHER_API_KEY",
  "FIREWORKS_API_KEY",
  "CEREBRAS_API_KEY",
  "MISTRAL_API_KEY",
  "PERPLEXITY_API_KEY",
  "XIAOMI_API_KEY",
  "GLM_API_KEY",
  "KIMI_API_KEY",
  "MINIMAX_API_KEY",
  "MINIMAX_CN_API_KEY",
  "HF_TOKEN",
  "GOOGLE_API_KEY",
  "XAI_API_KEY",
  "DASHSCOPE_API_KEY",
  "QWEN_API_KEY",
  "NOUS_API_KEY",
  "NVIDIA_API_KEY",
  "HERMESONE_API_KEY",
  "CUSTOM_API_KEY",
  "ATLASCLOUD_API_KEY",
] as const;

function inheritEnabled(): boolean {
  const raw = (process.env.HERMES_AGENT_SERVICES_INHERIT_LLM || "")
    .trim()
    .toLowerCase();
  return raw !== "0" && raw !== "false" && raw !== "off" && raw !== "no";
}

function stripSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

function lookup(
  sources: Array<Record<string, string | undefined>>,
  key: string,
): string {
  for (const src of sources) {
    const v = (src[key] || "").trim();
    if (v) return v;
  }
  return "";
}

function resolveActiveApiKey(opts: {
  provider: string;
  baseUrl: string;
  profileEnv: Record<string, string>;
  providerSecrets: Record<string, string>;
  forwarded: Record<string, string>;
}): string {
  const { provider, baseUrl, profileEnv, providerSecrets, forwarded } = opts;
  const sources = [forwarded, profileEnv, providerSecrets];

  const expected = expectedEnvKeyForModel(provider, baseUrl);
  if (expected) {
    const v = lookup(sources, expected);
    if (v) return v;
  }

  const hostKey = hostDerivedEnvKeyForUrl(baseUrl);
  if (hostKey) {
    const v = lookup(sources, hostKey);
    if (v) return v;
  }

  if (baseUrl) {
    try {
      const matching = readModels().find((m) => m.baseUrl === baseUrl);
      if (matching) {
        const envKey = customProviderEnvKey(
          matching.providerLabel || matching.name,
        );
        const v = lookup(sources, envKey);
        if (v) return v;
      }
    } catch {
      /* ignore */
    }
  }

  for (const key of ["CUSTOM_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"]) {
    const v = lookup(sources, key);
    if (v) return v;
  }

  if (baseUrl && /localhost|127\.0\.0\.1/i.test(baseUrl)) {
    return "no-key-required";
  }
  return "";
}

function isAnthropicProtocol(provider: string, baseUrl: string): boolean {
  if (provider === "anthropic") return true;
  if (!baseUrl) return false;
  try {
    const entry = readModels().find(
      (m) => m.baseUrl === baseUrl || (m.baseUrl && stripSlash(m.baseUrl) === baseUrl),
    );
    return entry?.apiMode === "anthropic_messages";
  } catch {
    return false;
  }
}

function inkosProviderId(
  provider: string,
  baseUrl: string,
  anthropic: boolean,
): string {
  if (anthropic) return "anthropic";
  if (provider === "openai" && (!baseUrl || /api\.openai\.com/i.test(baseUrl))) {
    return "openai";
  }
  // Any OpenAI-compatible / custom / native-compat host → InkOS "custom"
  return "custom";
}

/**
 * Build env vars from the active Hermes profile model so spawned A2A agents
 * reuse this project's LLM. Empty when inherit is disabled or nothing is
 * configured. Callers should merge agent `.env` *after* this so per-agent
 * overrides still win.
 */
export function resolveHermesLlmEnvForAgents(
  profile?: string,
): Record<string, string> {
  if (!inheritEnabled()) return {};

  const active = profile || getActiveProfileNameSync();
  const mc = getModelConfig(active);
  const profileEnv = readEnv(active);
  const providerSecrets = providerListSafe(active);
  const out: Record<string, string> = {};

  for (const key of KNOWN_API_KEYS) {
    const value = (profileEnv[key] || providerSecrets[key] || "").trim();
    if (value) out[key] = value;
  }

  // Also forward CUSTOM_PROVIDER_* keys from the profile .env / vault.
  for (const [key, value] of Object.entries(profileEnv)) {
    if (key.startsWith("CUSTOM_PROVIDER_") && key.endsWith("_KEY") && value?.trim()) {
      out[key] = value.trim();
    }
  }
  for (const [key, value] of Object.entries(providerSecrets)) {
    if (
      key.startsWith("CUSTOM_PROVIDER_") &&
      key.endsWith("_KEY") &&
      value?.trim() &&
      !out[key]
    ) {
      out[key] = value.trim();
    }
  }

  const provider = (mc.provider || "").trim().toLowerCase();
  const model = (mc.model || "").trim();
  const baseUrl = stripSlash(
    (mc.baseUrl || canonicalProviderBaseUrl(provider) || "").trim(),
  );

  const resolvedKey = resolveActiveApiKey({
    provider,
    baseUrl,
    profileEnv,
    providerSecrets,
    forwarded: out,
  });

  if (!resolvedKey && !baseUrl && !model) {
    return out;
  }

  const anthropic = isAnthropicProtocol(provider, baseUrl);
  const useCompatPath =
    anthropic ||
    OPENAI_COMPAT_PROVIDERS.has(provider) ||
    provider === "openai" ||
    provider === "openrouter" ||
    provider === "alibaba" ||
    !!baseUrl;

  if (useCompatPath || resolvedKey) {
    if (anthropic) {
      if (resolvedKey) out.ANTHROPIC_API_KEY = resolvedKey;
      if (baseUrl) out.ANTHROPIC_BASE_URL = baseUrl;
    } else {
      if (resolvedKey) out.OPENAI_API_KEY = resolvedKey;
      if (baseUrl) {
        out.OPENAI_BASE_URL = baseUrl;
        // LiteLLM / CrewAI often also read this alias
        out.OPENAI_API_BASE = baseUrl;
      }
    }

    if (model) {
      out.OPENAI_MODEL = model;
      out.CREWAI_BRIDGE_MODEL = model;
    }

    // InkOS CLI reads INKOS_LLM_* from the process env (inherited by subprocess).
    out.INKOS_LLM_PROVIDER = inkosProviderId(provider, baseUrl, anthropic);
    if (resolvedKey && resolvedKey !== "no-key-required") {
      out.INKOS_LLM_API_KEY = resolvedKey;
    } else if (resolvedKey === "no-key-required") {
      out.INKOS_LLM_API_KEY = resolvedKey;
    }
    if (baseUrl) out.INKOS_LLM_BASE_URL = baseUrl;
    if (model) out.INKOS_LLM_MODEL = model;

    const hostKey = hostDerivedEnvKeyForUrl(baseUrl);
    if (
      hostKey &&
      hostKey !== "OPENAI_API_KEY" &&
      hostKey !== "ANTHROPIC_API_KEY" &&
      resolvedKey &&
      resolvedKey !== "no-key-required"
    ) {
      out[hostKey] = resolvedKey;
    }
  }

  return out;
}
