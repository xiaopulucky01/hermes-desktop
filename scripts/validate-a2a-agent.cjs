#!/usr/bin/env node
/**
 * Validate one or more A2A agent packages (manifest + optional agent-card.json).
 *
 *   npm run agent:validate -- ../agent-services/agents/research-agent
 *   npm run agent:validate -- --all-agents
 */

const { readdirSync, existsSync, statSync } = require("fs");
const { join, resolve } = require("path");
const { validateAgentPackageDir } = require("./lib/a2a-agent-tools.cjs");

const args = process.argv.slice(2);
const paths = [];
let allAgents = false;
let allowTemplate = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--all-agents") allAgents = true;
  else if (args[i] === "--allow-template") allowTemplate = true;
  else if (args[i] === "-h" || args[i] === "--help") {
    console.log(
      "Usage: npm run agent:validate -- <dir>... [--all-agents] [--allow-template]",
    );
    process.exit(0);
  } else paths.push(resolve(args[i]));
}

if (allAgents) {
  const root = resolve(process.cwd(), "../agent-services/agents");
  if (existsSync(root)) {
    for (const name of readdirSync(root)) {
      const dir = join(root, name);
      if (statSync(dir).isDirectory() && existsSync(join(dir, "manifest.json"))) {
        paths.push(dir);
      }
    }
  }
}

if (!paths.length) {
  console.error("No agent directories to validate");
  process.exit(1);
}

let failed = 0;
for (const dir of paths) {
  const result = validateAgentPackageDir(dir, {
    strictSkills: !allowTemplate,
  });
  const label = dir;
  if (result.ok) {
    console.log(`OK  ${label}`);
  } else {
    failed++;
    console.error(`FAIL ${label}`);
    for (const i of result.issues.filter((x) => x.level === "error")) {
      console.error(`  - [${i.code}] ${i.message}`);
    }
  }
  for (const i of result.issues.filter((x) => x.level === "warning")) {
    console.warn(`  ! [${i.code}] ${i.message}`);
  }
}

process.exit(failed ? 1 : 0);
