"""Desktop image_gen relay — upstream provider dispatch + My Works indexing."""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from agent.image_gen_provider import DEFAULT_ASPECT_RATIO, ImageGenProvider
from plugins._desktop_media_storage import (
    _pick_fallback_provider,
    record_image_work,
)

logger = logging.getLogger(__name__)


class RelayImageGenProvider(ImageGenProvider):
    @property
    def name(self) -> str:
        return "relay"

    @property
    def display_name(self) -> str:
        return "Desktop Relay"

    def is_available(self) -> bool:
        return self._upstream() is not None

    def _upstream(self) -> Optional[ImageGenProvider]:
        from agent.image_gen_registry import get_provider, list_providers

        return _pick_fallback_provider("image_gen", get_provider, list_providers)

    def list_models(self) -> List[Dict[str, Any]]:
        upstream = self._upstream()
        return upstream.list_models() if upstream is not None else []

    def default_model(self) -> Optional[str]:
        upstream = self._upstream()
        return upstream.default_model() if upstream is not None else None

    def capabilities(self) -> Dict[str, Any]:
        upstream = self._upstream()
        return upstream.capabilities() if upstream is not None else super().capabilities()

    def generate(
        self,
        prompt: str,
        aspect_ratio: str = DEFAULT_ASPECT_RATIO,
        *,
        image_url: Optional[str] = None,
        reference_image_urls: Optional[List[str]] = None,
        **kwargs: Any,
    ) -> Dict[str, Any]:
        upstream = self._upstream()
        if upstream is None:
            return {
                "success": False,
                "image": None,
                "error": "No upstream image_gen provider is available for desktop relay.",
                "error_type": "provider_unavailable",
                "provider": self.name,
                "prompt": prompt,
                "aspect_ratio": aspect_ratio,
            }

        result = upstream.generate(
            prompt,
            aspect_ratio,
            image_url=image_url,
            reference_image_urls=reference_image_urls,
            **kwargs,
        )
        return record_image_work(
            result,
            works_label=kwargs.get("works_label"),
            prompt=prompt,
        )


def register(ctx) -> None:
    ctx.register_image_gen_provider(RelayImageGenProvider())
