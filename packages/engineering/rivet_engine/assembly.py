"""Ordered assembly instructions (B6).

Structural steps follow the parent graph (a part never comes before the part it mounts
on), then wiring, then a wiring check, and only then the step that connects the power
supplies. Every step references real instance IDs from the same plan.
"""

from __future__ import annotations

from collections.abc import Sequence

from rivet_engine.models import AssemblyStep, ComponentInstance, Connection
from rivet_engine.ports import Catalog, PlacementError

# role -> structural stage (lower first)
STAGES = [
    ("Prepare the chassis", ["chassis"], "Assemble the chassis plates and check its mounting points."),
    ("Mount the motors", ["motor"], "Fix each motor into its motor mount with the shaft pointing outward."),
    ("Fit the wheels and caster", ["wheel", "caster"], "Press each wheel onto its motor shaft and attach the caster."),
    ("Mount the electronics", ["controller", "motor_driver", "distance_sensor"], "Fix the boards to their mounting points; the range sensor faces forward."),
    ("Place the power supplies", ["motor_power", "controller_power"], "Secure the power supplies. Leave them disconnected, with no batteries inserted."),
    ("Lay out wiring supplies", ["accessory"], "Set out the breadboard, wires and adapters used in the next steps."),
]
NO_POWER = "Keep every power supply disconnected during this step."


def _stage_of(role: str) -> int:
    for index, (_, roles, _) in enumerate(STAGES):
        if role in roles:
            return index
    return 3  # unknown roles are treated as electronics


def _structural_order(components: Sequence[ComponentInstance]) -> dict[str, int]:
    by_id = {c.instance_id: c for c in components}
    stage: dict[str, int] = {}

    def resolve(iid: str, path: tuple[str, ...]) -> int:
        if iid in path:
            raise PlacementError("Assembly dependency cycle", {"cycle": list(path[path.index(iid):]) + [iid]})
        if iid in stage:
            return stage[iid]
        c = by_id[iid]
        own = _stage_of(c.role)
        parent = c.parent_instance_id
        if parent is not None and parent in by_id:
            own = max(own, resolve(parent, path + (iid,)))
        stage[iid] = own
        return own

    for c in components:
        resolve(c.instance_id, ())
    return stage


def _describe(c: Connection) -> str:
    net = f" ({c.net_name})" if c.net_name else ""
    return f"{c.from_.instance_id}.{c.from_.port_id} to {c.to.instance_id}.{c.to.port_id}{net}"


def build_assembly_steps(
    components: Sequence[ComponentInstance], connections: Sequence[Connection], catalog: Catalog
) -> list[AssemblyStep]:
    by_id = {c.instance_id: c for c in components}
    stage = _structural_order(components)
    steps: list[tuple[str, list[str], str, list[str]]] = []

    for index, (title, _, text) in enumerate(STAGES):
        ids = [c.instance_id for c in components if stage[c.instance_id] == index]
        if ids:
            notes = [NO_POWER] if index >= 3 else []
            steps.append((title, ids, text, notes))

    def category(iid: str) -> str:
        return catalog.require(by_id[iid].catalog_id).identity.category

    def port_signal(iid: str, pid: str | None) -> str | None:
        port = catalog.require(by_id[iid].catalog_id).port(pid) if pid else None
        return port.signal if port else None

    electrical = [c for c in connections if c.kind == "electrical" and c.from_.instance_id in by_id and c.to.instance_id in by_id]
    energizing, ground, motors, signals = [], [], [], []
    for c in electrical:
        signals_ = {port_signal(c.from_.instance_id, c.from_.port_id), port_signal(c.to.instance_id, c.to.port_id)}
        if "power_output" in signals_ and "power_supply" in {category(c.from_.instance_id), category(c.to.instance_id)}:
            energizing.append(c)
        elif signals_ == {"ground"}:
            ground.append(c)
        elif "motor_output" in signals_:
            motors.append(c)
        else:
            signals.append(c)

    def wire_step(title: str, conns: list[Connection], lead: str, notes: list[str]) -> None:
        if conns:
            ids = sorted({e.instance_id for c in conns for e in (c.from_, c.to)})
            steps.append((title, ids, lead + " " + "; ".join(_describe(c) for c in conns) + ".", notes))

    wire_step("Wire logic supply and control signals", signals, "Connect:", [NO_POWER])
    wire_step("Wire the motors", motors, "Connect each driver output to a motor terminal:", [NO_POWER, "If a wheel spins backwards later, swap that motor's two leads."])
    wire_step("Wire the common ground", ground, "Connect every ground together:", [NO_POWER])
    if electrical:
        checked = sorted({e.instance_id for c in electrical for e in (c.from_, c.to)})
        steps.append(
            (
                "Check the wiring before power",
                checked,
                "Compare every wire against the netlist. Confirm supply polarity, that the motor supply goes only to the driver's motor input, and that all grounds are joined.",
                [NO_POWER, "Do not continue until every connection matches the netlist."],
            )
        )
    wire_step(
        "Connect power",
        energizing,
        "Only after the wiring check passes, connect the supplies:",
        ["Lift the wheels off the table for the first power-up.", "Disconnect the motor supply immediately if anything gets hot or smells."],
    )

    return [
        AssemblyStep(step=n, title=title, instance_ids=ids, instructions=text, safety_notes=notes)
        for n, (title, ids, text, notes) in enumerate(steps, start=1)
    ]
