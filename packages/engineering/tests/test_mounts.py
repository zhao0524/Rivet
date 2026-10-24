import copy
import math

import pytest

from rivet_engine import mounts
from rivet_engine.models import CatalogComponent, Mount, Pose
from rivet_engine.ports import Catalog, PlacementError, PlacementOptions, RoverSelection
from tests import support

SYNTHETIC = RoverSelection(
    chassis="synthetic.chassis",
    motor="synthetic.motor",
    wheel="synthetic.wheel",
    caster="synthetic.caster",
    controller="synthetic.controller",
    motor_driver="synthetic.driver",
    distance_sensor="synthetic.range_sensor",
    motor_power="synthetic.battery_6v",
    controller_power="synthetic.usb_power",
    accessories=("synthetic.wire_kit",),
)


def _place(selection=SYNTHETIC, catalog=None, **options):
    return mounts.place_rover(selection, catalog or support.synthetic_catalog(), PlacementOptions(**options))


def _by_id(result):
    return {c.instance_id: c for c in result.components}


def _close(a, b, tol=1e-3):
    return all(abs(x - y) <= tol for x, y in zip(a, b))


# --- transform math ------------------------------------------------------------------


@pytest.mark.parametrize("rot", [(0, 0, 0), (90, 0, 0), (0, 90, 0), (0, 0, 90), (30, -45, 60), (-120, 10, 170)])
def test_pose_matrix_round_trip(rot):
    pose = Pose(position_mm=[1.5, -2, 3], rotation_deg=list(rot))
    back = mounts.to_pose(mounts.pose_matrix(pose))
    assert _close(mounts.pose_matrix(back)[0] + mounts.pose_matrix(back)[1], mounts.pose_matrix(pose)[0] + mounts.pose_matrix(pose)[1])


def test_inverse_is_identity():
    m = mounts.matrix((10, -4, 7), (25, 40, -70))
    ident = mounts.multiply(m, mounts.inverse(m))
    for i in range(4):
        for j in range(4):
            assert math.isclose(ident[i][j], 1.0 if i == j else 0.0, abs_tol=1e-9)


def test_euler_order_matches_three_js_xyz():
    # Rx(90) * Ry(90): local +z maps to world +x (Ry), and local +y to world +z (Rx after).
    m = mounts.matrix((0, 0, 0), (90, 90, 0))
    assert _close(mounts.transform_point(m, (0, 0, 1)), (1, 0, 0))
    assert _close(mounts.transform_point(m, (0, 1, 0)), (0, 0, 1))


def test_place_child_with_rotated_parent_and_offset_child_mount():
    parent = mounts.matrix((100, 0, 0), (0, 90, 0))
    parent_mount = Mount(mount_id="p", kind="a", position_mm=[0, 0, 10], rotation_deg=[0, 0, 0], allowed_mates=["b"])
    child_mount = Mount(mount_id="c", kind="b", position_mm=[0, -5, 0], rotation_deg=[0, 0, 0], allowed_mates=["a"])
    child = mounts.place_child(parent, parent_mount, child_mount)
    # Parent rotated 90 about y: its local +z points along world +x.
    assert _close(mounts.transform_point(child, (0, 0, 0)), (110, 5, 0))
    # The child's own mount point lands exactly on the parent mount point.
    assert _close(mounts.transform_point(child, (0, -5, 0)), mounts.transform_point(mounts.multiply(parent, mounts.mount_matrix(parent_mount)), (0, 0, 0)))


def test_mates_rules():
    a = Mount(mount_id="p", kind="deck", position_mm=[0, 0, 0], rotation_deg=[0, 0, 0], allowed_mates=["pad"])
    b = Mount(mount_id="c", kind="pad", position_mm=[0, 0, 0], rotation_deg=[0, 0, 0], allowed_mates=["deck"])
    c = Mount(mount_id="c", kind="pad", position_mm=[0, 0, 0], rotation_deg=[0, 0, 0], allowed_mates=["shelf"])
    open_child = Mount(mount_id="c", kind="pad", position_mm=[0, 0, 0], rotation_deg=[0, 0, 0], allowed_mates=[])
    closed_parent = Mount(mount_id="p", kind="deck", position_mm=[0, 0, 0], rotation_deg=[0, 0, 0], allowed_mates=["rail"])
    assert mounts.mates(a, b) and mounts.mates(b, a)
    assert mounts.mates(a, open_child)
    assert not mounts.mates(a, c)  # child refuses the parent kind
    assert not mounts.mates(closed_parent, b)  # parent refuses the child kind


# --- placement ----------------------------------------------------------------------


def test_places_full_rover_with_stable_ids_and_roles():
    result = _place()
    assert result.template_id == "rover_2wd.v1"
    assert [c.instance_id for c in result.components] == [
        "chassis-1", "motor-left-1", "motor-right-1", "wheel-left-1", "wheel-right-1", "caster-1",
        "controller-1", "driver-1", "sensor-1", "power-motor-1", "power-control-1", "accessory-1",
    ]
    roles = {c.instance_id: c.role for c in result.components}
    assert roles["motor-left-1"] == roles["motor-right-1"] == "motor"
    assert roles["accessory-1"] == "accessory"


def test_placement_is_repeatable():
    assert [c.to_wire() for c in _place().components] == [c.to_wire() for c in _place().components]


def test_references_resolve_against_catalog():
    catalog = support.synthetic_catalog()
    by_id = _by_id(_place())
    for c in by_id.values():
        if c.parent_instance_id is None:
            continue
        parent = by_id[c.parent_instance_id]
        if c.attached_to_mount_id:
            assert catalog.require(parent.catalog_id).mount(c.attached_to_mount_id)
            assert catalog.require(c.catalog_id).mount(c.own_mount_id)


def test_duplicate_parts_are_distinct_mirrored_instances():
    by_id = _by_id(_place())
    left, right = by_id["wheel-left-1"], by_id["wheel-right-1"]
    assert left.catalog_id == right.catalog_id
    assert math.isclose(left.pose.position_mm[0], -right.pose.position_mm[0], abs_tol=1e-3)
    assert left.pose.position_mm[0] < 0 < right.pose.position_mm[0]


def test_wheels_sit_on_the_ground_and_nothing_is_below_it():
    catalog = support.synthetic_catalog()
    result = _place()
    boxes = {c.instance_id: mounts.world_aabb(c, catalog.require(c.catalog_id)) for c in result.components}
    lowest = min(b.min_mm[1] for b in boxes.values())
    assert math.isclose(lowest, 0.0, abs_tol=1e-3)
    assert math.isclose(boxes["wheel-left-1"].min_mm[1], 0.0, abs_tol=1e-3)


def test_wheel_lands_on_motor_shaft():
    catalog = support.synthetic_catalog()
    by_id = _by_id(_place())
    motor = by_id["motor-right-1"]
    wheel = by_id["wheel-right-1"]
    shaft = catalog.require(motor.catalog_id).mount("shaft")
    hub = catalog.require(wheel.catalog_id).mount("hub")
    shaft_world = mounts.transform_point(mounts.multiply(mounts.pose_matrix(motor.pose), mounts.mount_matrix(shaft)), (0, 0, 0))
    hub_world = mounts.transform_point(mounts.multiply(mounts.pose_matrix(wheel.pose), mounts.mount_matrix(hub)), (0, 0, 0))
    assert _close(shaft_world, hub_world)


def test_rotated_aabb_is_conservative():
    catalog = support.synthetic_catalog()
    component = catalog.require("synthetic.chassis")
    flat = mounts.world_aabb(support.synthetic_plan().components[0], component)
    inst = support.synthetic_plan().components[0].model_copy(deep=True)
    inst.pose = Pose(position_mm=[0, 0, 0], rotation_deg=[0, 45, 0])
    rotated = mounts.world_aabb(inst, component)
    d = component.physical.dimensions_mm
    expected = (d.x + d.z) * math.sqrt(0.5)
    assert math.isclose(rotated.max_mm[0] - rotated.min_mm[0], expected, rel_tol=1e-6)
    assert rotated.max_mm[0] - rotated.min_mm[0] > flat.max_mm[0] - flat.min_mm[0]


def test_aabb_overlap_helper():
    catalog = support.synthetic_catalog()
    by_id = _by_id(_place())
    box = lambda i: mounts.world_aabb(by_id[i], catalog.require(by_id[i].catalog_id))
    assert box("motor-left-1").overlaps(box("motor-left-1"))
    assert not box("wheel-left-1").overlaps(box("wheel-right-1"))


# --- sensor height bounds -------------------------------------------------------------


def test_sensor_height_within_bounds_moves_only_the_sensor():
    base = _by_id(_place())
    raised = _by_id(_place(mount_offsets={"sensor-1": (0, 20, 0)}))
    assert math.isclose(raised["sensor-1"].pose.position_mm[1] - base["sensor-1"].pose.position_mm[1], 20, abs_tol=1e-3)
    for iid in base:
        if iid != "sensor-1":
            assert base[iid].pose == raised[iid].pose


@pytest.mark.parametrize("offset", [(0, 25, 0), (0, -10, 0)])
def test_sensor_height_boundaries_inclusive(offset):
    _place(mount_offsets={"sensor-1": offset})


@pytest.mark.parametrize("offset", [(0, 25.01, 0), (0, -10.5, 0), (5, 0, 0)])
def test_sensor_height_out_of_range_rejected(offset):
    with pytest.raises(PlacementError):
        _place(mount_offsets={"sensor-1": offset})


def test_offset_on_non_adjustable_instance_rejected():
    with pytest.raises(PlacementError):
        _place(mount_offsets={"controller-1": (0, 1, 0)})
    with pytest.raises(PlacementError):
        _place(mount_offsets={"ghost-1": (0, 1, 0)})


# --- impossible configurations -----------------------------------------------------


def _catalog_with(records):
    return Catalog("t", tuple(CatalogComponent.model_validate(r) for r in records))


def test_missing_anchor_rejected():
    records = support.synthetic_catalog_records()
    chassis = next(r for r in records if r["catalog_id"] == "synthetic.chassis")
    chassis["mounts"] = [m for m in chassis["mounts"] if m["mount_id"] != "front_sensor"]
    with pytest.raises(PlacementError) as err:
        _place(catalog=_catalog_with(records))
    assert err.value.details["mount_id"] == "front_sensor"


def test_impossible_mate_rejected():
    records = support.synthetic_catalog_records()
    wheel = next(r for r in records if r["catalog_id"] == "synthetic.wheel")
    wheel["mounts"][0]["kind"] = "square_peg"
    with pytest.raises(PlacementError):
        _place(catalog=_catalog_with(records))


def test_missing_own_mount_rejected():
    records = support.synthetic_catalog_records()
    caster = next(r for r in records if r["catalog_id"] == "synthetic.caster")
    caster["mounts"] = []
    with pytest.raises(PlacementError):
        _place(catalog=_catalog_with(records))


def test_unknown_selection_rejected():
    with pytest.raises(PlacementError):
        _place(selection=RoverSelection(**{**SYNTHETIC.__dict__, "motor": "synthetic.nope"}))


def test_placement_does_not_mutate_catalog():
    catalog = support.synthetic_catalog()
    before = copy.deepcopy(catalog.to_wire())
    _place(catalog=catalog, mount_offsets={"sensor-1": (0, 5, 0)})
    assert catalog.to_wire() == before


# --- real catalog ----------------------------------------------------------------------


def test_places_sourced_catalog_and_reports_approximated_geometry():
    from rivet_engine.catalog import load_catalog

    selection = RoverSelection(
        chassis="chassis.sparkfun_shadow_rob13301",
        motor="motor.adafruit_tt_gearbox_200rpm_3777",
        wheel="wheel.adafruit_tt_wheel_3766",
        caster="caster.sparkfun_shadow_nub",
        controller="board.esp32_devkitc_v4_wroom32e",
        motor_driver="driver.adafruit_tb6612_2448",
        distance_sensor="sensor.adafruit_vl53l0x_3317",
        motor_power="power.sparkfun_shadow_4xaa_holder",
        controller_power="power.adafruit_usb_power_bank_5000_4288",
    )
    result = mounts.place_rover(selection, load_catalog())
    assert len(result.components) == 11
    [approx] = result.findings
    assert approx.rule_id == "mechanical.geometry_approximated" and approx.severity == "advisory"
    assert "chassis-1" in approx.affected_instance_ids
    assert "driver-1" not in approx.affected_instance_ids
    by_id = _by_id(result)
    # Mirrored motors must still put both wheels on one axle.
    assert by_id["wheel-left-1"].pose.position_mm[1:] == by_id["wheel-right-1"].pose.position_mm[1:]


def test_offset_limits_are_a_copy():
    limits = mounts.offset_limits()
    limits["sensor-1"]["max_mm"][1] = 999
    assert mounts.offset_limits()["sensor-1"]["max_mm"][1] == 25
