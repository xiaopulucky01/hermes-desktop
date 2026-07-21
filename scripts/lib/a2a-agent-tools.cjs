/**
 * Plain-Node scaffold + validate helpers for CLI (no TS loader required).
 * Keep in sync with src/main/agent-services/{scaffold,validate}.ts
 */

const {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
  createWriteStream,
} = require("fs");
const { createHash } = require("crypto");
const { basename, dirname, join, resolve } = require("path");
const { spawnSync } = require("child_process");

const ID_RE = /^[a-z][a-z0-9-]{1,62}$/;
const TEMPLATE_SKILL_IDS = new Set(["template", "example", "todo", "placeholder"]);

function issue(level, code, message) {
  return { level, code, message };
}

function validateAgentServiceManifest(manifest, options = {}) {
  const issues = [];
  if (!manifest || typeof manifest !== "object") {
    return {
      ok: false,
      issues: [issue("error", "not_object", "manifest.json must be a JSON object")],
    };
  }
  const m = manifest;
  if (!m.id || typeof m.id !== "string") {
    issues.push(issue("error", "missing_id", "manifest.id is required"));
  } else if (!ID_RE.test(m.id)) {
    issues.push(issue("error", "bad_id", `manifest.id "${m.id}" must be kebab-case`));
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
  if (!m.version) issues.push(issue("error", "missing_version", "manifest.version is required"));
  if (!m.name?.trim()) issues.push(issue("error", "missing_name", "manifest.name is required"));
  if (!m.description || m.description.trim().length < 12) {
    issues.push(
      issue("error", "weak_description", "manifest.description must be ≥12 chars"),
    );
  }
  const cmd = m.entrypoint?.command;
  if (!Array.isArray(cmd) || !cmd.length) {
    issues.push(issue("error", "missing_entrypoint", "entrypoint.command required"));
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
          'entrypoint must use "shared:python" or "venv:python"',
        ),
      );
    }
  }
  if (!m.a2a) {
    issues.push(issue("error", "missing_a2a", "manifest.a2a is required"));
  } else {
    const range = m.a2a.port_range;
    if (!Array.isArray(range) || range.length !== 2 || range[0] > range[1]) {
      issues.push(issue("error", "bad_port_range", "a2a.port_range must be [min, max]"));
    }
  }
  const skills = m.skills_hint;
  if (!Array.isArray(skills) || !skills.length) {
    issues.push(issue("error", "missing_skills", "skills_hint required"));
  } else {
    for (const s of skills) {
      if (!s?.id || !s?.description?.trim()) {
        issues.push(issue("error", "bad_skill", "skills_hint needs id+description"));
        continue;
      }
      if (s.description.trim().length < 8) {
        issues.push(issue("error", "weak_skill", `skill "${s.id}" description too short`));
      }
      if (
        options.strictSkills !== false &&
        (TEMPLATE_SKILL_IDS.has(s.id) || /replace with/i.test(s.description))
      ) {
        issues.push(
          issue("error", "template_skill", `skill "${s.id}" still looks like a template`),
        );
      }
    }
  }
  return { ok: !issues.some((i) => i.level === "error"), issues };
}

function validateAgentCardSkills(card) {
  const issues = [];
  if (!card || typeof card !== "object") {
    return {
      ok: false,
      issues: [issue("error", "card_not_object", "Agent Card must be an object")],
    };
  }
  if (!card.name?.trim()) {
    issues.push(issue("error", "card_missing_name", "Agent Card.name required"));
  }
  if (!card.description || card.description.trim().length < 12) {
    issues.push(issue("error", "card_weak_description", "Agent Card.description too short"));
  }
  if (!Array.isArray(card.skills) || !card.skills.length) {
    issues.push(issue("error", "card_missing_skills", "Agent Card.skills required"));
  } else {
    for (const s of card.skills) {
      const label = s.name || s.id || "?";
      if ((s.description || "").trim().length < 8) {
        issues.push(
          issue("error", "card_weak_skill", `skill "${label}" needs a clear description`),
        );
      }
    }
  }
  return { ok: !issues.some((i) => i.level === "error"), issues };
}

function titleCaseId(id) {
  return id
    .split("-")
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

function resolveDefaultAgentTemplateDir(fromCwd = process.cwd()) {
  const candidates = [
    join(fromCwd, "../agent-services/agents-template"),
    join(fromCwd, "agent-services/agents-template"),
    join(dirname(fromCwd), "agent-services/agents-template"),
  ];
  for (const c of candidates) {
    const resolved = resolve(c);
    if (existsSync(join(resolved, "manifest.json"))) return resolved;
  }
  return null;
}

function scaffoldAgentService(options) {
  const id = String(options.id || "").trim();
  if (!ID_RE.test(id)) {
    return { success: false, error: `Invalid id "${id}"` };
  }
  const templateDir = resolve(options.templateDir);
  if (!existsSync(join(templateDir, "manifest.json"))) {
    return { success: false, error: `Template missing: ${templateDir}` };
  }
  const destRoot = resolve(options.destDir);
  const dest = join(destRoot, id);
  if (existsSync(dest) && !options.overwrite) {
    return { success: false, error: `Already exists: ${dest}` };
  }
  try {
    mkdirSync(destRoot, { recursive: true });
    if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });
    cpSync(templateDir, dest, {
      recursive: true,
      filter: (src) => {
        const base = src.replace(/\\/g, "/");
        if (base.includes("/.venv") || base.endsWith("/.venv")) return false;
        if (base.includes("/shared-venv")) return false;
        if (base.includes("/__pycache__")) return false;
        if (base.includes("/.git")) return false;
        return true;
      },
    });

    const name = options.name?.trim() || titleCaseId(id);
    const description =
      options.description?.trim() ||
      `${name} — isolated A2A agent for Hermes Desktop`;
    const port = options.defaultPort ?? 9910;
    const manifestPath = join(dest, "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    manifest.id = id;
    manifest.version = "0.1.0";
    manifest.name = name;
    manifest.description = description;
    manifest.entrypoint = { command: ["shared:python", "-m", "app.server"], cwd: "." };
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
      card_paths: ["/.well-known/agent.json", "/.well-known/agent-card.json"],
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
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    const pyproject = join(dest, "pyproject.toml");
    if (existsSync(pyproject)) {
      let text = readFileSync(pyproject, "utf-8");
      text = text.replace(/name\s*=\s*"[^"]+"/, `name = "${id}"`);
      text = text.replace(/version\s*=\s*"[^"]+"/, `version = "0.1.0"`);
      text = text.replace(
        /description\s*=\s*"[^"]+"/,
        `description = "${description.replace(/"/g, '\\"')}"`,
      );
      writeFileSync(pyproject, text);
    }

    writeFileSync(
      join(dest, "README.md"),
      `# ${name}\n\n${description}\n\nScaffolded with \`npm run agent:new\`.\n`,
    );

    const check = validateAgentServiceManifest(manifest, {
      expectedId: id,
      strictSkills: true,
    });
    if (!check.ok) {
      return {
        success: false,
        path: dest,
        error: check.issues
          .filter((i) => i.level === "error")
          .map((i) => i.message)
          .join("; "),
      };
    }
    return { success: true, path: dest };
  } catch (err) {
    return { success: false, error: err.message || String(err) };
  }
}

function sha256File(filePath) {
  const hash = createHash("sha256");
  hash.update(readFileSync(filePath));
  return hash.digest("hex");
}

function packAgentService(agentDir, outDir) {
  const abs = resolve(agentDir);
  const manifestPath = join(abs, "manifest.json");
  if (!existsSync(manifestPath)) {
    return { success: false, error: `No manifest.json in ${abs}` };
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  const expectedId = basename(abs);
  const validation = validateAgentServiceManifest(manifest, {
    expectedId,
    strictSkills: true,
  });
  if (!validation.ok) {
    return {
      success: false,
      error: validation.issues
        .filter((i) => i.level === "error")
        .map((i) => i.message)
        .join("; "),
      issues: validation.issues,
    };
  }

  mkdirSync(outDir, { recursive: true });
  const zipName = `${manifest.id}-${manifest.version}.zip`;
  const zipPath = join(outDir, zipName);

  // Prefer tar (available on Win10+ and CI) creating zip via PowerShell on Windows.
  if (process.platform === "win32") {
    const staging = join(outDir, `.pack-${manifest.id}`);
    rmSync(staging, { recursive: true, force: true });
    mkdirSync(staging, { recursive: true });
    cpSync(abs, join(staging, manifest.id), {
      recursive: true,
      filter: (src) => {
        const base = src.replace(/\\/g, "/");
        if (base.includes("/.venv") || base.endsWith("/.venv")) return false;
        if (base.includes("/shared-venv")) return false;
        if (base.includes("/__pycache__")) return false;
        if (base.includes("/.git")) return false;
        return true;
      },
    });
    rmSync(zipPath, { force: true });
    const ps = spawnSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `Compress-Archive -Path '${join(staging, manifest.id).replace(/'/g, "''")}' -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force`,
      ],
      { encoding: "utf-8" },
    );
    rmSync(staging, { recursive: true, force: true });
    if (ps.status !== 0) {
      return {
        success: false,
        error: ps.stderr || ps.stdout || "Compress-Archive failed",
      };
    }
  } else {
    const ps = spawnSync(
      "bash",
      [
        "-lc",
        `cd '${dirname(abs).replace(/'/g, "'\\''")}' && zip -r '${zipPath.replace(/'/g, "'\\''")}' '${basename(abs)}' -x '*/.venv/*' -x '*/shared-venv/*' -x '*/__pycache__/*' -x '*/.git/*'`,
      ],
      { encoding: "utf-8" },
    );
    if (ps.status !== 0) {
      return { success: false, error: ps.stderr || "zip failed" };
    }
  }

  const sha256 = sha256File(zipPath);
  const catalogEntry = {
    id: manifest.id,
    type: "a2a-service",
    name: manifest.name,
    version: manifest.version,
    description: manifest.description,
    archiveUrl: `REPLACE_WITH_RELEASE_URL/${zipName}`,
    archiveSha256: sha256,
    platforms: ["win32", "darwin", "linux"],
    tags: ["a2a"],
  };
  const catalogPath = join(outDir, `${manifest.id}-${manifest.version}.catalog.json`);
  writeFileSync(catalogPath, `${JSON.stringify(catalogEntry, null, 2)}\n`);

  return {
    success: true,
    zipPath,
    sha256,
    catalogPath,
    catalogEntry,
  };
}

function validateAgentPackageDir(agentDir, options = {}) {
  const abs = resolve(agentDir);
  const manifestPath = join(abs, "manifest.json");
  if (!existsSync(manifestPath)) {
    return {
      ok: false,
      issues: [issue("error", "no_manifest", `missing ${manifestPath}`)],
    };
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  const result = validateAgentServiceManifest(manifest, {
    expectedId: options.expectedId ?? basename(abs),
    strictSkills: options.strictSkills !== false,
  });
  const cardPath = join(abs, "agent-card.json");
  if (existsSync(cardPath)) {
    const card = JSON.parse(readFileSync(cardPath, "utf-8"));
    const cardResult = validateAgentCardSkills(card);
    result.issues.push(...cardResult.issues);
    result.ok = result.ok && cardResult.ok;
  }
  return result;
}

module.exports = {
  validateAgentServiceManifest,
  validateAgentCardSkills,
  validateAgentPackageDir,
  scaffoldAgentService,
  resolveDefaultAgentTemplateDir,
  packAgentService,
  sha256File,
};
