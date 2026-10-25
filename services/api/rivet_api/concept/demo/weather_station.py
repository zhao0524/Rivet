"""Desk weather station (community build): a white display unit showing the temperature, a grey
mast with a purple cup anemometer on top, and a white stacked-disc radiation shield housing the
temperature sensor, cabled to the mast."""

import math

from rivet_api.concept.demo.kit import ALONG_Z, Kit

WHITE = "#f3f2ee"
GREY = "#a9adb3"
PURPLE = "#7b5cf0"
ORANGE = "#ef8a3c"
SCREEN = "#16171b"

MAST = (0.0, -40.0)  # x, z
MAST_TOP = 320.0
SHIELD = (120.0, -40.0)


def build():
    k = Kit()
    mx, mz = MAST

    # Display unit at the front.
    face = 92.0
    k.add("Display unit", "body", "rounded_box", (176, 86, 54), (0, 43, 65), color=WHITE)
    k.add("Display foot", "body", "box", (150, 4, 46), (0, 2, 65), color="#dedcd6")
    k.add("Screen bezel", "panel", "rounded_box", (132, 60, 2), (-8, 46, face + 1), color="#0c0d10", material="glossy_plastic")
    k.add("Screen", "panel", "box", (122, 50, 1), (-8, 46, face + 2.4), color=SCREEN, material="glass")
    # Screen contents: a sun, the temperature as bars, and a wind-speed graph.
    k.add("Sun icon", "panel", "cylinder", (14, 1, 14), (-52, 52, face + 3.2), ALONG_Z, "#f5b82e")
    for i in range(8):
        a = math.radians(i * 45)
        k.add("Sun ray", "panel", "box", (2, 5, 1), (-52 + math.cos(a) * 11, 52 + math.sin(a) * 11, face + 3.2), (0, 0, i * 45 - 90), color="#f5b82e")
    # "21" as seven-segment digits.
    segments = {"a": (0, 10, 1), "b": (5, 5, 0), "c": (5, -5, 0), "d": (0, -10, 1), "e": (-5, -5, 0), "f": (-5, 5, 0), "g": (0, 0, 1)}
    for cx, lit in ((-26, "abged"), (-8, "bc")):
        for seg in lit:
            dx, dy, flat = segments[seg]
            size = (10, 3, 1) if flat else (3, 10, 1)
            k.add("Temperature digit", "panel", "box", size, (cx + dx, 46 + dy, face + 3.2), color="#f4f4f4")
    k.add("Degree mark", "panel", "torus", (5, 1.4, 5), (4, 56, face + 3.2), (90, 0, 0), color="#f4f4f4")
    for i, h in enumerate((8, 12, 16, 22, 28)):
        k.add("Wind bar", "panel", "box", (4, h, 1), (22 + i * 7, 32 + h / 2, face + 3.2), color="#8f7cf5")
    k.add("Button", "other", "cylinder", (10, 4, 10), (60, 88, 70), color=ORANGE)
    k.add("Light sensor", "sensor", "cylinder", (6, 2, 6), (70, 46, face + 1), ALONG_Z, "#2a2a2a")

    # Mast clamped to the back of the display, on a round foot.
    k.add("Mast foot", "frame", "cylinder", (70, 8, 70), (mx, 4, mz), color="#2a2b2e")
    k.add("Mast", "frame", "cylinder", (14, MAST_TOP - 8, 14), (mx, 8 + (MAST_TOP - 8) / 2, mz), color=GREY, material="aluminum")
    k.add("Mast clamp", "frame", "box", (26, 26, 84), (mx, 60, 0), color="#2a2b2e")
    k.add("Mast collar", "frame", "torus", (18, 4, 18), (mx, 200, mz), color="#2a2b2e")
    k.add("Wind vane", "sensor", "sphere", (14, 14, 14), (mx + 12, 260, mz + 10), color=ORANGE)
    k.add("Vane fin", "sensor", "box", (2, 20, 14), (mx + 9, 268, mz + 4), (0, 30, 0), color=ORANGE)

    # Cup anemometer on top.
    hub_y = MAST_TOP + 10
    k.add("Anemometer hub", "sensor", "cylinder", (26, 20, 26), (mx, hub_y, mz), color=PURPLE)
    k.add("Anemometer cap", "sensor", "sphere", (24, 24, 24), (mx, hub_y + 12, mz), color=PURPLE, material="glossy_plastic")
    for i in range(3):
        a = math.radians(i * 120 + 15)
        cx, cz = mx + math.cos(a) * 76, mz + math.sin(a) * 76
        k.rod("Anemometer arm", "sensor", (mx, hub_y, mz), (cx, hub_y, cz), 4, color=GREY, material="aluminum")
        # The cup opens sideways, facing the wind as it turns.
        k.add("Anemometer cup", "sensor", "hemisphere", (34, 18, 34), (cx, hub_y, cz), (0, -math.degrees(a), 90), PURPLE, "glossy_plastic")

    # Radiation shield on its own short post, cabled to the mast.
    sx, sz = SHIELD
    k.add("Shield foot", "frame", "cylinder", (50, 6, 50), (sx, 3, sz), color="#2a2b2e")
    k.add("Shield post", "frame", "cylinder", (10, 130, 10), (sx, 70, sz), color="#2a2b2e")
    for i in range(6):
        k.add("Shield disc", "body", "cylinder", (96 - i * 4, 8, 96 - i * 4), (sx, 136 + i * 14, sz), color=WHITE)
        k.add("Shield spacer", "frame", "cylinder", (20, 6, 20), (sx, 143 + i * 14, sz), color="#e2e0da")
    k.add("Shield top", "body", "hemisphere", (76, 16, 76), (sx, 136 + 6 * 14 - 3, sz), color=WHITE)
    k.polyline("Sensor cable", "cable", [(mx + 7, 150, mz), (40, 128, mz + 6), (90, 118, sz + 6), (sx - 5, 110, sz)], 4, color="#1a1a1a")
    k.polyline("Display cable", "cable", [(mx + 7, 40, mz + 10), (mx + 30, 20, mz + 30), (60, 20, 40)], 4, color="#1a1a1a")
    for i in range(4):
        k.add("Display vent", "body", "box", (24, 2, 1), (60, 22 + i * 6, 92.2), color="#d6d4ce")

    # Inferred internals.
    k.add("Controller board", "board", "box", (110, 1.6, 36), (0, 20, 62), color="#2f8f4e", material="pcb", internal=True)
    k.add("Battery", "battery", "box", (60, 14, 24), (0, 66, 56), color="#2563eb", internal=True)
    k.add("Temperature sensor", "sensor", "box", (16, 8, 16), (sx, 160, sz), color="#7b3fe4", material="pcb", internal=True)
    k.add("Wind sensor board", "board", "box", (16, 1.6, 16), (mx, hub_y - 4, mz), color="#c0392b", material="pcb", internal=True)
    k.wire("Battery to board", "Battery", "Controller board", "power", "#d03030")
    k.wire("Board to temperature sensor", "Controller board", "Temperature sensor", "signal", "#f4d03f", via=[(mx, 60, mz), (90, 118, sz + 6)])
    k.wire("Board to wind sensor", "Controller board", "Wind sensor board", "signal", "#f4d03f", via=[(mx, 60, mz)])

    return k.model(
        "Desk weather station",
        "weather station",
        "A desk weather station: a white display showing the temperature and wind speed, a purple cup anemometer on a mast and a white radiation shield for the temperature sensor.",
        [
            "Hand-built model of the community build; sizes estimated for a station about 35 cm tall",
            "Internal parts are typical for this kind of device, not seen in the picture",
        ],
    )
