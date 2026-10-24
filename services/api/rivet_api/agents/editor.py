"""Edit operation parsing. Only the five allowed operations ever reach the engine."""

from typing import Annotated, Callable, Literal, Union

from pydantic import BaseModel, ConfigDict, Field, StrictFloat, StrictInt, TypeAdapter, ValidationError

from rivet_api.errors import ApiError

ALLOWED_OPERATIONS = [
    "set_budget",
    "set_behavior_parameter",
    "replace_optional_sensor",
    "set_mount_offset_within_template",
    "change_appearance_color",
]


class _Op(BaseModel):
    model_config = ConfigDict(extra="forbid")


class SetBudget(_Op):
    op: Literal["set_budget"]
    amount: str
    currency: str = "USD"


class SetBehaviorParameter(_Op):
    op: Literal["set_behavior_parameter"]
    name: str
    value: Union[StrictInt, StrictFloat]


class ReplaceOptionalSensor(_Op):
    op: Literal["replace_optional_sensor"]
    catalog_id: str


class SetMountOffsetWithinTemplate(_Op):
    op: Literal["set_mount_offset_within_template"]
    instance_id: str
    offset_mm: Annotated[list[float], Field(min_length=3, max_length=3)]


class ChangeAppearanceColor(_Op):
    op: Literal["change_appearance_color"]
    instance_id: str
    color: str


EditOperation = Annotated[
    Union[
        SetBudget,
        SetBehaviorParameter,
        ReplaceOptionalSensor,
        SetMountOffsetWithinTemplate,
        ChangeAppearanceColor,
    ],
    Field(discriminator="op"),
]
_adapter = TypeAdapter(EditOperation)

# Optional free-text -> operation selector (an LLM). It may only return one of the
# allowed operations as a dict, or None; its output is validated like any other input.
EditSelector = Callable[[str], dict | None]


def _unsupported(message: str, **details) -> ApiError:
    return ApiError(
        "UNSUPPORTED_EDIT", message, 422, {"allowed_operations": ALLOWED_OPERATIONS, **details}
    )


def parse_edit(
    instruction: str | None, operation: dict | None, selector: EditSelector | None = None
) -> BaseModel:
    raw = operation
    if raw is None:
        if instruction and instruction.strip() and selector is not None:
            raw = selector(instruction)
        if raw is None:
            raise _unsupported("This edit could not be mapped to a supported operation")
    try:
        return _adapter.validate_python(raw)
    except ValidationError as exc:
        fields = [".".join(str(p) for p in e["loc"]) for e in exc.errors()]
        raise _unsupported("The edit operation is not valid", fields=fields) from exc
