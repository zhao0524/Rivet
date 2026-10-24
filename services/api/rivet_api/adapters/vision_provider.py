"""Model backends for the live vision provider.

A backend turns (system prompt, user text, optional image) into raw reply text. It
knows nothing about IntentSpec; parsing and validation happen in LiveVisionProvider.
Provider exceptions are mapped to generic API errors and their details are never
forwarded, since they can contain credentials.
"""

import base64
import logging
from typing import Any, Protocol

from rivet_api.errors import ApiError

log = logging.getLogger("rivet_api")


class VisionBackend(Protocol):
    def complete_json(self, system: str, user_text: str, image: tuple[bytes, str] | None) -> str: ...


_ERROR_MAP: dict[str, tuple[str, str, int, bool]] = {
    "RateLimitError": ("PROVIDER_QUOTA", "The vision provider rate limit was reached", 429, True),
    "APIConnectionError": ("PROVIDER_UNAVAILABLE", "The vision provider could not be reached", 503, True),
    "APITimeoutError": ("PROVIDER_UNAVAILABLE", "The vision provider timed out", 503, True),
    "InternalServerError": ("PROVIDER_UNAVAILABLE", "The vision provider had an internal error", 503, True),
    "AuthenticationError": ("PROVIDER_AUTH", "The vision provider rejected the server credentials", 502, False),
    "PermissionDeniedError": ("PROVIDER_AUTH", "The vision provider rejected the server credentials", 502, False),
}


def map_provider_error(exc: Exception) -> ApiError:
    name = type(exc).__name__
    log.warning("vision provider call failed: %s", name)  # class only; never str(exc)
    code, message, status, retryable = _ERROR_MAP.get(
        name, ("PROVIDER_ERROR", "The vision provider returned an error", 502, False)
    )
    return ApiError(code, message, status, retryable=retryable)


class OpenAIBackend:
    """Chat Completions with JSON mode. `client` is an `openai.OpenAI` instance."""

    def __init__(self, client: Any, model: str):
        self.client = client
        self.model = model

    def __repr__(self) -> str:
        return f"OpenAIBackend(model={self.model!r})"

    def complete_json(self, system: str, user_text: str, image: tuple[bytes, str] | None) -> str:
        content: list[dict[str, Any]] = [{"type": "text", "text": user_text}]
        if image is not None:
            data, mime = image
            uri = f"data:{mime};base64,{base64.b64encode(data).decode()}"
            content.append({"type": "image_url", "image_url": {"url": uri}})
        try:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": content},
                ],
                response_format={"type": "json_object"},
            )
        except Exception as exc:
            raise map_provider_error(exc) from None
        return response.choices[0].message.content or ""
