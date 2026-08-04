/**
 * Lightweight capability router — ranks installed packages for a user query.
 */

import type {
  EcosystemPackageKind,
  InstalledCapability,
  RankedCapability,
} from "../../shared/ecosystem";
import { readCapabilities } from "./capabilities";

const KIND_ORDER: EcosystemPackageKind[] = [
  "skill",
  "workflow",
  "mcp",
  "agent",
  "app",
  "plugin",
];

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((t) => t.length > 1);
}

function scoreCapability(
  query: string,
  cap: InstalledCapability,
): number {
  const qTokens = tokenize(query);
  if (qTokens.length === 0) return 0;

  const haystack = [
    cap.name,
    cap.description,
    cap.when_to_use,
    ...(cap.tags ?? []),
    ...(cap.examples ?? []),
    cap.not_for ? `not ${cap.not_for}` : "",
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  let score = 0;
  for (const token of qTokens) {
    if (haystack.includes(token)) score += 2;
    if (cap.when_to_use?.toLowerCase().includes(token)) score += 3;
    if (cap.name.toLowerCase().includes(token)) score += 1;
  }

  if (cap.not_for) {
    for (const token of qTokens) {
      if (cap.not_for.toLowerCase().includes(token)) score -= 4;
    }
  }

  // Kind priority only breaks ties among positive matches.
  if (score > 0) {
    const kindIdx = KIND_ORDER.indexOf(cap.kind);
    if (kindIdx >= 0) score += (KIND_ORDER.length - kindIdx) * 0.1;
    if (cap.invocation === "open_ui") score -= 0.5;
  }

  return score;
}

/**
 * Rank installed capabilities for a natural-language query (Top-K).
 */
// @lat: [[lat.md/ecosystem#Hermes ecosystem#Capability router]]
export function rankCapabilities(
  query: string,
  limit = 5,
): RankedCapability[] {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const caps = readCapabilities().capabilities.filter(
    (c) => c.origin !== "bundled",
  );
  const ranked: RankedCapability[] = caps
    .map((cap) => ({
      ...cap,
      score: scoreCapability(trimmed, cap),
    }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score);

  return ranked.slice(0, Math.max(1, limit));
}

/** Format router hint for injection into an agent turn. */
export function formatRouterHint(
  query: string,
  limit = 3,
): string | null {
  const top = rankCapabilities(query, limit);
  if (top.length === 0) return null;

  const lines = top.map(
    (c, i) =>
      `${i + 1}. [${c.kind}] ${c.name} (${c.id}) — ${c.when_to_use || c.description || "no description"}`,
  );
  return (
    "[Installed capabilities that may match this request]\n" +
    lines.join("\n") +
    "\nPrefer the most specific match; ask the user if multiple fit equally."
  );
}

/** System-message wrapper used by chat send paths. */
export function capabilityRouterSystemMessage(
  userMessage?: string,
): { role: "system"; content: string } | null {
  const hint = formatRouterHint(userMessage || "", 3);
  if (!hint) return null;
  return { role: "system", content: hint };
}
