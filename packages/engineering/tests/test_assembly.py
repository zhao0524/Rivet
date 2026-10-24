import pytest

import rivet_engine
from rivet_engine.assembly import (
    CELLS_TITLE,
    KIT_ROLE,
    KIT_USES,
    POWER_TITLE,
    STAGES,
    UNUSED_KIT_TITLE,
    build_assembly_steps,
)
from rivet_engine.catalog import load_catalog
from rivet_engine.models import BuildPlan
from rivet_engine.ports import PlacementError
from tests import support

STRUCTURAL_TITLES = {title for title, _, _ in STAGES}


def _steps(plan=None):
    plan = plan or support.synthetic_plan()
    return build_assembly_steps(plan.components, plan.connections, support.synthetic_catalog())


@pytest.fixture(scope="module")
def sample():
    """The default sourced rover, as solve() builds it."""
    return BuildPlan.model_validate(rivet_engine.solve(support.appendix_intent_dict()))


def _sample_steps(sample, components=None, connections=None):
    return build_assembly_steps(
        sample.components if components is None else components,
        sample.connections if connections is None else connections,
        load_catalog(),
    )


def _with_motor_supply(sample, catalog_id):
    return [c.model_copy(update={"catalog_id": catalog_id}) if c.instance_id == "power-motor-1" else c for c in sample.components]


def _steps_of(steps):
    out = {}
    for s in steps:
        for i in s.instance_ids:
            out.setdefault(i, []).append(s.title)
    return out


def test_steps_numbered_and_reference_real_instances():
    plan = support.synthetic_plan()
    steps = _steps(plan)
    ids = {c.instance_id for c in plan.components}
    assert [s.step for s in steps] == list(range(1, len(steps) + 1))
    assert len(steps) >= 6
    for s in steps:
        assert s.instance_ids and set(s.instance_ids) <= ids
        assert len(s.instance_ids) == len(set(s.instance_ids)), s.title


def test_every_part_appears_in_a_structural_step_before_any_wiring():
    plan = support.synthetic_plan()
    steps = _steps(plan)
    first_wiring = next(n for n, s in enumerate(steps) if s.title not in STRUCTURAL_TITLES | {UNUSED_KIT_TITLE})
    structural = {i for s in steps[:first_wiring] if s.title in STRUCTURAL_TITLES for i in s.instance_ids}
    assert structural >= {c.instance_id for c in plan.components if c.role != KIT_ROLE}


def _plans(sample):
    plan = support.synthetic_plan()
    return {
        "sample": (sample, _sample_steps(sample)),
        "synthetic": (plan, _steps(plan)),
        "sample, shadow 4xAA holder": (sample, _sample_steps(sample, _with_motor_supply(sample, "power.sparkfun_shadow_4xaa_holder"))),
        "sample, no wiring": (sample, _sample_steps(sample, connections=[])),
    }


@pytest.mark.parametrize("case", ["sample", "synthetic", "sample, shadow 4xAA holder", "sample, no wiring"])
def test_every_bom_line_appears_in_at_least_one_step(sample, case):
    plan, steps = _plans(sample)[case]
    touched = {i for s in steps for i in s.instance_ids}
    for item in plan.bom.items:
        assert set(item.instance_ids) <= touched, (case, item.catalog_id)
    assert touched == {c.instance_id for c in plan.components}


def test_kit_items_join_the_step_that_uses_them(sample):
    steps = _sample_steps(sample)
    kit = {c.catalog_id: c.instance_id for c in sample.components if c.role == KIT_ROLE}
    where = _steps_of(steps)
    titles = [s.title for s in steps]
    assert UNUSED_KIT_TITLE not in titles
    assert "Lay out wiring supplies" not in titles
    # Catalog note "Holds the TB6612 breakout": seated with the driver.
    assert where[kit["accessory.adafruit_half_breadboard_64"]] == ["Mount the electronics"]
    # Jumpers and the sensor's STEMMA QT cable carry signal and ground wires, never the supplies.
    assert where[kit["wiring.adafruit_jumper_mm_40x150_758"]] == ["Wire logic supply and control signals", "Wire the common ground"]
    assert where[kit["wiring.adafruit_stemma_qt_to_male_4209"]] == ["Wire logic supply and control signals", "Wire the common ground"]
    # The DC jack adapter is where the 3xAA holder's plug meets the driver (ground, then motor supply).
    assert where[kit["accessory.adafruit_dc_jack_terminal_368"]] == ["Wire the common ground", POWER_TITLE]
    # "Connects the power bank to the ESP32 board": only the controller supply wire.
    assert where[kit["wiring.adafruit_usb_a_microb_3ft_592"]] == [POWER_TITLE]
    assert where[kit["accessory.adafruit_aa_alkaline_3pack_3521"]] == [CELLS_TITLE]
    for s in steps:
        for iid in s.instance_ids:
            if iid in kit.values():
                assert iid in s.instructions, (s.title, iid)


def test_kit_instructions_name_the_wires_each_item_carries(sample):
    by_title = {s.title: s for s in _sample_steps(sample)}
    signals = by_title["Wire logic supply and control signals"].instructions
    assert "STEMMA QT cable (accessory-3) for the sensor-1 wires" in signals
    assert "jumper wires (accessory-2) for the others" in signals
    assert "not checked" in signals
    ground = by_title["Wire the common ground"].instructions
    assert "DC jack adapter (accessory-5) for the power-motor-1 wire" in ground
    power = by_title[POWER_TITLE].instructions
    assert "USB cable (accessory-4) for the power-control-1 wire" in power
    assert "jumper" not in power and "STEMMA" not in power
    assert "breadboard" not in by_title["Wire the motors"].instructions


def test_batteries_go_in_after_the_wiring_check_and_right_before_power(sample):
    steps = _sample_steps(sample)
    titles = [s.title for s in steps]
    check, cells, power = titles.index("Check the wiring before power"), titles.index(CELLS_TITLE), titles.index(POWER_TITLE)
    assert power == len(steps) - 1 and cells == power - 1 and check < cells
    assert set(steps[cells].instance_ids) == {"power-motor-1", "accessory-6"}
    assert steps[cells].instructions.startswith("Only after the wiring check passes")
    assert any("power-motor-1 disconnected" in n for n in steps[cells].safety_notes)
    for s in steps[:cells]:
        text = s.instructions.lower()
        assert "accessory-6" not in s.instance_ids
        assert "batter" not in text or "no batteries" in text, s.title


def test_kit_item_without_a_recorded_use_gets_its_own_step_not_dropped():
    plan = support.synthetic_plan()
    steps = _steps(plan)
    [unused] = [s for s in steps if s.title == UNUSED_KIT_TITLE]
    assert unused.instance_ids == ["wires-1"]
    assert "wires-1" in unused.instructions and "no step that uses them" in unused.instructions
    titles = [s.title for s in steps]
    assert titles.index(UNUSED_KIT_TITLE) < titles.index("Wire logic supply and control signals")


def test_kit_use_needs_its_documented_partner(sample):
    # The 3xAA cells and the DC jack match only the 3842 holder; with the Shadow 4xAA holder
    # (plug size unconfirmed) neither use applies, so both are listed as unused, not guessed.
    steps = _sample_steps(sample, _with_motor_supply(sample, "power.sparkfun_shadow_4xaa_holder"))
    [unused] = [s for s in steps if s.title == UNUSED_KIT_TITLE]
    assert unused.instance_ids == ["accessory-5", "accessory-6"]
    assert CELLS_TITLE not in [s.title for s in steps]
    assert steps[-1].title == POWER_TITLE and "accessory-5" not in steps[-1].instance_ids


def test_every_kit_use_names_real_catalog_parts():
    catalog = load_catalog()
    categories = {c.identity.category for c in catalog.components}
    for catalog_id, use in KIT_USES.items():
        assert catalog_id in catalog, catalog_id
        assert catalog.require(catalog_id).identity.category in {"accessory", "wiring"}
        for target in use.targets | use.peers:
            assert target in catalog or target in categories, (catalog_id, target)


def test_parents_come_before_children():
    plan = support.synthetic_plan()
    first = {}
    for s in _steps(plan):
        for i in s.instance_ids:
            first.setdefault(i, s.step)
    for c in plan.components:
        if c.parent_instance_id:
            assert first[c.parent_instance_id] <= first[c.instance_id], c.instance_id


def test_power_is_connected_only_after_the_wiring_check():
    steps = _steps()
    titles = [s.title for s in steps]
    check = titles.index("Check the wiring before power")
    power = titles.index(POWER_TITLE)
    assert power == len(steps) - 1 and check < power
    for s in steps[:power]:
        assert "battery" not in s.instructions.lower() or "no batteries" in s.instructions.lower()
    # The battery and USB supply wires only appear in the final step.
    assert "VMOTOR" in steps[power].instructions and "V5" in steps[power].instructions
    assert all("VMOTOR" not in s.instructions for s in steps[:power])


def test_wiring_steps_cover_every_connection():
    plan = support.synthetic_plan()
    text = " ".join(s.instructions for s in _steps(plan))
    for c in plan.connections:
        assert f"{c.from_.instance_id}.{c.from_.port_id} to {c.to.instance_id}.{c.to.port_id}" in text


def test_safety_notes_on_electrical_steps():
    for s in _steps():
        if "Wire" in s.title or "power" in s.title.lower() or "electronics" in s.title:
            assert s.safety_notes, s.title


def test_cycle_rejected():
    plan = support.synthetic_plan().model_copy(deep=True)
    plan.components[0].parent_instance_id = "motor-left-1"
    with pytest.raises(PlacementError):
        _steps(plan)


def test_no_connections_gives_structural_steps_only():
    plan = support.synthetic_plan()
    steps = build_assembly_steps(plan.components, [], support.synthetic_catalog())
    assert all("Wire" not in s.title and s.title != POWER_TITLE for s in steps)


def test_deterministic_and_non_mutating(sample):
    plan = support.synthetic_plan()
    before = plan.to_wire()
    assert [s.to_wire() for s in _steps(plan)] == [s.to_wire() for s in _steps(plan)]
    assert plan.to_wire() == before
    sample_before = sample.to_wire()
    assert [s.to_wire() for s in _sample_steps(sample)] == [s.to_wire() for s in _sample_steps(sample)]
    assert sample.to_wire() == sample_before
