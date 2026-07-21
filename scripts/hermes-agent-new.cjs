#!/usr/bin/env node
/**
 * hermes agent new — scaffold an isolated A2A agent from agents-template.
 *
 *   npm run agent:new -- my-agent
 *   npm run agent:new -- my-agent --name "My Agent" --dest ../agent-services/agents
 */

const { resolve } = require("path");
const {
  scaffoldAgentService,
  resolveDefaultAgentTemplateDir,
} = require("./lib/a2a-agent-tools.cjs");

const args = process.argv.slice(2);
if (!args.length || args.includes("-h") || args.includes("--help")) {
  console.log(`Usage: npm run agent:new -- <id> [options]

Options:
  --name <name>         Display name
  --desc <text>         Description
  --dest <dir>          Parent directory (default: ../agent-services/agents)
  --template <dir>      Template path (default: ../agent-services/agents-template)
`);
  process.exit(args.length ? 0 : 1);
}

const id = args[0];
let name;
let description;
let destDir = resolve(process.cwd(), "../agent-services/agents");
let templateDir =
  resolveDefaultAgentTemplateDir(process.cwd()) ||
  resolve(process.cwd(), "../agent-services/agents-template");

for (let i = 1; i < args.length; i++) {
  if (args[i] === "--name") name = args[++i];
  else if (args[i] === "--desc" || args[i] === "--description") description = args[++i];
  else if (args[i] === "--dest") destDir = resolve(args[++i]);
  else if (args[i] === "--template") templateDir = resolve(args[++i]);
}

const result = scaffoldAgentService({
  id,
  name,
  description,
  destDir,
  templateDir,
});

if (!result.success) {
  console.error(result.error);
  process.exit(1);
}
console.log(`Created ${result.path}`);
console.log("Next: edit app/, then pip install -e . and link via HERMES_AGENT_SERVICES_DEV_LINK");
