# A2A integration



Hermes Desktop loads the A2A plugin from `resources/hermes-a2a/` in this repo (dev and packaged exe) — not from bundled `resources/python`. A sibling `../hermes-a2a` repo is optional for staging overrides only.



## Junction layout



```

hermes-desktop/
└── resources/hermes-a2a/
    └── plugins/platforms/a2a/

%LOCALAPPDATA%\hermes\plugins\platforms\a2a  →  resources/hermes-a2a/plugins/platforms/a2a
```

On every app launch [[src/main/a2a-plugin.ts#ensureA2aPluginLinked]] junctions the plugin into `%LOCALAPPDATA%\hermes\plugins\platforms\a2a`. `scripts/link-hermes-a2a.ps1` remains a manual equivalent.

Hermes discovers user platform plugins from `HERMES_HOME/plugins/` at gateway startup. No edits under `resources/python/Lib/site-packages` are required, so `npm run prepare-runtime` does not wipe A2A.



## Enablement



When the bundled or sibling A2A plugin is present, [[src/main/a2a-plugin.ts#ensureA2aConfig]] auto-writes `plugins.enabled`, `platforms.a2a`, `display.platforms.a2a.streaming`, and optional toolset entries into `config.yaml`. [[src/main/a2a-plugin.ts#ensureA2aEnv]] auto-generates `A2A_BEARER_TOKEN` and sets `A2A_HOST=0.0.0.0` in `.env` when missing — users do not edit YAML or env by hand.

Inbound streaming uses A2A `message/stream` over Server-Sent Events; blocking callers use `message/send`. The Agent Card advertises `capabilities.streaming: true`.

Set `A2A_PUBLIC_URL` in `.env` when binding `0.0.0.0` so peers get a reachable URL in the Agent Card (defaults to `127.0.0.1` in the card when bind is wildcard).

## Remote access

Desktop auto-provisions bearer auth and wildcard bind for out-of-box LAN/WAN reachability.

[[src/main/a2a-plugin.ts#ensureA2aEnv]] writes `A2A_BEARER_TOKEN` (random, when missing) and `A2A_HOST=0.0.0.0` into `%LOCALAPPDATA%\\hermes\\.env`. Remote callers must send `Authorization: Bearer <token>`. Open firewall port 9900 (or your configured `A2A_PORT`).



Inbound Agent Card: `http://127.0.0.1:9900/.well-known/agent.json` (default port; bearer token required when bound to `0.0.0.0`).

Streaming: use JSON-RPC `message/stream` — response is `text/event-stream` with task + artifact update events. Blocking callers use `message/send`.



## Eager boot



Local desktop sessions start the gateway at launch so A2A does not wait for the first chat message.



[[src/main/app/start.ts#startMainProcess]] calls [[src/main/app/gateway-boot.ts#bootGatewayAndA2aOnAppStart]] after the main window is created. Remote and SSH modes skip local gateway start; the A2A plugin link still runs for local `HERMES_HOME`.



## Packaged installs

`resources/hermes-a2a/` is the canonical A2A plugin tree for dev and release. [[scripts/stage-hermes-a2a.mjs]] runs before `electron-builder`; it **keeps** an existing staged tree unless `HERMES_A2A_FORCE_STAGE=1` or `HERMES_A2A_ROOT` points at an external copy to overwrite.

The tree ships inside the installer (`asarUnpack: resources/**`). [[src/main/a2a-plugin.ts#resolveHermesA2aPluginDir]] loads `process.resourcesPath/hermes-a2a` when packaged. At runtime, override with `HERMES_A2A_ROOT` if needed.



## Upstream migration



When A2A ships in bundled hermes-agent: disable `a2a-platform`, remove the junction, run `prepare-runtime`, and rely on the bundled `plugins/platforms/a2a/` platform adapter instead.

## Outbound delegation

Generic A2A client tools let Hermes delegate tasks to **any** compliant peer — no per-framework hardcoding. Discovery, registry, streaming, and credentials live in [[resources/hermes-a2a/plugins/platforms/a2a/tools.py]] and helpers.

### Runtime registry

[[resources/hermes-a2a/plugins/platforms/a2a/registry.py#upsert_from_card]] caches Agent Cards to `%LOCALAPPDATA%\\hermes\\a2a_registry.json` after `a2a_discover`. New agents become callable without Hermes code changes.

### Host credentials

[[resources/hermes-a2a/plugins/platforms/a2a/credentials.py#resolve_peer]] resolves Bearer tokens by host from `a2a.credentials` in config, legacy `a2a_agents`, or env `A2A_TOKEN_<HOST>` — not by agent framework name.

Example bootstrap config:

```yaml
a2a:
  defaults:
    timeout: 600
    prefer_streaming: true
  credentials:
    - host: "127.0.0.1:9910"
      auth: { type: bearer, token_env: "A2A_TOKEN_127_0_0_1_9910" }
```

### Tools

Six protocol-generic client tools; routing uses endpoint URLs and Agent Card skills, not framework names.

| Tool | Purpose |
|------|---------|
| `a2a_discover(url)` | Fetch Agent Card (`agent.json` or `agent-card.json`), register peer |
| `a2a_registry_list(filter?)` | List cached agents and skills |
| `a2a_delegate(endpoint, message)` | Delegate task; uses `message/stream` when peer supports streaming |
| `a2a_task_watch(task_id, …)` | Poll `tasks/get` or read local `a2a_tasks/` log |
| `a2a_call` | Legacy alias for `a2a_delegate` |
| `a2a_list` | Registry + config peers + conversations |

Orchestration flow: discover unknown URL → match skills from registry → delegate by endpoint URL → watch task log or poll status.

Installed third-party A2A services (isolated packages under agent-services) are managed by [[agent-services]] — Hermes starts each with its own `.venv` and port, then upserts Agent Cards into the runtime registry. Users speak natural language; the orchestrator calls `a2a_delegate` internally.

### Streaming and task trace

Outbound streaming uses [[resources/hermes-a2a/plugins/platforms/a2a/client.py#stream_post_json]] (SSE) and [[resources/hermes-a2a/plugins/platforms/a2a/client.py#parse_stream_event]]. Progress lines are persisted under `%LOCALAPPDATA%\\hermes\\a2a_tasks/<task_id>.jsonl`.

### Agent Card discovery

[[resources/hermes-a2a/plugins/platforms/a2a/client.py#fetch_agent_card]] tries `/.well-known/agent.json` then `/.well-known/agent-card.json` for CrewAI and other peers.

## Outbound delegation tests

Python unit tests in [[resources/hermes-a2a/tests/test_outbound_a2a.py]] cover card fetch, registry, streaming client, credentials, and `a2a_delegate`.

### Agent Card discovery

Card URL fallback (`agent.json` then `agent-card.json`) is verified by the fetch tests.

### Runtime registry

Registry upsert and list behavior is verified after discover.

### Streaming delegation

SSE `message/stream` parsing and status transitions are verified against a mock server.

### Host credentials

Env-based `A2A_TOKEN_*` host lookup is verified.

### a2a_delegate tool

Blocking `message/send` delegation returns completed task text in integration tests.

