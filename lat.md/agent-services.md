# Agent services

Cloud-downloadable and locally linked A2A agent services live under [[src/main/agent-services/paths.ts#AGENT_SERVICES_ROOT]]. Multiple agents share one `shared-venv` (never Hermes `resources/python`); each agent is still one process and one A2A port.

## Layout

Installed agents live under `installed/<id>/` with manifest, state, env, and logs. The shared interpreter is `shared-venv/` beside `catalog.json` (override with `HERMES_AGENT_SERVICES_SHARED_VENV`).

```
%HERMES_HOME%/agent-services/
├── catalog.json
├── shared-venv/          # multi-agent shared Python (not Hermes runtime)
├── cache/
└── installed/<id>/
    ├── manifest.json
    ├── state.json
    ├── .env
    └── logs/stdout.log
```

Dev link mode still uses [[src/main/agent-services/installer.ts#installAgentServiceFromPath]]; when the work dir is under `agent-services/agents/`, shared-venv resolves to that repo's `shared-venv/`.

## Shared Python runtime

All agents may share one venv under agent-services so disk use stays one copy of dependencies. Hermes bundled Python only bootstraps that venv.

### Shared venv path

[[src/main/agent-services/paths.ts#resolveSharedVenvRoot]] picks `HERMES_AGENT_SERVICES_SHARED_VENV`, else repo `…/agent-services/shared-venv` for link mode, else `%HERMES_HOME%/agent-services/shared-venv`.

### Resolve shared python

[[src/main/agent-services/python-runtime.ts#resolvePythonArgv0]] maps `shared:python` to the shared interpreter and rejects start when shared-venv is missing.

### Ensure shared venv

[[src/main/agent-services/installer.ts#ensureSharedVenv]] creates shared-venv with Hermes python, optionally installs `requirements-shared.txt`, then agents run `shared:python -m pip install -e .`.

## Per-agent Python

Optional isolation remains via `venv:python` and a package-local `.venv`. Prefer `shared:python` for multi-agent installs.

### Resolve venv python

[[src/main/agent-services/python-runtime.ts#resolveVenvPython]] locates a package-local `.venv` interpreter when not using shared mode.

### Resolve command token

[[src/main/agent-services/python-runtime.ts#resolvePythonArgv0]] supports `bootstrap:python`, `shared:python`, `venv:python`, and rejects bare `python` at start without a runtime venv.

### Post-install venv

[[src/main/agent-services/installer.ts#runPostInstall]] runs `shared:ensure-venv` then `shared:python` pip steps by default (or private `.venv` when the manifest opts out).

## Installation

Install flows copy or link a manifest-bearing folder, download an archive, or fetch a GitHub zipball. Archives exclude venvs; post_install uses the shared env.

### Install from local path

[[src/main/agent-services/installer.ts#installAgentServiceFromPath]] copies or links a package, then ensures shared (or private) venv and `pip install -e .`.

### Install from archive URL

[[src/main/agent-services/installer.ts#installAgentServiceFromArchive]] downloads, extracts, and runs shared post_install.

### Install from GitHub

[[src/main/agent-services/installer.ts#installAgentServiceFromGitHub]] installs from a repo zipball into the shared runtime.

## Discover catalog

Discover lists A2A packages as kind `a2aServices`, separate from Hermes profile agents. Local packages are auto-scanned; the bundled JSON is only an optional override.

### Local agents scan

[[src/main/agent-services/local-catalog.ts#scanLocalA2aAgentCatalog]] reads `../agent-services/agents/*/manifest.json` so new agents show up without editing `resources/a2a-services-catalog.json`.

### Install A2A service

[[src/main/registry.ts#installRegistryItem]] resolves relative `localPath` against the desktop project root, then installs/links and starts. Cloud entries use `archiveUrl` / `githubRepo` via hermes-registry. `shared-venv` is created on first successful post_install.

## Port allocation

[[src/main/agent-services/port-manager.ts#allocateAgentServicePort]] allocates ports per agent process from the manifest range.

### Reuses previous free port

Restart prefers the last successful port when free.

### Skips occupied ports

Allocation walks the range until `probeTcp` reports free.

## Supervisor

[[src/main/agent-services/supervisor.ts#startAgentService]] resolves `shared:python` (or `venv:python`), spawns the entrypoint, injects A2A env, and bootstraps the registry.

### Start agent service

Allocate port → spawn with shared interpreter → merge package `.env` + installed `.env` (for keys like `OPENAI_API_KEY`) → card probe → persist state.

### Boot on app start

[[src/main/agent-services/supervisor.ts#bootAgentServicesOnAppStart]] starts enabled catalog entries (or one DEV_LINK path).

### Lazy start

[[src/main/agent-services/supervisor.ts#ensureAgentServiceRunning]] starts on demand.

### Crash auto-restart

Enabled services get limited backoff restarts after unexpected exit.

## A2A bootstrap

[[src/main/agent-services/bootstrap-a2a.ts#bootstrapAgentServiceA2a]] upserts Agent Cards into `a2a_registry.json` with optional `service_id`.

### Registry upsert

[[src/main/agent-services/bootstrap-a2a.ts#upsertA2aRegistryEntry]] writes the peer shape used for outbound `a2a_delegate`.

## Orchestrator routing

[[src/main/a2a-plugin.ts#ensureA2aOrchestratorHint]] appends SOUL.md guidance to list peers and delegate by skill.

## IPC and preload

Renderer APIs cover list/install/start/stop, experts, updates, scaffold, and UI open via [[src/main/ipc/register.ts]].

### Settings pane

[[src/renderer/src/components/settings/AgentServicesPane.tsx]] lists supervised agents in the settings modal using the shared card layout: status badges, start/stop/update actions, scaffold-from-template, and an empty state that points at Discover or `HERMES_AGENT_SERVICES_DEV_LINK`.

### Open agent UI

[[src/main/agent-services/ui.ts#openAgentServiceUi]] opens localhost UIs safely.

## Template and sample agents

`agents-template/` is the generic A2A stub; real adapters live under `agents/<id>/`.

Upstream clones (e.g. CrewAI) stay in `projects/` and are installed into shared-venv by that agent's `post_install`. Hermes never starts `projects/` directly. `agents/crewai-agent` exposes multi-skill Agent Cards (research, web, files, code, data) wired to local CrewAI tools.

## Ecosystem

Scaffolding, publish validation, and the update channel support multi-agent packages on the shared runtime.

### Scaffold new agent

[[src/main/agent-services/scaffold.ts#scaffoldAgentService]] copies `agents-template` into `agents/<id>/` with `shared:python` defaults (`npm run agent:new`).

### Manifest validation

[[src/main/agent-services/validate.ts#validateAgentServiceManifest]] requires `shared:python` or `venv:python`, ports, and non-placeholder skills.

### Agent Card skills gate

[[src/main/agent-services/validate.ts#validateAgentCardSkills]] requires clear Card skills for routing.

### Update channel

[[src/main/agent-services/updates.ts#checkAgentServiceUpdate]] compares versions and reinstalls from archive/GitHub; pack omits venvs.

## Agent services tests

Port allocation, shared/private Python resolution, GitHub install, and ecosystem gates are covered under `tests/agent-services-*.test.ts`.
