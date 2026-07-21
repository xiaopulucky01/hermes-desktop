/**
 * Publish-gate validation for A2A agent service packages.
 * Used by Desktop, CLI scripts, and CI — no network I/O.
 */

import type { AgentServiceManifest } from "./types";

export interface ManifestValidationIssue {
  level: "error" | "warning";
  code: string;
  message: string;
}

export interface ManifestValidationResult {
  ok: boolean;
  issues: ManifestValidationIssue[];
}

const ID_RE = /^[a-z][a-z0-9-]{1,62}$/;
const TEMPLATE_SKILL_IDS = new Set(["template", "example", "todo", "placeholder"]);

function issue(
  level: ManifestValidationIssue["level"],
  code: string,
  message: string,
): ManifestValidationIssue {
  return { level, code, message };
}

/** Validate a parsed manifest against the P3 publish checklist. */
export function validateAgentServiceManifest(
  manifest: unknown,
  options: { expectedId?: string; strictSkills?: boolean } = {},
): ManifestValidationResult {
  // @lat: [[lat.md/agent-services#Agent services#Ecosystem#Manifest validation]]
  const issues: ManifestValidationIssue[] = [];
  if (!manifest || typeof manifest !== "object") {
    return {
      ok: false,
      issues: [issue("error", "not_object", "manifest.json must be a JSON object")],
    };
  }

  const m = manifest as Partial<AgentServiceManifest>;

  if (!m.id || typeof m.id !== "string") {
    issues.push(issue("error", "missing_id", "manifest.id is required"));
  } else if (!ID_RE.test(m.id)) {
    issues.push(
      issue(
        "error",
        "bad_id",
        `manifest.id "${m.id}" must match ${ID_RE} (kebab-case)`,
      ),
    );
  }

  if (options.expectedId && m.id && m.id !== options.expectedId) {
    issues.push(
      issue(
        "error",
        "id_mismatch",
        `manifest.id "${m.id}" does not match folder "${options.expectedId}"`,
      ),
    );
  }

  if (!m.version || typeof m.version !== "string") {
    issues.push(issue("error", "missing_version", "manifest.version is required"));
  }

  if (!m.name || typeof m.name !== "string" || !m.name.trim()) {
    issues.push(issue("error", "missing_name", "manifest.name is required"));
  }

  if (!m.description || typeof m.description !== "string" || m.description.trim().length < 12) {
    issues.push(
      issue(
        "error",
        "weak_description",
        "manifest.description must be a business-facing sentence (≥12 chars)",
      ),
    );
  }

  const cmd = m.entrypoint?.command;
  if (!Array.isArray(cmd) || cmd.length === 0) {
    issues.push(
      issue("error", "missing_entrypoint", "manifest.entrypoint.command is required"),
    );
  } else {
    const head = String(cmd[0]);
    const usesVenv =
      head === "shared:python" ||
      head === "venv:python" ||
      head.startsWith("shared:") ||
      head.includes(".venv/") ||
      head.includes(".venv\\") ||
      head.includes("shared-venv") ||
      /Scripts[/\\]python/i.test(head) ||
      /bin[/\\]python/.test(head);
    if (!usesVenv) {
      issues.push(
        issue(
          "error",
          "entrypoint_not_venv",
          'entrypoint.command[0] must be "shared:python" or "venv:python"',
        ),
      );
    }
  }

  if (!m.a2a || typeof m.a2a !== "object") {
    issues.push(issue("error", "missing_a2a", "manifest.a2a is required"));
  } else {
    const range = m.a2a.port_range;
    if (
      !Array.isArray(range) ||
      range.length !== 2 ||
      typeof range[0] !== "number" ||
      typeof range[1] !== "number" ||
      range[0] > range[1]
    ) {
      issues.push(
        issue("error", "bad_port_range", "manifest.a2a.port_range must be [min, max]"),
      );
    }
    if (range && range[0] < 9910) {
      issues.push(
        issue(
          "warning",
          "port_below_pool",
          "port_range starts below 9910 (Hermes inbound A2A uses 9900)",
        ),
      );
    }
  }

  const skills = m.skills_hint;
  if (!Array.isArray(skills) || skills.length === 0) {
    issues.push(
      issue(
        "error",
        "missing_skills",
        "manifest.skills_hint must list at least one business skill",
      ),
    );
  } else {
    for (const s of skills) {
      if (!s?.id || !s?.description?.trim()) {
        issues.push(
          issue("error", "bad_skill", "each skills_hint entry needs id and description"),
        );
        continue;
      }
      const desc = s.description.trim();
      if (desc.length < 8) {
        issues.push(
          issue(
            "error",
            "weak_skill",
            `skill "${s.id}" description is too short for routing`,
          ),
        );
      }
      if (
        options.strictSkills !== false &&
        (TEMPLATE_SKILL_IDS.has(s.id) || /replace with/i.test(desc))
      ) {
        issues.push(
          issue(
            "error",
            "template_skill",
            `skill "${s.id}" still looks like template placeholder text`,
          ),
        );
      }
    }
  }

  if (m.ui?.type === "webview" && !m.ui.url) {
    issues.push(
      issue("warning", "webview_no_url", 'ui.type is "webview" but ui.url is missing'),
    );
  }

  const ok = !issues.some((i) => i.level === "error");
  return { ok, issues };
}

/** Validate Agent Card JSON used at publish time (optional offline check). */
export function validateAgentCardSkills(card: unknown): ManifestValidationResult {
  // @lat: [[lat.md/agent-services#Agent services#Ecosystem#Agent Card skills gate]]
  const issues: ManifestValidationIssue[] = [];
  if (!card || typeof card !== "object") {
    return {
      ok: false,
      issues: [issue("error", "card_not_object", "Agent Card must be a JSON object")],
    };
  }
  const c = card as {
    name?: string;
    description?: string;
    skills?: Array<{ id?: string; name?: string; description?: string }>;
  };
  if (!c.name?.trim()) {
    issues.push(issue("error", "card_missing_name", "Agent Card.name is required"));
  }
  if (!c.description || c.description.trim().length < 12) {
    issues.push(
      issue(
        "error",
        "card_weak_description",
        "Agent Card.description must be business-facing (≥12 chars)",
      ),
    );
  }
  const skills = c.skills;
  if (!Array.isArray(skills) || skills.length === 0) {
    issues.push(
      issue(
        "error",
        "card_missing_skills",
        "Agent Card.skills must include at least one skill for orchestrator routing",
      ),
    );
  } else {
    for (const s of skills) {
      const label = s.name || s.id || "?";
      const desc = (s.description || "").trim();
      if (desc.length < 8) {
        issues.push(
          issue(
            "error",
            "card_weak_skill",
            `Agent Card skill "${label}" needs a clear description`,
          ),
        );
      }
    }
  }
  return { ok: !issues.some((i) => i.level === "error"), issues };
}
