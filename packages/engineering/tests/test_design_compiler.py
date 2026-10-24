"""Real geometry tests for the v2 design compiler (no mocks): shapes, placement, checks,
repair, exports, determinism and the engineering bridge, on the golden fixtures."""
import copy
import json
from pathlib import Path

import numpy as np
import pytest

pytest.importorskip("manifold3d", reason="install the engine's geometry extra: pip install -e 'packages/engineering[geometry]'")
pytest.importorskip("OCP", reason="install the engine's geometry extra: pip install -e 'packages/engineering[geometry]'")

from rivet_engine import engineering_bridge, get_catalog  # noqa: E402
from rivet_engine.design_compiler import DesignValidationError, compile_design  # noqa: E402
from rivet_engine.design_ir import DesignSpec, apply_patch, changed_bodies, json_schema, topology_signature  # noqa: E402
from rivet_engine.design_ir.models import Shape  # noqa: E402
from rivet_engine.geometry import freeform, occ, parametric  # noqa: E402
from rivet_engine.geometry.catalog_geometry import catalog_regions  # noqa: E402
from rivet_engine.geometry.meshing import decode_glb, edge_manifold_report, encode_stl, weld  # noqa: E402
from rivet_engine.geometry.repair import repair  # noqa: E402

ROOT = Path(__file__).resolve().parents[3]
FIXTURES = ROOT / "fixtures" / "design"
CATALOG = get_catalog()


def load(name: str) -> dict:
    return json.loads((FIXTURES / f"{name}.json").read_text())


@pytest.fixture(scope="module")
def compiled(tmp_path_factory):
    out = {}
    for name in ("rover-two-wheel", "four-wheel", "robot-arm", "custom-sensor-housing", "organic-concept"):
        events = []
        result = compile_design(load(name), CATALOG, output_dir=tmp_path_factory.mktemp(name), progress=events.append)
        out[name] = (result, events)
    return out


def world_centre(result: dict, body_id: str) -> np.ndarray:
    entry = next(p for p in result["part_manifest"] if p["body_id"] == body_id)
    return (np.array(entry["bounds_mm"]["min"]) + np.array(entry["bounds_mm"]["max"])) / 2


@pytest.mark.parametrize("shape", [
    {"type": "box", "dimensions_mm": [40, 10, 30]},
    {"type": "rounded_box", "dimensions_mm": [40, 20, 30], "radius_mm": 4},
    {"type": "tube", "radius_mm": 8, "wall_mm": 2, "height_mm": 30, "axis": "Z"},
    {"type": "cone", "radius_mm": 10, "radius_top_mm": 3, "height_mm": 20},
    {"type": "capsule", "radius_mm": 4, "height_mm": 30, "axis": "X"},
    {"type": "torus", "radius_mm": 20, "minor_radius_mm": 3},
    {"type": "ellipsoid", "dimensions_mm": [40, 20, 30]},
    {"type": "wheel", "radius_mm": 32, "height_mm": 26, "wall_mm": 7, "spokes": 5},
    {"type": "extrude_profile", "profile_mm": [[-80, -45], [80, -45], [95, 0], [80, 45], [-80, 45]], "height_mm": 12},
    {"type": "revolve_profile", "profile_mm": [[0, 0], [20, 0], [15, 30], [0, 35]]},
    {"type": "loft", "sections": [[[-20, -20], [20, -20], [20, 20], [-20, 20]], [[-10, -8], [10, -8], [10, 8], [-10, 8]]], "section_heights_mm": [0, 30]},
    {"type": "sweep", "radius_mm": 3, "path_mm": [[0, 0, 0], [0, 30, 0], [30, 40, 0], [60, 40, 10]]},
    {"type": "shell", "wall_mm": 2, "children": [{"type": "rounded_box", "dimensions_mm": [60, 30, 40], "radius_mm": 5}]},
    {"type": "boolean", "operation": "difference", "children": [{"type": "box", "dimensions_mm": [40, 40, 40]}, {"type": "sphere", "radius_mm": 25}]},
])
def test_parametric_shapes_are_closed_solids(shape):
    regions = parametric.build_regions(Shape.model_validate(shape))
    for r in regions:
        assert occ.is_valid(r.shape) and occ.volume(r.shape) > 0
        mesh = weld(occ.tessellate(r.shape, 0.2))
        assert edge_manifold_report(mesh)["watertight"]
        assert mesh.volume() == pytest.approx(occ.volume(r.shape), rel=0.03)


def test_open_shell_is_hollow_even_on_filleted_solids():
    solid = parametric.build_regions(Shape(type="rounded_box", dimensions_mm=(92, 28, 138), radius_mm=8))[0].shape
    shelled = parametric.hollow(solid, 2.0, "bottom")
    assert occ.volume(shelled) < 0.4 * occ.volume(solid)


def test_occupancy_blend_is_watertight_and_smooth():
    shape = Shape.model_validate({"type": "occupancy", "smoothing_mm": 6, "pitch_mm": 2, "children": [
        {"type": "ellipsoid", "dimensions_mm": [40, 30, 60]}, {"type": "sphere", "radius_mm": 12, "frame": {"position_mm": [0, 15, 28]}}]})
    mesh, info = freeform.build_occupancy(shape)
    assert info["watertight"]
    lo, hi = mesh.bounds()
    assert hi[2] > 36  # the head extends the blended body forward
    assert 15000 < mesh.volume() < 60000


def test_imported_stl_is_scaled_into_its_box(tmp_path):
    box = weld(occ.tessellate(parametric.build_regions(Shape(type="box", dimensions_mm=(10, 20, 40)))[0].shape, 0.1))
    data = encode_stl(box)
    shape = Shape(type="mesh_reference", asset_id="asset-x", dimensions_mm=(50, 50, 80))
    mesh, info = freeform.build_mesh_reference(shape, lambda _id: data)
    lo, hi = mesh.bounds()
    assert np.allclose(hi - lo, [20, 40, 80], atol=1e-3) and info["watertight"]


def test_tof_sensor_has_its_own_breakout_geometry_not_an_ultrasonic_drum():
    entry = next(c for c in CATALOG if c["catalog_id"] == "sensor.adafruit_vl53l0x_3317")
    regions, info = catalog_regions(entry)
    assert info["recipe"] == "tof_breakout" and info["mesh_source_verified"] is False
    assert {r.name for r in regions} >= {"pcb", "chip", "sensor_windows"}
    lo = np.min([occ.bounds(r.shape)[0] for r in regions], axis=0)
    hi = np.max([occ.bounds(r.shape)[1] for r in regions], axis=0)
    assert np.allclose(hi - lo, [21.0, 2.8, 18.0], atol=0.2)  # flat 21 x 18 board, no tall transducers


def test_all_golden_fixtures_compile_valid_and_stable(compiled):
    for name, (result, events) in compiled.items():
        report = result["geometry_report"]
        assert report["status"] == "valid", (name, report["blocking"])
        assert report["counts"]["hard_collisions"] == 0 and report["counts"]["unresolved_required_mounts"] == 0
        assert report["stability"]["verdict"] == "stable", name
        assert sum(1 for e in events if e["event"] == "geometry_preview") >= 2, name
        assert all(p["status"] == "placed" for p in result["part_manifest"]), name


def test_previews_are_real_growing_glbs(compiled):
    result, _ = compiled["rover-two-wheel"]
    counts = []
    for snap in result["preview_snapshots"]:
        doc, meshes = decode_glb(Path(snap["path"]).read_bytes())
        counts.append(len({name for name, _, _ in meshes}))
        assert doc["asset"]["extras"]["units"] == "m"
    assert counts == sorted(counts) and counts[0] < counts[-1]
    assert result["preview_snapshots"][-1]["is_partial"] is False


def test_compile_is_deterministic(tmp_path):
    a = compile_design(load("robot-arm"), CATALOG, output_dir=tmp_path / "a")
    b = compile_design(load("robot-arm"), CATALOG, output_dir=tmp_path / "b")
    assert a["geometry_digest"] == b["geometry_digest"] and a["scene_sha256"] == b["scene_sha256"]


def test_four_wheel_request_gets_four_anchored_wheels_and_an_honest_electrical_verdict(compiled):
    result, _ = compiled["four-wheel"]
    wheels = [p for p in result["part_manifest"] if p["role"] == "wheel"]
    assert len(wheels) == 4 and all(p["status"] == "placed" for p in wheels)
    assert len(result["geometry_report"]["stability"]["contact_bodies"]) == 4
    eng = engineering_bridge.evaluate(load("four-wheel"), CATALOG)
    assert eng["status"] == "unsupported" and any(f["rule_id"] == "engineering.motor_channels" for f in eng["findings"])


def test_two_wheel_rover_electronics_are_verified_by_the_engine():
    eng = engineering_bridge.evaluate(load("rover-two-wheel"), CATALOG)
    assert eng["profile"] == engineering_bridge.ROVER_PROFILE and eng["linked_plan"]["schema_version"] == "1.0"
    assert eng["firmware"]["supported"] and eng["firmware"]["pin_map"]
    assert all(f["rule_id"].startswith(engineering_bridge.AUTHORITATIVE_PREFIXES) for f in eng["findings"])
    assert eng["superseded_template_findings"]  # template mechanical checks are not claimed for custom geometry


def test_taller_sensor_pod_moves_the_real_sensor(tmp_path):
    low = load("rover-two-wheel")
    tall = copy.deepcopy(low)
    next(b for b in tall["bodies"] if b["id"] == "sensor_pod")["attachment"]["offset_mm"] = [0, 30, 0]
    a = compile_design(low, CATALOG, output_dir=tmp_path / "low", write_exports=False)
    b = compile_design(tall, CATALOG, output_dir=tmp_path / "tall", write_exports=False)
    assert world_centre(b, "range_sensor")[1] - world_centre(a, "range_sensor")[1] == pytest.approx(18, abs=0.5)
    assert a["geometry_digest"] != b["geometry_digest"]


def test_wider_chassis_patch_changes_only_the_deck(tmp_path):
    spec = load("rover-two-wheel")
    deck = next(b for b in spec["bodies"] if b["id"] == "deck")
    wider = [[x * 1.2, z] for x, z in deck["shape"]["profile_mm"]]
    patched = apply_patch(spec, {"reason": "make the chassis wider", "operations": [{"operation": "update", "body_id": "deck", "set": {"shape.profile_mm": wider}}]})
    diff = changed_bodies(spec, patched)
    assert diff["changed"] == ["deck"] and not diff["added"] and not diff["removed"]
    a = compile_design(spec, CATALOG, output_dir=tmp_path / "a", write_exports=False)
    b = compile_design(patched, CATALOG, output_dir=tmp_path / "b", write_exports=False)
    digests = lambda r: {p["body_id"]: p["geometry_digest"] for p in r["part_manifest"]}  # noqa: E731
    assert digests(a)["deck"] != digests(b)["deck"]
    assert digests(a)["controller"] == digests(b)["controller"]  # purchased parts keep their exact geometry
    assert b["geometry_report"]["bounds_mm"]["size"][0] > a["geometry_report"]["bounds_mm"]["size"][0]


def test_deliberate_clash_is_named_and_deterministic_repair_removes_it(tmp_path):
    spec = load("rover-two-wheel")
    next(b for b in spec["bodies"] if b["id"] == "motor_driver")["attachment"]["offset_mm"] = [-18, 0, 26]  # onto the controller
    first = compile_design(spec, CATALOG, output_dir=tmp_path / "clash", write_exports=False)
    pairs = {frozenset((h["a"], h["b"])) for h in first["geometry_report"]["collisions"]["hard_collisions"]}
    assert frozenset(("controller", "motor_driver")) in pairs
    fixed = repair(spec, CATALOG, output_dir=tmp_path / "repair", initial=first)
    assert fixed["changed"] and fixed["result"]["geometry_report"]["counts"]["hard_collisions"] == 0
    assert {b["id"] for b in fixed["spec"]["bodies"]} == {b["id"] for b in spec["bodies"]}  # nothing deleted
    assert any(a["accepted"] and a["body_id"] in ("controller", "motor_driver") for a in fixed["actions"])


def test_thin_unsupported_arm_fails_the_structure_check(tmp_path):
    spec = load("custom-sensor-housing")
    spec["bodies"].append({"id": "thin_arm", "name": "Thin arm", "role": "arm_link", "kind": "fabricated", "manufacturing": "3d_print",
                           "parent_id": "housing", "material": {"name": "PLA"}, "shape": {"type": "box", "dimensions_mm": [3, 3, 150]},
                           "attachment": {"parent_anchor": "back", "child_anchor": "front"}})
    result = compile_design(spec, CATALOG, output_dir=tmp_path, write_exports=False)
    issue = next(i for i in result["geometry_report"]["manufacturing"]["issues"] if i["body_id"] == "thin_arm")
    assert issue["rule"] == "structure.unsupported_cantilever" and issue["severity"] == "blocking"
    assert result["geometry_report"]["status"] == "invalid"


def test_unstable_footprint_is_reported_with_uncertainty(tmp_path):
    spec = load("rover-two-wheel")
    next(b for b in spec["bodies"] if b["id"] == "caster")["attachment"]["offset_mm"] = [0, 0, 60]  # caster in front of the axle
    result = compile_design(spec, CATALOG, output_dir=tmp_path, write_exports=False)
    stab = result["geometry_report"]["stability"]
    assert stab["verdict"] in ("unstable", "uncertain") and stab["unknown_mass_bodies"]
    assert "design is statically unstable" in result["geometry_report"]["blocking"] or stab["verdict"] == "uncertain"


def test_housing_exports_step_and_stl_for_fabricated_parts_only(compiled):
    result, _ = compiled["custom-sensor-housing"]
    kinds = {(a.get("body_id"), a["kind"]) for a in result["manufacturing_assets"] if a.get("path")}
    assert ("housing", "step") in kinds and ("housing", "stl") in kinds and ("base_plate", "step") in kinds
    assert ("controller", "step") not in kinds  # purchased parts are never exported as fabrication CAD
    step = next(a for a in result["manufacturing_assets"] if a.get("body_id") == "housing" and a["kind"] == "step")
    text = Path(step["path"]).read_text(errors="ignore")
    assert "ISO-10303-21" in text and "2026-01-01T00:00:00" in text
    housing = next(p for p in result["part_manifest"] if p["body_id"] == "housing")
    assert {f["id"]: f["status"] for f in housing["features"]} == {"hollow": "applied", "top_round": "applied", "sensor_window": "applied"}


def test_ungrounded_product_and_world_poses_are_rejected(tmp_path):
    spec = load("rover-two-wheel")
    next(b for b in spec["bodies"] if b["id"] == "controller")["catalog_id"] = "board.made_up_9000"
    with pytest.raises(DesignValidationError) as err:
        compile_design(spec, CATALOG, output_dir=tmp_path)
    assert err.value.errors[0]["type"] == "ungrounded_product"
    spec = load("rover-two-wheel")
    next(b for b in spec["bodies"] if b["id"] == "battery")["frame"] = {"position_mm": [10, 20, 30]}
    with pytest.raises(DesignValidationError):
        compile_design(spec, CATALOG, output_dir=tmp_path)


def test_candidate_topology_signature_tells_designs_apart():
    sigs = {topology_signature(load(n)) for n in ("rover-two-wheel", "four-wheel", "robot-arm", "organic-concept")}
    assert len(sigs) == 4


def test_contract_schema_matches_the_model():
    schema = json.loads((ROOT / "contracts" / "design-spec.v2.schema.json").read_text())
    assert schema == json.loads(json.dumps(json_schema()))
    for name in ("rover-two-wheel", "four-wheel", "robot-arm", "custom-sensor-housing", "organic-concept"):
        DesignSpec.model_validate(load(name))
