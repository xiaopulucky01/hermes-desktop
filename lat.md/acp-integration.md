# ACP integration

Hermes Desktop exposes the upstream Hermes Agent ACP server to external IDEs by generating a launcher script with the correct Python path, `HERMES_HOME`, and bundled `PYTHONPATH`.

ACP (Agent Client Protocol) is JSON-RPC over stdio — editors spawn Hermes as a subprocess and exchange newline-delimited messages on stdout/stdin. The desktop does not host ACP itself; it prepares the command IDEs should spawn via `hermes acp`.

## Launcher script

The desktop writes a small wrapper script so IDEs spawn Hermes with the same env as gateway and CLI child processes.

[[src/main/acp.ts#ensureAcpLauncherScript]] writes `hermes-acp.cmd` (Windows) or `hermes-acp.sh` (macOS/Linux) under the desktop's `userData/acp/` directory. The script sets the same child-process env as gateway/CLI spawns ([[src/main/installer.ts#buildHermesChildEnv]]) and invokes `hermes acp` through [[src/main/installer.ts#hermesCliArgs]].

Refresh the script from Settings → IDE Integration whenever `HERMES_HOME`, the bundled runtime, or provider credentials change.

## ACP availability

ACP requires the upstream `acp_adapter` package and a local Hermes engine — remote/SSH desktop modes cannot expose stdio agents.

[[src/main/acp.ts#isAcpModuleInstalled]] checks for `acp_adapter` in the active Hermes Python tree (file probe, then `import acp_adapter`). ACP is unavailable in remote/SSH connection modes because stdio agents must run on the same machine as the IDE.

The bundled Windows runtime installs `hermes-agent[acp]` during [[bundled-runtime#Bundled runtime#Bundled engine detection]]. Traditional venv installs can add extras from Settings or with `pip install 'hermes-agent[acp]'` via [[src/main/acp.ts#installAcpExtra]].

## Launch info IPC

Settings and copy-paste snippets read launch metadata from the main process over IPC.

[[src/main/acp.ts#getAcpLaunchInfo]] returns launcher path, raw command/args/env, and a Zed example JSON snippet. Exposed to the renderer as `get-acp-launch-info`; optional `install-acp-extra` installs the upstream extra into non-bundled venvs.

Settings → IDE Integration ([[src/renderer/src/components/settings/IdeIntegrationPane.tsx]]) surfaces copy-paste launcher and Zed config text for ACP-compatible editors.
