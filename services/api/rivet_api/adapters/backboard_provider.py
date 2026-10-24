"""Backboard.io backend for the live vision provider.

One stateless call per reply: POST /threads/messages with memory off, no tools and
`json_output` on. The image, if any, is sent as a multipart `files` attachment. Errors
are mapped to generic API errors; provider details are never forwarded.
"""

import logging
from typing import Any

import httpx

from rivet_api.errors import ApiError

log = logging.getLogger("rivet_api")

DEFAULT_BASE_URL = "https://app.backboard.io/api"
# Backboard validates the upload's file extension, so a bare name like "image" is a 400.
_IMAGE_EXTENSIONS = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp"}


def _status_error(status: int) -> ApiError:
    if status == 429:
        return ApiError("PROVIDER_QUOTA", "The vision provider rate limit was reached", 429, retryable=True)
    if status in (401, 403):
        return ApiError("PROVIDER_AUTH", "The vision provider rejected the server credentials", 502)
    if status >= 500:
        return ApiError("PROVIDER_UNAVAILABLE", "The vision provider had an internal error", 503, retryable=True)
    return ApiError("PROVIDER_ERROR", "The vision provider returned an error", 502)


class BackboardBackend:
    def __init__(
        self,
        api_key: str,
        model: str,
        llm_provider: str = "openai",
        base_url: str = DEFAULT_BASE_URL,
        client: Any = None,
    ):
        self._api_key = api_key
        self.model = model
        self.llm_provider = llm_provider
        self.base_url = base_url.rstrip("/")
        self.client = client or httpx.Client(timeout=60.0)

    def __repr__(self) -> str:
        return f"BackboardBackend(provider={self.llm_provider!r}, model={self.model!r})"

    def complete_json(self, system: str, user_text: str, image: tuple[bytes, str] | None) -> str:
        data = {
            "content": user_text,
            "system_prompt": system,
            "llm_provider": self.llm_provider,
            "model_name": self.model,
            "memory": "off",
            "web_search": "off",
            "json_output": "true",
            "stream": "false",
        }
        files = None
        if image is not None:
            files = {"files": (f"image{_IMAGE_EXTENSIONS.get(image[1], '')}", image[0], image[1])}
        try:
            response = self.client.post(
                f"{self.base_url}/threads/messages",
                headers={"X-API-Key": self._api_key},
                data=data,
                files=files,
            )
        except httpx.TimeoutException:
            log.warning("vision provider call failed: timeout")
            raise ApiError("PROVIDER_UNAVAILABLE", "The vision provider timed out", 503, retryable=True) from None
        except httpx.HTTPError as exc:
            log.warning("vision provider call failed: %s", type(exc).__name__)
            raise ApiError("PROVIDER_UNAVAILABLE", "The vision provider could not be reached", 503, retryable=True) from None
        if response.status_code >= 400:
            log.warning("vision provider call failed: HTTP %s", response.status_code)
            raise _status_error(response.status_code)
        try:
            body = response.json()
        except ValueError:
            body = None
        if not isinstance(body, dict):
            return ""
        # A failed run still answers HTTP 200: `content` then holds the provider's own message
        # (for example "add credits"), which must never be parsed as the model's reply.
        if str(body.get("status", "")).upper() == "FAILED":
            log.warning("vision provider run failed: %s", str(body.get("content", ""))[:200])
            raise ApiError("PROVIDER_ERROR", "The vision provider could not complete the request", 502)
        content = body.get("content")
        return content if isinstance(content, str) else ""
