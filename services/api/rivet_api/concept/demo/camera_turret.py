"""Pan-tilt camera (community build): a dark base with an orange turntable, a blue pan servo, a black
U bracket with a blue tilt servo on its side, and a white camera body with a green board and a
black lens, with a red and black power lead leaving the base."""

import math

from rivet_api.concept.demo.kit import ALONG_X, ALONG_Z, Kit

BASE = "#2a2b2e"
ORANGE = "#f29a4a"
BLUE = "#3d7fe0"
BLACK = "#17181a"
WHITE = "#f3f2ee"

BASE_H = 30.0
TABLE_TOP = BASE_H + 8
BRACKET_Y = 84.0  # bracket floor
PIVOT_Y = 128.0  # tilt axis height


def build():
    k = Kit()

    # Base and turntable.
    k.add("Base", "body", "rounded_box", (170, BASE_H, 170), (0, BASE_H / 2, 0), color=BASE)
    k.add("Base top plate", "body", "box", (150, 2, 150), (0, BASE_H + 1, 0), color="#232427")
    for x in (-70, 70):
        for z in (-70, 70):
            k.add("Base screw", "frame", "cylinder", (7, 2, 7), (x, BASE_H + 1.5, z), color="#b8bcc2", material="chrome")
            k.add("Rubber foot", "other", "cylinder", (16, 3, 16), (x, 1.5, z), color="#101010", material="rubber")
    k.add("Power light", "light", "sphere", (6, 6, 6), (50, BASE_H / 2, 85), color="#58d68d", material="glossy_plastic")
    k.add("Turntable", "frame", "cylinder", (124, 8, 124), (0, BASE_H + 4, 0), color=ORANGE)
    k.add("Turntable edge", "frame", "torus", (125, 3, 125), (0, BASE_H + 4, 0), color="#e0853a")
    for i in range(12):
        a = math.radians(i * 30)
        k.add("Turntable tick", "frame", "box", (3, 1, 8), (math.cos(a) * 54, TABLE_TOP + 0.5, math.sin(a) * 54), (0, -math.degrees(a) + 90, 0), color="#d9722a")

    # Blue pan servo standing on the turntable.
    k.add("Pan servo", "motor", "box", (40, 38, 22), (0, TABLE_TOP + 19, 0), color=BLUE)
    for s in (-1, 1):
        k.add("Servo tab", "motor", "box", (8, 3, 22), (s * 24, TABLE_TOP + 28, 0), color=BLUE)
        k.add("Tab screw", "motor", "cylinder", (3, 4, 3), (s * 25, TABLE_TOP + 30, 0), color="#d0d0d0", material="chrome")
    k.add("Pan servo label", "panel", "box", (24, 14, 0.6), (0, TABLE_TOP + 17, 11.3), color="#e8eef8")
    k.add("Pan horn", "motor", "cylinder", (22, 8, 22), (0, TABLE_TOP + 40, 0), color=WHITE)

    # Black U bracket on the pan horn.
    k.add("Bracket floor", "frame", "box", (80, 4, 44), (0, BRACKET_Y, 0), color=BLACK)
    for s in (-1, 1):
        k.add("Bracket side", "frame", "box", (4, 64, 44), (s * 38, BRACKET_Y + 32, 0), color=BLACK)
        k.add("Pivot bearing", "frame", "cylinder", (14, 6, 14), (s * 41, PIVOT_Y, 0), ALONG_X, "#b8bcc2", "aluminum")

    # Blue tilt servo on the right side, horn turning the camera.
    k.add("Tilt servo", "motor", "box", (22, 40, 38), (54, PIVOT_Y - 8, 0), color=BLUE)
    k.add("Tilt servo label", "panel", "box", (0.6, 14, 24), (65.3, PIVOT_Y - 8, 0), color="#e8eef8")
    k.add("Tilt horn", "motor", "cylinder", (20, 4, 20), (67, PIVOT_Y, 0), ALONG_X, WHITE)
    k.add("Tilt horn screw", "motor", "cylinder", (5, 2, 5), (70, PIVOT_Y, 0), ALONG_X, "#d0d0d0", "chrome")

    # Camera: white housing between the bracket sides, green board on the front, black lens.
    k.add("Camera axle", "frame", "cylinder", (8, 76, 8), (0, PIVOT_Y, 0), ALONG_X, "#b8bcc2", "aluminum")
    k.add("Camera housing", "camera", "rounded_box", (58, 50, 66), (0, PIVOT_Y + 2, 0), color=WHITE)
    k.add("Camera board", "board", "box", (52, 46, 2), (0, PIVOT_Y + 2, 34), color="#2f8f4e", material="pcb")
    for x, y in ((-21, -18), (21, -18), (-21, 22), (21, 22)):
        k.add("Board screw", "board", "cylinder", (4, 2, 4), (x, PIVOT_Y + y, 35.5), ALONG_Z, "#d4b04a", "metal")
    k.add("Lens mount", "camera", "box", (24, 24, 6), (-6, PIVOT_Y + 4, 38), color="#141414")
    k.add("Lens barrel", "camera", "cylinder", (26, 22, 26), (-6, PIVOT_Y + 4, 52), ALONG_Z, "#0f1012")
    k.add("Lens ring", "camera", "torus", (27, 3, 27), (-6, PIVOT_Y + 4, 62), (90, 0, 0), color="#2a2c30")
    k.add("Lens glass", "camera", "cylinder", (18, 2, 18), (-6, PIVOT_Y + 4, 63.5), ALONG_Z, "#1d2f8a", "glass")
    k.add("Status LED", "light", "sphere", (4, 4, 4), (18, PIVOT_Y + 18, 36), color="#e45b5b", material="glossy_plastic")
    k.add("Ribbon cable", "cable", "box", (16, 1, 30), (0, PIVOT_Y + 27, 14), (-20, 0, 0), color="#e6d39a")

    # Leads: tilt servo cable down to the base, power lead out the back-left.
    k.polyline("Servo cable", "cable", [(60, PIVOT_Y - 26, -10), (70, 70, -30), (62, BASE_H + 2, -50)], 3, color="#111214")
    k.polyline("Power lead red", "cable", [(-84, 12, -30), (-120, 10, -40), (-160, 4, -30), (-200, 2, -44)], 3, color="#d03030")
    k.polyline("Power lead black", "cable", [(-84, 8, -24), (-122, 6, -34), (-162, 2, -24), (-198, 2, -36)], 3, color="#111214")

    # Inferred internals.
    k.add("Controller board", "board", "box", (110, 1.6, 90), (0, 6, 0), color="#1f6f3a", material="pcb", internal=True)
    k.add("Power regulator", "board", "box", (30, 8, 26), (40, 16, 40), color="#c0392b", material="pcb", internal=True)
    k.add("Camera module", "camera", "box", (30, 30, 20), (0, PIVOT_Y + 2, 16), color="#20232a", internal=True)
    k.wire("Regulator to board", "Power regulator", "Controller board", "power", "#d03030")
    k.wire("Board to pan servo", "Controller board", "Pan servo", "signal", "#f4d03f")
    k.wire("Board to tilt servo", "Controller board", "Tilt servo", "signal", "#f4d03f", via=[(62, BASE_H + 2, -50), (70, 70, -30)])
    k.wire("Board to camera", "Controller board", "Camera module", "data", "#3a8fd0", via=[(0, BRACKET_Y, -18)])

    return k.model(
        "Pan-tilt camera",
        "pan-tilt camera",
        "A camera on a black U bracket with blue pan and tilt servos, on an orange turntable over a dark base, so it can turn to look around the room.",
        [
            "Hand-built model of the community build; sizes estimated for a mount about 20 cm tall",
            "Internal parts are typical for this kind of device, not seen in the picture",
        ],
    )
