"""Line-following robot (community build): a round purple two-deck chassis on two black wheels with
yellow gearmotors, a green controller board on top, and an infrared sensor bar over a black tape
line on a white test mat."""

import math
from itertools import pairwise

from rivet_api.concept.demo.kit import ALONG_X, Kit

PURPLE = "#8a63f2"
PURPLE_DARK = "#7350dc"
BRASS = "#b48a3c"
YELLOW = "#f2d36b"
BLACK = "#17181a"
MAT = "#f4f4f2"

MAT_TOP = 4.0
WHEEL_D = 52.0
AXLE_Y = MAT_TOP + WHEEL_D / 2
LOWER = 32.0  # lower deck centre height
UPPER = 72.0


def build():
    k = Kit()

    # Test mat and the tape line curving under the robot.
    k.add("Test mat", "other", "box", (320, MAT_TOP, 320), (0, MAT_TOP / 2, 0), color=MAT)
    line = [(150, -140), (90, -110), (40, -40), (20, 40), (-10, 100), (-70, 122), (-150, 140)]
    for (x1, z1), (x2, z2) in pairwise(line):
        k.rod("Tape line", "other", (x1, MAT_TOP + 0.3, z1), (x2, MAT_TOP + 0.3, z2), 22, 0.6, color="#141414", shape="box")
    for (x, z) in line[1:-1]:
        k.add("Tape line joint", "other", "cylinder", (22, 0.6, 22), (x, MAT_TOP + 0.3, z), color="#141414")

    # Two purple decks on brass standoffs.
    k.add("Lower deck", "frame", "cylinder", (150, 4, 150), (0, LOWER, 0), color=PURPLE)
    k.add("Lower deck rim", "frame", "torus", (151, 3, 151), (0, LOWER, 0), color=PURPLE_DARK)
    k.add("Upper deck", "frame", "cylinder", (124, 4, 124), (0, UPPER, 0), color=PURPLE)
    k.add("Upper deck rim", "frame", "torus", (125, 3, 125), (0, UPPER, 0), color=PURPLE_DARK)
    for i in range(4):
        a = math.radians(i * 90 + 45)
        x, z = math.cos(a) * 48, math.sin(a) * 48
        k.add("Standoff", "frame", "cylinder", (6, UPPER - LOWER, 6), (x, (LOWER + UPPER) / 2, z), color=BRASS, material="metal")
        k.add("Standoff nut", "frame", "cylinder", (8, 2, 8), (x, UPPER + 3, z), color=BRASS, material="metal")

    # Battery strap and tape labels on the lower deck.
    k.add("Battery holder", "battery", "box", (70, 16, 30), (0, LOWER + 10, -10), color="#202124")
    for dx in (-26, 26):
        k.add("Yellow label", "panel", "box", (22, 0.6, 10), (dx, LOWER + 2.3, 38), (0, 20 if dx > 0 else -20, 0), color=YELLOW)

    # Wheels with yellow gearmotors under the lower deck.
    for s in (-1, 1):
        wx = s * 86
        k.add("Wheel", "wheel", "wheel", (16, WHEEL_D, WHEEL_D), (wx, AXLE_Y, 0), color=BLACK, material="rubber")
        k.add("Wheel hub", "wheel", "cylinder", (26, 3, 26), (wx + s * 8.5, AXLE_Y, 0), ALONG_X, YELLOW)
        k.add("Hub screw", "wheel", "cylinder", (5, 2, 5), (wx + s * 10.5, AXLE_Y, 0), ALONG_X, "#d0d0d0", "chrome")
        for i in range(10):
            a = math.radians(i * 36)
            k.add("Tread lug", "wheel", "box", (16, 3, 6), (wx, AXLE_Y + math.cos(a) * 26, math.sin(a) * 26), (-math.degrees(a), 0, 0), color="#0c0c0d", material="rubber")
        k.add("Gearmotor", "motor", "box", (40, 18, 22), (s * 56, AXLE_Y - 4, 0), color=YELLOW)
        k.add("Motor can", "motor", "cylinder", (18, 20, 18), (s * 30, AXLE_Y - 4, 0), ALONG_X, "#e8e8e6", "metal")
        k.add("Motor shaft", "motor", "cylinder", (5, 12, 5), (s * 77, AXLE_Y, 0), ALONG_X, "#d0d0d0", "chrome")
        k.add("Motor bracket", "frame", "box", (6, 8, 22), (s * 46, LOWER - 4, 0), color=PURPLE_DARK)

    # Ball caster at the back.
    k.add("Caster mount", "frame", "cylinder", (18, LOWER - 2 - 12, 18), (0, (LOWER - 2 + 12) / 2, -56), color="#2a2b2e")
    k.add("Caster ball", "wheel", "sphere", (14, 14, 14), (0, MAT_TOP + 7, -56), color="#d7d7d7", material="chrome")

    # Infrared sensor bar reaching out over the line at the front.
    k.add("Sensor bracket", "frame", "box", (14, 6, 34), (0, LOWER - 4, 80), color=PURPLE_DARK)
    k.add("Sensor bar", "sensor", "box", (96, 4, 14), (0, MAT_TOP + 10, 100), color=BLACK, material="pcb")
    k.add("Sensor riser", "frame", "box", (10, 18, 8), (0, MAT_TOP + 19, 94), color=PURPLE_DARK)
    for i in range(5):
        x = -36 + i * 18
        k.add("IR sensor", "sensor", "box", (8, 3, 7), (x, MAT_TOP + 6.5, 100), color="#f0b48a")
        k.add("IR LED", "light", "sphere", (4, 4, 4), (x, MAT_TOP + 12.5, 104), color="#e45b5b" if i == 2 else "#efe7da", material="glossy_plastic")

    # Controller board on the upper deck.
    top = UPPER + 2
    k.add("Controller board", "board", "box", (54, 2, 34), (0, top + 1, 0), color="#2f8f4e", material="pcb")
    k.add("Microcontroller", "board", "box", (14, 2, 14), (0, top + 3, 0), color="#1a1a1a")
    for s in (-1, 1):
        k.add("Header row", "board", "box", (46, 8, 3), (0, top + 6, s * 14), color="#151515")
        for j in range(6):
            k.add("Header pin", "board", "box", (1, 6, 1), (-20 + j * 8, top + 13, s * 14), color="#d4b04a", material="metal")
    k.add("USB port", "board", "box", (10, 4, 8), (24, top + 4, 0), color="#c8c8c8", material="chrome")
    k.polyline("Sensor cable", "cable", [(0, top + 2, 16), (0, LOWER + 6, 60), (0, MAT_TOP + 22, 96)], 2.5, color="#2f9e5c")

    # Inferred internals.
    k.add("Battery", "battery", "box", (60, 12, 22), (0, LOWER + 10, -10), color="#2563eb", internal=True)
    k.add("Motor driver", "board", "box", (30, 1.6, 26), (0, LOWER - 4, -34), color="#c0392b", material="pcb", internal=True)
    k.wire("Battery to driver", "Battery", "Motor driver", "power", "#d03030")
    k.wire("Driver to left motor", "Motor driver", "Gearmotor", "power", "#d03030")
    k.wire("Driver to right motor", "Motor driver", "Gearmotor 2", "power", "#d03030")
    k.wire("Board to driver", "Controller board", "Motor driver", "signal", "#f4d03f")

    return k.model(
        "Line-following robot",
        "line-following robot",
        "A small round purple robot on two wheels whose infrared sensor bar follows a black tape line on the floor.",
        [
            "Hand-built model of the community build; sizes estimated for a robot about 15 cm across",
            "Internal parts are typical for this kind of device, not seen in the picture",
        ],
    )
