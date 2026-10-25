"""Grey quadruped robot dog (Unitree Go2 style): long rounded torso, black sensor face with a ribbed
lidar dome under the chin, aluminium-capped hip and thigh actuators, curved thighs and slim shins
ending in black rubber feet; a side battery bay with green status LEDs."""

import math

from rivet_api.concept.demo.kit import ALONG_X, ALONG_Z, Kit

SHELL = "#a9aeb4"
SHELL_LIGHT = "#bfc3c8"
LEG = "#c9ccd0"
DARK = "#2a2c30"
BLACK = "#121314"
ALU = "#d4d7db"

BODY_Y = 330.0
BODY_L, BODY_W, BODY_H = 440.0, 196.0, 112.0
HIP_Z = 168.0
HIP_X = 66.0  # abduction actuators sit inside the body width
THIGH_X = 132.0


def _leg(k: Kit, label: str, sx: int, sz: int) -> None:
    hz = sz * HIP_Z
    # Hip abduction actuator: along the body axis, aluminium end cap facing out of the body end.
    k.add(f"{label} hip actuator", "motor", "cylinder", (92, 74, 92), (sx * HIP_X, BODY_Y - 4, hz + sz * 26), ALONG_Z, SHELL, "glossy_plastic")
    k.add(f"{label} hip end cap", "motor", "cylinder", (84, 10, 84), (sx * HIP_X, BODY_Y - 4, hz + sz * 66), ALONG_Z, ALU, "glossy_plastic")
    k.add(f"{label} hip cap ring", "motor", "torus", (86, 4, 86), (sx * HIP_X, BODY_Y - 4, hz + sz * 61), ALONG_Z, "#9a9fa5", "glossy_plastic")
    # Thigh actuator: lateral, outside the body, aluminium cap on its outer face.
    tx = sx * THIGH_X
    k.add(f"{label} thigh actuator", "motor", "cylinder", (100, 66, 100), (tx, BODY_Y - 10, hz), ALONG_X, SHELL_LIGHT, "glossy_plastic")
    k.add(f"{label} thigh motor cap", "motor", "cylinder", (88, 8, 88), (tx + sx * 36, BODY_Y - 10, hz), ALONG_X, ALU, "glossy_plastic")
    k.add(f"{label} thigh cap rim", "motor", "torus", (92, 5, 92), (tx + sx * 33, BODY_Y - 10, hz), ALONG_X, "#9a9fa5", "glossy_plastic")
    k.add(f"{label} thigh cap screw", "motor", "cylinder", (8, 3, 8), (tx + sx * 41, BODY_Y - 10, hz), ALONG_X, "#7d8288", "metal")
    # Thigh: thick, curving down and back to the knee; a cover hides the knee motor near the top.
    hip_c = (tx + sx * 6, BODY_Y - 24, hz)
    knee = (tx + sx * 8, 178.0, hz - 70)
    mid = (tx + sx * 10, 255.0, hz - 46)
    k.rod(f"{label} thigh upper", "leg", hip_c, mid, 46, 74, color=LEG, material="glossy_plastic", shape="rounded_box")
    k.rod(f"{label} thigh lower", "leg", mid, knee, 38, 50, color=LEG, material="glossy_plastic", shape="rounded_box")
    k.add(f"{label} thigh cover", "leg", "rounded_box", (50, 70, 96), (tx + sx * 8, BODY_Y - 52, hz - 10), (24, 0, 0), color=SHELL_LIGHT, material="glossy_plastic")
    k.add(f"{label} thigh screw", "leg", "cylinder", (5, 3, 5), (tx + sx * 34, 230, hz - 58), ALONG_X, "#7d8288", "metal")
    k.add(f"{label} knee joint", "leg", "cylinder", (34, 40, 34), knee, ALONG_X, DARK)
    k.add(f"{label} knee cap", "leg", "cylinder", (26, 4, 26), (knee[0] + sx * 21, knee[1], knee[2]), ALONG_X, "#5c6066", "metal")
    # Shin: slim and slightly bowed, down and forward to the foot.
    foot = (tx + sx * 4, 22.0, hz + 6)
    shin_mid = (tx + sx * 6, 104.0, hz - 46)
    k.rod(f"{label} shin upper", "leg", knee, shin_mid, 24, 30, color=LEG, material="glossy_plastic", shape="rounded_box")
    k.rod(f"{label} shin lower", "leg", shin_mid, (foot[0], foot[1] + 14, foot[2]), 20, 24, color=LEG, material="glossy_plastic", shape="rounded_box")
    k.add(f"{label} shin dot", "leg", "cylinder", (5, 2, 5), (shin_mid[0] + sx * 12.5, shin_mid[1] + 20, shin_mid[2] + 4), ALONG_X, "#5c6066")
    k.add(f"{label} foot", "leg", "sphere", (40, 38, 40), foot, color=BLACK, material="rubber")
    k.add(f"{label} foot collar", "leg", "cylinder", (28, 10, 28), (foot[0], foot[1] + 18, foot[2]), color=DARK)


def build():
    k = Kit()
    front = BODY_L / 2

    # Torso shell: main body, lighter top cover, belly pan and rear plate.
    k.add("Torso shell", "body", "rounded_box", (BODY_W, BODY_H, BODY_L), (0, BODY_Y, 0), color=SHELL, material="glossy_plastic")
    k.add("Top cover", "body", "rounded_box", (BODY_W - 26, 14, BODY_L - 60), (0, BODY_Y + BODY_H / 2 + 2, -10), color=SHELL_LIGHT, material="glossy_plastic")
    k.add("Top cover hatch", "body", "box", (70, 2, 50), (0, BODY_Y + BODY_H / 2 + 9.6, -70), color="#9ea3a9")
    k.add("Power button", "body", "cylinder", (26, 8, 26), (-40, BODY_Y + BODY_H / 2 + 6, front - 70), color=SHELL_LIGHT, material="glossy_plastic")
    k.add("Belly pan", "body", "rounded_box", (BODY_W - 40, 20, BODY_L - 80), (0, BODY_Y - BODY_H / 2 - 6, 0), color="#8d9298")
    k.add("Rear plate", "body", "rounded_box", (BODY_W - 30, BODY_H - 30, 14), (0, BODY_Y, -front - 2), color=SHELL_LIGHT, material="glossy_plastic")
    for s in (-1, 1):
        # Side cut-outs over the hips, shown as dark recesses.
        k.add("Hip recess", "body", "rounded_box", (6, 70, 90), (s * (BODY_W / 2 + 0.5), BODY_Y - 10, front - 70), color=DARK)
        k.add("Hip recess rear", "body", "rounded_box", (6, 70, 90), (s * (BODY_W / 2 + 0.5), BODY_Y - 10, -front + 70), color=DARK)
        # White wordmark strip and the "02" number decal.
        k.add("Side wordmark", "decal", "box", (1, 14, 100), (s * (BODY_W / 2 + 0.6), BODY_Y + 30, 30), color="#f4f5f6")
        k.add("Number decal", "decal", "box", (1, 18, 26), (s * (BODY_W / 2 + 0.6), BODY_Y + 2, front - 40), color="#f4f5f6")
        for i in range(4):
            k.add("Speed stripe", "decal", "box", (1, 22, 3), (s * (BODY_W / 2 + 0.6), BODY_Y + 2, front - 12 - i * 6), (-20, 0, 0), color="#f4f5f6")
    # Battery bay on the right flank with status LEDs.
    bay_x = BODY_W / 2 + 1
    k.add("Battery bay", "battery", "rounded_box", (4, 64, 120), (bay_x, BODY_Y - 6, -40), color="#9a9fa5")
    for z in (-70, -40):
        k.add("Battery latch slot", "battery", "box", (2, 26, 14), (bay_x + 2, BODY_Y - 6, z), color="#2b2d31")
    for i in range(3):
        k.add("Status LED", "light", "sphere", (4, 4, 4), (bay_x + 2.5, BODY_Y + 8 - i * 7, -22), color="#2fd36b", material="glossy_plastic")

    # Head: rounded nose block, black face panel with camera and sensor, lidar dome under the chin.
    k.add("Head", "body", "rounded_box", (150, 96, 60), (0, BODY_Y - 4, front + 20), color=SHELL, material="glossy_plastic")
    k.add("Face panel", "sensor", "rounded_box", (52, 74, 6), (0, BODY_Y + 2, front + 51), color=BLACK, material="glossy_plastic")
    k.add("Face camera", "camera", "cylinder", (20, 4, 20), (0, BODY_Y + 22, front + 55), ALONG_Z, "#0a0a0c", "glass")
    k.add("Face camera ring", "camera", "torus", (24, 3, 24), (0, BODY_Y + 22, front + 55), ALONG_Z, "#4a4d52", "metal")
    k.add("Face sensor", "sensor", "cylinder", (16, 4, 16), (0, BODY_Y - 8, front + 55), ALONG_Z, "#0a0a0c", "glass")
    k.add("Face sensor ring", "sensor", "torus", (19, 2.4, 19), (0, BODY_Y - 8, front + 55), ALONG_Z, "#e0e0e0", "metal")
    lidar_c = (0, BODY_Y - 72, front + 30)
    k.add("Lidar dome", "sensor", "sphere", (84, 60, 74), lidar_c, color="#16171a", material="glossy_plastic")
    k.add("Lidar base", "sensor", "cylinder", (90, 14, 80), (lidar_c[0], lidar_c[1] + 28, lidar_c[2]), color=BLACK)
    for i in range(8):
        a = math.radians(i * 45)
        k.add(
            "Lidar rib", "sensor", "box", (4, 52, 6), (lidar_c[0] + math.cos(a) * 42, lidar_c[1] - 2, lidar_c[2] + math.sin(a) * 37),
            (0, -i * 45, 0), color="#2a2c30",
        )

    legs = (("Front-left", -1, 1), ("Front-right", 1, 1), ("Rear-left", -1, -1), ("Rear-right", 1, -1))
    for label, sx, sz in legs:
        _leg(k, label, sx, sz)

    # Inferred internals: battery pack, motion controller, compute board and power distribution.
    battery = k.add("Battery pack", "battery", "box", (120, 60, 200), (0, BODY_Y - 10, -40), color="#3a3d44", internal=True)
    pdb = k.add("Power distribution board", "board", "box", (110, 1.6, 80), (0, BODY_Y - 44, 80), color="#1f6f3a", material="pcb", internal=True)
    mcu = k.add("Motion control board", "board", "box", (100, 1.6, 90), (0, BODY_Y + 30, 60), color="#1d4fa0", material="pcb", internal=True)
    compute = k.add("Compute module", "board", "box", (80, 10, 70), (0, BODY_Y + 30, -60), color="#141414", material="pcb", internal=True)
    imu = k.add("IMU", "sensor", "box", (24, 6, 24), (0, BODY_Y + 26, 0), color="#7a2a8f", internal=True)
    k.wire("Battery to power board", battery, pdb, "power", "#d01f1f", 3)
    k.wire("Power board to motion control", pdb, mcu, "power", "#d01f1f", 2)
    k.wire("Motion control to compute", mcu, compute, "data", "#2b6fd6", 1.5)
    k.wire("Compute to IMU", compute, imu, "signal", "#f2c200", 1.2)
    k.wire("Compute to lidar", compute, "Lidar dome", "data", "#2b6fd6", 1.5, via=[(0, BODY_Y - 30, front - 20)])
    k.wire("Compute to face camera", compute, "Face camera", "data", "#2b6fd6", 1.5, via=[(0, BODY_Y + 20, front - 20)])
    # Leg power runs to each hip actuator, which sits inside the torso.
    for label, _, _ in legs:
        k.wire(f"Power to {label.lower()} leg", pdb, f"{label} hip actuator", "power", "#d01f1f", 2)

    return k.model(
        "Quadruped robot dog",
        "quadruped robot dog",
        "A grey four-legged robot dog: long rounded torso, black sensor face with a ribbed lidar dome under the chin, "
        "aluminium-capped hip and thigh actuators, curved thighs and slim shins on black rubber feet.",
        [
            "Hand-built model of the uploaded photo; sizes estimated for a robot dog about 70 cm long standing",
            "Internal parts are typical for this kind of device, not seen in the photo",
        ],
    )
