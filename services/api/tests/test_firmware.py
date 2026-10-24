import hashlib
import io
import json
import re
import zipfile
from pathlib import Path

import pytest

from rivet_api.errors import ApiError
from rivet_api.firmware.compile import compile_firmware
from rivet_api.firmware.generate import FIRMWARE_SIGNALS, PROFILE_ID, generate_firmware

# TEST DATA ONLY: arbitrary distinct numbers so the template can be exercised.
# This is not wiring advice and not a real pin allocation (that comes from B's engine).
TEST_PINS = dict(zip(FIRMWARE_SIGNALS, [16, 17, 18, 19, 21, 22, 23, 25, 26]))

REQUIRED_MEMBERS = {"platformio.ini", "src/main.cpp", "include/rivet_config.h", "README.md", "manifest.json"}


def with_pins(plan: dict, pins: dict | None = None) -> dict:
    plan["firmware"]["pin_map"] = dict(TEST_PINS if pins is None else pins)
    return plan


@pytest.fixture
def plan(plan_dict):
    return with_pins(plan_dict)


def text(bundle, name: str) -> str:
    return bundle.files[name].decode()


# ---- generation ---------------------------------------------------------------------


def test_signal_list_is_the_documented_nine():
    assert len(FIRMWARE_SIGNALS) == 9 and len(set(FIRMWARE_SIGNALS)) == 9
    assert PROFILE_ID == "rover.obstacle_avoidance.v1"


def test_bundle_contains_exactly_the_required_members(plan):
    assert set(generate_firmware(plan).files) == REQUIRED_MEMBERS


def test_manifest_matches_plan_and_file_hashes(plan):
    bundle = generate_firmware(plan)
    m = json.loads(bundle.files["manifest.json"])
    assert (m["build_id"], m["revision"], m["profile_id"]) == (plan["build_id"], plan["revision"], PROFILE_ID)
    assert m["plan_status"] == plan["status"] == "needs_review"
    assert m["generation_mode"] == plan["provenance"]["generation_mode"]
    assert m["compile_status"] == "not_checked"
    assert re.match(r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$", m["generated_at"])
    listed = {f["path"]: f for f in m["files"]}
    assert set(listed) == REQUIRED_MEMBERS - {"manifest.json"}
    for path, entry in listed.items():
        assert entry["sha256"] == hashlib.sha256(bundle.files[path]).hexdigest()
        assert entry["template_source"].startswith("rivet_api/firmware/templates/esp32_rover/")
        assert (Path(__file__).parents[1] / entry["template_source"]).is_file()


def test_pin_map_values_are_rendered_into_the_config_header(plan):
    header = text(generate_firmware(plan), "include/rivet_config.h")
    for signal, pin in TEST_PINS.items():
        assert re.search(rf"^#define PIN_{signal.upper()} {pin}$", header, re.M), signal


def test_behavior_parameters_are_converted_into_the_config_header(plan):
    header = text(generate_firmware(plan), "include/rivet_config.h")
    assert re.search(r"^#define RIVET_OBSTACLE_STOP_MM 250$", header, re.M)
    assert re.search(r"^#define RIVET_TURN_DURATION_MS 600$", header, re.M)
    assert re.search(r"^#define RIVET_FORWARD_PWM 115$", header, re.M)  # round(0.45 * 255)
    assert re.search(r"^#define RIVET_START_ENABLED 0$", header, re.M)


def test_parameter_edits_flow_into_the_next_firmware(plan):
    plan["behavior"]["parameters"].update(obstacle_stop_distance_m=0.4, turn_duration_ms=800)
    header = text(generate_firmware(plan), "include/rivet_config.h")
    assert "RIVET_OBSTACLE_STOP_MM 400" in header and "RIVET_TURN_DURATION_MS 800" in header


def test_main_uses_the_grounding_friendly_hal_names_and_a_disable_path(plan):
    main = text(generate_firmware(plan), "src/main.cpp")
    for name in ("drive_forward", "turn_in_place", "read_front_distance", "stop_motors"):
        assert re.search(rf"\b{name}\s*\(", main), name
    assert "State::kDisabled" in main and 'Serial.println("DISABLED")' in main


# Object-like macros from the ESP32 Arduino core (esp32-hal-gpio.h, esp32-hal.h). An identifier
# with one of these names is rewritten by the preprocessor; `enum class State { DISABLED, ...}`
# failed `pio run` on espressif32@6.9.0 this way.
ESP32_CORE_MACROS = set(
    "LOW HIGH INPUT OUTPUT PULLUP INPUT_PULLUP PULLDOWN INPUT_PULLDOWN OPEN_DRAIN OUTPUT_OPEN_DRAIN "
    "ANALOG DISABLED RISING FALLING CHANGE ONLOW ONHIGH ONLOW_WE ONHIGH_WE".split()
)


def _code_only(source: str) -> str:
    """C++ source without comments and string literals, so only identifiers remain."""
    source = re.sub(r"//[^\n]*|/\*.*?\*/", " ", source, flags=re.S)
    return re.sub(r'"(?:\\.|[^"\\])*"', '""', source)


def test_state_names_do_not_collide_with_esp32_core_macros(plan):
    code = _code_only(text(generate_firmware(plan), "src/main.cpp"))
    enum = re.search(r"enum class State \{([^}]*)\}", code)
    assert enum, "state enum not found"
    names = [n.strip() for n in enum.group(1).split(",") if n.strip()]
    assert names == ["kDisabled", "kForward", "kStop", "kTurn"]
    assert not set(names) & ESP32_CORE_MACROS
    used = set(re.findall(r"\bState::(\w+)", code))
    assert used == set(names), used
    assert not re.search(r"\bDISABLED\b", code), "bare DISABLED is the ESP32 core macro"


def _lib_deps(ini: str) -> list[str]:
    block = re.search(r"^lib_deps\s*=\s*\n((?:[ \t]+\S[^\n]*\n?)+)", ini, re.M)
    assert block, "lib_deps not found"
    return [line.strip() for line in block.group(1).splitlines() if line.strip()]


def test_no_placeholders_survive_and_ini_pins_versions(plan):
    bundle = generate_firmware(plan)
    for name, data in bundle.files.items():
        assert not re.search(r"\{\{[A-Z0-9_]+\}\}", data.decode()), name
    ini = text(bundle, "platformio.ini")
    assert re.search(r"platform\s*=\s*espressif32@\d+\.\d+\.\d+", ini)
    # PlatformIO registry ids are owner/name with no spaces; "adafruit/Adafruit VL53L0X"
    # gave UnknownPackageError in CI. Every library is pinned to an exact version.
    deps = _lib_deps(ini)
    assert deps == ["adafruit/Adafruit_VL53L0X@1.2.4"]
    for dep in deps:
        assert re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+@\d+\.\d+\.\d+", dep), dep


def test_review_status_and_fixture_label_are_stated_in_the_readme(plan):
    readme = text(generate_firmware(plan), "README.md")
    assert "needs_review" in readme
    assert "verify wiring" in readme.lower()
    assert "generation_mode=fixture" in readme and "SAVED FIXTURE" in readme


def test_live_plans_do_not_carry_the_fixture_warning(plan):
    plan["provenance"]["generation_mode"] = "live"
    assert "SAVED FIXTURE" not in text(generate_firmware(plan), "README.md")


# ---- refusals --------------------------------------------------------------------------


def test_empty_pin_map_is_not_supported(plan_dict):
    with pytest.raises(ApiError) as exc:
        generate_firmware(plan_dict)  # the saved fixture ships no pin map
    assert exc.value.status == 422 and exc.value.code == "FIRMWARE_NOT_SUPPORTED"


def test_wrong_profile_or_target_is_not_supported(plan):
    plan["behavior"]["profile_id"] = "rover.line_following.v1"
    with pytest.raises(ApiError) as exc:
        generate_firmware(plan)
    assert exc.value.code == "FIRMWARE_NOT_SUPPORTED"
    plan["behavior"]["profile_id"] = PROFILE_ID
    plan["firmware"]["target"] = "stm32"
    with pytest.raises(ApiError) as exc:
        generate_firmware(plan)
    assert exc.value.code == "FIRMWARE_NOT_SUPPORTED"


def test_unbuildable_plan_is_refused(plan):
    plan["status"] = "unbuildable"
    with pytest.raises(ApiError) as exc:
        generate_firmware(plan)
    assert exc.value.status == 422 and exc.value.code == "FIRMWARE_REFUSED"


def test_missing_signals_are_listed(plan):
    del plan["firmware"]["pin_map"]["motor_standby"]
    with pytest.raises(ApiError) as exc:
        generate_firmware(plan)
    assert exc.value.code == "FIRMWARE_INVALID_PIN_MAP"
    assert exc.value.details["missing"] == ["motor_standby"]


def test_unknown_signals_are_rejected_not_ignored(plan):
    plan["firmware"]["pin_map"]["led_strip"] = 4
    with pytest.raises(ApiError) as exc:
        generate_firmware(plan)
    assert exc.value.code == "FIRMWARE_INVALID_PIN_MAP" and exc.value.details["unknown"] == ["led_strip"]


@pytest.mark.parametrize("bad", [-1, 40, 99, "18", 18.5, True, None, [18]])
def test_pin_values_must_be_gpio_integers(plan, bad):
    plan["firmware"]["pin_map"]["i2c_sda"] = bad
    with pytest.raises(ApiError) as exc:
        generate_firmware(plan)
    assert exc.value.code == "FIRMWARE_INVALID_PIN_MAP" and "i2c_sda" in exc.value.details["invalid"]


def test_duplicate_pins_are_rejected(plan):
    plan["firmware"]["pin_map"]["i2c_scl"] = plan["firmware"]["pin_map"]["i2c_sda"]
    with pytest.raises(ApiError) as exc:
        generate_firmware(plan)
    assert exc.value.code == "FIRMWARE_INVALID_PIN_MAP"
    assert sorted(exc.value.details["duplicates"][0]) == ["i2c_scl", "i2c_sda"]


@pytest.mark.parametrize(
    "changes",
    [
        {"obstacle_stop_distance_m": 0},
        {"obstacle_stop_distance_m": -1},
        {"obstacle_stop_distance_m": 50},
        {"turn_duration_ms": 0},
        {"turn_duration_ms": 10**9},
        {"forward_speed_fraction": 0},
        {"forward_speed_fraction": 1.5},
        {"forward_speed_fraction": "fast"},
    ],
)
def test_out_of_range_behavior_parameters_are_refused(plan, changes):
    plan["behavior"]["parameters"].update(changes)
    with pytest.raises(ApiError) as exc:
        generate_firmware(plan)
    assert exc.value.code == "FIRMWARE_INVALID_PARAMETER"


def test_missing_behavior_parameter_is_refused(plan):
    del plan["behavior"]["parameters"]["turn_duration_ms"]
    with pytest.raises(ApiError) as exc:
        generate_firmware(plan)
    assert exc.value.code == "FIRMWARE_INVALID_PARAMETER"


# ---- injection ----------------------------------------------------------------------------


@pytest.mark.parametrize(
    "title",
    [
        '*/ #define EVIL 1 // "',
        "ok\n#error injected",
        "x\r\n#include <stdlib.h>\n",
        'back\\slash"; system("rm -rf /"); //',
        "<script>alert(1)</script>",
    ],
)
def test_hostile_titles_cannot_inject_code_or_markup(plan, title):
    plan["title"] = title
    bundle = generate_firmware(plan)
    for name in ("src/main.cpp", "include/rivet_config.h", "platformio.ini"):
        for line in text(bundle, name).splitlines():
            assert not line.lstrip().startswith(("#error", "#include <stdlib.h>")), (name, line)
            if "EVIL" in line:  # the word may survive, but only as plain comment text
                assert line.lstrip().startswith(("//", ";")), (name, line)
    assert "<script>" not in text(bundle, "README.md")
    assert "system(" not in text(bundle, "src/main.cpp")
    header = text(bundle, "include/rivet_config.h")
    assert header.count("/*") == header.count("*/")


# ---- compile ----------------------------------------------------------------------------------


class FakeProc:
    def __init__(self, returncode=0, stdout="", stderr=""):
        self.returncode, self.stdout, self.stderr = returncode, stdout, stderr


def test_compile_not_checked_when_pio_is_missing(tmp_path):
    result = compile_firmware(tmp_path, which=lambda _: None)
    assert result.status == "not_checked" and "PlatformIO" in result.summary


def test_compile_runs_a_fixed_argv_without_a_shell_and_with_a_scrubbed_env(tmp_path, monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-do-not-leak")
    seen = {}

    def runner(argv, **kw):
        seen.update(argv=argv, kw=kw)
        return FakeProc(0, "SUCCESS")

    result = compile_firmware(tmp_path, runner=runner, which=lambda _: "/usr/bin/pio", timeout_s=7)
    assert result.status == "passed"
    assert seen["argv"] == ["/usr/bin/pio", "run", "-d", str(tmp_path)]
    assert not seen["kw"].get("shell")
    assert seen["kw"]["timeout"] == 7 and seen["kw"]["cwd"] == str(tmp_path)
    assert "OPENAI_API_KEY" not in seen["kw"]["env"] and "PATH" in seen["kw"]["env"]


def test_compile_failure_returns_the_log_tail(tmp_path):
    log = "\n".join(f"line {i}" for i in range(100))
    result = compile_firmware(tmp_path, runner=lambda a, **k: FakeProc(1, log), which=lambda _: "/pio")
    assert result.status == "failed"
    tail = result.log_tail.splitlines()
    assert len(tail) == 40 and tail[-1] == "line 99" and tail[0] == "line 60"


def test_compile_timeout_is_failed_not_passed(tmp_path):
    import subprocess

    def runner(argv, **kw):
        raise subprocess.TimeoutExpired(argv, kw["timeout"])

    result = compile_firmware(tmp_path, runner=runner, which=lambda _: "/pio", timeout_s=1)
    assert result.status == "failed" and "timeout" in result.summary


def test_compile_strips_terminal_escape_codes(tmp_path):
    result = compile_firmware(
        tmp_path, runner=lambda a, **k: FakeProc(1, "\x1b[31merror\x1b[0m here"), which=lambda _: "/pio"
    )
    assert "\x1b" not in result.log_tail and "error here" in result.log_tail


def test_generate_with_compile_records_the_result_in_the_manifest(plan, monkeypatch):
    import rivet_api.firmware.compile as comp

    monkeypatch.setattr(comp.shutil, "which", lambda _: "/pio")
    monkeypatch.setattr(comp.subprocess, "run", lambda a, **k: FakeProc(0, "ok"))
    bundle = generate_firmware(plan, compile=True)
    assert bundle.compile.status == "passed"
    assert json.loads(bundle.files["manifest.json"])["compile_status"] == "passed"


# ---- route ---------------------------------------------------------------------------------------


@pytest.fixture
def pinned_project(generate, stub_engine_cls):
    client, app, job = generate(engine=stub_engine_cls(real=True, mutate_plan=lambda p: with_pins(p)))
    assert job["status"] == "complete"
    return client, job["build_id"]


def test_route_returns_a_zip_tied_to_the_revision(pinned_project):
    client, build_id = pinned_project
    resp = client.get(f"/api/projects/{build_id}/exports/firmware.zip")
    assert resp.status_code == 200 and resp.headers["content-type"] == "application/zip"
    assert resp.headers["content-disposition"] == f'attachment; filename="{build_id}-r1-firmware.zip"'
    assert resp.headers["x-rivet-compile-status"] == "not_checked"
    assert resp.headers["x-rivet-generation-mode"] == "fallback"
    with zipfile.ZipFile(io.BytesIO(resp.content)) as z:
        assert set(z.namelist()) == REQUIRED_MEMBERS
        manifest = json.loads(z.read("manifest.json"))
    assert manifest["build_id"] == build_id and manifest["revision"] == 1


def test_route_refuses_the_synthetic_fixture_even_with_a_pin_map(generate, stub_engine_cls):
    client, _, job = generate(engine=stub_engine_cls(mutate_plan=lambda p: with_pins(p)))
    resp = client.get(f"/api/projects/{job['build_id']}/exports/firmware.zip")
    assert resp.status_code == 422 and resp.json()["error"]["code"] == "FIRMWARE_REFUSED"
    assert "demo.tb6612" in resp.json()["error"]["details"]["synthetic_catalog_ids"]


def test_route_422_for_a_real_plan_without_a_pin_map(generate, stub_engine_cls):
    client, _, job = generate(engine=stub_engine_cls(real=True))
    resp = client.get(f"/api/projects/{job['build_id']}/exports/firmware.zip")
    assert resp.status_code == 422 and resp.json()["error"]["code"] == "FIRMWARE_NOT_SUPPORTED"


def test_route_compile_flag_reports_the_real_outcome(pinned_project, monkeypatch):
    import rivet_api.firmware.compile as comp

    client, build_id = pinned_project
    monkeypatch.setattr(comp.shutil, "which", lambda _: None)
    unchecked = client.get(f"/api/projects/{build_id}/exports/firmware.zip?compile=true")
    assert unchecked.headers["x-rivet-compile-status"] == "not_checked"
    monkeypatch.setattr(comp.shutil, "which", lambda _: "/pio")
    monkeypatch.setattr(comp.subprocess, "run", lambda a, **k: FakeProc(2, "boom"))
    failed = client.get(f"/api/projects/{build_id}/exports/firmware.zip?compile=true")
    assert failed.status_code == 200 and failed.headers["x-rivet-compile-status"] == "failed"
    with zipfile.ZipFile(io.BytesIO(failed.content)) as z:
        assert json.loads(z.read("manifest.json"))["compile_status"] == "failed"


def test_route_errors(pinned_project):
    client, build_id = pinned_project
    url = f"/api/projects/{build_id}/exports/firmware.zip"
    assert client.get(url + "?revision=9").status_code == 404
    assert client.get(url + "?revision=abc").status_code == 400
    assert client.get(url + "?compile=maybe").status_code == 400
    assert client.get("/api/projects/nope-nope-nope/exports/firmware.zip").status_code == 404
    assert client.get("/api/projects/BAD_ID/exports/firmware.zip").status_code == 400


def test_route_does_not_modify_the_stored_plan(pinned_project, tmp_path):
    client, build_id = pinned_project
    path = tmp_path / "projects" / build_id / "revision-1.json"
    before = path.read_bytes()
    client.get(f"/api/projects/{build_id}/exports/firmware.zip?compile=true")
    assert path.read_bytes() == before
