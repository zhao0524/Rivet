"""1:16 off-road RC monster truck: black/grey/red body shell with a roll cage cab, chunky black
front bumper, red aluminium coil-over shocks and big knobby tyres on black five-spoke rims."""

import math

from rivet_api.concept.demo.kit import ALONG_X, ALONG_Z, Kit

BLACK = "#121314"
GLOSS_BLACK = "#16171a"
GREY = "#a7acb2"
LIGHT_GREY = "#cfd3d7"
RED = "#d3202b"
SHOCK_RED = "#c81e2a"
TYRE = "#1b1c1d"
RIM = "#141516"
BRASS = "#c9a24a"

WHEEL_D, WHEEL_W = 112.0, 56.0
R = WHEEL_D / 2
AXLE_Y = R
AXLE_Z = 120.0
TRACK = 118.0


def _wheel(k: Kit, label: str, x: float, z: float) -> str:
    side = 1 if x > 0 else -1
    tyre = k.add(f"{label} tyre", "wheel", "cylinder", (WHEEL_D - 6, WHEEL_W, WHEEL_D - 6), (x, AXLE_Y, z), ALONG_X, TYRE, "rubber")
    for s in (-1, 1):
        k.add(f"{label} tyre shoulder", "wheel", "torus", (WHEEL_D - 8, 14, WHEEL_D - 8), (x + s * (WHEEL_W / 2 - 7), AXLE_Y, z), ALONG_X, TYRE, "rubber")
    # Knobby tread: two staggered rows of blocks around the tyre, plus shoulder lugs.
    n = 14
    for row, offset in ((-1, 0.0), (1, 0.5)):
        for i in range(n):
            a = math.radians((i + offset) * 360 / n)
            rr = R - 3.5
            k.add(
                f"{label} tread block", "wheel", "box", (WHEEL_W / 2 - 4, 7, 15),
                (x + row * WHEEL_W / 4, AXLE_Y + math.cos(a) * rr, z + math.sin(a) * rr), (math.degrees(a), 0, 0), TYRE, "rubber",
            )
    for i in range(n):
        a = math.radians((i + 0.25) * 360 / n)
        rr = R - 9
        k.add(
            f"{label} shoulder lug", "wheel", "box", (6, 8, 11),
            (x + side * (WHEEL_W / 2 + 0.5), AXLE_Y + math.cos(a) * rr, z + math.sin(a) * rr), (math.degrees(a), 0, 0), TYRE, "rubber",
        )
    face = x + side * (WHEEL_W / 2 - 3)
    k.add(f"{label} rim", "wheel", "cylinder", (66, 4, 66), (face, AXLE_Y, z), ALONG_X, RIM, "glossy_plastic")
    k.add(f"{label} rim lip", "wheel", "torus", (68, 4, 68), (face + side * 1.5, AXLE_Y, z), ALONG_X, "#202224", "glossy_plastic")
    for i in range(5):
        a = math.radians(i * 72 + 18)
        k.add(
            f"{label} rim spoke", "wheel", "box", (4, 26, 7),
            (face + side * 2.6, AXLE_Y + math.cos(a) * 16, z + math.sin(a) * 16), (math.degrees(a), 0, 0), "#1d1f21", "glossy_plastic",
        )
    k.add(f"{label} wheel hub", "wheel", "cylinder", (16, 6, 16), (face + side * 3, AXLE_Y, z), ALONG_X, "#1d1f21", "glossy_plastic")
    k.add(f"{label} wheel nut", "wheel", "cylinder", (9, 8, 9), (face + side * 6, AXLE_Y, z), ALONG_X, BRASS, "metal")
    k.add(f"{label} axle tip", "wheel", "cylinder", (4, 4, 4), (face + side * 10.5, AXLE_Y, z), ALONG_X, "#d9dde1", "chrome")
    return tyre


def _shock(k: Kit, label: str, top: tuple, bottom: tuple) -> None:
    k.rod(f"{label} shock body", "suspension", top, [top[i] + (bottom[i] - top[i]) * 0.55 for i in range(3)], 12, color=SHOCK_RED, material="aluminum")
    k.rod(f"{label} shock shaft", "suspension", [top[i] + (bottom[i] - top[i]) * 0.5 for i in range(3)], bottom, 5, color="#e3e6e9", material="chrome")
    k.add(f"{label} shock cap", "suspension", "sphere", (13, 13, 13), top, color=SHOCK_RED, material="aluminum")
    k.add(f"{label} shock end", "suspension", "sphere", (8, 8, 8), bottom, color="#202124")
    # Spring coils around the body: rings facing along the shock axis.
    axis = [bottom[i] - top[i] for i in range(3)]
    for j in range(9):
        p = [top[i] + axis[i] * (0.14 + j * 0.085) for i in range(3)]
        k.ring(f"{label} spring coil", "suspension", p, axis, 19, 3, color="#d6dadf", material="chrome")
    k.ring(f"{label} spring collar", "suspension", [top[i] + axis[i] * 0.1 for i in range(3)], axis, 18, 5, color=SHOCK_RED, material="aluminum", shape="cylinder")


def build():
    k = Kit()

    # Chassis tub and skid plates.
    k.add("Chassis tub", "frame", "box", (96, 18, 300), (0, 52, 0), color=BLACK)
    k.add("Front skid plate", "frame", "box", (80, 8, 48), (0, 46, 150), (-18, 0, 0), color="#1a1b1d")
    k.add("Rear skid plate", "frame", "box", (80, 8, 40), (0, 46, -150), (18, 0, 0), color="#1a1b1d")

    # Front bumper: chunky black with round holes and a row of slots.
    k.add("Front bumper", "frame", "rounded_box", (150, 34, 26), (0, 84, 188), color="#1b1c1e")
    k.add("Bumper top bar", "frame", "rounded_box", (130, 10, 18), (0, 106, 182), color="#1b1c1e")
    k.add("Bumper lower lip", "frame", "box", (120, 10, 22), (0, 64, 186), (-20, 0, 0), color="#1b1c1e")
    for s in (-1, 1):
        k.add("Bumper hole", "frame", "cylinder", (13, 3, 13), (s * 50, 86, 201.2), ALONG_Z, "#050505")
        k.rod("Bumper upright", "frame", (s * 40, 100, 182), (s * 30, 126, 170), 12, 10, color="#1b1c1e", shape="box")
    for i in range(7):
        k.add("Bumper slot", "frame", "box", (5, 9, 2), (-27 + i * 9, 80, 201.2), color="#050505")

    # Body shell: black hood with red stripes, grey sides with red slashes, grille and lights.
    k.add("Hood", "body", "rounded_box", (176, 22, 118), (0, 140, 104), (7, 0, 0), color=GLOSS_BLACK, material="glossy_plastic")
    k.add("Hood scoop", "body", "rounded_box", (60, 10, 50), (0, 154, 104), (7, 0, 0), color="#0c0c0d", material="glossy_plastic")
    for i in range(4):
        k.add("Hood scoop slat", "body", "box", (54, 1.2, 2), (0, 159.5, 88 + i * 9), (7, 0, 0), color="#2b2d30")
    for s in (-1, 1):
        k.add("Hood stripe", "body", "box", (12, 1.2, 116), (s * 62, 151.8, 104), (7, s * 4, 0), color=RED, material="glossy_plastic")
        k.add("Body clip post", "body", "cylinder", (3, 14, 3), (s * 38, 160, 128), color="#d4d7db", material="chrome")
        k.add("Body clip", "body", "torus", (9, 1.4, 9), (s * 38, 166, 128), ALONG_X, "#d4d7db", "chrome")
    k.add("Grille panel", "body", "rounded_box", (150, 30, 10), (0, 128, 165), (8, 0, 0), color=LIGHT_GREY, material="glossy_plastic")
    k.add("Grille opening", "body", "box", (120, 12, 2), (0, 126, 170.5), (8, 0, 0), color="#0a0a0b")
    for s in (-1, 1):
        k.add("Headlight decal", "light", "rounded_box", (34, 8, 2), (s * 52, 136, 170), (8, 0, s * 6), color="#f2f3f4", material="glossy_plastic")
        k.add("Headlight decal outline", "light", "box", (36, 1.4, 2.2), (s * 52, 131.5, 170.2), (8, 0, s * 6), color=RED)

    for s in (-1, 1):
        sx = s * 90
        k.add("Front fender", "body", "rounded_box", (22, 38, 120), (sx, 124, 104), (6, 0, 0), color=GLOSS_BLACK, material="glossy_plastic")
        k.add("Fender red stripe", "body", "box", (2, 6, 110), (s * 101.2, 132, 104), (6, 0, 0), color=RED, material="glossy_plastic")
        k.add("Side panel", "body", "box", (6, 62, 150), (s * 92, 136, -20), color=GREY, material="glossy_plastic")
        k.add("Side panel lower", "body", "box", (6, 16, 150), (s * 92, 100, -20), color=GLOSS_BLACK, material="glossy_plastic")
        for j, (z, h) in enumerate(((-2, 60), (-26, 60), (-50, 50))):
            k.add("Side red slash", "body", "box", (6.6, h, 9), (s * 92.3, 136, z), (32, 0, 0), color=RED, material="glossy_plastic")
        k.add("Side black slash", "body", "box", (6.6, 58, 12), (s * 92.4, 136, 22), (32, 0, 0), color=GLOSS_BLACK, material="glossy_plastic")
        k.add("Sponsor badge", "body", "cylinder", (13, 1, 13), (s * 95.6, 150, 40), ALONG_X, "#8fc4e8", "glossy_plastic")
        k.add("Sponsor badge 2", "body", "cylinder", (13, 1, 13), (s * 95.6, 150, 22), ALONG_X, "#e9ecef", "glossy_plastic")
        k.add("Side decal stripe", "body", "box", (6.8, 4, 120), (s * 92.5, 112, -24), color=LIGHT_GREY)
        k.add("Rear fender", "body", "rounded_box", (22, 34, 90), (s * 90, 122, -122), color=GLOSS_BLACK, material="glossy_plastic")
        k.add("Rear fender stripe", "body", "box", (2, 6, 84), (s * 101.2, 128, -122), color=RED, material="glossy_plastic")

    # Cab: roof, seat and a black tube roll cage.
    k.add("Cab floor", "body", "box", (170, 6, 150), (0, 106, -20), color="#1a1b1d")
    k.add("Seat", "body", "rounded_box", (52, 46, 40), (0, 132, -30), (-12, 0, 0), color="#3a3d42")
    k.add("Roof panel", "body", "rounded_box", (150, 6, 104), (0, 206, -40), color=GLOSS_BLACK, material="glossy_plastic")
    k.add("Roof red stripe", "body", "box", (40, 1.2, 100), (60, 209.5, -40), color=RED, material="glossy_plastic")
    k.add("Roof light pod", "light", "rounded_box", (60, 8, 14), (0, 213, 6), color="#0d0e10", material="glossy_plastic")
    cage = "#141516"
    for s in (-1, 1):
        front_low, front_top = (s * 80, 150, 48), (s * 70, 204, 12)
        rear_low, rear_top = (s * 80, 150, -92), (s * 72, 204, -90)
        k.rod("Cage A-pillar", "frame", front_low, front_top, 7, color=cage)
        k.rod("Cage roof rail", "frame", front_top, rear_top, 7, color=cage)
        k.rod("Cage rear post", "frame", rear_low, rear_top, 7, color=cage)
        k.rod("Cage door bar", "frame", front_low, rear_low, 6, color=cage)
        k.rod("Cage diagonal", "frame", (s * 80, 150, -20), rear_top, 6, color=cage)
        k.rod("Cage rear brace", "frame", rear_top, (s * 60, 150, -150), 6, color=cage)
        k.rod("Cage window net bar", "frame", (s * 82, 172, 30), (s * 76, 172, -86), 4, color=cage)
    k.rod("Cage front hoop", "frame", (-70, 204, 12), (70, 204, 12), 7, color=cage)
    k.rod("Cage rear hoop", "frame", (-72, 204, -90), (72, 204, -90), 7, color=cage)
    k.rod("Cage cross bar", "frame", (-72, 180, -90), (72, 180, -90), 6, color=cage)
    k.rod("Cage X brace", "frame", (-72, 204, -90), (72, 160, -90), 5, color=cage)
    k.rod("Cage X brace", "frame", (72, 204, -90), (-72, 160, -90), 5, color=cage)
    k.add("Rear deck", "body", "box", (160, 10, 60), (0, 120, -140), color=GLOSS_BLACK, material="glossy_plastic")
    k.add("Rear bumper", "frame", "rounded_box", (130, 24, 20), (0, 80, -186), color="#1b1c1e")
    for s in (-1, 1):
        k.add("Tail light", "light", "box", (20, 8, 2), (s * 50, 120, -170.5), color="#b3121c", material="glossy_plastic")

    # Suspension: A-arms from the chassis to each hub carrier, and red coil-over shocks.
    for label, sx, sz in (("Front-left", -1, 1), ("Front-right", 1, 1), ("Rear-left", -1, -1), ("Rear-right", 1, -1)):
        z = sz * AXLE_Z
        hub = (sx * (TRACK - WHEEL_W / 2 - 8), AXLE_Y, z)
        k.add(f"{label} hub carrier", "suspension", "box", (14, 30, 22), hub, color="#202124")
        for dz in (-14, 14):
            k.rod(f"{label} lower arm", "suspension", (sx * 44, 46, z + dz * 1.8), (hub[0], AXLE_Y - 12, z + dz * 0.4), 8, 6, color="#1c1d1f", shape="box")
        k.rod(f"{label} upper link", "suspension", (sx * 40, 70, z), (hub[0], AXLE_Y + 12, z), 6, color="#1c1d1f")
        k.rod(f"{label} drive shaft", "drivetrain", (sx * 30, AXLE_Y, z), hub, 6, color="#6f747a", material="metal")
        _shock(k, label, (sx * 44, 146 if sz > 0 else 140, z - sz * 10), (hub[0] - sx * 6, AXLE_Y - 6, z - sz * 4))
        k.add(f"{label} shock tower", "frame", "box", (10, 44, 20), (sx * 44, 128, z - sz * 10), color="#1c1d1f")
    for label, sx, sz in (("Front-left", -1, 1), ("Front-right", 1, 1), ("Rear-left", -1, -1), ("Rear-right", 1, -1)):
        _wheel(k, label, sx * TRACK, sz * AXLE_Z)

    # Rear bumper mount from the chassis.
    k.rod("Rear bumper mount", "frame", (0, 54, -146), (0, 78, -180), 24, 10, color="#1b1c1e", shape="box")

    # Inferred internals: brushed motor and ESC, 2S LiPo, receiver, steering servo, differentials.
    # Laid out so no two overlap (overlapping internals would be stacked apart by the cleaner).
    motor = k.add("Brushed drive motor", "motor", "cylinder", (30, 40, 30), (32, 70, -60), ALONG_X, "#b9bec4", "metal", internal=True)
    k.add("Motor pinion and spur gear", "drivetrain", "cylinder", (40, 8, 40), (8, 70, -60), ALONG_X, "#e8e8e8", internal=True)
    esc = k.add("ESC", "board", "box", (30, 16, 40), (-30, 70, -10), color="#1d5fbf", internal=True)
    rx = k.add("Radio receiver", "board", "box", (24, 12, 30), (30, 68, 20), color="#1a1a1a", internal=True)
    battery = k.add("LiPo battery 2S", "battery", "box", (30, 20, 90), (0, 74, 50), color="#c43b2a", internal=True)
    servo = k.add("Steering servo", "motor", "box", (40, 20, 20), (0, 86, 125), color="#141414", internal=True)
    k.add("Centre drive shaft", "drivetrain", "cylinder", (8, 198, 8), (0, AXLE_Y, 0), ALONG_Z, "#7b8086", "metal", internal=True)
    for z, name in ((AXLE_Z, "Front differential"), (-AXLE_Z, "Rear differential")):
        k.add(name, "drivetrain", "cylinder", (40, 44, 40), (0, AXLE_Y, z), ALONG_X, "#5d6268", "metal", internal=True)
    k.wire("Battery to ESC", battery, esc, "power", "#d01f1f", 2.5)
    k.wire("ESC to motor", esc, motor, "power", "#d01f1f", 2.5)
    k.wire("Receiver to ESC", rx, esc, "signal", "#f2c200", 1.2)
    k.wire("Receiver to steering servo", rx, servo, "signal", "#f2c200", 1.2)

    return k.model(
        "Off-road RC monster truck",
        "RC monster truck",
        "A 1:16 off-road RC truck: black, grey and red body shell with a roll cage cab, chunky black front bumper, "
        "red coil-over shocks and big knobby tyres on black five-spoke rims.",
        [
            "Hand-built model of the uploaded photo; sizes estimated for a 1:16 truck about 39 cm long",
            "Internal parts are typical for this kind of device, not seen in the photo",
        ],
    )
