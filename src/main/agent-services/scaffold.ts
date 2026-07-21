/**
 * Scaffold a new isolated A2A agent package from the agents-template template.
 */

import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import { basename, dirname, join, resolve } from "path";
import { validateAgentServiceManifest } from "./validate";
import type { AgentServiceManifest } from "./types";

export interface ScaffoldAgentOptions {
  /** New agent id (kebab-case). */
  id: string;
  /** Display name (defaults to title-cased id). */
  name?: string;
  description?: string;
  /** Destination directory (created as <destDir>/<id>). */
  destDir: string;
  /** Path to agents-template (or cookiecutter output root). */
  templateDir: string;
  /** Starting port (default 9910). */
  defaultPort?: number;
  /** Skip strict template-skill check on generated package (always rewritten). */
  overwrite?: boolean;
}

export interface ScaffoldAgentResult {
  success: boolean;
  path?: string;
  error?: string;
}

function titleCaseId(id: string): string {
  return id
    .split("-")
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

function rewriteFile(path: string, replacements: Array<[RegExp, string]>): void {
  let text = readFileSync(path, "utf-8");
  for (const [re, value] of replacements) {
    text = text.replace(re, value);
  }
  writeFileSync(path, text, "utf-8");
}

function listFilesRecursive(root: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(root)) {
    if (entry === ".venv" || entry === "shared-venv" || entry === "__pycache__" || entry === ".git")
      continue;
    const abs = join(root, entry);
    const st = statSync(abs);
    if (st.isDirectory()) out.push(...listFilesRecursive(abs));
    else out.push(abs);
  }
  return out;
}

/** Resolve default template: sibling ../agent-services/agents-template when present. */
export function resolveDefaultAgentTemplateDir(
  fromCwd = process.cwd(),
): string | null {
  const candidates = [
    join(fromCwd, "../agent-services/agents-template"),
    join(fromCwd, "agent-services/agents-template"),
    join(dirname(fromCwd), "agent-services/agents-template"),
    // Legacy name during transition
    join(fromCwd, "../agent-services/agents-bridge"),
  ];
  for (const c of candidates) {
    const resolved = resolve(c);
    if (existsSync(join(resolved, "manifest.json"))) return resolved;
  }
  return null;
}

/**
 * Copy the template into destDir/<id> and rewrite id/name/skills for a real agent.
 */
export function scaffoldAgentService(
  options: ScaffoldAgentOptions,
): ScaffoldAgentResult {
  // @lat: [[lat.md/agent-services#Agent services#Ecosystem#Scaffold new agent]]
  const id = options.id.trim();
  if (!/^[a-z][a-z0-9-]{1,62}$/.test(id)) {
    return {
      success: false,
      error: `Invalid id "${id}" — use kebab-case (e.g. research-agent)`,
    };
  }

  const templateDir = resolve(options.templateDir);
  if (!existsSync(join(templateDir, "manifest.json"))) {
    return {
      success: false,
      error: `Template not found or missing manifest.json: ${templateDir}`,
    };
  }

  const destRoot = resolve(options.destDir);
  const dest = join(destRoot, id);
  if (existsSync(dest) && !options.overwrite) {
    return { success: false, error: `Destination already exists: ${dest}` };
  }

  try {
    mkdirSync(destRoot, { recursive: true });
    if (existsSync(dest)) {
      rmSync(dest, { recursive: true, force: true });
    }
    cpSync(templateDir, dest, {
      recursive: true,
      filter: (src) => {
        const base = src.replace(/\\/g, "/");
        if (base.includes("/.venv") || base.endsWith("/.venv")) return false;
        if (base.includes("/shared-venv")) return false;
        if (base.includes("/__pycache__")) return false;
        if (base.includes("/.git/") || base.endsWith("/.git")) return false;
        return true;
      },
    });

    const name = options.name?.trim() || titleCaseId(id);
    const description =
      options.description?.trim() ||
      `${name} — isolated A2A agent for Hermes Desktop`;
    const port = options.defaultPort ?? 9910;

    const manifestPath = join(dest, "manifest.json");
    const manifest = JSON.parse(
      readFileSync(manifestPath, "utf-8"),
    ) as AgentServiceManifest;
    manifest.id = id;
    manifest.version = "0.1.0";
    manifest.name = name;
    manifest.description = description;
    manifest.entrypoint = {
      command: ["shared:python", "-m", "app.server"],
      cwd: ".",
    };
    manifest.python = {
      venv: "shared",
      shared_venv: true,
      bootstrap: "hermes",
      requires: ">=3.10,<3.13",
    };
    manifest.install = {
      post_install: [
        "shared:ensure-venv",
        "shared:python -m pip install -U pip",
        "shared:python -m pip install -e .",
      ],
    };
    manifest.a2a = {
      ...(manifest.a2a || {}),
      default_port: port,
      port_range: [port, Math.max(port + 89, 9999)],
      card_paths: [
        "/.well-known/agent.json",
        "/.well-known/agent-card.json",
      ],
      health_path: "/health",
      auth: { type: "bearer", token_env: "AUTH_TOKEN" },
    };
    manifest.ui = manifest.ui || { type: "none" };
    manifest.skills_hint = [
      {
        id: `${id}-core`,
        description: `Handle ${name.toLowerCase()} requests delegated from Hermes`,
      },
    ];
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf-8");

    const pyproject = join(dest, "pyproject.toml");
    if (existsSync(pyproject)) {
      rewriteFile(pyproject, [
        [/name\s*=\s*"[^"]+"/, `name = "${id}"`],
        [/version\s*=\s*"[^"]+"/, `version = "0.1.0"`],
        [
          /description\s*=\s*"[^"]+"/,
          `description = "${description.replace(/"/g, '\\"')}"`,
        ],
      ]);
    }

    const readme = join(dest, "README.md");
    writeFileSync(
      readme,
      `# ${name}\n\n${description}\n\nUses the **shared** agent-services \`shared-venv\` (not Hermes resources/python).\n\n## Setup\n\n\`\`\`powershell\ncd ${basename(destRoot)}\\\\${id}\n# Desktop post_install or:\n# create ..\\\\shared-venv once, then:\n..\\\\shared-venv\\\\Scripts\\\\python -m pip install -e .\ncopy .env.example .env\n\`\`\`\n`,
      "utf-8",
    );

    for (const file of listFilesRecursive(dest)) {
      if (!/\.(py|md|toml|json|example)$/i.test(file)) continue;
      if (file.endsWith("manifest.json")) continue;
      rewriteFile(file, [
        [/agents-template/g, id],
        [/agents-bridge-template/g, id],
        [/A2A Agent Template/g, name],
        [/TemplateExecutor/g, `${pascal(id)}Executor`],
        [/CrewBridgeExecutor/g, `${pascal(id)}Executor`],
        [/template-core/g, `${id}-core`],
        [/Research Agent/g, name],
      ]);
    }

    const check = validateAgentServiceManifest(manifest, {
      expectedId: id,
      strictSkills: true,
    });
    if (!check.ok) {
      return {
        success: false,
        error: `Scaffold wrote files but validation failed: ${check.issues
          .filter((i) => i.level === "error")
          .map((i) => i.message)
          .join("; ")}`,
        path: dest,
      };
    }

    return { success: true, path: dest };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Scaffold failed",
    };
  }
}

function pascal(id: string): string {
  return id
    .split("-")
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join("");
}
