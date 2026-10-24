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
            import rivet_engine
            from rivet_engine import apply_edit, get_catalog, solve, verify
            self._get_sourcing_report = getattr(rivet_engine, "get_sourcing_report", None)
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
        # Startup probe: an engine whose entry points are still placeholders imports fine
        # but cannot serve requests, so it must count as unavailable (and trigger the
        # labeled fallback) rather than fail every job later.
        try:
            self._call(self._get_catalog)
        except ApiError as err:
            raise ApiError(
                "ENGINE_UNAVAILABLE",
                "The engineering engine is installed but not ready",
                503,
                {"reason": err.code, **err.details},
            ) from None

    @staticmethod
    def _envelope_error(exc: Exception) -> ApiError | None:
        """Use the engine's own envelope (rivet_engine.ports.EngineError) when it has one."""
        to_envelope, status = getattr(exc, "to_envelope", None), getattr(exc, "http_status", None)
        if not callable(to_envelope) or not isinstance(status, int):
            return None
        try:
            err = to_envelope()["error"]
            return ApiError(
                str(err["code"]),
                str(err["message"]),
                status,
                dict(err.get("details") or {}),
                bool(err.get("retryable", False)),
            )
        except (KeyError, TypeError, ValueError):
            return None

    @classmethod
    def _call(cls, fn, *args):
        """Map engine exceptions to API errors. Only engine-authored envelopes are shown."""
        try:
            return fn(*args)
        except ApiError:
            raise
        except Exception as exc:
            name = type(exc).__name__
            log.warning("engine call failed: %s", name)
            mapped = cls._envelope_error(exc)
            if mapped is not None:
                raise mapped from None
            # Not a structured engine error: say nothing about its text (it may hold paths).
            raise ApiError("ENGINE_ERROR", "The engineering engine failed", 502, {"engine_error": name}) from None

    def solve(self, intent: dict[str, Any]) -> dict[str, Any]:
        return self._call(self._solve, intent)

    def apply_edit(self, plan: dict[str, Any], operation: dict[str, Any]) -> dict[str, Any]:
        return self._call(self._apply_edit, plan, operation)

    def verify(self, plan: dict[str, Any]) -> dict[str, Any]:
        return self._call(self._verify, plan)

    def get_sourcing_report(self) -> dict[str, Any]:
        return self._call(self._get_sourcing_report) if self._get_sourcing_report else {}

    def get_catalog(self) -> list[dict[str, Any]]:
        return self._call(self._get_catalog)


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
