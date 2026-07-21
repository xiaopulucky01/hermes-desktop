import { describe, it, expect } from "vitest";
import {
  validateAgentCardSkills,
  validateAgentServiceManifest,
} from "../src/main/agent-services/validate";
import { isNewerVersion } from "../src/main/agent-services/updates";
import { scaffoldAgentService } from "../src/main/agent-services/scaffold";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("validateAgentServiceManifest", () => {
  // @lat: [[lat.md/agent-services#Agent services#Ecosystem#Manifest validation]]
  it("accepts a publish-ready research-style manifest", () => {
    const result = validateAgentServiceManifest({
      id: "research-agent",
      version: "0.1.0",
      name: "Research Agent",
      description: "Market and topic research summaries for Hermes",
      entrypoint: { command: ["shared:python", "-m", "app.server"] },
      python: { shared_venv: true },
      a2a: { port_range: [9910, 9999] },
      skills_hint: [
        {
          id: "research",
          description: "Market research and competitor analysis",
        },
      ],
    });
    expect(result.ok).toBe(true);
  });

  it("rejects template skill placeholders", () => {
    const result = validateAgentServiceManifest({
      id: "my-agent",
      version: "0.1.0",
      name: "My Agent",
      description: "A real agent description here",
      entrypoint: { command: ["shared:python", "-m", "app.server"] },
      a2a: { port_range: [9910, 9999] },
      skills_hint: [
        { id: "template", description: "Replace with business skills" },
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === "template_skill")).toBe(true);
  });

  it("rejects bare python entrypoint", () => {
    const result = validateAgentServiceManifest({
      id: "my-agent",
      version: "0.1.0",
      name: "My Agent",
      description: "A real agent description here",
      entrypoint: { command: ["python", "-m", "app.server"] },
      a2a: { port_range: [9910, 9999] },
      skills_hint: [
        { id: "core", description: "Handles delegated specialist tasks" },
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === "entrypoint_not_venv")).toBe(
      true,
    );
  });
});

describe("validateAgentCardSkills", () => {
  // @lat: [[lat.md/agent-services#Agent services#Ecosystem#Agent Card skills gate]]
  it("requires business-facing skills on the card", () => {
    const bad = validateAgentCardSkills({ name: "X", description: "short" });
    expect(bad.ok).toBe(false);
    const good = validateAgentCardSkills({
      name: "Research Agent",
      description: "Market and topic research via A2A for Hermes",
      skills: [
        {
          id: "research",
          description: "Produce concise research briefs on a topic",
        },
      ],
    });
    expect(good.ok).toBe(true);
  });
});

describe("isNewerVersion", () => {
  // @lat: [[lat.md/agent-services#Agent services#Ecosystem#Update channel]]
  it("compares semver-ish versions", () => {
    expect(isNewerVersion("0.1.0", "0.2.0")).toBe(true);
    expect(isNewerVersion("0.2.0", "0.1.9")).toBe(false);
    expect(isNewerVersion("1.0.0", "1.0.0")).toBe(false);
  });
});

describe("scaffoldAgentService", () => {
  // @lat: [[lat.md/agent-services#Agent services#Ecosystem#Scaffold new agent]]
  it("copies agents-template when available", () => {
    const template = join(
      process.cwd(),
      "../agent-services/agents-template",
    );
    if (!existsSync(join(template, "manifest.json"))) {
      return;
    }
    const destRoot = mkdtempSync(join(tmpdir(), "hermes-scaffold-"));
    try {
      const result = scaffoldAgentService({
        id: "demo-agent",
        name: "Demo Agent",
        description: "Demo specialist for Hermes A2A delegation tests",
        destDir: destRoot,
        templateDir: template,
      });
      expect(result.success).toBe(true);
      const manifest = JSON.parse(
        readFileSync(join(destRoot, "demo-agent", "manifest.json"), "utf-8"),
      );
      expect(manifest.id).toBe("demo-agent");
      expect(manifest.entrypoint.command[0]).toBe("shared:python");
      expect(manifest.python?.shared_venv).toBe(true);
    } finally {
      rmSync(destRoot, { recursive: true, force: true });
    }
  });
});
