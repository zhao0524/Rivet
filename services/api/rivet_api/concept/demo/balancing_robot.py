"""Self-balancing robot (community build): two large black wheels with orange hubs either side of a
black motor block, three white decks on brass standoffs, a green controller board with its IMU in
the middle, and a red battery pack and purple switch board on the top deck."""

import math
from itertools import pairwise

from rivet_api.concept.demo.kit import ALONG_X, ALONG_Z, Kit

WHITE = "#f3f2ee"
ORANGE = "#ef8a3c"
BLACK = "#17181a"
BRASS = "#b48a3c"
BLUE = "#3a6fe0"

WHEEL_D = 150.0
AXLE_Y = WHEEL_D / 2
WHEEL_X = 78.0
DECKS = (102.0, 182.0, 252.0)


def build():
    k = Kit()

    # Wheels: tyre, orange hub disc with spokes, and tread lugs around the tyre.
    for s in (-1, 1):
        wx = s * WHEEL_X
        k.add("Wheel", "wheel", "wheel", (30, WHEEL_D, WHEEL_D), (wx, AXLE_Y, 0), color=BLACK, material="rubber")
        k.add("Hub disc", "wheel", "cylinder", (104, 4, 104), (wx + s * 14, AXLE_Y, 0), ALONG_X, ORANGE)
        k.add("Hub cap", "wheel", "cylinder", (20, 6, 20), (wx + s * 17, AXLE_Y, 0), ALONG_X, "#d9722a")
        k.add("Hub screw", "wheel", "cylinder", (6, 2, 6), (wx + s * 20.5, AXLE_Y, 0), ALONG_X, "#d0d0d0", "chrome")
        for i in range(5):
            a = math.radians(i * 72)
            k.add("Hub spoke", "wheel", "box", (2, 44, 8), (wx + s * 16.5, AXLE_Y + math.cos(a) * 26, math.sin(a) * 26), (-math.degrees(a), 0, 0), color="#d9722a")
        for i in range(16):
            a = math.radians(i * 22.5)
            r = WHEEL_D / 2 - 1
            k.add("Tread lug", "wheel", "box", (30, 5, 9), (wx, AXLE_Y + math.cos(a) * r, math.sin(a) * r), (-math.degrees(a), 0, 0), color="#0c0c0d", material="rubber")
        k.add("Axle", "motor", "cylinder", (8, 20, 8), (s * 56, AXLE_Y, 0), ALONG_X, "#d0d0d0", "chrome")

    # Motor block between the wheels, with three blue motor end caps on its front.
    k.add("Motor block", "motor", "rounded_box", (96, 50, 54), (0, AXLE_Y, 0), color=BLACK)
    for i, x in enumerate((-24, 0, 24)):
        k.add("Motor end cap", "motor", "cylinder", (18, 4, 18), (x, AXLE_Y + 2, 28.5), ALONG_Z, BLUE)
        k.add("Motor end screw", "motor", "cylinder", (4, 2, 4), (x, AXLE_Y + 2, 31), ALONG_Z, "#d0d0d0", "chrome")
    k.add("Motor block strap", "frame", "box", (98, 6, 56), (0, AXLE_Y + 18, 0), color=WHITE)

    # Three white decks on brass standoffs.
    for i, y in enumerate(DECKS):
        k.add("Deck", "frame", "rounded_box", (112, 6, 72), (0, y, 0), color=WHITE)
    k.add("Deck mount", "frame", "box", (60, DECKS[0] - 3 - (AXLE_Y + 21), 30), (0, (DECKS[0] - 3 + AXLE_Y + 21) / 2, 0), color=WHITE)
    for lo, hi in pairwise(DECKS):
        for x in (-48, 48):
            for z in (-28, 28):
                k.add("Standoff", "frame", "cylinder", (6, hi - lo, 6), (x, (lo + hi) / 2, z), color=BRASS, material="metal")
    for x in (-48, 48):
        for z in (-28, 28):
            k.add("Standoff nut", "frame", "cylinder", (9, 3, 9), (x, DECKS[-1] + 4.5, z), color=BRASS, material="metal")

    # Controller board on the middle deck.
    top = DECKS[1] + 3
    k.add("Controller board", "board", "box", (84, 2, 42), (0, top + 1, 0), color="#2f8f4e", material="pcb")
    k.add("Microcontroller", "board", "box", (16, 2, 16), (-14, top + 3, 0), color="#1a1a1a")
    k.add("IMU", "sensor", "box", (14, 2, 14), (20, top + 3, 6), color="#7b3fe4", material="pcb")
    for s in (-1, 1):
        k.add("Header row", "board", "box", (70, 7, 3), (0, top + 5.5, s * 17), color="#151515")
        for j in range(8):
            k.add("Header pin", "board", "box", (1, 6, 1), (-31 + j * 9, top + 12, s * 17), color="#d4b04a", material="metal")

    # Top deck: red battery pack and the purple power switch board.
    top3 = DECKS[2] + 3
    k.add("Battery pack", "battery", "rounded_box", (44, 12, 24), (-18, top3 + 6, 0), color="#e2483d")
    k.add("Switch board", "board", "box", (32, 6, 24), (24, top3 + 3, 4), color="#8a63f2", material="pcb")
    k.add("Power switch", "other", "box", (9, 5, 7), (24, top3 + 8.5, 4), color="#141414")

    # Visible leads: red and yellow from the top deck down to the board, black from the motors.
    k.polyline("Battery lead", "cable", [(-40, top3 + 6, 6), (-58, DECKS[2] - 20, 10), (-50, top + 4, 12), (-36, top + 2, 12)], 3, color="#d03030")
    k.polyline("Switch lead", "cable", [(24, top3, -8), (34, DECKS[2] - 22, -12), (30, top + 4, -12)], 2.5, color="#f2d36b")
    k.polyline("Motor lead", "cable", [(-46, AXLE_Y + 10, 20), (-60, DECKS[0] + 10, 30), (-52, top, 20)], 3, color="#111214")

    # Inferred internals.
    k.add("Battery cells", "battery", "box", (38, 8, 18), (-18, top3 + 6, 0), color="#2563eb", internal=True)
    k.add("Motor driver", "board", "box", (70, 1.6, 40), (0, AXLE_Y + 12, 0), color="#c0392b", material="pcb", internal=True)
    k.add("Left motor", "motor", "cylinder", (28, 34, 28), (-24, AXLE_Y - 6, 0), ALONG_X, "#6b6b6b", "metal", internal=True)
    k.add("Right motor", "motor", "cylinder", (28, 34, 28), (24, AXLE_Y - 6, 0), ALONG_X, "#6b6b6b", "metal", internal=True)
    k.wire("Battery to driver", "Battery cells", "Motor driver", "power", "#d03030", via=[(-58, 200, 10)])
    k.wire("Driver to left motor", "Motor driver", "Left motor", "power", "#d03030")
    k.wire("Driver to right motor", "Motor driver", "Right motor", "power", "#d03030")
    k.wire("Board to driver", "Controller board", "Motor driver", "signal", "#f4d03f")

    return k.model(
        "Self-balancing robot",
        "self-balancing robot",
        "A two-wheel robot with orange-hubbed wheels and three white decks that keeps itself upright with an IMU and two motors.",
        [
            "Hand-built model of the community build; sizes estimated for a robot about 26 cm tall",
            "Internal parts are typical for this kind of device, not seen in the picture",
        ],
    )
