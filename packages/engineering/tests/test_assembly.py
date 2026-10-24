import pytest

from rivet_engine.assembly import build_assembly_steps
from rivet_engine.ports import PlacementError
from tests import support


def _steps(plan=None):
    plan = plan or support.synthetic_plan()
    return build_assembly_steps(plan.components, plan.connections, support.synthetic_catalog())


def test_steps_numbered_and_reference_real_instances():
    plan = support.synthetic_plan()
    steps = _steps(plan)
    ids = {c.instance_id for c in plan.components}
    assert [s.step for s in steps] == list(range(1, len(steps) + 1))
    assert len(steps) >= 6
    for s in steps:
        assert s.instance_ids and set(s.instance_ids) <= ids


def test_every_component_appears_in_a_structural_step():
    plan = support.synthetic_plan()
    covered = {i for s in _steps(plan)[:6] for i in s.instance_ids}
    assert covered == {c.instance_id for c in plan.components}


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
    power = titles.index("Connect power")
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
    assert all("Wire" not in s.title and s.title != "Connect power" for s in steps)


def test_deterministic_and_non_mutating():
    plan = support.synthetic_plan()
    before = plan.to_wire()
    assert [s.to_wire() for s in _steps(plan)] == [s.to_wire() for s in _steps(plan)]
    assert plan.to_wire() == before
