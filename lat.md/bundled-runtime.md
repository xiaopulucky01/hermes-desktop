# Bundled runtime

Windows installers ship a self-contained Python runtime under `resources/python/` prepared by `npm run prepare-runtime` (see `scripts/prepare-runtime.mjs`). The bundle installs `hermes-agent[acp]` so IDE integration works out of the box.

## Bundled engine detection

When `resources/python` is present (dev tree or packaged `extraResources`), [[src/main/bundled-runtime.ts#resolveBundledPythonDir]] points the desktop at that runtime instead of `%LOCALAPPDATA%\\hermes\\hermes-agent\\venv`.

[[src/main/installer.ts#shouldUseBundledEngine]] skips the Welcome install flow when the bundled interpreter is available and no traditional venv install exists. User config and sessions live under `%LOCALAPPDATA%\\hermes` (or `HERMES_HOME` when set).

Set `HERMES_BUNDLED_RUNTIME=0` to force the legacy online installer path.

## Spawn executable

On Windows the bundle launches console `python.exe` with a normalized path so gateway/CLI spawns stay flash-free.

[[src/main/bundled-runtime.ts#resolveBundledSpawnExecutable]] picks `python.exe` (not `pythonw.exe`) via `realpath`. Console flashes are suppressed by `sitecustomize.py` (`CREATE_NO_WINDOW`). [[src/main/installer.ts#buildHermesChildEnv]] sets `PYTHONPATH` to the bundled site-packages. [[src/main/installer.ts#getHermesPythonSpawnPath]] re-resolves the interpreter at spawn time so a dev session started before `prepare-runtime` can recover once the bundle exists.

## Source paths under the bundle

Bundled installs put agent sources under site-packages, not a checkout root beside `python.exe`.

[[src/main/hermes-agent-compat.ts#ensureLocalDashboardCompatibility]] reads `web_server.py` via [[src/main/installer.ts#hermesPythonSourceRoot]] (the site-packages tree). Using `HERMES_REPO`/`resources/python/hermes_cli/` fails with ENOENT because that directory does not exist in the bundle layout.

When installing from a local `resources/hermes-agent` checkout, every new top-level `.py` module must be listed in that checkout's `[tool.setuptools] py-modules` or the sealed site-packages install omits it and the gateway dies on import (e.g. `registration_lifecycle` required by `hermes_cli.plugins`).

## Desktop-core (optional)

The `desktop-core/` package (when present) installs `core` plus OCR extras; absent trees skip that install step.

`prepare-runtime` installs `onnxruntime` / `rapidocr_onnxruntime` when `desktop-core/` exists, otherwise verifies only `hermes_cli`, `playwright`, and `pymupdf`.

## Desktop relay plugins

`scripts/patch-bundled-python.mjs` copies desktop-only relay backends from `scripts/bundled-plugins/` into the bundled site-packages tree.

The `image_gen/relay` and `video_gen/relay` plugins delegate generation to an upstream provider (`image_gen.relay_upstream` / `video_gen.relay_upstream` in config, or the first available FAL/OpenAI backend) and index local outputs into `HERMES_HOME/desktop/works/` when `HERMES_DESKTOP=1`.

## Windows subprocess patches

`scripts/bundled-python/sitecustomize.py` is installed into site-packages so child processes spawned on Windows default to `CREATE_NO_WINDOW`, avoiding console flashes from the desktop bundle.

## Git Bash lookup patch

`scripts/patch-bundled-python.mjs` patches `_find_bash` to also search `HERMES_HOME/git` and `%LOCALAPPDATA%\\AI-Compartner\\git`.

Matching normalizes CRLF→LF so Windows hermes-agent 0.20+ checkouts still apply.

## Gateway home-channel patch

The same script rewrites the gateway `run.py` home-channel block for CN auto-`/sethome` and a Chinese first-turn notice. The match target tracks upstream 0.20 (no unused `get_profile_dir` import in the secondary-profile branch).
