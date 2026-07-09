#!/usr/bin/env node
/**
 * Post-process the bundled Python runtime for AI Compartner desktop:
 *   1. Copy desktop-only relay plugins (image_gen + video_gen)
 *   2. Install sitecustomize.py to suppress Windows console flashes
 *
 * Idempotent — safe to run after every `prepare-runtime`.
 */
// @lat: [[bundled-runtime#Desktop relay plugins]]
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function parsePythonDirArg() {
  const arg = process.argv.find((entry) => entry.startsWith("--python-dir="));
  if (arg) return resolve(arg.slice("--python-dir=".length));
  return join(resolve(__dirname, ".."), "resources", "python");
}

function bundledPythonExists(dir) {
  return (
    existsSync(join(dir, "python.exe")) ||
    existsSync(join(dir, "pythonw.exe")) ||
    existsSync(join(dir, "bin", "python3"))
  );
}

const PYTHON_DIR = parsePythonDirArg();
const SITE_PACKAGES = join(PYTHON_DIR, "Lib", "site-packages");
const PLUGINS_SRC = join(__dirname, "bundled-plugins");
const SITECUSTOMIZE_SRC = join(__dirname, "bundled-python", "sitecustomize.py");

function log(msg) {
  console.log(`[patch-bundled-python] ${msg}`);
}

/** Copy a file only when content differs — keeps mtimes stable so pack-runtime
 *  can skip rebuilding the archive when nothing actually changed. */
function copyIfChanged(src, dest) {
  mkdirSync(dirname(dest), { recursive: true });
  if (existsSync(dest)) {
    const srcBuf = readFileSync(src);
    const destBuf = readFileSync(dest);
    if (srcBuf.equals(destBuf)) return false;
  }
  writeFileSync(dest, readFileSync(src));
  return true;
}

function copyDirRecursive(src, dest) {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const from = join(src, entry.name);
    const to = join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(from, to);
    } else {
      copyIfChanged(from, to);
    }
  }
}

function copyRelayPlugins() {
  const pairs = [
    ["image_gen", "relay"],
    ["video_gen", "relay"],
  ];
  for (const [category, name] of pairs) {
    const src = join(PLUGINS_SRC, category, name);
    const dest = join(SITE_PACKAGES, "plugins", category, name);
    if (!existsSync(src)) {
      throw new Error(`missing bundled plugin source: ${src}`);
    }
    copyDirRecursive(src, dest);
    log(`installed plugins/${category}/${name}`);
  }
}

function installSitecustomize() {
  if (!existsSync(SITECUSTOMIZE_SRC)) {
    throw new Error(`missing ${SITECUSTOMIZE_SRC}`);
  }
  const dest = join(SITE_PACKAGES, "sitecustomize.py");
  if (copyIfChanged(SITECUSTOMIZE_SRC, dest)) {
    log(`installed sitecustomize.py (Windows subprocess hide)`);
  } else {
    log(`sitecustomize.py already up-to-date`);
  }
}

function copyDesktopMediaStorage() {
  const src = join(PLUGINS_SRC, "_desktop_media_storage.py");
  const dest = join(SITE_PACKAGES, "plugins", "_desktop_media_storage.py");
  if (!existsSync(src)) {
    throw new Error(`missing bundled helper: ${src}`);
  }
  if (copyIfChanged(src, dest)) {
    log("installed plugins/_desktop_media_storage.py");
  } else {
    log("plugins/_desktop_media_storage.py already up-to-date");
  }
}

const GATEWAY_HOME_CHANNEL_PATCH_MARKER = "# desktop: auto-sethome + zh notice v2";
const LOCAL_FIND_BASH_PATCH_MARKER = "# desktop: HERMES_HOME git bash lookup";

function gatewayHomeChannelPatchedBlock() {
  return `        # One-time prompt if no home channel is set for this platform
        # Skip for webhooks - they deliver directly to configured targets (github_comment, etc.)
        ${GATEWAY_HOME_CHANNEL_PATCH_MARKER}
        if source.platform and source.platform != Platform.LOCAL and source.platform != Platform.WEBHOOK:
            platform_name = source.platform.value
            env_key = _home_target_env_var(platform_name)
            _DESKTOP_AUTO_SETHOME = frozenset({"weixin", "wecom", "dingtalk", "feishu"})
            _DESKTOP_PLATFORM_LABELS = {
                "weixin": "微信",
                "wecom": "企业微信",
                "dingtalk": "钉钉",
                "feishu": "飞书",
            }
            if not os.getenv(env_key) and platform_name in _DESKTOP_AUTO_SETHOME:
                try:
                    from hermes_cli.config import save_env_value

                    chat_id = source.chat_id
                    chat_name = source.chat_name or chat_id
                    thread_env_key = _home_thread_env_var(platform_name)
                    save_env_value(env_key, str(chat_id))
                    save_env_value(thread_env_key, str(source.thread_id or ""))
                    os.environ[env_key] = str(chat_id)
                    os.environ[thread_env_key] = str(source.thread_id or "")
                    platform_config = self.config.platforms.setdefault(
                        source.platform,
                        PlatformConfig(enabled=True),
                    )
                    platform_config.home_channel = HomeChannel(
                        platform=source.platform,
                        chat_id=str(chat_id),
                        name=chat_name,
                        thread_id=str(source.thread_id) if source.thread_id else None,
                    )
                    logger.info(
                        "Auto-sethome: designated %s (%s) as %s home channel",
                        chat_id,
                        chat_name,
                        platform_name,
                    )
                except Exception as e:
                    logger.warning(
                        "Auto-sethome failed for %s: %s", platform_name, e,
                    )
            if not history and not os.getenv(env_key):
                # Slack dispatches all Hermes commands through a single
                # parent slash command \`/hermes\`; bare \`/sethome\` is not
                # registered and would fail with "app did not respond".
                sethome_cmd = (
                    "/hermes sethome"
                    if source.platform == Platform.SLACK
                    else "/sethome"
                )
                label = _DESKTOP_PLATFORM_LABELS.get(
                    platform_name, platform_name.title(),
                )
                notice = (
                    f"📬 尚未为{label}设置主频道。主频道用于接收定时任务结果和跨平台消息。\\n\\n"
                    f"发送 {sethome_cmd} 可将当前会话设为主频道，也可忽略此提示。"
                )
                await self._deliver_platform_notice(source, notice)`;
}

function patchLocalFindBash() {
  const localPath = join(SITE_PACKAGES, "tools", "environments", "local.py");
  if (!existsSync(localPath)) {
    log("tools/environments/local.py not found — skip bash lookup patch");
    return;
  }
  let content = readFileSync(localPath, "utf8");
  if (content.includes(LOCAL_FIND_BASH_PATCH_MARKER)) {
    log("local.py bash lookup already patched");
    return;
  }

  const needle = `    custom = os.environ.get("HERMES_GIT_BASH_PATH")
    if custom and os.path.isfile(custom):
        return custom

    # Prefer our own portable Git install first`;
  const replacement = `    custom = os.environ.get("HERMES_GIT_BASH_PATH")
    if custom and os.path.isfile(custom):
        return custom

    ${LOCAL_FIND_BASH_PATCH_MARKER}
    _hermes_home = os.environ.get("HERMES_HOME", "")
    if _hermes_home:
        for candidate in (
            os.path.join(_hermes_home, "git", "bin", "bash.exe"),
            os.path.join(_hermes_home, "git", "usr", "bin", "bash.exe"),
        ):
            if os.path.isfile(candidate):
                return candidate

    # Prefer our own portable Git install first`;

  if (!content.includes(needle)) {
    throw new Error(
      "local.py _find_bash block not found — upstream changed; update patch-bundled-python.mjs",
    );
  }
  content = content.replace(needle, replacement);

  const legacyNeedle = `_hermes_portable_git = os.path.join(_local_appdata, "hermes", "git") if _local_appdata else ""`;
  const legacyReplacement = `_hermes_portable_git_dirs = []
    if _local_appdata:
        for _subdir in ("AI-Compartner", "hermes"):
            _hermes_portable_git_dirs.append(os.path.join(_local_appdata, _subdir, "git"))`;
  if (content.includes(legacyNeedle)) {
    content = content.replace(legacyNeedle, legacyReplacement);
    content = content.replace(
      `    if _hermes_portable_git:
        for candidate in (
            os.path.join(_hermes_portable_git, "bin", "bash.exe"),        # PortableGit (primary)
            os.path.join(_hermes_portable_git, "usr", "bin", "bash.exe"), # MinGit fallback
        ):
            if os.path.isfile(candidate):
                return candidate`,
      `    for _hermes_portable_git in _hermes_portable_git_dirs:
        for candidate in (
            os.path.join(_hermes_portable_git, "bin", "bash.exe"),        # PortableGit (primary)
            os.path.join(_hermes_portable_git, "usr", "bin", "bash.exe"), # MinGit fallback
        ):
            if os.path.isfile(candidate):
                return candidate`,
    );
  }

  writeFileSync(localPath, content, "utf8");
  log("patched tools/environments/local.py: HERMES_HOME + AI-Compartner git bash lookup");
}

function patchGatewayHomeChannelNotice() {
  const runPath = join(SITE_PACKAGES, "gateway", "run.py");
  if (!existsSync(runPath)) {
    log("gateway/run.py not found — skip home-channel patch");
    return;
  }
  let content = readFileSync(runPath, "utf8");
  if (content.includes(GATEWAY_HOME_CHANNEL_PATCH_MARKER)) {
    log("gateway/run.py home-channel notice already patched");
    return;
  }

  const newBlock = gatewayHomeChannelPatchedBlock();
  const englishBlock = `        # One-time prompt if no home channel is set for this platform
        # Skip for webhooks - they deliver directly to configured targets (github_comment, etc.)
        if not history and source.platform and source.platform != Platform.LOCAL and source.platform != Platform.WEBHOOK:
            platform_name = source.platform.value
            env_key = _home_target_env_var(platform_name)
            if not os.getenv(env_key):
                # Slack dispatches all Hermes commands through a single
                # parent slash command \`/hermes\`; bare \`/sethome\` is not
                # registered and would fail with "app did not respond".
                sethome_cmd = (
                    "/hermes sethome"
                    if source.platform == Platform.SLACK
                    else "/sethome"
                )
                notice = (
                    f"📬 No home channel is set for {platform_name.title()}. "
                    f"A home channel is where Hermes delivers cron job results "
                    f"and cross-platform messages.\\n\\n"
                    f"Type {sethome_cmd} to make this chat your home channel, "
                    f"or ignore to skip."
                )
                await self._deliver_platform_notice(source, notice)`;

  // v1 patch left notice inside `not history`; upgrade that block to v2.
  const v1Marker = "# desktop: auto-sethome + zh notice\n";
  const v1Start = content.indexOf(v1Marker);
  if (v1Start !== -1) {
    const blockStart = content.lastIndexOf(
      "        # One-time prompt if no home channel is set for this platform\n",
      v1Start,
    );
    if (blockStart === -1) {
      throw new Error("gateway/run.py v1 home-channel patch start not found");
    }
    const voiceMarker =
      "        # -----------------------------------------------------------------\n        # Voice channel awareness";
    const v1End = content.indexOf(voiceMarker, v1Start);
    if (v1End === -1) {
      throw new Error("gateway/run.py v1 home-channel patch boundary not found");
    }
    content = content.slice(0, blockStart) + newBlock + "\n        \n" + content.slice(v1End);
    writeFileSync(runPath, content, "utf8");
    log("upgraded gateway/run.py home-channel patch to v2");
    return;
  }

  if (content.includes(englishBlock)) {
    content = content.replace(englishBlock, newBlock);
    writeFileSync(runPath, content, "utf8");
    log("patched gateway/run.py: auto-sethome for CN platforms + Chinese notice");
    return;
  }

  throw new Error(
    "gateway/run.py home-channel block not found — upstream gateway changed; update patch-bundled-python.mjs",
  );
}

function patchImageGenerateToolForDesktop() {
  const toolPath = join(SITE_PACKAGES, "tools", "image_generation_tool.py");
  if (!existsSync(toolPath)) {
    log("tools/image_generation_tool.py not found — skip desktop patch");
    return;
  }
  let content = readFileSync(toolPath, "utf8");
  if (content.includes("works_label")) {
    log("image_generation_tool.py already patched for desktop");
    return;
  }

  content = content.replace(
    '"description": "The text prompt describing the desired image. Be detailed and descriptive.",',
    `"description": (
                    "The text prompt describing the desired image. Be detailed and "
                    "descriptive. For Chinese-speaking users, write this prompt in "
                    "Chinese unless the user explicitly requested English."
                ),`,
  );

  content = content.replace(
    `"default": DEFAULT_ASPECT_RATIO,
            },
        },
        "required": ["prompt"],`,
    `"default": DEFAULT_ASPECT_RATIO,
            },
            "works_label": {
                "type": "string",
                "description": (
                    "Optional short label in the user's language for the desktop "
                    "My Works library (我的作品). When the user writes in Chinese, "
                    "provide a concise Chinese summary here if prompt is English."
                ),
            },
        },
        "required": ["prompt"],`,
  );

  content = content.replace(
    "def _dispatch_to_plugin_provider(prompt: str, aspect_ratio: str):",
    "def _dispatch_to_plugin_provider(prompt: str, aspect_ratio: str, extra_kwargs=None):",
  );

  content = content.replace(
    `        kwargs = {"prompt": prompt, "aspect_ratio": aspect_ratio}
        if configured_model:
            kwargs["model"] = configured_model
        result = provider.generate(**kwargs)`,
    `        kwargs = {"prompt": prompt, "aspect_ratio": aspect_ratio}
        if configured_model:
            kwargs["model"] = configured_model
        if isinstance(extra_kwargs, dict):
            for key, value in extra_kwargs.items():
                if value is not None and value != "":
                    kwargs[key] = value
        result = provider.generate(**kwargs)`,
  );

  content = content.replace(
    `    dispatched = _dispatch_to_plugin_provider(prompt, aspect_ratio)
    if dispatched is not None:
        return dispatched

    return image_generate_tool(`,
    `    extra_kwargs = {}
    works_label = args.get("works_label")
    if isinstance(works_label, str) and works_label.strip():
        extra_kwargs["works_label"] = works_label.strip()

    dispatched = _dispatch_to_plugin_provider(
        prompt, aspect_ratio, extra_kwargs or None,
    )
    if dispatched is not None:
        return dispatched

    return image_generate_tool(`,
  );

  writeFileSync(toolPath, content, "utf8");
  log("patched tools/image_generation_tool.py for desktop My Works labels");
}

const MEMORY_ACCOUNT_PATHS_MARKER =
  "# desktop: account-scoped memory paths (HERMES_ACCOUNT_KEY)";

function patchMemoryToolAccountPaths() {
  const toolPath = join(SITE_PACKAGES, "tools", "memory_tool.py");
  if (!existsSync(toolPath)) {
    log("tools/memory_tool.py not found — skip account paths patch");
    return;
  }
  let content = readFileSync(toolPath, "utf8");
  if (content.includes(MEMORY_ACCOUNT_PATHS_MARKER)) {
    log("memory_tool.py account paths already patched");
    return;
  }

  const oldBlock = `def get_memory_dir() -> Path:
    """Return the profile-scoped memories directory."""
    return get_hermes_home() / "memories"`;

  const newBlock = `def _sanitize_account_key_for_filename(account_key: str) -> str:
    import re
    return re.sub(r"[^a-zA-Z0-9._-]", "_", account_key)

${MEMORY_ACCOUNT_PATHS_MARKER}
def get_memory_dir() -> Path:
    """Return the profile-scoped memories directory for the active account."""
    base = get_hermes_home() / "memories"
    account_key = os.environ.get("HERMES_ACCOUNT_KEY", "").strip()
    if account_key:
        safe = _sanitize_account_key_for_filename(account_key)
        account_dir = base / "accounts" / safe
        account_dir.mkdir(parents=True, exist_ok=True)
        return account_dir
    if os.environ.get("HERMES_DESKTOP", "").strip() == "1":
        guest = base / "accounts" / "_guest"
        guest.mkdir(parents=True, exist_ok=True)
        return guest
    return base`;

  if (!content.includes(oldBlock)) {
    throw new Error(
      "memory_tool.py get_memory_dir block not found — upstream changed; update patch-bundled-python.mjs",
    );
  }
  content = content.replace(oldBlock, newBlock);
  writeFileSync(toolPath, content, "utf8");
  log("patched tools/memory_tool.py for account-scoped memory paths");
}

const DISPLAY_HERMES_HOME_PATCH_MARKER =
  "# desktop: HERMES_DESKTOP app name display";

function patchDisplayHermesHome() {
  const constantsPath = join(SITE_PACKAGES, "hermes_constants.py");
  if (!existsSync(constantsPath)) {
    log("hermes_constants.py not found — skip display_hermes_home patch");
    return;
  }
  let content = readFileSync(constantsPath, "utf8");
  if (content.includes(DISPLAY_HERMES_HOME_PATCH_MARKER)) {
    log("hermes_constants.py display_hermes_home already patched");
    return;
  }

  const oldBlock = `    """
    home = get_hermes_home()
    try:
        return "~/" + str(home.relative_to(Path.home()))
    except ValueError:
        return str(home)`;

  const newBlock = `    """
    ${DISPLAY_HERMES_HOME_PATCH_MARKER}
    if os.environ.get("HERMES_DESKTOP", "").strip() == "1":
        name = os.environ.get("HERMES_APP_NAME", "AI Compartner").strip()
        return name or "AI Compartner"
    home = get_hermes_home()
    try:
        return "~/" + str(home.relative_to(Path.home()))
    except ValueError:
        return str(home)`;

  if (!content.includes(oldBlock)) {
    throw new Error(
      "hermes_constants.py display_hermes_home block not found — upstream changed; update patch-bundled-python.mjs",
    );
  }
  content = content.replace(oldBlock, newBlock);
  writeFileSync(constantsPath, content, "utf8");
  log("patched hermes_constants.py: desktop display_hermes_home branding");
}

const GATEWAY_ALLOWLIST_WARNING_PATCH_MARKER =
  "# desktop: display_hermes_home in allowlist warning";

function patchGatewayAllowlistWarning() {
  const runPath = join(SITE_PACKAGES, "gateway", "run.py");
  if (!existsSync(runPath)) {
    log("gateway/run.py not found — skip allowlist warning patch");
    return;
  }
  let content = readFileSync(runPath, "utf8");
  if (
    content.includes(GATEWAY_ALLOWLIST_WARNING_PATCH_MARKER) ||
    content.includes(
      '"or explicitly opt in with GATEWAY_ALLOW_ALL_USERS=true in %s/.env plus "',
    )
  ) {
    log("gateway/run.py allowlist warning already patched");
    return;
  }

  const oldImport =
    "# Resolve Hermes home directory (respects HERMES_HOME override)\nfrom hermes_constants import get_hermes_home, get_hermes_home_override";
  const newImport =
    "# Resolve Hermes home directory (respects HERMES_HOME override)\nfrom hermes_constants import get_hermes_home, get_hermes_home_override, display_hermes_home";

  const oldWarning = `            logger.warning(
                "No env user allowlists configured. Messaging platforms default to "
                "pairing/allowlist policies and will deny unknown senders unless you "
                "configure platform allowlists (e.g., TELEGRAM_ALLOWED_USERS=your_id) "
                "or explicitly opt in with GATEWAY_ALLOW_ALL_USERS=true plus "
                "dm_policy/group_policy: open on the platform."
            )`;

  const newWarning = `            ${GATEWAY_ALLOWLIST_WARNING_PATCH_MARKER}
            logger.warning(
                "No env user allowlists configured. Messaging platforms default to "
                "pairing/allowlist policies and will deny unknown senders unless you "
                "configure platform allowlists (e.g., TELEGRAM_ALLOWED_USERS=your_id) "
                "or explicitly opt in with GATEWAY_ALLOW_ALL_USERS=true in %s/.env plus "
                "dm_policy/group_policy: open on the platform.",
                display_hermes_home(),
            )`;

  if (!content.includes(oldImport)) {
    throw new Error(
      "gateway/run.py hermes_constants import not found — upstream changed; update patch-bundled-python.mjs",
    );
  }
  if (!content.includes(oldWarning)) {
    throw new Error(
      "gateway/run.py allowlist warning not found — upstream changed; update patch-bundled-python.mjs",
    );
  }

  content = content.replace(oldImport, newImport);
  content = content.replace(oldWarning, newWarning);
  writeFileSync(runPath, content, "utf8");
  log("patched gateway/run.py: branded allowlist warning path");
}

function main() {
  if (!bundledPythonExists(PYTHON_DIR)) {
    log(`${PYTHON_DIR} not found — run prepare-runtime first, skipping`);
    return;
  }
  log(`patching bundled python at ${PYTHON_DIR}`);
  if (!existsSync(SITE_PACKAGES)) {
    throw new Error(`site-packages missing: ${SITE_PACKAGES}`);
  }
  copyRelayPlugins();
  copyDesktopMediaStorage();
  patchLocalFindBash();
  patchDisplayHermesHome();
  patchGatewayHomeChannelNotice();
  patchGatewayAllowlistWarning();
  patchMemoryToolAccountPaths();
  patchImageGenerateToolForDesktop();
  installSitecustomize();
  log("done");
}

main();
