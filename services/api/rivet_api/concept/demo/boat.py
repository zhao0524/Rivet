"""Deep-V RC racing speedboat: red deck and canopy, black flank band with yellow and orange flame
streaks, navy lower hull, and stainless rudder, strut, trim tabs and a brass propeller at the stern."""

import math

from rivet_api.concept.demo.kit import ALONG_X, Kit

RED = "#d8202a"
DEEP_RED = "#b5161f"
BLACK = "#121214"
NAVY = "#1d2c63"
YELLOW = "#f6c51b"
ORANGE = "#f08a1c"
STEEL = "#c3c8cd"

STERN, BOW_START, BOW_TIP = -230.0, 20.0, 232.0
WIDTH = 112.0
TIP_Y = 47.0
LAYERS = (  # name, bottom, top, color
    ("Lower hull", 10.0, 36.0, NAVY),
    ("Hull flank band", 36.0, 54.0, BLACK),
    ("Deck", 54.0, 70.0, RED),
)


def build():
    k = Kit()
    mid_len = BOW_START - STERN
    mid_z = (BOW_START + STERN) / 2
    bow_len = BOW_TIP - BOW_START

    for name, y0, y1, color in LAYERS:
        h, yc = y1 - y0, (y0 + y1) / 2
        k.add(f"{name} aft", "body", "rounded_box", (WIDTH, h, mid_len + 10), (0, yc, mid_z + 5), color=color, material="glossy_plastic")
        # The bow is the front half of an ellipsoid, pitched so every band meets at the same tip.
        pitch = math.degrees(math.atan2(yc - TIP_Y, bow_len))
        k.add(f"{name} bow", "body", "sphere", (WIDTH, h, 2 * bow_len), (0, yc, BOW_START), (pitch, 0, 0), color=color, material="glossy_plastic")
    # Deep-V keel under the whole length, rising into the bow.
    k.add("Keel", "body", "box", (38, 38, mid_len), (0, 27, mid_z), (0, 0, 45), color=NAVY, material="glossy_plastic")
    k.add("Bow keel", "body", "sphere", (40, 34, 2 * bow_len - 30), (0, 30, BOW_START), (math.degrees(math.atan2(30 - TIP_Y, bow_len)), 0, 0), color=NAVY, material="glossy_plastic")
    k.add("Chine strake", "body", "box", (WIDTH + 6, 3, mid_len - 10), (0, 18, mid_z + 5), color="#15214d", material="glossy_plastic")
    k.add("Gunwale trim", "body", "box", (WIDTH + 2, 2, mid_len), (0, 70.5, mid_z), color=DEEP_RED, material="glossy_plastic")

    # Flame graphics: slanted yellow and orange streaks along both flanks and on the deck.
    for s in (-1, 1):
        x = s * (WIDTH / 2 + 0.4)
        # Flame tongues: long thin streaks fanning back from the bow along the black band.
        for z, length, color, y, tilt in (
            (-10, 120, YELLOW, 48, 2.5), (-40, 130, ORANGE, 43, 4), (-110, 90, YELLOW, 50, 1.5), (-130, 70, ORANGE, 41, 5), (-185, 50, YELLOW, 46, 3),
        ):
            k.add("Flame streak", "decal", "box", (1.2, 3.2, length), (x, y, z), (tilt, 0, 0), color=color, material="glossy_plastic")
        k.add("Hull lettering", "decal", "box", (1.2, 5, 40), (x, 45, -150), color="#f4f4f4")
        k.add("Lower hull streak", "decal", "box", (1.2, 3, 150), (x, 25, -40), (-3, 0, 0), color=ORANGE, material="glossy_plastic")
        k.add("Water outlet", "other", "cylinder", (7, 6, 7), (s * (WIDTH / 2 + 2), 47, -200), ALONG_X, STEEL, "chrome")
    for x, z, color, yaw in ((-45, -10, YELLOW, 6), (-45, -85, ORANGE, 3), (45, -10, YELLOW, -6), (45, -85, ORANGE, -3), (0, -175, YELLOW, 0)):
        k.add("Deck flame", "decal", "box", (9, 0.8, 70), (x, 70.6, z), (0, yaw, 0), color=color, material="glossy_plastic")

    # Canopy (cockpit hatch) with a dark window and yellow trim.
    k.add("Canopy", "body", "rounded_box", (70, 36, 160), (0, 86, -42), color=RED, material="glossy_plastic")
    k.add("Canopy nose", "body", "sphere", (70, 36, 96), (0, 86, 38), color=RED, material="glossy_plastic")
    k.add("Canopy top", "body", "hemisphere", (62, 10, 150), (0, 109, -30), color=RED, material="glossy_plastic")
    k.add("Canopy window", "glass", "rounded_box", (56, 5, 46), (0, 103, 40), (-16, 0, 0), color="#15171b", material="glossy_plastic")
    for s in (-1, 1):
        k.add("Canopy trim stripe", "decal", "box", (1, 5, 130), (s * 35.3, 80, -36), color=YELLOW, material="glossy_plastic")
        k.add("Canopy orange stripe", "decal", "box", (1, 3, 100), (s * 35.3, 88, -46), color=ORANGE, material="glossy_plastic")
        k.add("Canopy side lettering", "decal", "box", (1, 4, 34), (s * 35.4, 96, 10), color="#f4f4f4")
    k.add("Canopy rear scoop", "body", "rounded_box", (50, 18, 32), (0, 110, -110), (8, 0, 0), color=DEEP_RED, material="glossy_plastic")
    k.add("Scoop intake", "body", "box", (40, 9, 2), (0, 113, -95), color="#0d0d0f")

    # Transom and running gear.
    k.add("Transom", "body", "box", (WIDTH - 4, 56, 4), (0, 40, STERN - 1), color=BLACK, material="glossy_plastic")
    k.add("Transom plate", "other", "box", (60, 20, 2), (0, 30, STERN - 3.5), color=STEEL, material="aluminum")
    k.rod("Drive strut", "drivetrain", (0, 14, STERN + 10), (0, -10, STERN - 18), 7, 12, color=STEEL, material="aluminum", shape="box")
    k.rod("Prop shaft", "drivetrain", (0, 4, STERN + 30), (0, -10, STERN - 24), 4, color=STEEL, material="chrome")
    k.add("Propeller", "propeller", "propeller", (40, 4, 40), (0, -10, STERN - 26), (90, 0, 0), color="#c9a24a", material="metal")
    k.add("Prop nut", "propeller", "sphere", (8, 8, 10), (0, -10, STERN - 30), color="#c9a24a", material="metal")
    k.add("Rudder", "other", "box", (3, 50, 24), (30, 0, STERN - 14), color=STEEL, material="aluminum")
    k.add("Rudder bracket", "other", "box", (10, 12, 10), (30, 26, STERN - 6), color=STEEL, material="aluminum")
    k.rod("Rudder tiller", "other", (30, 32, STERN - 8), (30, 46, STERN + 8), 3, color=STEEL, material="chrome")
    for s in (-1, 1):
        k.add("Trim tab", "other", "box", (24, 2.4, 16), (s * 36, 12, STERN - 7), (-6, 0, 0), color=STEEL, material="aluminum")
        k.add("Turn fin", "other", "box", (2.4, 14, 22), (s * (WIDTH / 2 - 4), 6, STERN + 30), color=STEEL, material="aluminum")

    # Inferred internals: water-cooled brushless motor and ESC, two LiPo packs, receiver, rudder servo.
    motor = k.add("Water-cooled brushless motor", "motor", "cylinder", (40, 44, 40), (0, 34, -150), (90, 0, 0), "#3a6fd0", "aluminum", internal=True)
    k.add("Motor end bell", "motor", "cylinder", (34, 16, 34), (0, 34, -180), (90, 0, 0), "#b9bec4", "metal", internal=True)
    esc = k.add("Water-cooled ESC", "board", "box", (34, 14, 60), (-26, 34, -80), color="#1d5fbf", internal=True)
    batt_l = k.add("LiPo battery pack left", "battery", "box", (34, 24, 120), (-26, 36, 20), color="#c43b2a", internal=True)
    batt_r = k.add("LiPo battery pack right", "battery", "box", (34, 24, 120), (26, 36, 20), color="#c43b2a", internal=True)
    rx = k.add("Radio receiver box", "board", "box", (26, 16, 34), (26, 40, -80), color="#1a1a1a", internal=True)
    servo = k.add("Rudder servo", "motor", "box", (20, 20, 40), (30, 38, -180), color="#141414", internal=True)
    k.wire("Left pack to ESC", batt_l, esc, "power", "#d01f1f", 3)
    k.wire("Right pack to ESC", batt_r, esc, "power", "#d01f1f", 3)
    k.wire("ESC to motor", esc, motor, "power", "#d01f1f", 3)
    k.wire("Receiver to ESC", rx, esc, "signal", "#f2c200", 1.2)
    k.wire("Receiver to rudder servo", rx, servo, "signal", "#f2c200", 1.2)

    return k.model(
        "RC racing speedboat",
        "RC speedboat",
        "A deep-V RC racing boat: glossy red deck and canopy, a black flank band with yellow and orange flame streaks, "
        "a navy lower hull and stainless rudder, strut and trim tabs with a brass propeller.",
        [
            "Hand-built model of the uploaded photo; sizes estimated for a boat about 47 cm long",
            "Internal parts are typical for this kind of device, not seen in the photo",
        ],
    )
