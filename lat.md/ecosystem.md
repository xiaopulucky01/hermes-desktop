# Hermes ecosystem

Three siblings separate the desktop shell, cloud catalog, and local installs so marketplace packages never mix into `hermes-desktop` source.

[[src/main/ecosystem/paths.ts#resolveEcosystemRoot]] picks `HERMES_ECOSYSTEM_ROOT`, else a sibling `../hermes-ecosystem` checkout (dev), else `%LOCALAPPDATA%/hermes-ecosystem` (Windows) or `~/.hermes-ecosystem`. Bundled engine skills and desktop-shipped plugins stay on product paths (`origin: bundled`); only user/marketplace packages live under the ecosystem root.

## Paths

Ecosystem roots and per-kind directories are resolved once per process with an override-friendly API.

[[src/main/ecosystem/paths.ts#getEcosystemRoot]] memoizes [[src/main/ecosystem/paths.ts#resolveEcosystemRoot]]. Agents install under `<root>/agents` via [[src/main/ecosystem/paths.ts#resolveAgentServicesRoot]] (no `%HERMES_HOME%/agent-services` fallback). Shared Python for A2A agents is `<root>/runtimes/python/shared-venv` ([[src/main/ecosystem/paths.ts#ecosystemSharedPythonVenvRoot]]).

## Capabilities index

`capabilities.json` lists installed packages for future routing (kind, id, when_to_use, invocation, origin).

[[src/main/ecosystem/capabilities.ts#readCapabilities]] / [[src/main/ecosystem/capabilities.ts#upsertCapability]] read and update that index. `links.json` records local path references without copying trees ([[src/main/ecosystem/capabilities.ts#upsertLocalLink]]).

## Agents root

A2A supervised agents install under `<ecosystem>/agents/installed/<id>`; discoverable source packages live in `<ecosystem>/agents/packages/<id>`.

[[src/main/agent-services/paths.ts#getAgentServicesRoot]] delegates to the ecosystem agents root. Discover Agents scans [[src/main/agent-services/local-catalog.ts#scanLocalA2aAgentCatalog]] under `agents/packages` (no `agent-services` repo). Install still uses [[src/main/registry.ts#installRegistryItem]].

## Apps

Open-source upstream projects (CrewAI, InkOS, Meetily, Orca) live under `<ecosystem>/apps/<id>` and are Discover **Apps**, not A2A agents.

[[src/main/ecosystem/apps-catalog.ts#scanLocalAppCatalog]] lists them; [[src/main/ecosystem/apps-launcher.ts#startEcosystemApp]] starts each via `hermes-app.json` (pnpm/uv upstream commands).

### Start

Launch and stop OSS apps with their upstream commands without treating them as A2A agents.

[[src/main/ecosystem/apps-launcher.ts#startEcosystemApp]] / [[src/main/ecosystem/apps-launcher.ts#stopEcosystemApp]] read `hermes-app.json` and spawn in the app cwd. Discover can Start/Stop installed apps; install also best-effort starts.

## Marketplace catalog

Discover prefers `HERMES_CATALOG_BASE_URL` (hermes-marketplace full store) and falls back to the public GitHub registry mirror.

[[src/main/registry.ts#fetchRegistry]] loads `/index.json` from that base. Marketplace kinds `plugin` and `app` appear as Discover tabs. The marketplace repo exposes browse, auth, publish, admin review, entitlements, checkout, and reviews.

## Package install

Marketplace and local packages install into `hermes-ecosystem` through [[src/main/ecosystem/installer.ts#installEcosystemPackage]].

Skills land under `skills/<publisher>/<id>/`. MCPs copy the package then splice `mcp_servers:` in the active profile config with absolute paths. Plugins junction into `%HERMES_HOME%/plugins/platforms/<id>` ([[src/main/ecosystem/linker.ts#linkEcosystemPlugin]]). Workflows and apps copy into their kind roots and register in `capabilities.json`.

[[src/main/registry.ts#installRegistryItem]] routes Discover installs through the ecosystem installer (bundled skills without a catalog path still use the Hermes CLI into the profile). [[src/main/registry.ts#uninstallRegistryItem]] reverses ecosystem installs and MCP config blocks. Discover exposes **Link local folder** via `installRegistryItem` with `localPath`.

## Plugin linker

Ecosystem plugins symlink into the Hermes gateway plugin tree without copying into `hermes-desktop`.

[[src/main/ecosystem/linker.ts#linkPluginFromPath]] links a local plugin directory for dev. [[src/main/ecosystem/linker.ts#linkEcosystemPlugin]] links an installed package under `ecosystem/plugins/`.

## Runtime pool

Shared Python and Node runtimes are content-addressed under `runtimes/<runtime>/<hash>` with reference counting in `runtimes.json`.

[[src/main/ecosystem/runtime-pool.ts#acquireRuntimeForPackage]] hashes lockfiles (`requirements.txt`, `package-lock.json`, etc.) and registers package refs. [[src/main/ecosystem/runtime-pool.ts#releaseRuntimeForPackage]] drops refs on uninstall; [[src/main/ecosystem/runtime-pool.ts#gcUnusedRuntimes]] removes empty pools (never `shared-venv`).

### Reference counting

Two packages with identical lock content share one pool entry until all refs are released.

Install/uninstall flows call acquire/release via [[src/main/ecosystem/installer.ts#registerInstalledCapability]].

### Materialize deps

First acquire for a lock hash creates the pool on disk: Python via venv + `pip install -r`, Node via `npm ci`/`npm install`, then writes `.hermes-ready`.

[[src/main/ecosystem/runtime-pool.ts#materializeRuntimePool]] is idempotent when the ready marker exists. Materialize failures are logged and do not abort package install.

### Bind to MCP

stdio MCP installs rewrite bare `python`/`node` commands to the pool interpreter and prepend pool bins to `PATH` / `NODE_PATH`.

[[src/main/ecosystem/runtime-pool.ts#bindCommandToRuntimePool]] is applied in [[src/main/ecosystem/installer.ts#appendMcpServerToConfig]] after the pool is acquired.

### Ensure ready

[[src/main/ecosystem/runtime-pool.ts#ensureRuntimePoolReady]] recreates a pool when `.hermes-ready` is missing; [[src/main/mcp-servers.ts#testMcpServer]] calls [[src/main/ecosystem/runtime-pool.ts#ensureMcpRuntimeReady]] first.

## Capability router

A lightweight Top-K ranker scores installed capabilities from `capabilities.json` for a user query.

[[src/main/ecosystem/router.ts#rankCapabilities]] token-matches `when_to_use`, tags, name, and description; [[src/main/ecosystem/router.ts#formatRouterHint]] formats a prompt hint for the agent. IPC: `ecosystem-rank-capabilities`, `ecosystem-router-hint`.

Legacy/API chat injects the hint via [[src/main/ecosystem/router.ts#capabilityRouterSystemMessage]] (with the context-folder system message). Dashboard transport passes the hint as `prompt.submit` `instructions` (not user text) so gateway sessions stay clean. Discover **Open Registry** uses [[src/main/registry.ts#getCatalogOpenUrl]] (marketplace when `HERMES_CATALOG_BASE_URL` is set).

## Entitlements

Paid/subscription catalog packages require an active marketplace entitlement before Discover install.

[[src/main/ecosystem/entitlements.ts#checkInstallEntitlement]] calls `GET /v1/entitlements/check` when marketplace is configured; free and local-link installs always pass. [[src/main/registry.ts#installRegistryItem]] gates on that result and, when unpaid, runs stub checkout via [[src/main/ecosystem/entitlements.ts#purchaseRegistryItem]]. Discover shows a Paid badge and **Buy & Install** for priced packages.

### Checkout

Stub checkout grants entitlement after a create+complete round-trip (payment webhook stand-in).

Marketplace `POST /v1/checkout` creates a session; `POST /v1/checkout/:id/complete` grants entitlement. Desktop install returns `code: needs_sign_in` when unpaid and unsigned; Discover opens [[src/renderer/src/components/HermesAccountModal.tsx]] and retries after login. IPC `registry-purchase` exposes [[src/main/ecosystem/entitlements.ts#purchaseRegistryItem]].

### Ensure ready

MCP enable/test re-materializes a missing shared runtime pool before stdio servers start.

[[src/main/mcp-servers.ts#setMcpServerEnabled]] and [[src/main/mcp-servers.ts#testMcpServer]] both call [[src/main/ecosystem/runtime-pool.ts#ensureMcpRuntimeReady]].

## Three-repo layout

`hermes-desktop` is the shell; `hermes-marketplace` is the deployable catalog/commerce API; `hermes-ecosystem` is machine-local install data (dev path often `D:/Project/private/hermes-ecosystem`).

Shell features (updates, login, payment UI, compute display) stay in desktop. Catalog metadata and billing backends belong in marketplace. Package bodies and shared runtimes belong in ecosystem.
