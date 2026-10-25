"""Mini FPV RC car styled as a black boxy off-roader (G-class look), with a grey FPV camera box
and lens on the roof, a whip antenna, glowing round headlights and silver multi-spoke wheels."""

import math

from rivet_api.concept.demo.kit import ALONG_X, ALONG_Z, Kit

BODY = "#111214"
TRIM = "#c9ccd1"
GLASS = "#1c2128"
TYRE = "#1a1a1a"
RIM = "#c4c8cd"
CAM = "#3b3d41"

L, W = 112.0, 50.0  # body length and width
WHEEL_D, WHEEL_W = 27.0, 10.0
AXLE_Y = WHEEL_D / 2
AXLE_Z = 37.0
TRACK = W / 2 - WHEEL_W / 2 + 2.5


def _wheel(k: Kit, label: str, x: float, z: float) -> str:
    side = 1 if x > 0 else -1
    tyre = k.add(f"{label} tyre", "wheel", "cylinder", (WHEEL_D, WHEEL_W, WHEEL_D), (x, AXLE_Y, z), ALONG_X, TYRE, "rubber")
    k.add(f"{label} tyre sidewall", "wheel", "torus", (WHEEL_D - 1, 3.2, WHEEL_D - 1), (x + side * (WHEEL_W / 2 - 1.2), AXLE_Y, z), ALONG_X, "#232425", "rubber")
    face = x + side * (WHEEL_W / 2 - 0.4)
    k.add(f"{label} rim", "wheel", "cylinder", (18.5, 1.6, 18.5), (face, AXLE_Y, z), ALONG_X, "#8d9298", "metal")
    k.add(f"{label} rim lip", "wheel", "torus", (19.5, 1.4, 19.5), (face + side * 0.4, AXLE_Y, z), ALONG_X, RIM, "chrome")
    for i in range(10):
        a = math.radians(i * 36)
        r = 4.8
        k.add(
            f"{label} rim spoke", "wheel", "box", (1.0, 7.4, 1.5),
            (face + side * 0.9, AXLE_Y + math.cos(a) * r, z + math.sin(a) * r), (math.degrees(a), 0, 0), RIM, "chrome",
        )
    k.add(f"{label} hub cap", "wheel", "cylinder", (5, 1.6, 5), (face + side * 1.2, AXLE_Y, z), ALONG_X, "#dfe2e6", "chrome")
    return tyre


def build():
    k = Kit()
    floor = 7.0
    body_top = 31.0

    # Lower body, flat hood and boxy cabin.
    k.add("Lower body", "body", "rounded_box", (W, body_top - floor, L), (0, (floor + body_top) / 2, 0), color=BODY, material="glossy_plastic")
    k.add("Hood", "body", "box", (W - 3, 3, 34), (0, body_top + 1.2, L / 2 - 19), (-3, 0, 0), color=BODY, material="glossy_plastic")
    k.add("Hood vent", "body", "box", (14, 0.6, 5), (0, body_top + 2.9, L / 2 - 24), color="#26282b")
    cab_z0, cab_z1 = -L / 2 + 3, L / 2 - 37
    cab_mid, cab_len = (cab_z0 + cab_z1) / 2, cab_z1 - cab_z0
    cab_h = 22.0
    k.add("Cabin", "body", "box", (W - 4, cab_h, cab_len), (0, body_top + cab_h / 2, cab_mid), color=BODY, material="glossy_plastic")
    k.add("Roof", "body", "rounded_box", (W - 3, 2.5, cab_len + 1), (0, body_top + cab_h + 0.5, cab_mid), color=BODY, material="glossy_plastic")
    k.add("Windscreen", "glass", "box", (W - 9, cab_h - 5, 1), (0, body_top + cab_h / 2 + 1, cab_z1 + 0.3), (-8, 0, 0), GLASS, "glossy_plastic")
    k.add("Windscreen frame", "body", "box", (W - 4, 2, 1.4), (0, body_top + 2, cab_z1 + 0.2), color=BODY, material="glossy_plastic")
    k.add("Rear window", "glass", "box", (W - 12, cab_h - 8, 0.8), (0, body_top + cab_h / 2 + 2, cab_z0 - 0.3), color=GLASS, material="glossy_plastic")

    for side in (-1, 1):
        sx = side * (W / 2 - 2 + 0.4)
        # Three side windows separated by pillars, like the photo.
        for i, (z0, z1) in enumerate(((cab_z1 - 22, cab_z1 - 3), (cab_z1 - 42, cab_z1 - 25), (cab_z0 + 3, cab_z1 - 45))):
            k.add("Side window", "glass", "box", (0.8, cab_h - 8, z1 - z0), (sx, body_top + cab_h / 2 + 1.5, (z0 + z1) / 2), color=GLASS, material="glossy_plastic")
        # Door shut lines and handles.
        for z in (cab_z1 - 23.5, cab_z1 - 43.5):
            k.add("Door seam", "body", "box", (0.5, 22, 0.6), (side * (W / 2 + 0.2), body_top - 4, z), color="#050505")
        for z in (cab_z1 - 21, cab_z1 - 41):
            k.add("Door handle", "body", "box", (0.8, 1.2, 4), (side * (W / 2 + 0.3), body_top - 2, z), color=TRIM, material="chrome")
        # Silver beltline trim and lower door strip.
        k.add("Beltline trim", "trim", "box", (0.6, 0.9, L - 18), (side * (W / 2 + 0.25), body_top - 0.5, -2), color=TRIM, material="chrome")
        k.add("Door trim strip", "trim", "box", (0.6, 0.9, 62), (side * (W / 2 + 0.25), floor + 9, -4), color=TRIM, material="chrome")
        # Running board between the wheels.
        k.add("Running board", "trim", "box", (5, 1.6, 2 * AXLE_Z - WHEEL_D - 4), (side * (W / 2 + 2), floor + 1, 0), color="#a9adb2", material="aluminum")
        # Fender flares and orange turn signals on top of the front fenders.
        for z in (AXLE_Z, -AXLE_Z):
            k.add("Fender flare", "body", "rounded_box", (4, 5, WHEEL_D + 6), (side * (W / 2 + 0.8), AXLE_Y + WHEEL_D / 2 + 1, z), color=BODY, material="glossy_plastic")
        k.add("Turn signal", "light", "rounded_box", (5, 2.4, 3.4), (side * (W / 2 - 4), body_top + 3.2, L / 2 - 6), color="#ff7a1a", material="glossy_plastic")
        # Side mirror on a stalk at the A-pillar.
        k.rod("Mirror stalk", "body", (side * (W / 2 - 1), body_top + 4, cab_z1 - 1), (side * (W / 2 + 4), body_top + 6, cab_z1 - 1), 1.4, color=BODY)
        k.add("Side mirror", "body", "rounded_box", (6, 5, 3), (side * (W / 2 + 6.5), body_top + 6.5, cab_z1 - 1.5), color=BODY, material="glossy_plastic")
        # Round headlights with chrome bezels and indicator lamps.
        k.add("Headlight", "light", "cylinder", (8, 1.6, 8), (side * 16, body_top - 6, L / 2 + 0.5), ALONG_Z, "#eef6ff", "glass")
        k.add("Headlight bezel", "light", "torus", (9.6, 1.6, 9.6), (side * 16, body_top - 6, L / 2 + 0.6), ALONG_Z, TRIM, "chrome")
        k.add("Headlight glow", "light", "sphere", (6.5, 6.5, 2.5), (side * 16, body_top - 6, L / 2 + 1.3), color="#cfe4ff", material="glossy_plastic")
        k.add("Fog lamp", "light", "cylinder", (3.4, 1, 3.4), (side * 17, floor + 4, L / 2 + 1.6), ALONG_Z, "#f3f4f5", "glass")
        k.add("Tail light", "light", "box", (5, 9, 1), (side * (W / 2 - 4.5), body_top - 7, -L / 2 - 0.3), color="#b3121c", material="glossy_plastic")

    # Chrome mesh grille with a round badge between the headlights.
    k.add("Grille", "panel", "box", (22, 10, 1), (0, body_top - 6, L / 2 + 0.4), color="#9da2a8", material="metal")
    for i in range(5):
        k.add("Grille bar", "panel", "box", (22, 0.7, 0.8), (0, body_top - 10 + i * 2, L / 2 + 1), color=TRIM, material="chrome")
    k.add("Grille badge", "panel", "cylinder", (6.5, 1, 6.5), (0, body_top - 6, L / 2 + 1.5), ALONG_Z, "#e6e8eb", "chrome")
    k.add("Badge star", "panel", "box", (0.6, 5, 0.4), (0, body_top - 6, L / 2 + 2.1), color="#7f848a", material="metal")
    k.add("Front bumper", "body", "rounded_box", (W - 2, 7, 6), (0, floor + 3, L / 2 - 1), color="#18191b")
    k.add("Rear bumper", "body", "rounded_box", (W - 2, 7, 5), (0, floor + 3, -L / 2 + 1), color="#18191b")
    k.add("Underbody", "body", "box", (W - 10, 4, L - 20), (0, floor - 1, 0), color="#0c0c0d")

    tyres = {}
    for label, x, z in (("Front-left", -TRACK, AXLE_Z), ("Front-right", TRACK, AXLE_Z), ("Rear-left", -TRACK, -AXLE_Z), ("Rear-right", TRACK, -AXLE_Z)):
        tyres[label] = _wheel(k, label, x, z)

    # FPV camera box on the roof: vented top, white logo, lens barrel at the front left.
    roof_y = body_top + cab_h + 1.8
    box_h, box_w, box_l = 17.0, 40.0, 46.0
    cam_y = roof_y + box_h / 2
    cam_z = cab_mid + 4
    k.add("FPV camera box", "camera", "rounded_box", (box_w, box_h, box_l), (0, cam_y, cam_z), color=CAM)
    k.add("Camera box base", "camera", "box", (box_w - 6, 2, box_l - 8), (0, roof_y + 0.2, cam_z), color="#2a2b2e")
    for i in range(6):
        k.add("Camera box vent slot", "camera", "box", (14, 0.6, 2), (6, roof_y + box_h + 0.05, cam_z - 14 + i * 4.2), color="#141516")
    k.add("FPV logo", "panel", "box", (12, 0.4, 9), (-9, roof_y + box_h + 0.1, cam_z + 7), color="#f2f2f2")
    k.add("FPV logo arrow", "panel", "box", (5, 0.4, 2.5), (-9, roof_y + box_h + 0.15, cam_z + 13), color="#f2f2f2")
    lens_x, lens_y = -7.0, cam_y - 1
    lens_z = cam_z + box_l / 2
    k.add("Camera lens barrel", "camera", "cylinder", (17, 14, 17), (lens_x, lens_y, lens_z + 5), ALONG_Z, CAM)
    k.add("Lens bezel", "camera", "torus", (17.5, 2, 17.5), (lens_x, lens_y, lens_z + 12), ALONG_Z, "#9aa0a6", "aluminum")
    k.add("Camera lens", "camera", "sphere", (11, 11, 4), (lens_x, lens_y, lens_z + 12), color="#0b0d10", material="glass")
    k.add("Antenna base", "antenna", "cylinder", (5, 4, 5), (12, roof_y + box_h + 2, cam_z - 16), color="#1a1a1a")
    k.add("Whip antenna", "antenna", "cylinder", (2.2, 62, 2.2), (12, roof_y + box_h + 35, cam_z - 16), color="#151515")

    # Inferred internals: receiver/ESC board, small LiPo, drive motor, steering servo, video TX.
    esc = k.add("Receiver and ESC board", "board", "box", (26, 1.6, 30), (0, 14, -8), color="#1f6f3a", material="pcb", internal=True)
    battery = k.add("LiPo battery", "battery", "box", (24, 8, 30), (0, 19, 18), color="#3b6fb6", internal=True)
    motor = k.add("Drive motor", "motor", "cylinder", (12, 18, 12), (0, AXLE_Y, -AXLE_Z + 8), ALONG_X, "#b9bec4", "metal", internal=True)
    servo = k.add("Steering servo", "motor", "box", (16, 8, 10), (0, 13, 38), color="#1a1a1a", internal=True)
    vtx = k.add("Video transmitter", "board", "box", (22, 1.4, 22), (4, roof_y + 6, cam_z - 6), color="#7a2a8f", material="pcb", internal=True)
    cam_board = k.add("Camera sensor board", "camera", "box", (14, 14, 1.4), (lens_x, lens_y, lens_z - 3), color="#141414", material="pcb", internal=True)
    k.wire("Battery to ESC", battery, esc, "power", "#d01f1f", 1.4)
    k.wire("ESC to drive motor", esc, motor, "power", "#d01f1f", 1.2)
    k.wire("Receiver to steering servo", esc, servo, "signal", "#f2c200", 1.0)
    k.wire("Battery to video transmitter", battery, vtx, "power", "#d01f1f", 1.0, via=[(4, body_top + cab_h, 0)])
    k.wire("Camera to video transmitter", cam_board, vtx, "signal", "#f2f2f2", 1.0)
    k.wire("Transmitter to antenna", vtx, "Antenna base", "signal", "#f2f2f2", 1.0)

    return k.model(
        "Mini FPV RC off-roader",
        "FPV RC car",
        "A palm-sized black boxy off-roader RC car with an FPV camera box and lens on the roof, a whip antenna, "
        "round glowing headlights, chrome grille and trim, and silver multi-spoke wheels.",
        [
            "Hand-built model of the uploaded photo; sizes estimated for a toy about 11 cm long",
            "Internal parts are typical for this kind of device, not seen in the photo",
        ],
    )
