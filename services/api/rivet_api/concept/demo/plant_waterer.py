"""Plant-watering helper (community build): a terracotta pot with a leafy plant and a purple soil
moisture probe, a clear water tank with a pump and white tube arching into the pot, and a small
green controller board on the table wired to the probe."""

import math

from rivet_api.concept.demo.kit import Kit

TERRACOTTA = "#d9784a"
TERRACOTTA_DARK = "#c4673c"
SOIL = "#6b4a2f"
LEAF = "#5fae58"
LEAF_LIGHT = "#8fcf7a"
STEM = "#3f8a3e"
PURPLE = "#7b5cf0"

POT_TOP = 150.0
TANK = (190.0, 0.0, 10.0)


def build():
    k = Kit()

    # Tapered pot as stacked bands, a rolled rim, and the soil.
    for i, d in enumerate((116, 124, 132, 140)):
        k.add("Pot wall", "body", "cylinder", (d, 32, d), (0, 16 + i * 32, 0), color=TERRACOTTA)
    k.add("Pot rim", "body", "cylinder", (162, 22, 162), (0, POT_TOP - 11, 0), color=TERRACOTTA)
    k.add("Rim lip", "body", "torus", (164, 5, 164), (0, POT_TOP - 1, 0), color=TERRACOTTA_DARK)
    k.add("Pot foot", "body", "cylinder", (110, 4, 110), (0, 2, 0), color=TERRACOTTA_DARK)
    k.add("Soil", "other", "cylinder", (150, 4, 150), (0, POT_TOP - 4, 0), color=SOIL, material="fabric")
    for i in range(6):
        a = math.radians(i * 60 + 10)
        k.add("Soil clump", "other", "sphere", (14, 6, 12), (math.cos(a) * 50, POT_TOP - 2, math.sin(a) * 50), color="#5a3d26", material="fabric")

    # Plant: stems from the soil, each ending in a long leaf.
    leaves = [(-70, 70, 30, 34), (-20, 95, -40, 20), (35, 85, 20, -30), (70, 60, -10, 10), (5, 110, 5, 0),
              (-45, 80, -10, -50), (50, 75, 45, 40), (-10, 65, 60, 15), (25, 100, -55, -15)]
    for i, (dx, rise, dz, _tilt) in enumerate(leaves):
        base = (dx * 0.12, POT_TOP - 2, dz * 0.12)
        tip = (dx * 0.6, POT_TOP + rise, dz * 0.6)
        k.rod("Stem", "other", base, tip, 4, color=STEM)
        k.rod("Leaf", "other", tip, (dx * 1.2, POT_TOP + rise + 30, dz * 1.2), 26, 4, color=LEAF if i % 2 else LEAF_LIGHT, shape="sphere")

    # Moisture probe pushed into the soil.
    k.add("Moisture probe", "sensor", "box", (12, 64, 3), (24, POT_TOP + 6, 30), color=PURPLE, material="pcb")
    for s in (-1, 1):
        k.add("Probe prong", "sensor", "box", (3, 40, 3.2), (24 + s * 3.5, POT_TOP - 26, 30), color="#d4b04a", material="metal")
    k.add("Probe connector", "sensor", "box", (10, 6, 6), (24, POT_TOP + 41, 30), color="#151515")

    # Water tank with water, a lid and the pump cap.
    tx, _, tz = TANK
    k.add("Water tank", "body", "rounded_box", (92, 120, 72), (tx, 60, tz), color="#cfe8f5", material="glass")
    k.add("Water", "other", "rounded_box", (86, 84, 66), (tx, 45, tz), color="#7cc4ea", material="glass")
    k.add("Tank lid", "body", "rounded_box", (96, 12, 76), (tx, 126, tz), color="#f3f2ee")
    k.add("Pump cap", "motor", "cylinder", (20, 14, 20), (tx, 139, tz), color="#1a1a1a")
    k.add("Water level mark", "panel", "box", (30, 2, 0.6), (tx, 90, tz + 36.2), color="#3a8fd0")

    # White tube from the pump up and over into the pot.
    tube = [(tx, 146, tz), (tx, 186, tz), (150, 214, 8), (90, 222, 6), (52, 200, 4), (40, POT_TOP + 4, 2)]
    k.polyline("Water tube", "other", tube, 8, color="#f4f4f2")
    k.add("Tube nozzle", "other", "cylinder", (10, 10, 10), (40, POT_TOP + 2, 2), color="#d0d0d0", material="chrome")

    # Controller board on the table in front, wired to the probe.
    bx, bz = 70.0, 150.0
    k.add("Controller board", "board", "box", (62, 2, 40), (bx, 1, bz), (0, -18, 0), color="#2f8f4e", material="pcb")
    k.add("Microcontroller", "board", "box", (14, 2, 14), (bx - 6, 3, bz), (0, -18, 0), color="#1a1a1a")
    for s in (-1, 1):
        k.add("Header row", "board", "box", (52, 6, 3), (bx + s * 5, 5, bz + s * 15), (0, -18, 0), color="#151515")
    for j in range(6):
        k.add("Header pin", "board", "box", (1, 5, 1), (bx - 20 + j * 8, 10, bz - 15 + j * 2.5), color="#d4b04a", material="metal")
    k.add("Relay", "board", "box", (16, 12, 14), (bx + 18, 8, bz + 2), (0, -18, 0), color="#2a62c9")
    k.polyline("Probe wire", "cable", [(24, POT_TOP + 44, 30), (40, POT_TOP + 30, 80), (56, 60, 120), (bx - 10, 4, bz - 10)], 2.5, color="#f2c94c")
    k.polyline("Pump wire", "cable", [(bx + 22, 8, bz - 8), (140, 6, 90), (tx - 30, 6, tz + 30)], 2.5, color="#1a1a1a")

    # Inferred internals.
    k.add("Pump", "motor", "box", (30, 36, 30), (tx, 22, tz), color="#2b2b2b", internal=True)
    k.add("Power regulator", "board", "box", (20, 1.6, 16), (tx, 126, tz), color="#c0392b", material="pcb", internal=True)
    k.wire("Relay to pump", "Relay", "Pump", "power", "#d03030")
    k.wire("Board to probe", "Controller board", "Moisture probe", "signal", "#f4d03f")
    k.wire("Regulator to pump", "Power regulator", "Pump", "power", "#d03030")

    return k.model(
        "Plant-watering helper",
        "plant watering helper",
        "A terracotta pot with a soil moisture probe and a water tank whose pump waters the plant through a white tube when the soil gets dry.",
        [
            "Hand-built model of the community build; sizes estimated for a pot about 16 cm across",
            "Internal parts are typical for this kind of device, not seen in the picture",
        ],
    )
