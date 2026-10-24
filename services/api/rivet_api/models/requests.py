import re
from decimal import Decimal, InvalidOperation
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

_ASSET_ID_RE = re.compile(r"^asset-[0-9a-f]{32}$")


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class GenerateInput(_Strict):
    kind: Literal["image", "text", "image_and_text"]
    image_asset_id: str | None = None
    user_text: str | None = Field(default=None, max_length=2000)

    @field_validator("image_asset_id")
    @classmethod
    def _asset_id_shape(cls, value: str | None) -> str | None:
        if value is not None and not _ASSET_ID_RE.match(value):
            raise ValueError("image_asset_id is not a valid asset id")
        return value

    @model_validator(mode="after")
    def _kind_matches_content(self) -> "GenerateInput":
        has_text = bool(self.user_text and self.user_text.strip())
        if self.kind in ("image", "image_and_text") and not self.image_asset_id:
            raise ValueError(f"kind {self.kind!r} requires image_asset_id")
        if self.kind == "text" and not has_text:
            raise ValueError("kind 'text' requires non-blank user_text")
        if self.kind == "text" and self.image_asset_id:
            raise ValueError("kind 'text' must not carry image_asset_id")
        return self


class GenerateRequirements(_Strict):
    """Requirements the user states explicitly; never taken from a model."""

    max_budget: str | None = None
    currency: str | None = Field(default=None, pattern=r"^[A-Z]{3}$")
    max_length_mm: float | None = Field(default=None, gt=0)
    max_width_mm: float | None = Field(default=None, gt=0)
    preferred_color: str | None = None

    @field_validator("max_budget")
    @classmethod
    def _decimal_string(cls, value: str | None) -> str | None:
        if value is None:
            return value
        try:
            if Decimal(value) < 0:
                raise ValueError("max_budget must not be negative")
        except InvalidOperation as exc:
            raise ValueError("max_budget must be a decimal string") from exc
        return value


class GenerateRequest(_Strict):
    input: GenerateInput
    requirements: GenerateRequirements | None = None


class ResolveRequest(_Strict):
    """Image or text in; the same input rules as generate, with no build requirements."""

    input: GenerateInput


class EditRequest(_Strict):
    base_revision: int = Field(ge=1)
    instruction: str | None = None
    operation: dict[str, Any] | None = None
