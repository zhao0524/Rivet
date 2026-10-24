"""EngineeringPort: the only way A talks to Developer B's engine.

Only the public entry points `solve`, `apply_edit`, `verify`, `get_catalog` of
`rivet_engine` are used; no internal modules are imported.
"""

import logging
from typing import Any, Protocol

from rivet_api.adapters.fixture import FixtureEngineeringAdapter
from rivet_api.config import Settings
from rivet_api.errors import ApiError

log = logging.getLogger("rivet_api")


class EngineeringPort(Protocol):
    def solve(self, intent: dict[str, Any]) -> dict[str, Any]: ...
    def apply_edit(self, plan: dict[str, Any], operation: dict[str, Any]) -> dict[str, Any]: ...
    def verify(self, plan: dict[str, Any]) -> dict[str, Any]: ...
    def get_catalog(self) -> list[dict[str, Any]]: ...


class RealEngineeringAdapter:
    def __init__(self) -> None:
        try:
            from rivet_engine import apply_edit, get_catalog, solve, verify
        except ImportError as exc:
            raise ApiError(
                "ENGINE_UNAVAILABLE",
                "The engineering package (rivet_engine) is not installed",
                503,
                {"hint": "pip install -e packages/engineering"},
                retryable=False,
            ) from exc
        self._solve, self._apply_edit, self._verify, self._get_catalog = (
            solve,
            apply_edit,
            verify,
            get_catalog,
        )

    def solve(self, intent: dict[str, Any]) -> dict[str, Any]:
        return self._solve(intent)

    def apply_edit(self, plan: dict[str, Any], operation: dict[str, Any]) -> dict[str, Any]:
        return self._apply_edit(plan, operation)

    def verify(self, plan: dict[str, Any]) -> dict[str, Any]:
        return self._verify(plan)

    def get_catalog(self) -> list[dict[str, Any]]:
        return self._get_catalog()


def build_engineering_port(settings: Settings) -> EngineeringPort:
    if settings.mode == "fixture":
        return FixtureEngineeringAdapter(settings.demo_fixture, "fixture")
    try:
        return RealEngineeringAdapter()
    except ApiError:
        if not settings.allow_fallback:
            raise
        log.warning("rivet_engine unavailable; serving labeled fallback fixture")
        return FixtureEngineeringAdapter(settings.demo_fixture, "fallback")
