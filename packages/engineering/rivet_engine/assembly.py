"""Ordered assembly instructions (B6).

Structural steps follow the parent graph (a part never comes before the part it mounts
on), then wiring, then a wiring check, then inserting the cells, and only then the step
that connects the power supplies. Every step references real instance IDs from the same
plan.

Loose kit items (role ``accessory``: breadboard, wires, cables, adapter, cells) have no
modeled position, so the parent graph cannot place them. Each one is referenced by the
step that uses it, as recorded in ``KIT_USES``. A kit item whose use this plan does not
record goes into its own step that says so, so every BOM line appears in at least one
step and nothing is given a use the plan does not have.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass

from rivet_engine.models import AssemblyStep, ComponentInstance, Connection
from rivet_engine.ports import Catalog, PlacementError

# role -> structural stage (lower first)
STAGES = [
    ("Prepare the chassis", ["chassis"], "Assemble the chassis plates and check its mounting points."),
    ("Mount the motors", ["motor"], "Fix each motor into its motor mount with the shaft pointing outward."),
    ("Fit the wheels and caster", ["wheel", "caster"], "Press each wheel onto its motor shaft and attach the caster."),
    ("Mount the electronics", ["controller", "motor_driver", "distance_sensor"], "Fix the boards to their mounting points; the range sensor faces forward."),
    ("Place the power supplies", ["motor_power", "controller_power"], "Secure the power supplies. Leave them disconnected, with no batteries inserted."),
]
KIT_ROLE = "accessory"
NO_POWER = "Keep every power supply disconnected during this step."
FIT_NOT_CHECKED = "Connector fit to the board pins is not checked by the engine."
UNUSED_KIT_TITLE = "Kit items not used by this plan"
CELLS_TITLE = "Insert the batteries"
POWER_TITLE = "Connect power"


@dataclass(frozen=True)
class KitUse:
    """How one loose kit item is used.

    kind:
      ``holds``        seats a part whose catalog category is in ``targets``; joins that part's
                       structural step.
      ``cells``        fills a supply whose catalog_id is in ``targets``; joins the step that
                       inserts the batteries, right before power is connected.
      ``supply_wires`` carries the wires of a supply whose catalog_id is in ``targets`` (to a part
                       in ``peers`` when given); joins every wiring step with such a wire.
      ``i2c_wires``    carries the power, ground, SDA and SCL wires of an I2C device.
      ``other_wires``  carries the signal and ground wires no other kit item carries.
    """

    label: str
    kind: str
    targets: frozenset[str] = frozenset()
    peers: frozenset[str] = frozenset()
    text: str = ""
    fit_checked: bool = True


# Every entry restates a use the catalog records (components.json notes and
# catalog_sources.md), the fit evidence or the netlist already give; nothing here adds one.
KIT_USES: dict[str, KitUse] = {
    # Note "Holds the TB6612 breakout."; "adhesive foam backing"; fit_evidence.json: the breakout
    # "sits in the half-size breadboard, which is stuck to the top plate".
    "accessory.adafruit_half_breadboard_64": KitUse(
        "half-size breadboard",
        "holds",
        frozenset({"motor_driver"}),
        text="Seat {held} in the half-size breadboard ({iid}) and fix the breadboard to the chassis with its adhesive foam backing.",
    ),
    # Male/male jumper pack (Adafruit 758): the plan's general wire supply.
    "wiring.adafruit_jumper_mm_40x150_758": KitUse("jumper wires", "other_wires", fit_checked=False),
    # Leads red 3.3 V, black GND, blue SDA, yellow SCL: the four wires of the I2C range sensor.
    "wiring.adafruit_stemma_qt_to_male_4209": KitUse("STEMMA QT cable", "i2c_wires", fit_checked=False),
    # Note "Connects the power bank to the ESP32 board."
    "wiring.adafruit_usb_a_microb_3ft_592": KitUse(
        "USB cable",
        "supply_wires",
        frozenset({"power.adafruit_usb_power_bank_5000_4288"}),
        frozenset({"board.esp32_devkitc_v4_wroom32e"}),
    ),
    # Note: the 3842 holder's 2.1 mm center-positive plug matches this jack. The Shadow 4xAA
    # holder's plug is unconfirmed, so it is not listed.
    "accessory.adafruit_dc_jack_terminal_368": KitUse(
        "DC jack adapter", "supply_wires", frozenset({"power.adafruit_3xaa_holder_2p1mm_3842"})
    ),
    # Notes "Required to power the 3xAA holder" / "Required to power the 4xAA holder".
    "accessory.adafruit_aa_alkaline_3pack_3521": KitUse(
        "AA batteries", "cells", frozenset({"power.adafruit_3xaa_holder_2p1mm_3842"})
    ),
    "accessory.adafruit_aa_alkaline_4pack_3349": KitUse(
        "AA batteries", "cells", frozenset({"power.sparkfun_shadow_4xaa_holder"})
    ),
}

I2C_DEVICE_SIGNALS = {"i2c_sda", "i2c_scl"}
I2C_CABLE_SIGNALS = {"power_in", "ground", "i2c_sda", "i2c_scl"}
NOT_I2C_DEVICES = {"controller", "power_supply"}


@dataclass
class _Step:
    title: str
    ids: list[str]
    text: str
    notes: list[str]


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


def _join(parts: list[str]) -> str:
    return parts[0] if len(parts) == 1 else ", ".join(parts[:-1]) + " and " + parts[-1]


def _wires(n: int) -> str:
    return "wire" if n == 1 else "wires"


def build_assembly_steps(
    components: Sequence[ComponentInstance], connections: Sequence[Connection], catalog: Catalog
) -> list[AssemblyStep]:
    by_id = {c.instance_id: c for c in components}
    order = {c.instance_id: n for n, c in enumerate(components)}
    stage = _structural_order(components)
    kit = [c for c in components if c.role == KIT_ROLE]

    def catalog_id(iid: str) -> str:
        return by_id[iid].catalog_id

    def category(iid: str) -> str:
        return catalog.require(catalog_id(iid)).identity.category

    def port_signal(iid: str, pid: str | None) -> str | None:
        port = catalog.require(catalog_id(iid)).port(pid) if pid else None
        return port.signal if port else None

    structural: list[tuple[int, _Step]] = []
    for index, (title, _, text) in enumerate(STAGES):
        ids = [c.instance_id for c in components if c.role != KIT_ROLE and stage[c.instance_id] == index]
        if ids:
            structural.append((index, _Step(title, ids, text, [NO_POWER] if index >= 3 else [])))

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

    # --- which wires each wire-type kit item carries ---------------------------------------
    def supply_end(use: KitUse, c: Connection) -> str | None:
        """The endpoint that is a supply named in ``use.targets`` (other end in ``peers`` if set)."""
        for end, other in ((c.from_, c.to), (c.to, c.from_)):
            if catalog_id(end.instance_id) in use.targets and (not use.peers or catalog_id(other.instance_id) in use.peers):
                return end.instance_id
        return None

    def i2c_end(c: Connection) -> str | None:
        """The endpoint on an I2C device, if the wire uses one of its power, ground, SDA or SCL ports."""
        for end in (c.from_, c.to):
            part = catalog.require(catalog_id(end.instance_id))
            if (
                part.identity.category not in NOT_I2C_DEVICES
                and I2C_DEVICE_SIGNALS <= {p.signal for p in part.ports}
                and port_signal(end.instance_id, end.port_id) in I2C_CABLE_SIGNALS
            ):
                return end.instance_id
        return None

    anchor_of: dict[str, Callable[[Connection], str | None]] = {}
    for item in kit:
        use = KIT_USES.get(item.catalog_id)
        if use is None:
            continue
        if use.kind == "supply_wires":
            anchor_of[item.instance_id] = lambda c, use=use: supply_end(use, c)
        elif use.kind == "i2c_wires":
            anchor_of[item.instance_id] = i2c_end

    def wire_items(conns: list[Connection], allow_other: bool) -> tuple[list[str], list[str], bool]:
        """Kit items carrying these wires: (instance ids, phrases, any connector fit unchecked)."""
        specific: list[tuple[str, str, bool]] = []
        carried: set[int] = set()
        for item in kit:
            find = anchor_of.get(item.instance_id)
            if find is None:
                continue
            hits = [(n, find(c)) for n, c in enumerate(conns)]
            hits = [(n, a) for n, a in hits if a is not None]
            if not hits:
                continue
            use = KIT_USES[item.catalog_id]
            carried |= {n for n, _ in hits}
            anchors = sorted({a for _, a in hits})
            phrase = f"the {use.label} ({item.instance_id}) for the {_join(anchors)} {_wires(len(hits))}"
            specific.append((item.instance_id, phrase, use.fit_checked))
        rest = [c for n, c in enumerate(conns) if n not in carried]
        general: list[tuple[str, str, bool]] = []
        if allow_other and rest:
            for item in kit:
                use = KIT_USES.get(item.catalog_id)
                if use is not None and use.kind == "other_wires":
                    target = "the others" if specific else "these wires"
                    general.append((item.instance_id, f"the {use.label} ({item.instance_id}) for {target}", use.fit_checked))
        chosen = specific + general
        return [i for i, _, _ in chosen], [p for _, p, _ in chosen], any(not ok for _, _, ok in chosen)

    used: set[str] = set()

    def wire_step(title: str, conns: list[Connection], lead: str, notes: list[str], allow_other: bool) -> _Step | None:
        if not conns:
            return None
        ids = sorted({e.instance_id for c in conns for e in (c.from_, c.to)})
        text = lead + " " + "; ".join(_describe(c) for c in conns) + "."
        kit_ids, phrases, unchecked = wire_items(conns, allow_other)
        if kit_ids:
            ids += sorted(kit_ids, key=order.__getitem__)
            used.update(kit_ids)
            text += " Use " + _join(phrases) + "."
            if unchecked:
                text += " " + FIT_NOT_CHECKED
        return _Step(title, ids, text, notes)

    signal_step = wire_step("Wire logic supply and control signals", signals, "Connect:", [NO_POWER], True)
    motor_step = wire_step(
        "Wire the motors",
        motors,
        "Connect each driver output to a motor terminal:",
        [NO_POWER, "If a wheel spins backwards later, swap that motor's two leads."],
        False,
    )
    ground_step = wire_step("Wire the common ground", ground, "Connect every ground together:", [NO_POWER], True)
    check_step = None
    if electrical:
        checked = sorted({e.instance_id for c in electrical for e in (c.from_, c.to)})
        check_step = _Step(
            "Check the wiring before power",
            checked,
            "Compare every wire against the netlist. Confirm supply polarity, that the motor supply goes only to the driver's motor input, and that all grounds are joined.",
            [NO_POWER, "Do not continue until every connection matches the netlist."],
        )
    power_step = wire_step(
        POWER_TITLE,
        energizing,
        "Only after the wiring check passes, connect the supplies:",
        ["Lift the wheels off the table for the first power-up.", "Disconnect the motor supply immediately if anything gets hot or smells."],
        False,
    )

    # --- kit items that hold a part or fill a supply ---------------------------------------
    cells_ids: list[str] = []
    cells_text: list[str] = []
    for item in kit:
        use = KIT_USES.get(item.catalog_id)
        if use is None:
            continue
        if use.kind == "holds":
            for _, step in structural:
                held = [i for i in step.ids if by_id[i].role != KIT_ROLE and category(i) in use.targets]
                if held:
                    step.ids.append(item.instance_id)
                    step.text += " " + use.text.format(held=_join(held), iid=item.instance_id)
                    used.add(item.instance_id)
                    break
        elif use.kind == "cells":
            supplies = [c.instance_id for c in components if c.catalog_id in use.targets]
            if supplies:
                cells_ids += [i for i in supplies if i not in cells_ids] + [item.instance_id]
                cells_text.append(f"the {use.label} ({item.instance_id}) into {_join(supplies)}")
                used.add(item.instance_id)

    cells_step = None
    if cells_ids:
        supplies = [i for i in cells_ids if by_id[i].role != KIT_ROLE]
        lead = "Only after the wiring check passes, insert " if check_step else "Insert "
        until = " until the power step" if power_step else ""
        cells_step = _Step(
            CELLS_TITLE,
            cells_ids,
            lead + _join(cells_text) + ".",
            [f"Keep {_join(supplies)} disconnected{until}."],
        )

    # --- kit items whose use this plan does not record --------------------------------------
    def kit_label(c: ComponentInstance) -> str:
        if c.catalog_id in KIT_USES:
            return KIT_USES[c.catalog_id].label
        part = catalog.get(c.catalog_id)
        return part.identity.model if part is not None else c.catalog_id

    unused = [c for c in kit if c.instance_id not in used]
    unused_step = None
    if unused:
        names = [f"{kit_label(c)} ({c.instance_id})" for c in unused]
        unused_step = _Step(
            UNUSED_KIT_TITLE,
            [c.instance_id for c in unused],
            "These kit items are in the BOM, but this plan records no step that uses them: "
            + _join(names)
            + ". Check what each one is for before you build.",
            [NO_POWER],
        )

    ordered = [s for _, s in structural] + [
        s for s in (unused_step, signal_step, motor_step, ground_step, check_step, cells_step, power_step) if s is not None
    ]
    return [
        AssemblyStep(step=n, title=s.title, instance_ids=s.ids, instructions=s.text, safety_notes=s.notes)
        for n, s in enumerate(ordered, start=1)
    ]
