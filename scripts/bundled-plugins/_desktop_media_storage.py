"""Desktop-only helpers for the My Works media library under HERMES_HOME/desktop/works."""

from __future__ import annotations

import json
import logging
import os
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

logger = logging.getLogger(__name__)

_RELAY_NAME = "relay"
_MAX_INDEX_ENTRIES = 500


def desktop_enabled() -> bool:
    return os.environ.get("HERMES_DESKTOP", "").strip() == "1"


def _works_root() -> Path:
    from hermes_constants import get_hermes_home

    root = get_hermes_home() / "desktop" / "works"
    root.mkdir(parents=True, exist_ok=True)
    return root


def _index_path() -> Path:
    return _works_root() / "index.json"


def _load_index() -> List[Dict[str, Any]]:
    path = _index_path()
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except Exception as exc:
        logger.debug("Could not read works index: %s", exc)
        return []


def _save_index(entries: List[Dict[str, Any]]) -> None:
    _index_path().write_text(
        json.dumps(entries[:_MAX_INDEX_ENTRIES], ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def _is_local_path(value: str) -> bool:
    if not value:
        return False
    if value.startswith("file:"):
        return True
    parsed = urlparse(value)
    if parsed.scheme in ("http", "https", "data"):
        return False
    return Path(value).exists()


def _stage_local_file(src_path: str, subdir: str) -> Optional[str]:
    src = Path(src_path)
    if not src.is_file():
        return None
    dest_dir = _works_root() / subdir
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / src.name
    try:
        if dest.resolve() != src.resolve():
            shutil.copy2(src, dest)
    except OSError as exc:
        logger.debug("Could not copy work media %s -> %s: %s", src, dest, exc)
        return str(src)
    return str(dest)


def _append_entry(
    *,
    kind: str,
    media_path: Optional[str],
    label: str,
    prompt: Optional[str],
    result: Dict[str, Any],
) -> None:
    if not media_path:
        return
    entry = {
        "id": datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%f"),
        "kind": kind,
        "label": label,
        "path": media_path,
        "prompt": prompt or result.get("prompt"),
        "model": result.get("model"),
        "provider": result.get("provider"),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    entries = _load_index()
    entries.insert(0, entry)
    _save_index(entries)


def record_image_work(
    result: Dict[str, Any],
    *,
    works_label: Optional[str] = None,
    prompt: Optional[str] = None,
) -> Dict[str, Any]:
    if not desktop_enabled() or not result.get("success"):
        return result

    out = dict(result)
    image = out.get("image")
    if isinstance(image, str) and _is_local_path(image):
        copied = _stage_local_file(image, "images")
        if copied:
            out["image"] = copied

    label = (works_label or "").strip() or (prompt or "").strip()[:120]
    if label:
        _append_entry(
            kind="image",
            media_path=out.get("image") if isinstance(out.get("image"), str) else None,
            label=label,
            prompt=prompt,
            result=out,
        )
    return out


def record_video_work(
    result: Dict[str, Any],
    *,
    works_label: Optional[str] = None,
    prompt: Optional[str] = None,
) -> Dict[str, Any]:
    if not desktop_enabled() or not result.get("success"):
        return result

    out = dict(result)
    video = out.get("video")
    if isinstance(video, str) and _is_local_path(video):
        copied = _stage_local_file(video, "videos")
        if copied:
            out["video"] = copied

    label = (works_label or "").strip() or (prompt or "").strip()[:120]
    if label:
        _append_entry(
            kind="video",
            media_path=out.get("video") if isinstance(out.get("video"), str) else None,
            label=label,
            prompt=prompt,
            result=out,
        )
    return out


def _load_section(category: str) -> Dict[str, Any]:
    try:
        from hermes_cli.config import load_config

        cfg = load_config()
        section = cfg.get(category) if isinstance(cfg, dict) else None
        return section if isinstance(section, dict) else {}
    except Exception as exc:
        logger.debug("Could not load %s config: %s", category, exc)
        return {}


def resolve_upstream_name(category: str) -> Optional[str]:
    section = _load_section(category)
    for key in ("relay_upstream", "upstream_provider", "upstream"):
        raw = section.get(key)
        if isinstance(raw, str) and raw.strip() and raw.strip() != _RELAY_NAME:
            return raw.strip()
    return None


def _pick_fallback_provider(category: str, get_provider, list_providers):
    configured = resolve_upstream_name(category)
    if configured:
        provider = get_provider(configured)
        if provider is not None and provider.name != _RELAY_NAME:
            return provider

    preferred = ("fal", "openai", "openai-codex", "xai", "krea")
    for name in preferred:
        provider = get_provider(name)
        if provider is not None and provider.name != _RELAY_NAME:
            try:
                if provider.is_available():
                    return provider
            except Exception:
                continue

    for provider in list_providers():
        if provider.name == _RELAY_NAME:
            continue
        try:
            if provider.is_available():
                return provider
        except Exception:
            continue
    return None
