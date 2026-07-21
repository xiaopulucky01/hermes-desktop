#!/usr/bin/env node
/**
 * Pack an A2A agent into a release zip + catalog fragment (update channel artifact).
 *
 *   npm run agent:pack -- ../agent-services/agents/research-agent --out dist/a2a-agents
 */

const { resolve } = require("path");
const { packAgentService } = require("./lib/a2a-agent-tools.cjs");

const args = process.argv.slice(2);
if (!args.length || args.includes("-h") || args.includes("--help")) {
  console.log(
    "Usage: npm run agent:pack -- <agentDir> [--out dist/a2a-agents]",
  );
  process.exit(args.length ? 0 : 1);
}

const agentDir = resolve(args[0]);
let outDir = resolve(process.cwd(), "dist/a2a-agents");
for (let i = 1; i < args.length; i++) {
  if (args[i] === "--out") outDir = resolve(args[++i]);
}

const result = packAgentService(agentDir, outDir);
if (!result.success) {
  console.error(result.error);
  process.exit(1);
}
console.log(`zip:     ${result.zipPath}`);
console.log(`sha256:  ${result.sha256}`);
console.log(`catalog: ${result.catalogPath}`);
console.log(
  "Upload the zip to GitHub Releases (or CDN), then set archiveUrl in hermes-registry index.json.",
);
