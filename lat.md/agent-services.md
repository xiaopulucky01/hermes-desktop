# Agent services

Cloud-downloadable and locally linked A2A agent services live under [[src/main/agent-services/paths.ts#AGENT_SERVICES_ROOT]] (`%HERMES_HOME%/agent-services/`). Hermes Desktop installs packages, supervises their HTTP processes, allocates ports, and registers peers for outbound `a2a_delegate`.

## Layout

On disk, each installed agent owns a folder under `installed/<id>/` with manifest, runtime state, env, and logs.

```
%HERMES_HOME%/agent-services/
├── catalog.json
├── cache/
└── installed/<id>/
    ├── manifest.json
    ├── state.json
    ├── .env
    └── logs/stdout.log
```

Dev agents can register in **link mode** (no copy) via [[src/main/agent-services/installer.ts#installAgentServiceFromPath]] or `HERMES_AGENT_SERVICES_DEV_LINK`.

## Installation

Install flows copy or link a manifest-bearing folder into `installed/<id>/`, or download and extract an archive from a URL.

### Install from local path

[[src/main/agent-services/installer.ts#installAgentServiceFromPath]] copies a folder containing `manifest.json` into `installed/<id>/`, or links it when `link: true`.

### Install from archive URL

[[src/main/agent-services/installer.ts#installAgentServiceFromArchive]] downloads a zip/tar into `cache/`, verifies optional `sha256`, extracts, and runs optional `post_install` steps from the manifest.

## Port allocation

[[src/main/agent-services/port-manager.ts#allocateAgentServicePort]] picks a port from the manifest `a2a.port_range`, skipping Hermes gateway (8642), inbound A2A (9900), ports claimed by other services, and TCP listeners already bound on localhost.

### Reuses previous free port

When restarting, the supervisor prefers the last successful port if it is still available.

### Skips occupied ports

When the preferred port is taken, allocation walks the configured range until `probeTcp` reports a free port.

## Supervisor

[[src/main/agent-services/supervisor.ts#startAgentService]] spawns the manifest `entrypoint`, injects `A2A_HOST`, `A2A_PORT`, `A2A_PUBLIC_URL`, and bearer `AUTH_TOKEN`, waits for Agent Card readiness, then updates catalog/state.

### Start agent service

End-to-end start: allocate port → spawn child → health/card probe → persist running state.

### Boot on app start

[[src/main/agent-services/supervisor.ts#bootAgentServicesOnAppStart]] runs after gateway boot. When `HERMES_AGENT_SERVICES_DEV_LINK` is set, that path is link-installed and started once; otherwise all `enabled` catalog entries are started.

## A2A bootstrap

[[src/main/agent-services/bootstrap-a2a.ts#bootstrapAgentServiceA2a]] fetches the peer Agent Card (both card paths), writes `%HERMES_HOME%/a2a_registry.json`, and mirrors bearer tokens into the desktop `.env` for outbound `a2a_delegate`.

### Registry upsert

[[src/main/agent-services/bootstrap-a2a.ts#upsertA2aRegistryEntry]] matches the Python registry schema used by [[resources/hermes-a2a/plugins/platforms/a2a/registry.py#upsert_from_card]].

## IPC and preload

Renderer APIs: `listAgentServices`, `installAgentServiceFromPath`, `installAgentServiceFromArchive`, `installAndStartAgentService`, `startAgentService`, `stopAgentService` (registered in [[src/main/ipc/register.ts]]).

## CrewAI bridge reference

The sample package at `../agent-services/crewai-bridge/` (sibling to this repo) ships a `manifest.json` and `python -m app.server` entrypoint using `a2a-sdk` + `crewai[a2a]`.

## Agent services tests

Port allocation and supervisor behavior are covered by unit tests under `tests/agent-services-*.test.ts`.
