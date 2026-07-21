# Bundled runtime

Windows installers ship a self-contained Python runtime under `resources/python/` prepared by `npm run prepare-runtime` (see `scripts/prepare-runtime.mjs`). The bundle installs `hermes-agent[acp]` so IDE integration works out of the box.

## Bundled engine detection

When `resources/python` is present (dev tree or packaged `extraResources`), [[src/main/bundled-runtime.ts#resolveBundledPythonDir]] points the desktop at that runtime instead of `%LOCALAPPDATA%\\hermes\\hermes-agent\\venv`.

[[src/main/installer.ts#shouldUseBundledEngine]] skips the Welcome install flow when the bundled interpreter is available and no traditional venv install exists. User config and sessions live under `%LOCALAPPDATA%\\hermes` (or `HERMES_HOME` when set).

Set `HERMES_BUNDLED_RUNTIME=0` to force the legacy online installer path.

## Spawn executable

On Windows the prepare-runtime bundle uses [[src/main/bundled-runtime.ts#resolveBundledSpawnExecutable]] to launch `python.exe` (not `pythonw.exe`) with a `realpath`-normalized path. Console flashes are suppressed by `sitecustomize.py` (`CREATE_NO_WINDOW`). [[src/main/installer.ts#buildHermesChildEnv]] sets `PYTHONPATH` to the bundled site-packages for gateway and CLI spawns. [[src/main/installer.ts#getHermesPythonSpawnPath]] re-resolves the bundled interpreter at spawn time so a dev session started before `prepare-runtime` can recover once the bundle is installed.

## Desktop-core (optional)

The local `desktop-core/` Python package (when present) installs the `core` module plus OCR extras (`onnxruntime`, `rapidocr_onnxruntime`). `prepare-runtime` skips it when the directory is absent and verifies only `hermes_cli`, `playwright`, and `pymupdf`.

## Desktop relay plugins

`scripts/patch-bundled-python.mjs` copies desktop-only relay backends from `scripts/bundled-plugins/` into the bundled site-packages tree.

The `image_gen/relay` and `video_gen/relay` plugins delegate generation to an upstream provider (`image_gen.relay_upstream` / `video_gen.relay_upstream` in config, or the first available FAL/OpenAI backend) and index local outputs into `HERMES_HOME/desktop/works/` when `HERMES_DESKTOP=1`.

## Windows subprocess patches

`scripts/bundled-python/sitecustomize.py` is installed into site-packages so child processes spawned on Windows default to `CREATE_NO_WINDOW`, avoiding console flashes from the desktop bundle.

## Git Bash lookup patch

`scripts/patch-bundled-python.mjs` patches upstream `tools/environments/local.py` `_find_bash` so the candidates list includes `HERMES_HOME/git` and `%LOCALAPPDATA%\\AI-Compartner\\git` before the stock `hermes\\git` / system Git paths.

## Gateway home-channel patch

The same script rewrites the gateway `run.py` home-channel block: keep upstream secret/config `home_env` resolution, auto-`/sethome` for weixin/wecom/dingtalk/feishu, and show a Chinese notice on first turn when still unset.
