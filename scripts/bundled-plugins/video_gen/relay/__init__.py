"""Desktop video_gen relay — upstream provider dispatch + My Works indexing."""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from agent.video_gen_provider import (
    DEFAULT_ASPECT_RATIO,
    DEFAULT_RESOLUTION,
    VideoGenProvider,
)
from plugins._desktop_media_storage import (
    _pick_fallback_provider,
    record_video_work,
)

logger = logging.getLogger(__name__)


class RelayVideoGenProvider(VideoGenProvider):
    @property
    def name(self) -> str:
        return "relay"

    @property
    def display_name(self) -> str:
        return "Desktop Relay"

    def is_available(self) -> bool:
        return self._upstream() is not None

    def _upstream(self) -> Optional[VideoGenProvider]:
        from agent.video_gen_registry import get_provider, list_providers

        return _pick_fallback_provider("video_gen", get_provider, list_providers)

    def list_models(self) -> List[Dict[str, Any]]:
        upstream = self._upstream()
        return upstream.list_models() if upstream is not None else []

    def default_model(self) -> Optional[str]:
        upstream = self._upstream()
        return upstream.default_model() if upstream is not None else None

    def generate(
        self,
        prompt: str,
        *,
        model: Optional[str] = None,
        image_url: Optional[str] = None,
        reference_image_urls: Optional[List[str]] = None,
        duration: Optional[int] = None,
        aspect_ratio: str = DEFAULT_ASPECT_RATIO,
        resolution: str = DEFAULT_RESOLUTION,
        negative_prompt: Optional[str] = None,
        audio: Optional[bool] = None,
        seed: Optional[int] = None,
        **kwargs: Any,
    ) -> Dict[str, Any]:
        upstream = self._upstream()
        if upstream is None:
            return {
                "success": False,
                "video": None,
                "error": "No upstream video_gen provider is available for desktop relay.",
                "error_type": "provider_unavailable",
                "provider": self.name,
                "prompt": prompt,
                "aspect_ratio": aspect_ratio,
            }

        result = upstream.generate(
            prompt,
            model=model,
            image_url=image_url,
            reference_image_urls=reference_image_urls,
            duration=duration,
            aspect_ratio=aspect_ratio,
            resolution=resolution,
            negative_prompt=negative_prompt,
            audio=audio,
            seed=seed,
            **kwargs,
        )
        return record_video_work(
            result,
            works_label=kwargs.get("works_label"),
            prompt=prompt,
        )


def register(ctx) -> None:
    ctx.register_video_gen_provider(RelayVideoGenProvider())
