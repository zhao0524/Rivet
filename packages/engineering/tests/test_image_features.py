"""Issue #67: visible image traits change the build where the template allows it, and every
trait is reported as applied or ignored in provenance.notes."""

import copy
import json
import typing
from dataclasses import replace

import pytest
from pydantic import ValidationError

import rivet_engine
from rivet_engine import configurator, image_features, models
from rivet_engine.configurator import EngineState, parse_intent
from rivet_engine.models import BuildPlan, ImageFeatures, IntentSpec
from rivet_engine.ports import InvalidInputError
from tests import support
from tests.test_integration import _synthetic_builder

LOW = {"drive_wheel_count": 2, "has_caster": True, "range_sensor_position": "front_low", "range_sensor_kind": "time_of_flight"}
HIGH = {"drive_wheel_count": 2, "has_caster": True, "range_sensor_position": "front_high", "range_sensor_kind": "time_of_flight"}
UNSUPPORTED = {
    "drive_wheel_count": 4,
    "has_caster": False,
    "range_sensor_position": "none",
    "range_sensor_kind": "ultrasonic",
    "wheel_size": "large",
    "chassis_size": "large",
    "body_color": "yellow",
    "visible_controller": "Arduino Uno",
}
MATCHING = {"drive_wheel_count": 2, "has_caster": True, "range_sensor_position": "front_mid", "range_sensor_kind": "time_of_flight"}


def _intent(features=None, **input_changes):
    intent = support.appendix_intent_dict()
    if features is not None:
        intent["image_features"] = copy.deepcopy(features)
    intent["input"].update(input_changes)
    return intent


def _solve(features=None, **input_changes):
    return rivet_engine.solve(_intent(features, **input_changes))


@pytest.fixture(scope="module")
def default_plan():
    return rivet_engine.solve(support.appendix_intent_dict())


@pytest.fixture(scope="module")
def low_plan():
    return _solve(LOW)


def _component(plan, instance_id):
    return next(c for c in plan["components"] if c["instance_id"] == instance_id)


def _sensor_y(plan):
    return _component(plan, "sensor-1")["pose"]["position_mm"][1]


def _image_notes(plan):
    return [n for n in plan["provenance"]["notes"] if n.startswith(image_features.NOTE_PREFIXES)]


def _blocking(plan):
    return {(f["rule_id"], f["result"], tuple(f["affected_instance_ids"]))
            for f in plan["verification"]["findings"] if f["severity"] == "blocking" and f["result"] != "PASS"}


def _without_time(plan):
    out = copy.deepcopy(plan)
    out.pop("created_at")
    return out


# --- two readings of an image give two different, still valid plans --------------------------


def test_two_image_readings_give_different_valid_plans(default_plan, low_plan):
    high_plan = _solve(HIGH)
    assert _sensor_y(low_plan) == pytest.approx(_sensor_y(default_plan) - 10)
    assert _sensor_y(high_plan) == pytest.approx(_sensor_y(default_plan) + 20)
    for plan in (low_plan, high_plan):
        assert plan["status"] == plan["verification"]["overall"] == default_plan["status"]
        assert not any(f["result"] == "FAIL" for f in plan["verification"]["findings"])
        assert _blocking(plan) == _blocking(default_plan)  # no new blocking finding
        # Only the sensor moved; every part is the same catalog item.
        others = lambda p: [c for c in p["components"] if c["instance_id"] != "sensor-1"]  # noqa: E731
        assert others(plan) == others(default_plan)
        assert {c["catalog_id"] for c in plan["components"]} <= {c["catalog_id"] for c in rivet_engine.get_catalog()}
        BuildPlan.model_validate(plan)
    assert _image_notes(low_plan)[0].startswith("Image applied: range_sensor_position=front_low: ")
    assert "10 mm lower" in _image_notes(low_plan)[0]
    assert _image_notes(high_plan)[0].startswith("Image applied: range_sensor_position=front_high: ")
    assert "20 mm higher" in _image_notes(high_plan)[0]
    assert not any(n.startswith(image_features.UNCHANGED) for n in _image_notes(low_plan) + _image_notes(high_plan))


def test_image_change_uses_the_template_offset_and_is_reverified(low_plan):
    state = EngineState.from_plan(BuildPlan.model_validate(low_plan))
    assert state.mount_offsets == {"sensor-1": (0.0, -10.0, 0.0)}
    assert state.image_features == ImageFeatures.model_validate(LOW)
    # The stored verification is exactly what the public verifier says about this pose.
    assert rivet_engine.verify(low_plan) == low_plan["verification"]


def test_matching_traits_change_nothing_and_say_so(default_plan):
    plan = _solve(MATCHING)
    assert plan["components"] == default_plan["components"]
    assert plan["verification"] == default_plan["verification"]
    notes = _image_notes(plan)
    assert all(n.startswith("Image applied: ") and "(no change needed)" in n for n in notes[:-1])
    assert notes[-1] == "Image did not change the build: every extracted trait already matches the build or was ignored"


# --- unsupported requests are reported, never approximated ------------------------------------


def test_unsupported_traits_are_reported_and_the_rover_stays_supported(default_plan):
    plan = _solve(UNSUPPORTED)
    assert plan["components"] == default_plan["components"]
    assert plan["verification"] == default_plan["verification"]
    notes = _image_notes(plan)
    for trait in UNSUPPORTED:
        assert sum(n.startswith(f"Image ignored: {trait}=") for n in notes) == 1, trait
    by_trait = {n.split("=", 1)[0][len("Image ignored: "):]: n for n in notes if n.startswith("Image ignored: ")}
    assert "sensor.adafruit_vl53l0x_3317" in by_trait["range_sensor_kind"]  # names the part used
    assert "no ultrasonic range sensor" in by_trait["range_sensor_kind"]
    assert "2 drive wheels" in by_trait["drive_wheel_count"]
    assert "caster.sparkfun_shadow_nub" in by_trait["has_caster"]
    assert "one wheel model (wheel.adafruit_tt_wheel_3766)" in by_trait["wheel_size"]
    assert "one chassis (chassis.sparkfun_shadow_rob13301)" in by_trait["chassis_size"]
    assert "fixed colors" in by_trait["body_color"] and '"yellow"' in by_trait["body_color"]
    assert "wiring profile" in by_trait["visible_controller"] and "never matched to a catalog SKU" in by_trait["visible_controller"]
    assert "front range sensor" in by_trait["range_sensor_position"]
    assert notes[-1].startswith("Image did not change the build: ")
    assert not any(c["render_overrides"].get("color") for c in plan["components"])


@pytest.mark.parametrize("kind", ["infrared", "unknown"])
def test_other_sensor_kinds_keep_the_time_of_flight_part(kind, default_plan):
    plan = _solve({"range_sensor_kind": kind})
    assert plan["components"] == default_plan["components"]
    [note, summary] = _image_notes(plan)
    assert note.startswith(f"Image ignored: range_sensor_kind={kind}: ") and "kept sensor.adafruit_vl53l0x_3317" in note
    assert summary.startswith(image_features.UNCHANGED)


def test_text_only_input_never_uses_image_features(default_plan):
    plan = _solve({"range_sensor_position": "front_low", "body_color": "red"}, kind="text", image_asset_id=None)
    assert _sensor_y(plan) == _sensor_y(default_plan)
    assert _image_notes(plan) == [
        "Image did not change the build: the input has no image; traits not used: range_sensor_position, body_color"
    ]


def test_empty_image_features_say_nothing_was_extracted(default_plan):
    plan = _solve({})
    assert plan["components"] == default_plan["components"]
    assert _image_notes(plan) == ["Image did not change the build: no visible trait was extracted from the image with confidence"]


# --- no image features: exactly today's output ----------------------------------------------


def test_without_image_features_the_plan_is_unchanged(default_plan):
    explicit_null = _intent()
    explicit_null["image_features"] = None
    assert _without_time(rivet_engine.solve(explicit_null)) == _without_time(default_plan)
    assert _image_notes(default_plan) == []
    [state_note] = [n for n in default_plan["provenance"]["notes"] if n.startswith(configurator.STATE_PREFIX)]
    assert "image_features" not in state_note
    assert default_plan["provenance"]["notes"] == [
        "Placed from template rover_2wd.v1; poses are computed, not model-generated",
        "Verification covers the engine's implemented rules only; it is not a physical safety certification",
        "Requested controller board.esp32_devkit_v1 has no catalog entry with a wiring profile; used board.esp32_devkitc_v4_wroom32e",
        'engine_state: {"currency": "USD", "max_budget": null, "max_length_mm": null, "max_width_mm": null, '
        '"mount_offsets": {}, "requested_behavior": "obstacle_avoidance"}',
    ]


def test_image_influenced_plans_are_deterministic():
    a, b = _solve(UNSUPPORTED | {"range_sensor_position": "front_high"}), _solve(UNSUPPORTED | {"range_sensor_position": "front_high"})
    assert _without_time(a) == _without_time(b)


# --- edits keep working on image-influenced plans ---------------------------------------------


def _edit(plan, op):
    result = rivet_engine.apply_edit(plan, op)
    assert result["accepted"], result
    return result["plan"]


def test_unrelated_edits_keep_the_image_pose_and_notes(low_plan):
    for op in (
        {"op": "set_behavior_parameter", "name": "turn_duration_ms", "value": 800},
        {"op": "change_appearance_color", "instance_id": "chassis-1", "color": "#123456"},
        {"op": "set_budget", "amount": "150", "currency": "USD"},
    ):
        edited = _edit(low_plan, op)
        assert edited["revision"] == 2 and edited["build_id"] == low_plan["build_id"]
        assert _sensor_y(edited) == _sensor_y(low_plan)
        assert _image_notes(edited) == _image_notes(low_plan)


def test_sensor_swap_keeps_the_pose_and_names_the_new_part(low_plan):
    swapped = _edit(low_plan, {"op": "replace_optional_sensor", "catalog_id": "sensor.adafruit_vl53l1x_3967"})
    notes = _image_notes(swapped)
    assert "sensor.adafruit_vl53l1x_3967" in notes[0] and "10 mm lower" in notes[0]
    assert not any("vl53l0x" in n for n in notes)
    assert EngineState.from_plan(BuildPlan.model_validate(swapped)).mount_offsets == {"sensor-1": (0.0, -10.0, 0.0)}


def test_a_later_offset_edit_replaces_the_image_and_the_notes_say_so(low_plan):
    raised = _edit(low_plan, {"op": "set_mount_offset_within_template", "instance_id": "sensor-1", "offset_mm": [0, 12, 0]})
    assert _sensor_y(raised) == pytest.approx(_sensor_y(low_plan) + 22)
    notes = _image_notes(raised)
    assert any(n.startswith("Image ignored: range_sensor_position=front_low: a later edit set the sensor-1 bracket offset to [0, 12, 0] mm")
               for n in notes)
    assert notes[-1].startswith(image_features.UNCHANGED)
    restored = _edit(raised, {"op": "set_mount_offset_within_template", "instance_id": "sensor-1", "offset_mm": [0, -10, 0]})
    assert _image_notes(restored) == _image_notes(low_plan)


def test_image_notes_are_rebuilt_once_through_repair():
    builder = _synthetic_builder()
    selection = replace(
        configurator.DEFAULT_SELECTION,
        chassis="synthetic.chassis", motor="synthetic.motor_high_stall", wheel="synthetic.wheel", caster="synthetic.caster",
        controller="synthetic.controller", motor_driver="synthetic.driver", distance_sensor="synthetic.range_sensor",
        motor_power="synthetic.battery_6v", controller_power="synthetic.usb_power", accessories=("synthetic.wire_kit",),
    )
    features = ImageFeatures(range_sensor_position="front_high", range_sensor_kind="time_of_flight")
    state = EngineState(mount_offsets=image_features.mount_offsets(features, "image"), image_features=features)
    plan = builder.assemble(
        selection=selection, state=state, build_id="synthetic-repair", revision=1, source_intent_id="intent-x",
        input_mode="image", created_at="2026-10-24T00:00:00Z", parameters=configurator.DEFAULT_PARAMETERS, render_overrides={},
    )
    repaired = builder.finalize(plan)
    assert any(n.startswith("Repair round 1") for n in repaired.provenance.notes)
    notes = [n for n in repaired.provenance.notes if n.startswith(image_features.NOTE_PREFIXES)]
    assert notes[0].startswith("Image applied: range_sensor_position=front_high: ") and "synthetic.range_sensor" in notes[0]
    # The synthetic sensor is not documented as time-of-flight, so that trait is not claimed as a match.
    assert notes[1].startswith("Image ignored: range_sensor_kind=time_of_flight: ")
    assert len(notes) == len(set(notes)) == 2
    assert repaired.provenance.notes[-1].startswith(configurator.STATE_PREFIX)
    assert EngineState.from_plan(repaired).image_features == features


# --- engine_state carries the traits; malformed traits are rejected -----------------------


def test_malformed_image_features_in_engine_state_are_rejected(low_plan):
    plan = copy.deepcopy(low_plan)
    notes = plan["provenance"]["notes"]
    i = next(i for i, n in enumerate(notes) if n.startswith(configurator.STATE_PREFIX))
    data = json.loads(notes[i][len(configurator.STATE_PREFIX):])
    data["image_features"] = {"range_sensor_position": "roof"}
    notes[i] = configurator.STATE_PREFIX + json.dumps(data)
    with pytest.raises(InvalidInputError):
        EngineState.from_plan(BuildPlan.model_validate(plan))


@pytest.mark.parametrize(
    "bad",
    [
        {"drive_wheel_count": 0},
        {"drive_wheel_count": 9},
        {"drive_wheel_count": True},
        {"drive_wheel_count": 2.5},
        {"has_caster": "yes"},
        {"range_sensor_position": "roof"},
        {"range_sensor_kind": "lidar"},
        {"wheel_size": "huge"},
        {"chassis_size": "tiny"},
        {"body_color": ""},
        {"visible_controller": "x" * 61},
        {"wheel_count": 2},
        "red",
    ],
)
def test_invalid_image_features_are_invalid_input(bad):
    with pytest.raises(InvalidInputError):
        rivet_engine.solve(_intent(bad))


# --- the engine model and contracts/intent.schema.json agree ---------------------------------


def _intent_schema():
    jsonschema = pytest.importorskip("jsonschema")
    path = support.REPO_ROOT / "contracts" / "intent.schema.json"
    return jsonschema.Draft202012Validator(json.loads(path.read_text()))


def test_contract_and_engine_model_define_the_same_image_features():
    validator = _intent_schema()
    prop = validator.schema["properties"]["image_features"]
    assert "image_features" not in validator.schema["required"]
    assert prop["additionalProperties"] is False
    assert set(prop["properties"]) == set(ImageFeatures.model_fields) == set(image_features.TRAITS)
    for name, enum in (
        ("range_sensor_position", models.RangeSensorPosition),
        ("range_sensor_kind", models.RangeSensorKind),
        ("wheel_size", models.WheelSize),
        ("chassis_size", models.ChassisSize),
    ):
        assert prop["properties"][name]["enum"] == [*typing.get_args(enum), None], name
    for name in ("body_color", "visible_controller"):
        assert prop["properties"][name]["maxLength"] == models.IMAGE_TEXT_MAX_CHARS


@pytest.mark.parametrize("features", [None, {}, LOW, UNSUPPORTED, {"range_sensor_position": None, "body_color": "red"}])
def test_valid_image_features_pass_both_the_contract_and_the_engine(features):
    validator = _intent_schema()
    intent = _intent()
    intent["image_features"] = features
    assert list(validator.iter_errors(intent)) == []
    assert IntentSpec.model_validate(intent).image_features == (None if features is None else ImageFeatures.model_validate(features))


@pytest.mark.parametrize(
    "bad",
    [{"drive_wheel_count": 9}, {"range_sensor_position": "roof"}, {"wheel_count": 2}, {"body_color": ""}, {"has_caster": "no"}, []],
)
def test_invalid_image_features_fail_both_the_contract_and_the_engine(bad):
    validator = _intent_schema()
    intent = _intent()
    intent["image_features"] = bad
    assert list(validator.iter_errors(intent)) != []
    with pytest.raises(ValidationError):
        IntentSpec.model_validate(intent)


def test_image_influenced_plan_matches_the_build_plan_contract(low_plan):
    jsonschema = pytest.importorskip("jsonschema")
    schema = json.loads((support.REPO_ROOT / "contracts" / "build-plan.schema.json").read_text())
    assert list(jsonschema.Draft202012Validator(schema).iter_errors(low_plan)) == []


def test_intent_round_trip_omits_absent_image_features():
    raw = support.appendix_intent_dict()
    assert parse_intent(raw).to_wire() == raw
    with_features = _intent(LOW)
    assert parse_intent(with_features).to_wire()["image_features"] == ImageFeatures.model_validate(LOW).to_wire()
