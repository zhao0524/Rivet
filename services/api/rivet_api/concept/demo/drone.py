"""Toy camera quadcopter ("DRONE II" style): glossy black body, X arms, ribbed motor pods,
red front and dark rear two-blade props, and open wire guards resting on the ground."""

import math

from rivet_api.concept.demo.kit import Kit, ring_points

BLACK = "#121316"
GLOSS = "#16171b"
MATTE = "#0f1012"
RED = "#d22a37"
DARK_PROP = "#33363b"
STRIPE = "#c3202c"

MOTOR_X, MOTOR_Z = 96.0, 96.0
GUARD_R, GUARD_Y = 70.0, 17.0
MOTOR_Y = 44.0
PROP_Y = 64.0


def build():
    k = Kit()

    # Body: long glossy shell with a rounded nose, ribbed battery pack at the rear.
    k.add("Body shell", "body", "rounded_box", (44, 30, 92), (0, 42, -4), color=GLOSS, material="glossy_plastic")
    k.add("Nose cap", "body", "sphere", (44, 30, 36), (0, 42, 40), color=GLOSS, material="glossy_plastic")
    k.add("Top canopy", "body", "rounded_box", (36, 8, 84), (0, 58, 2), color="#1c1d22", material="glossy_plastic")
    k.add("Belly plate", "body", "box", (40, 4, 88), (0, 25, -2), color=MATTE)
    k.add("Rear battery pack", "battery", "rounded_box", (42, 32, 28), (0, 38, -50), color=MATTE)
    for i in range(9):
        k.add("Battery pack rib", "body", "box", (1.4, 24, 1.2), (-16 + i * 4, 37, -64.4), color="#1b1c20")
    for side in (-1, 1):
        for i in range(5):
            k.add("Battery pack rib", "body", "box", (1.2, 24, 1.4), (side * 21.4, 37, -60 + i * 5), color="#1b1c20")
    k.add("Charging port", "other", "box", (8, 3, 1.2), (0, 29, -64.8), color="#050506")

    # Rear logo panel, tilted, with a red edge line and a white |X| mark.
    k.add("Logo panel", "panel", "box", (40, 1.2, 15), (0, 55.5, -41), (-22, 0, 0), color="#0b0c0e", material="glossy_plastic")
    k.add("Logo panel red edge", "panel", "box", (40.5, 1.4, 1.2), (0, 58.4, -34.2), (-22, 0, 0), color=STRIPE)
    for x in (-6.5, 6.5):
        k.add("Logo mark bar", "panel", "box", (1.2, 0.6, 9), (x, 56.3, -41.3), (-22, 0, 0), color="#e9e9e9")
    for yaw in (-36, 36):
        k.add("Logo mark cross", "panel", "box", (1.2, 0.6, 11), (0, 56.4, -41.3), (-22, yaw, 0), color="#e9e9e9")

    # Thin red pinstripes along the shell and a grey wordmark on top.
    for side in (-1, 1):
        k.add("Body pinstripe", "body", "box", (0.8, 1.4, 74), (side * 22.2, 50, -2), color=STRIPE)
    k.add("Top wordmark", "panel", "box", (3.5, 0.4, 28), (0, 62.2, 10), color="#5d6066")

    motors = {
        "Front-left": (-MOTOR_X, MOTOR_Z, RED, 62),
        "Front-right": (MOTOR_X, MOTOR_Z, RED, 118),
        "Rear-left": (-MOTOR_X, -MOTOR_Z, DARK_PROP, 40),
        "Rear-right": (MOTOR_X, -MOTOR_Z, DARK_PROP, 140),
    }
    motor_names = {}
    for label, (mx, mz, prop_color, prop_yaw) in motors.items():
        sx, sz = math.copysign(1, mx), math.copysign(1, mz)
        root = (sx * 19, 40, sz * 26)
        tip = (mx, 40, mz)
        k.rod(f"{label} arm", "arm", root, tip, 9, 7, color=BLACK, shape="box")
        k.rod(f"{label} arm stripe", "arm", (root[0], 43.6, root[2]), (mx - sx * 12, 43.6, mz - sz * 12), 1.1, 0.5, color=STRIPE, shape="box")

        motor_names[label] = k.add(f"{label} motor pod", "motor", "cylinder", (25, 22, 25), (mx, MOTOR_Y, mz), color=GLOSS, material="glossy_plastic")
        for j, y in enumerate((36.5, 40.5, 47.5)):
            k.add(f"{label} motor rib", "motor", "torus", (26.5 - j, 2.2, 26.5 - j), (mx, y, mz), color="#202226")
        k.add(f"{label} motor cap", "motor", "hemisphere", (21, 6, 21), (mx, 58, mz), color=GLOSS, material="glossy_plastic")
        k.add(f"{label} motor shaft", "motor", "cylinder", (3, 6, 3), (mx, 62.5, mz), color="#a9adb3", material="aluminum")
        # Two wide paddle blades on a narrow root, pitched about their long axis.
        prop_mat = "glossy_plastic" if prop_color == RED else "plastic"
        for half, pitch in ((0, 9), (180, -9)):
            yaw = prop_yaw + half
            dx, dz = math.sin(math.radians(yaw)), math.cos(math.radians(yaw))
            k.add(f"{label} propeller blade", "propeller", "rounded_box", (18, 2.6, 32), (mx + dx * 36, PROP_Y, mz + dz * 36), (0, yaw, pitch), color=prop_color, material=prop_mat)
            k.add(f"{label} propeller tip", "propeller", "cylinder", (18, 2.6, 18), (mx + dx * 51, PROP_Y, mz + dz * 51), (0, yaw, pitch), color=prop_color, material=prop_mat)
            k.add(f"{label} propeller root", "propeller", "box", (8, 3.2, 18), (mx + dx * 13, PROP_Y, mz + dz * 13), (0, yaw, pitch), color=prop_color, material=prop_mat)
            k.add(f"{label} propeller blade hole", "propeller", "cylinder", (2.2, 3, 2.2), (mx + dx * 24, PROP_Y + 0.3, mz + dz * 24), color="#0c0c0c")
        k.add(f"{label} prop hub", "propeller", "cylinder", (10, 6, 10), (mx, PROP_Y + 0.5, mz), color=prop_color, material=prop_mat)
        k.add(f"{label} prop screw", "propeller", "cylinder", (2.4, 1, 2.4), (mx, PROP_Y + 4, mz), color="#2a2a2a", material="metal")

        # Open guard ring around the rotor, resting on the ground; the gap faces the body.
        toward_body = math.degrees(math.atan2(-mz, -mx))
        arc = ring_points((mx, GUARD_Y, mz), GUARD_R, toward_body + 28, toward_body + 332, 17)
        for a, b in zip(arc, arc[1:]):
            k.rod(f"{label} guard ring", "guard", a, b, 3.2, color=BLACK)
        for spoke_deg in (95, 180, 265):
            end = ring_points((mx, GUARD_Y, mz), GUARD_R, toward_body + spoke_deg, toward_body + spoke_deg, 1)[0]
            k.rod(f"{label} guard spoke", "guard", (mx, 34, mz), end, 3.0, color=BLACK)
        on_arm = (mx - sx * 30, 38, mz - sz * 30)
        for end in (arc[0], arc[-1]):
            k.rod(f"{label} guard mount", "guard", on_arm, end, 3.0, color=BLACK)

    # Inferred internals: a brushed-motor flight controller and a 1S pack in the rear module.
    fc = k.add("Flight controller board", "board", "box", (30, 1.6, 36), (0, 37, 6), color="#1f7a3a", material="pcb", internal=True)
    k.add("Flight controller MCU", "board", "box", (7, 1.2, 7), (0, 38.4, 8), color="#111111", internal=True)
    k.add("Gyro IMU chip", "sensor", "box", (4, 1, 4), (8, 38.3, 0), color="#111111", internal=True)
    rx = k.add("Wi-Fi receiver board", "board", "box", (22, 1.4, 18), (0, 47, 26), color="#1d4fa0", material="pcb", internal=True)
    battery = k.add("LiPo battery 1S", "battery", "box", (30, 14, 24), (0, 37, -50), color="#8fa3b8", internal=True)
    k.wire("Battery to flight controller", battery, fc, "power", "#d01f1f", 1.5)
    k.wire("Flight controller to receiver", fc, rx, "signal", "#f2f2f2", 1.0)
    for label, (mx, mz, _, _) in motors.items():
        k.wire(f"FC to {label.lower()} motor", fc, motor_names[label], "power", "#d01f1f", 1.2, via=[(mx * 0.55, 40, mz * 0.55)])

    return k.model(
        "Toy camera quadcopter",
        "quadcopter drone",
        "A small toy quadcopter: glossy black body with red pinstripes, X arms, ribbed motor pods, "
        "red front and dark rear two-blade props, and open propeller guards it stands on.",
        [
            "Hand-built model of the uploaded photo; sizes estimated for a toy drone about 33 cm across the guards",
            "Internal parts are typical for this kind of device, not seen in the photo",
        ],
    )
