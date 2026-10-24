"""Template-based ESP32 firmware for the single supported profile.

Nothing here chooses hardware: GPIO numbers come only from the plan's pin map (which
the engineering engine owns), behavior thresholds come from the plan's parameters, and
templates are filled by an allow-list substitution. Unknown or missing signals are
rejected, never defaulted.
"""

import hashlib
import json
import math
import re
import tempfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from rivet_api.errors import ApiError
from rivet_api.firmware.compile import CompileResult, compile_firmware

PROFILE_ID = "rover.obstacle_avoidance.v1"
TARGET = "esp32_arduino_platformio"
# Signals the template needs. Values must be ESP32 GPIO numbers supplied by the plan.
FIRMWARE_SIGNALS = (
    "motor_left_pwm",
    "motor_left_in1",
    "motor_left_in2",
    "motor_right_pwm",
    "motor_right_in1",
    "motor_right_in2",
    "motor_standby",
    "i2c_sda",
    "i2c_scl",
)
_MAX_GPIO = 39

_TEMPLATE_DIR = Path(__file__).resolve().parent / "templates" / "esp32_rover"
_TEMPLATE_SOURCE_PREFIX = "rivet_api/firmware/templates/esp32_rover/"
# output path in the ZIP -> template file
_FILES = {
    "platformio.ini": "platformio.ini.tmpl",
    "src/main.cpp": "main.cpp.tmpl",
    "include/rivet_config.h": "rivet_config.h.tmpl",
    "README.md": "README.md.tmpl",
}
_PLACEHOLDER_RE = re.compile(r"\{\{([A-Z0-9_]+)\}\}")
_UNSAFE_TEXT_RE = re.compile(r"[^A-Za-z0-9 ._:()-]")


@dataclass
class FirmwareBundle:
    files: dict[str, bytes]
    manifest: dict[str, Any]
    compile: CompileResult | None = None


def _safe_text(value: Any, limit: int = 80) -> str:
    """Whitelist characters so metadata can never close a comment, string or markup."""
    return _UNSAFE_TEXT_RE.sub("?", str(value))[:limit]


def _not_supported(message: str, **details: Any) -> ApiError:
    return ApiError("FIRMWARE_NOT_SUPPORTED", message, 422, details)


def _validate_pin_map(pin_map: Any) -> dict[str, int]:
    if not isinstance(pin_map, dict) or not pin_map:
        raise _not_supported(
            "This plan has no firmware pin map; firmware needs the engine's validated pin allocation",
            required_signals=list(FIRMWARE_SIGNALS),
        )
    unknown = sorted(set(pin_map) - set(FIRMWARE_SIGNALS))
    missing = [s for s in FIRMWARE_SIGNALS if s not in pin_map]
    invalid = [
        s
        for s in FIRMWARE_SIGNALS
        if s in pin_map
        and (
            isinstance(pin_map[s], bool)
            or not isinstance(pin_map[s], int)
            or not 0 <= pin_map[s] <= _MAX_GPIO
        )
    ]
    seen: dict[int, list[str]] = {}
    for s in FIRMWARE_SIGNALS:
        value = pin_map.get(s)
        if s not in invalid and isinstance(value, int) and not isinstance(value, bool):
            seen.setdefault(value, []).append(s)
    duplicates = [sorted(names) for names in seen.values() if len(names) > 1]
    if unknown or missing or invalid or duplicates:
        raise ApiError(
            "FIRMWARE_INVALID_PIN_MAP",
            "The plan's pin map cannot be turned into firmware",
            422,
            {"unknown": unknown, "missing": missing, "invalid": invalid, "duplicates": duplicates},
        )
    return {s: pin_map[s] for s in FIRMWARE_SIGNALS}


def _number(params: dict[str, Any], name: str, low: float, high: float) -> float:
    value = params.get(name)
    if (
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or not math.isfinite(value)
        or not low < value <= high
    ):
        raise ApiError(
            "FIRMWARE_INVALID_PARAMETER",
            f"Behavior parameter {name!r} is missing or outside ({low}, {high}]",
            422,
            {"parameter": name},
        )
    return value


def _behavior_values(params: dict[str, Any]) -> dict[str, str]:
    stop_m = _number(params, "obstacle_stop_distance_m", 0, 8.0)
    turn_ms = _number(params, "turn_duration_ms", 0, 60_000)
    speed = _number(params, "forward_speed_fraction", 0, 1.0)
    return {
        "OBSTACLE_STOP_MM": str(max(1, round(stop_m * 1000))),
        "TURN_DURATION_MS": str(max(1, round(turn_ms))),
        "FORWARD_PWM": str(max(1, round(speed * 255))),
    }


def _render(template: str, values: dict[str, str]) -> str:
    def substitute(match: re.Match[str]) -> str:
        key = match.group(1)
        if key not in values:
            raise RuntimeError(f"firmware template uses unknown placeholder {key}")
        return values[key]

    return _PLACEHOLDER_RE.sub(substitute, template)


def _check_supported(plan: dict[str, Any]) -> None:
    if plan["status"] == "unbuildable":
        raise ApiError(
            "FIRMWARE_REFUSED", "Firmware is not generated for an unbuildable plan", 422, {"status": plan["status"]}
        )
    firmware = plan["firmware"]
    if (
        firmware.get("target") != TARGET
        or firmware.get("profile_id") != PROFILE_ID
        or plan["behavior"].get("profile_id") != PROFILE_ID
    ):
        raise _not_supported(
            "Only the rover.obstacle_avoidance.v1 profile on esp32_arduino_platformio is supported",
            supported_profile=PROFILE_ID,
            supported_target=TARGET,
        )


def render_project(plan: dict[str, Any]) -> dict[str, bytes]:
    _check_supported(plan)
    pins = _validate_pin_map(plan["firmware"].get("pin_map"))
    behavior = _behavior_values(plan["behavior"].get("parameters", {}))
    mode = plan["provenance"]["generation_mode"]
    values = {
        "BUILD_ID": _safe_text(plan["build_id"]),
        "REVISION": str(int(plan["revision"])),
        "PROFILE_ID": PROFILE_ID,
        "TITLE": _safe_text(plan["title"]),
        "PLAN_STATUS": _safe_text(plan["status"]),
        "GENERATION_MODE": _safe_text(mode),
        "FIXTURE_WARNING": (
            "\n**WARNING: SAVED FIXTURE.** This firmware comes from a saved build "
            f"(generation_mode={_safe_text(mode)}), not a live engineering result.\n"
            if mode in ("fixture", "fallback")
            else ""
        ),
        **{f"PIN_{signal.upper()}": str(pin) for signal, pin in pins.items()},
        **behavior,
    }
    return {
        path: _render((_TEMPLATE_DIR / name).read_text(), values).encode()
        for path, name in _FILES.items()
    }


def _manifest(plan: dict[str, Any], files: dict[str, bytes], compile_status: str) -> dict[str, Any]:
    return {
        "build_id": plan["build_id"],
        "revision": plan["revision"],
        "profile_id": PROFILE_ID,
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "plan_status": plan["status"],
        "generation_mode": plan["provenance"]["generation_mode"],
        "compile_status": compile_status,
        "files": [
            {
                "path": path,
                "sha256": hashlib.sha256(data).hexdigest(),
                "template_source": _TEMPLATE_SOURCE_PREFIX + _FILES[path],
            }
            for path, data in files.items()
        ],
    }


def generate_firmware(
    plan: dict[str, Any],
    compile: bool = False,
    compiler: Callable[[Path], CompileResult] = compile_firmware,
) -> FirmwareBundle:
    files = render_project(plan)
    result: CompileResult | None = None
    if compile:
        with tempfile.TemporaryDirectory(prefix="rivet-fw-") as tmp:
            for path, data in files.items():
                target = Path(tmp) / path
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(data)
            result = compiler(Path(tmp))
    manifest = _manifest(plan, files, result.status if result else "not_checked")
    files = {**files, "manifest.json": (json.dumps(manifest, indent=2) + "\n").encode()}
    return FirmwareBundle(files=files, manifest=manifest, compile=result)
