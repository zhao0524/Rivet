"""Electrical logic and power checks (B4 categories 4 and 5).

Ratings come only from catalog ports. A missing rating gives UNKNOWN; a PASS that relies
on approximated catalog evidence is downgraded to an advisory WARN.

Supply voltage rule: a supply whose maximum exceeds the input's rated maximum is a blocking
FAIL (over-voltage); one that only dips below the rated minimum is an advisory WARN (brown-out).

Motor current rule: motor stall current (motor port current_limit_a) against the driver
output's continuous rating (driver port current_limit_a):
  stall <= continuous                -> PASS
  stall > continuous                 -> FAIL (blocking)
Unverified current evidence remains UNKNOWN; peak ratings alone do not establish
a supported stall duration or protection mechanism.
"""

from __future__ import annotations

import re
from collections import defaultdict

from rivet_engine.models import Connection, Finding, Port
from rivet_engine.validators.common import PlanView, Rule, compare_range

DRIVING = {"digital_output", "digital_io", "pwm_output"}
I2C = {"i2c", "i2c_sda", "i2c_scl"}
RECEIVING = {"digital_input", "digital_io", "pwm_input"} | I2C
COMPATIBLE = [
    (DRIVING, RECEIVING),
    ({"i2c_sda", "i2c"}, {"i2c_sda", "i2c"}),
    ({"i2c_scl", "i2c"}, {"i2c_scl", "i2c"}),
    ({"power_output"}, {"power_in"}),
    ({"ground"}, {"ground"}),
    ({"motor_output"}, {"motor_power"}),
]
_ADDRESS = re.compile(r"address\s+(0x[0-9a-fA-F]{2})")


def _compatible(a: Port, b: Port) -> bool:
    return any((a.signal in x and b.signal in y) or (b.signal in x and a.signal in y) for x, y in COMPATIBLE)


def check(view: PlanView) -> list[Finding]:
    conns = [c for c in view.electrical if view.resolvable(c)]
    out: list[Finding] = []
    out += _signals(view, conns)
    out += _gpio(view, conns)
    out += _supply_ranges(view, conns)
    out += _logic_levels(view, conns)
    out += _motor_voltage(view, conns)
    out += _motor_current(view, conns)
    out += _motor_channels(view, conns)
    out += _ground(view, conns)
    out += _required_ports(view, conns)
    out += _i2c(view, conns)
    out += _capacity(view, conns)
    return out


def _ports(view: PlanView, conn: Connection) -> tuple[Port, Port]:
    return view.port(conn.from_.instance_id, conn.from_.port_id), view.port(conn.to.instance_id, conn.to.port_id)


def _signals(view, conns):
    rule = Rule("electrical.signal_types", pass_message="Every wire joins compatible port types")
    for conn in conns:
        a, b = _ports(view, conn)
        if _compatible(a, b):
            rule.ok([conn.from_.instance_id, conn.to.instance_id])
        else:
            rule.fail(f"{conn.connection_id} joins {a.signal} to {b.signal}", [conn.from_.instance_id, conn.to.instance_id])
    return rule.result()


def _gpio(view, conns):
    rule = Rule("electrical.gpio_usage", pass_message="Controller pins are used once each and only as documented")
    controllers = {c.instance_id for c in view.role("controller")}
    users: dict[tuple[str, str], set[str]] = defaultdict(set)
    for conn in conns:
        for end, other in ((conn.from_, conn.to), (conn.to, conn.from_)):
            if end.instance_id not in controllers:
                continue
            port = view.port(end.instance_id, end.port_id)
            if port.signal not in DRIVING | {"digital_input"}:
                continue
            users[(end.instance_id, end.port_id)].add(conn.net_name or conn.connection_id)
            notes = port.notes.lower()
            target = view.port(other.instance_id, other.port_id)
            if port.signal == "digital_input" and target.signal not in ("digital_output",):
                rule.fail(f"{end.port_id} is input-only but drives {other.instance_id}.{other.port_id}", [end.instance_id, other.instance_id], view.urls([end.instance_id]))
            elif "do not use" in notes:
                rule.fail(f"{end.port_id} is reserved: {port.notes}", [end.instance_id], view.urls([end.instance_id]))
            elif "strapping" in notes:
                rule.warn(f"{end.port_id} is a strapping pin; its level at reset can change the boot mode", [end.instance_id], view.urls([end.instance_id]))
            else:
                rule.ok([end.instance_id])
    for (iid, pid), nets in sorted(users.items()):
        if len(nets) > 1:
            rule.fail(f"{iid}.{pid} is shared by nets {sorted(nets)}", [iid])
    return rule.result()


def _judge_range(rule, label, src_range, dst_range, ids, urls, verified: bool) -> None:
    (smin, smax), (amin, amax) = src_range, dst_range
    verdict = compare_range(src_range, dst_range)
    if verdict == "unknown":
        rule.unknown(f"{label}: voltage rating not documented on one side", ids, urls)
    elif verdict == "outside":
        rule.fail(f"{label}: {smin}-{smax} V is outside the accepted {amin}-{amax} V", ids, urls)
    elif smax > amax:
        rule.fail(f"{label}: up to {smax} V exceeds the rated maximum {amax} V", ids, urls)
    elif smin < amin:
        rule.warn(f"{label}: may drop to {smin} V, below the rated minimum {amin} V (brown-out)", ids, urls)
    elif not verified:
        rule.warn(f"{label}: within range, but based on approximated ratings", ids, urls)
    else:
        rule.ok(ids, urls)


def _supply_ranges(view, conns):
    rule = Rule("electrical.supply_voltage", pass_message="Every supply output is within the input's accepted range")
    for conn in conns:
        a, b = _ports(view, conn)
        pair = {a.signal, b.signal}
        if pair != {"power_output", "power_in"}:
            continue
        src, src_end, dst, dst_end = (a, conn.from_, b, conn.to) if a.signal == "power_output" else (b, conn.to, a, conn.from_)
        ids = [src_end.instance_id, dst_end.instance_id]
        label = f"{src_end.instance_id}.{src.port_id} -> {dst_end.instance_id}.{dst.port_id}"
        _judge_range(rule, label, (src.voltage_min_v, src.voltage_max_v), (dst.voltage_min_v, dst.voltage_max_v),
                     ids, view.urls(ids), view.ratings_verified(ids))
    return rule.result()


def _supply_voltage_of(view, conns, instance_id: str) -> tuple[float | None, float | None] | None:
    """Voltage range feeding a component's logic: the supply wired to its first power_in."""
    for conn in conns:
        for end, other in ((conn.to, conn.from_), (conn.from_, conn.to)):
            if end.instance_id != instance_id:
                continue
            mine, theirs = view.port(end.instance_id, end.port_id), view.port(other.instance_id, other.port_id)
            if mine.signal == "power_in" and theirs.signal == "power_output":
                comp = view.component(other.instance_id)
                if comp and comp.identity.category == "controller":
                    return theirs.voltage_min_v, theirs.voltage_max_v
    return None


def _logic_levels(view, conns):
    rule = Rule("electrical.logic_level", pass_message="Signal inputs accept the controller's logic level")
    controllers = {c.instance_id for c in view.role("controller")}
    for conn in conns:
        a, b = _ports(view, conn)
        ends = [(conn.from_, a, conn.to, b), (conn.to, b, conn.from_, a)]
        for src_end, src, dst_end, dst in ends:
            if src_end.instance_id not in controllers or src.signal not in DRIVING | I2C or dst.signal not in RECEIVING:
                continue
            ids = [src_end.instance_id, dst_end.instance_id]
            level = src.logic_level_v
            label = f"{src_end.instance_id}.{src.port_id} -> {dst_end.instance_id}.{dst.port_id}"
            if level is None:
                rule.unknown(f"{label}: controller logic level not documented", ids)
                continue
            if dst.voltage_min_v is not None and dst.voltage_max_v is not None:
                accept = (dst.voltage_min_v, dst.voltage_max_v)
                source = "input rating"
            elif dst.logic_level_v is not None:
                accept = (dst.logic_level_v * 0.7, dst.logic_level_v * 1.1)
                source = "input logic level"
            else:
                supply = _supply_voltage_of(view, conns, dst_end.instance_id)
                if supply is None:
                    rule.unknown(f"{label}: input threshold not documented and no logic supply found", ids)
                    continue
                accept, source = supply, "logic supply wired from the controller"
            verdict = compare_range((level, level), accept)
            if verdict == "outside":
                rule.fail(f"{label}: {level} V logic is outside {accept[0]}-{accept[1]} V ({source})", ids, view.urls(ids))
            elif verdict == "unknown":
                rule.unknown(f"{label}: logic acceptance not documented", ids)
            else:
                rule.ok(ids)
    return rule.result()


def _driver_motor_supply(view, conns, driver_id: str):
    for conn in conns:
        for end, other in ((conn.to, conn.from_), (conn.from_, conn.to)):
            if end.instance_id == driver_id and view.port(end.instance_id, end.port_id).signal == "power_in":
                src = view.port(other.instance_id, other.port_id)
                comp = view.component(other.instance_id)
                if src.signal == "power_output" and comp and comp.identity.category == "power_supply":
                    return other.instance_id, src
    return None


def _motor_links(view, conns):
    """motor instance -> list of (driver instance, driver output port, motor port)."""
    links = defaultdict(list)
    for conn in conns:
        a, b = _ports(view, conn)
        for m_end, m_port, d_end, d_port in ((conn.from_, a, conn.to, b), (conn.to, b, conn.from_, a)):
            if m_port.signal == "motor_power" and d_port.signal == "motor_output":
                links[m_end.instance_id].append((d_end.instance_id, d_port, m_port))
    return links


def _motor_voltage(view, conns):
    rule = Rule("electrical.motor_voltage", pass_message="Motor supply is within the motors' rated voltage")
    for motor_id, links in sorted(_motor_links(view, conns).items()):
        driver_id, _, motor_port = links[0]
        supply = _driver_motor_supply(view, conns, driver_id)
        ids = [motor_id, driver_id]
        if supply is None:
            rule.unknown(f"No motor supply found for the driver feeding {motor_id}", ids)
            continue
        supply_id, src = supply
        ids.append(supply_id)
        _judge_range(rule, f"{supply_id} supply on {motor_id}", (src.voltage_min_v, src.voltage_max_v),
                     (motor_port.voltage_min_v, motor_port.voltage_max_v), ids, view.urls(ids), view.ratings_verified(ids))
    return rule.result()


def _motor_channels(view, conns):
    """Each motor needs two distinct driver outputs, and no output may feed two motors."""
    rule = Rule("electrical.motor_channels", pass_message="Each motor has its own pair of driver outputs")
    links = _motor_links(view, conns)
    feeds: dict[tuple[str, str], set[str]] = defaultdict(set)
    for motor_id, motor_links in sorted(links.items()):
        outputs = {(d, port.port_id) for d, port, _ in motor_links}
        terminals = {m.port_id for _, _, m in motor_links}
        for out in outputs:
            feeds[out].add(motor_id)
        if len(outputs) < 2 or len(terminals) < 2:
            rule.fail(f"{motor_id} is not driven by two distinct driver outputs on two terminals", [motor_id])
        else:
            rule.ok([motor_id])
    for (driver_id, port_id), motors in sorted(feeds.items()):
        if len(motors) > 1:
            rule.fail(f"{driver_id}.{port_id} drives more than one motor: {', '.join(sorted(motors))}", sorted(motors) + [driver_id])
    for m in view.role("motor"):
        if m.instance_id not in links:
            rule.fail(f"{m.instance_id} is not connected to any driver output", [m.instance_id])
    return rule.result()


def _motor_current(view, conns):
    rule = Rule("electrical.motor_driver_current", pass_message="Driver outputs cover the motors' stall current")
    for motor_id, links in sorted(_motor_links(view, conns).items()):
        driver_id = links[0][0]
        ids = sorted({motor_id} | {d for d, _, _ in links})
        stalls = [m.current_limit_a for _, _, m in links]
        conts = [d.current_limit_a for _, d, _ in links]
        if None in stalls:
            rule.unknown(f"Cannot confirm stall-current margin because {motor_id}'s stall-current rating is not sourced", ids, view.urls(ids))
            continue
        if None in conts:
            rule.unknown(f"Cannot confirm stall-current margin because the {driver_id} outputs for {motor_id} have no current rating", ids, view.urls(ids))
            continue
        stall, cont = max(stalls), min(conts)
        if not view.ratings_verified(ids):
            rule.unknown(f"Cannot confirm stall-current margin from unverified ratings for {motor_id} and {driver_id}", ids, view.urls(ids))
        elif stall <= cont:
            rule.ok(ids, view.urls(ids))
        else:
            rule.fail(
                f"{motor_id} stall current {stall} A exceeds the {driver_id} continuous rating {cont} A; "
                "no validated stall-duration limit or current protection is modeled",
                ids,
                view.urls(ids),
            )
    return rule.result()


def _ground(view, conns):
    rule = Rule("electrical.common_ground", pass_message="All grounded parts share one ground net")
    parent: dict[str, str] = {}

    def find(x):
        while parent.setdefault(x, x) != x:
            x = parent[x]
        return x

    grounded = set()
    for conn in conns:
        a, b = _ports(view, conn)
        if a.signal == b.signal == "ground":
            grounded |= {conn.from_.instance_id, conn.to.instance_id}
            parent[find(conn.from_.instance_id)] = find(conn.to.instance_id)
    wired = {e.instance_id for c in conns for e in (c.from_, c.to)}
    needs = sorted(
        iid for iid in wired if (comp := view.component(iid)) is not None and any(p.signal == "ground" for p in comp.ports)
    )
    missing = [iid for iid in needs if iid not in grounded]
    if missing:
        rule.fail("Ground not connected for: " + ", ".join(missing), missing)
    groups = {find(i) for i in grounded}
    if len(groups) > 1:
        rule.fail(f"Ground is split into {len(groups)} separate nets", sorted(grounded))
    rule.ok(needs)
    return rule.result()


def _required_ports(view, conns):
    rule = Rule("electrical.required_connections", pass_message="Every required power, motor and control port is wired")
    used = {(e.instance_id, e.port_id) for c in conns for e in (c.from_, c.to)}
    for c in view.plan.components:
        comp = view.component(c.instance_id)
        if comp is None or c.role == "accessory":
            continue
        required = [p for p in comp.ports if p.signal in ("power_in", "motor_power")]
        if c.role == "motor_driver":
            required += [p for p in comp.ports if p.signal in ("pwm_input", "digital_input")]
        if c.role == "distance_sensor":
            required += [p for p in comp.ports if p.signal in ("i2c_sda", "i2c_scl")]
        if c.role == "controller":
            # a controller needs exactly one of its power inputs
            powered = [p for p in comp.ports if p.signal == "power_in" and (c.instance_id, p.port_id) in used]
            required = [p for p in required if p.signal != "power_in"]
            if not powered:
                rule.fail(f"{c.instance_id} has no power input wired", [c.instance_id])
        for p in required:
            if (c.instance_id, p.port_id) not in used:
                rule.fail(f"{c.instance_id}.{p.port_id} ({p.signal}) is not connected", [c.instance_id])
        rule.ok([c.instance_id])
    return rule.result()


def _i2c(view, conns):
    rule = Rule("electrical.i2c_addresses", pass_message="I2C devices have distinct addresses")
    devices = sorted(
        {e.instance_id for c in conns for e in (c.from_, c.to) if view.port(e.instance_id, e.port_id).signal == "i2c_sda"}
    )
    addresses: dict[str, list[str]] = defaultdict(list)
    for iid in devices:
        port = next(p for p in view.component(iid).ports if p.signal == "i2c_sda")
        match = _ADDRESS.search(port.notes)
        if match:
            addresses[match.group(1).lower()].append(iid)
        else:
            rule.unknown(f"{iid} has no documented I2C address", [iid], severity="advisory")
    rule.applicable = bool(devices)
    for address, ids in sorted(addresses.items()):
        if len(ids) > 1:
            rule.fail(f"{len(ids)} devices share I2C address {address}", ids)
        else:
            rule.ok(ids)
    return rule.result()


def _capacity(view, conns):
    """A supply passes only if its rating covers a documented load: for each part it powers,
    a driver counts as the summed stall current of its motors, any other part as the
    documented maximum draw (current_limit_a) of its power input."""
    rule = Rule("electrical.supply_capacity", pass_message="Supplies cover their documented load")
    links = _motor_links(view, conns)
    for c in view.plan.components:
        comp = view.component(c.instance_id)
        if comp is None or comp.identity.category != "power_supply":
            continue
        outs = [p for p in comp.ports if p.signal == "power_output"]
        loads: dict[str, float | None] = {}
        for load_id, load_port in _powered_by(view, conns, c.instance_id):
            load_comp = view.component(load_id)
            if load_comp.identity.category == "motor_driver":
                for m, ls in links.items():
                    if any(d == load_id for d, _, _ in ls):
                        stall = [p.current_limit_a for _, _, p in ls]
                        loads[m] = None if None in stall else max(stall)
            else:
                loads[load_id] = load_port.current_limit_a
        ids = [c.instance_id] + sorted(loads)
        if not outs or any(p.current_limit_a is None for p in outs):
            rule.unknown(f"{c.instance_id} ({comp.identity.model}) has no documented current capacity", ids, severity="advisory")
        elif not loads:
            rule.unknown(f"{c.instance_id} powers nothing that is wired", ids, severity="advisory")
        elif None in loads.values():
            missing = sorted(k for k, v in loads.items() if v is None)
            rule.unknown(f"{c.instance_id}: current draw of {', '.join(missing)} is not documented", ids, severity="advisory")
        else:
            capacity, load = min(p.current_limit_a for p in outs), sum(loads.values())
            if capacity < load:
                rule.fail(f"{c.instance_id} supplies {capacity} A but its loads can draw {round(load, 3)} A combined", ids, view.urls([c.instance_id]))
            else:
                rule.ok(ids, view.urls([c.instance_id]))
    return rule.result()


def _powered_by(view, conns, supply_id: str):
    """(instance_id, power_in port) pairs wired to this supply's output."""
    out = []
    for conn in conns:
        for end, other in ((conn.from_, conn.to), (conn.to, conn.from_)):
            if end.instance_id == supply_id and view.port(end.instance_id, end.port_id).signal == "power_output":
                port = view.port(other.instance_id, other.port_id)
                if port.signal == "power_in":
                    out.append((other.instance_id, port))
    return sorted(out, key=lambda x: (x[0], x[1].port_id))
