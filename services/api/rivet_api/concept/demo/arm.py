"""Black desktop 6-axis robot arm: four-point star base plate, round pedestal with an aluminium
turntable ring, twin-plate upper arm with bearings, tube forearm, servo wrist with chrome bolts,
and a geared two-finger gripper; a small controller board is mounted beside the base."""

import math

from rivet_api.concept.demo.kit import ALONG_Z, Kit

BLACK = "#141416"
SATIN = "#1b1c1f"
ALU = "#b8bdc3"
CHROME = "#e3e6ea"

SHOULDER = (0.0, 176.0, 0.0)
KNEE = (20.0, 300.0, 0.0)
ELBOW = (50.0, 410.0, 0.0)
WRIST = (-122.0, 298.0, 0.0)


def _lerp(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


def build():
    k = Kit()

    # Star base plate with mounting holes.
    k.add("Base plate centre", "frame", "box", (96, 5, 96), (0, 2.5, 0), (0, 45, 0), color=BLACK)
    for i, deg in enumerate((45, 135, 225, 315)):
        dx, dz = math.cos(math.radians(deg)), math.sin(math.radians(deg))
        k.rod("Base plate arm", "frame", (dx * 20, 2.5, dz * 20), (dx * 150, 2.5, dz * 150), 40, 5, color=BLACK, shape="box")
        k.add("Base plate arm tip", "frame", "cylinder", (40, 5, 40), (dx * 150, 2.5, dz * 150), color=BLACK)
        for r in (95, 120, 145):
            k.add("Base plate hole", "frame", "cylinder", (5, 5.4, 5), (dx * r, 2.6, dz * r), color="#050505")

    # Pedestal, aluminium ring and turntable.
    k.add("Pedestal", "frame", "cylinder", (112, 62, 112), (0, 36, 0), color=SATIN)
    k.add("Pedestal band", "frame", "torus", (113, 3, 113), (0, 50, 0), color="#0e0e10")
    k.add("Turntable ring", "frame", "cylinder", (116, 3, 116), (0, 68.5, 0), color=ALU, material="aluminum")
    k.add("Turntable", "frame", "cylinder", (108, 14, 108), (0, 77, 0), color=BLACK)
    k.add("Turntable bearing", "frame", "torus", (60, 3, 60), (0, 84.5, 0), color=ALU, material="aluminum")

    # Shoulder block and twin side plates with the shoulder bearing.
    k.add("Shoulder servo block", "motor", "rounded_box", (72, 34, 64), (6, 101, 0), color=SATIN)
    k.add("Shoulder servo", "motor", "box", (40, 40, 22), (0, 138, 0), color=BLACK)
    for s in (-1, 1):
        z = s * 34
        k.add("Shoulder side plate", "frame", "box", (86, 76, 6), (8, 136, z), color=BLACK)
        k.add("Shoulder plate top", "frame", "cylinder", (60, 6, 60), (4, SHOULDER[1], z), ALONG_Z, BLACK)
        k.add("Shoulder bearing", "frame", "torus", (22, 5, 22), (SHOULDER[0], SHOULDER[1], z + s * 3.6), ALONG_Z, ALU, "aluminum")
        k.add("Shoulder bearing hub", "frame", "cylinder", (12, 4, 12), (SHOULDER[0], SHOULDER[1], z + s * 4), ALONG_Z, CHROME, "chrome")
        for dx, dy in ((26, -22), (26, 22), (-18, -30)):
            k.add("Plate screw", "frame", "cylinder", (4, 2, 4), (dx, 136 + dy, z + s * 3.6), ALONG_Z, CHROME, "chrome")

    # Upper arm: two parallel plates with a dog-leg, joined by spacers.
    for s in (-1, 1):
        z = s * 25
        k.rod("Upper arm plate lower", "arm", (SHOULDER[0] - 2, SHOULDER[1] - 6, z), (KNEE[0], KNEE[1], z), 6, 44, color=BLACK, shape="box")
        k.rod("Upper arm plate upper", "arm", (KNEE[0] - 1, KNEE[1] - 6, z), (ELBOW[0], ELBOW[1], z), 6, 40, color=BLACK, shape="box")
        k.add("Knee boss", "arm", "cylinder", (40, 6, 40), (KNEE[0], KNEE[1], z), ALONG_Z, BLACK)
        k.add("Elbow plate end", "arm", "cylinder", (40, 6, 40), (ELBOW[0], ELBOW[1], z), ALONG_Z, BLACK)
    for t in (0.25, 0.6):
        k.add("Upper arm spacer", "arm", "cylinder", (8, 44, 8), _lerp(SHOULDER, KNEE, t), ALONG_Z, "#0d0d0f")
    k.rod("Upper arm stiffener", "arm", _lerp(SHOULDER, KNEE, 0.15), _lerp(KNEE, ELBOW, 0.7), 16, color="#0f0f11")

    # Elbow servo with its label, and the round elbow horn.
    k.add("Elbow servo", "motor", "box", (42, 22, 40), (ELBOW[0] - 6, ELBOW[1] - 6, 0), (0, 0, -14), color=BLACK)
    k.add("Elbow servo label", "panel", "box", (26, 0.6, 30), (ELBOW[0] - 8, ELBOW[1] + 5.4, 0), (0, 0, -14), color="#e9e6d4")
    k.add("Elbow servo label print", "panel", "box", (16, 0.7, 4), (ELBOW[0] - 8, ELBOW[1] + 5.6, -6), (0, 0, -14), color="#2f8f4e")
    for s in (-1, 1):
        k.add("Elbow horn", "arm", "cylinder", (30, 5, 30), (ELBOW[0], ELBOW[1], s * 30), ALONG_Z, "#101012")
        for a in range(0, 360, 90):
            r = math.radians(a + 45)
            k.add("Elbow horn screw", "arm", "cylinder", (3.5, 2, 3.5), (ELBOW[0] + math.cos(r) * 8, ELBOW[1] + math.sin(r) * 8, s * 33), ALONG_Z, CHROME, "chrome")

    # Forearm: black tube in a clamp bracket, running down to the wrist.
    k.add("Forearm clamp", "arm", "rounded_box", (34, 34, 30), _lerp(ELBOW, WRIST, 0.12), (0, 0, 33), color=BLACK)
    k.rod("Forearm tube", "arm", _lerp(ELBOW, WRIST, 0.05), _lerp(ELBOW, WRIST, 0.9), 26, color="#0e0e10", material="glossy_plastic")
    k.add("Forearm end cap", "arm", "rounded_box", (30, 30, 30), _lerp(ELBOW, WRIST, 0.88), (0, 0, 33), color=BLACK)

    # Wrist pitch servo with the chrome bolt cross, then the wrist roll servo.
    wx, wy, wz = WRIST
    k.add("Wrist bracket", "arm", "box", (36, 44, 6), (wx + 4, wy, 16), color=BLACK)
    k.add("Wrist bracket back", "arm", "box", (36, 44, 6), (wx + 4, wy, -16), color=BLACK)
    k.add("Wrist pitch servo", "motor", "box", (40, 40, 26), (wx - 4, wy - 4, 0), color=BLACK)
    k.add("Wrist horn plate", "arm", "cylinder", (26, 4, 26), (wx, wy, 21), ALONG_Z, "#121214")
    for dx, dy in ((0, 0), (6.5, 0), (-6.5, 0), (0, 6.5), (0, -6.5)):
        k.add("Wrist bolt", "arm", "cylinder", (4.6, 3, 4.6), (wx + dx, wy + dy, 24), ALONG_Z, CHROME, "chrome")
    roll_x = wx - 36
    k.add("Wrist roll servo", "motor", "box", (34, 30, 34), (roll_x, wy + 6, 0), color=BLACK)
    k.add("Wrist roll horn", "arm", "cylinder", (20, 4, 20), (roll_x - 18, wy + 6, 0), (0, 0, 90), color="#121214")

    # Gripper: upright back plate, gear pair, linkage rods and two fingers.
    gx = roll_x - 22  # the back plate bolts onto the roll horn
    k.add("Gripper back plate", "gripper", "box", (6, 62, 30), (gx, wy + 28, 0), color=BLACK)
    k.add("Gripper plate slot", "gripper", "box", (6.4, 26, 8), (gx, wy + 40, 0), color="#050505")
    k.add("Gripper servo", "motor", "box", (30, 24, 32), (gx - 16, wy + 4, 0), color=BLACK)
    for s in (-1, 1):
        gear = (gx - 20, wy - 12, s * 9)
        k.add("Gripper gear", "gripper", "cylinder", (17, 6, 17), gear, color="#1c1d20")
        for i in range(12):
            a = math.radians(i * 30 + (15 if s > 0 else 0))
            k.add("Gear tooth", "gripper", "box", (3, 6, 2.4), (gear[0] + math.cos(a) * 9, gear[1], gear[2] + math.sin(a) * 9), (0, -math.degrees(a), 0), color="#1c1d20")
        for dy in (-3, 5):
            k.rod("Gripper linkage", "gripper", (gx - 18, wy - 10 + dy, s * 6), (gx - 56, wy - 8 + dy, s * 13), 3, color=ALU, material="aluminum")
        k.add("Gripper finger", "gripper", "box", (36, 12, 9), (gx - 70, wy - 6, s * 14), color=BLACK)
        k.add("Gripper finger tip", "gripper", "box", (16, 16, 11), (gx - 92, wy - 6, s * 14), color=BLACK)
        k.add("Finger pivot", "gripper", "cylinder", (5, 12, 5), (gx - 54, wy - 6, s * 14), color=CHROME, material="chrome")

    # Visible cables: one up the back of the upper arm, servo leads at the wrist, and the base loom.
    k.polyline("Arm cable", "cable", [(30, 120, -42), (34, 200, -40), (44, 300, -36), (58, 392, -26)], 3, color="#0b0b0b")
    k.polyline("Wrist servo lead red", "cable", [(roll_x + 4, wy + 22, 8), (roll_x + 16, wy + 40, 10), (wx + 10, wy + 30, 16)], 2, color="#c8202a")
    k.polyline("Wrist servo lead white", "cable", [(roll_x + 6, wy + 22, 5), (roll_x + 18, wy + 38, 6), (wx + 12, wy + 28, 12)], 2, color="#eeeeee")
    k.polyline("Base cable loom", "cable", [(40, 60, 40), (62, 30, 70), (80, 22, 86)], 4, color="#0b0b0b")
    k.polyline("Base cable loop", "cable", [(-20, 60, 52), (-10, 20, 80), (30, 14, 88), (70, 22, 86)], 3, color="#0b0b0b")

    # Controller board on a bracket over the front-right base arm.
    board_c = (96, 34, 92)
    k.add("Board bracket", "frame", "box", (12, 30, 6), (88, 18, 84), (0, -45, 0), color=BLACK)
    k.add("Controller board", "board", "box", (46, 3, 34), board_c, (0, -45, 38), color="#1a1b1d", material="pcb")
    for i, (dx, dz) in enumerate(((-12, -8), (-2, -8), (8, -8))):
        k.add("Servo header", "board", "box", (7, 6, 8), (board_c[0] + dx * 0.7, board_c[1] + 5, board_c[2] + dz * 0.5 + dx * 0.7), (0, -45, 38), color="#f2f2f2")
    k.add("Board USB port", "board", "box", (9, 4, 7), (board_c[0] + 12, board_c[1] + 8, board_c[2] + 12), (0, -45, 38), color=CHROME, material="chrome")
    k.add("Board module", "board", "box", (16, 2.4, 14), (board_c[0] - 2, board_c[1] + 4, board_c[2] + 2), (0, -45, 38), color="#c9bfa6", material="metal")

    # Inferred internals: base servo and power board in the pedestal. The servo cables are the
    # visible cables above, so no extra wires are drawn through the open frame.
    k.add("Base rotation servo", "motor", "box", (40, 40, 22), (0, 40, 0), color="#101010", internal=True)
    k.add("Power regulator board", "board", "box", (60, 1.6, 40), (0, 14, 0), color="#1f6f3a", material="pcb", internal=True)

    return k.model(
        "Desktop 6-axis robot arm",
        "robot arm",
        "A black desktop robot arm: star base plate, round pedestal with an aluminium turntable ring, twin-plate upper arm, "
        "tube forearm, servo wrist with chrome bolts and a geared two-finger gripper, with a controller board by the base.",
        [
            "Hand-built model of the uploaded photo; sizes estimated for an arm about 45 cm tall",
            "Internal parts are typical for this kind of device, not seen in the photo",
        ],
    )
