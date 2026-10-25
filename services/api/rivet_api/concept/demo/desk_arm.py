"""Desk robot arm (community build): white links with orange joint caps on a round black base,
an orange turntable, a two-finger gripper, and a purple block on the desk beside it."""

import math

from rivet_api.concept.demo.kit import ALONG_X, ALONG_Z, Kit

WHITE = "#f1f0ec"
ORANGE = "#ef8a3c"
BLACK = "#1d1e21"
GREY = "#c9c9c4"
PURPLE = "#7b5cf0"

SHOULDER = (0.0, 100.0, 0.0)
ELBOW = (36.0, 238.0, 0.0)
WRIST = (-92.0, 262.0, 0.0)


def build():
    k = Kit()

    # Round black base, white ring, orange turntable.
    k.add("Base", "frame", "cylinder", (170, 22, 170), (0, 11, 0), color=BLACK)
    k.add("Base edge", "frame", "torus", (172, 4, 172), (0, 20, 0), color="#121315")
    k.add("Base ring", "frame", "cylinder", (132, 10, 132), (0, 27, 0), color=WHITE)
    k.add("Turntable", "frame", "cylinder", (108, 10, 108), (0, 37, 0), color=ORANGE)
    k.add("Turntable bearing", "frame", "torus", (84, 3, 84), (0, 42.5, 0), color=GREY, material="aluminum")
    for i in range(8):
        a = math.radians(i * 45 + 22.5)
        k.add("Base screw", "frame", "cylinder", (6, 2, 6), (math.cos(a) * 74, 22.5, math.sin(a) * 74), color=GREY, material="chrome")
    k.add("Status light", "light", "sphere", (7, 7, 7), (0, 18, 85), color="#58d68d", material="glossy_plastic")

    # Shoulder: white bracket with an orange joint cap on each side.
    k.add("Shoulder bracket", "frame", "rounded_box", (54, 58, 50), (0, 71, 0), color=WHITE)
    k.add("Shoulder joint", "motor", "cylinder", (46, 62, 46), SHOULDER, ALONG_Z, ORANGE)
    for s in (-1, 1):
        k.add("Shoulder cap", "motor", "cylinder", (30, 3, 30), (SHOULDER[0], SHOULDER[1], s * 32.5), ALONG_Z, "#d9722a")
        k.add("Shoulder cap screw", "motor", "cylinder", (6, 2, 6), (SHOULDER[0], SHOULDER[1], s * 34.5), ALONG_Z, GREY, "chrome")

    # Upper arm: white link with a black cable along its back.
    k.rod("Upper arm", "arm", SHOULDER, ELBOW, 34, 30, color=WHITE, shape="rounded_box")
    k.rod("Upper arm cover", "arm", (8, 130, 0), (30, 205, 0), 24, 32, color="#e6e4de", shape="rounded_box")
    k.polyline("Arm cable", "cable", [(-16, 96, -18), (8, 170, -18), (24, 236, -18)], 5, color="#111214")

    # Elbow joint.
    k.add("Elbow joint", "motor", "cylinder", (40, 50, 40), ELBOW, ALONG_Z, ORANGE)
    for s in (-1, 1):
        k.add("Elbow cap", "motor", "cylinder", (26, 3, 26), (ELBOW[0], ELBOW[1], s * 26.5), ALONG_Z, "#d9722a")
        k.add("Elbow cap screw", "motor", "cylinder", (5, 2, 5), (ELBOW[0], ELBOW[1], s * 28.5), ALONG_Z, GREY, "chrome")

    # Forearm to the wrist.
    k.rod("Forearm", "arm", ELBOW, WRIST, 28, 26, color=WHITE, shape="rounded_box")
    k.rod("Forearm stripe", "arm", (10, 243, 0), (-60, 256, 0), 6, 27, color=ORANGE, shape="box")

    # Wrist: orange pitch joint, black roll collar, white palm.
    k.add("Wrist joint", "motor", "cylinder", (32, 38, 32), WRIST, ALONG_Z, ORANGE)
    k.add("Wrist collar", "motor", "cylinder", (26, 20, 26), (WRIST[0] - 22, WRIST[1], 0), ALONG_X, BLACK)
    k.add("Wrist collar ring", "motor", "torus", (27, 3, 27), (WRIST[0] - 30, WRIST[1], 0), (0, 0, 90), GREY, "aluminum")
    palm_x = WRIST[0] - 40
    k.add("Gripper palm", "gripper", "rounded_box", (16, 46, 32), (palm_x, WRIST[1], 0), color=WHITE)
    for s in (-1, 1):
        y = WRIST[1] + s * 12
        k.add("Gripper finger", "gripper", "box", (40, 9, 14), (palm_x - 27, y, 0), color=WHITE)
        k.add("Finger pad", "gripper", "box", (16, 3, 14), (palm_x - 39, y - s * 5.5, 0), color=ORANGE, material="rubber")
        k.add("Finger tip", "gripper", "rounded_box", (10, 11, 15), (palm_x - 50, y, 0), color=ORANGE)
        k.add("Finger rail", "gripper", "box", (24, 2, 16), (palm_x - 16, y + s * 5, 0), color=GREY, material="aluminum")

    # The block it picks up, on the desk beside the base.
    k.add("Purple block", "other", "rounded_box", (30, 30, 30), (72, 15, 88), (0, 20, 0), color=PURPLE)

    # Inferred internals.
    k.add("Base servo", "motor", "box", (36, 13, 28), (0, 12, 0), color="#101010", internal=True)
    k.add("Controller board", "board", "box", (80, 1.6, 50), (0, 3, 0), color="#1f6f3a", material="pcb", internal=True)
    k.add("Shoulder servo", "motor", "box", (36, 30, 22), (0, 68, 0), color="#101010", internal=True)
    k.add("Elbow servo", "motor", "box", (22, 22, 30), ELBOW, color="#101010", internal=True)
    k.add("Gripper servo", "motor", "box", (12, 22, 20), (palm_x, WRIST[1], 0), color="#101010", internal=True)
    k.wire("Board to base servo", "Controller board", "Base servo", "signal", "#f4d03f")
    k.wire("Board to shoulder servo", "Controller board", "Shoulder servo", "signal", "#f4d03f")
    k.wire("Board to elbow servo", "Controller board", "Elbow servo", "signal", "#f4d03f", via=[(24, 170, -18)])
    k.wire("Board to gripper servo", "Controller board", "Gripper servo", "signal", "#f4d03f", via=[(36, 238, -18), (-92, 262, -18)])

    return k.model(
        "Desk robot arm",
        "robot arm",
        "A white desk robot arm with orange joints on a round black base, with a two-finger gripper that picks up small blocks.",
        [
            "Hand-built model of the community build; sizes estimated for an arm about 30 cm tall",
            "Internal parts are typical for this kind of device, not seen in the picture",
        ],
    )
