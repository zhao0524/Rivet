"""ESP32 DevKit (30-pin, ESP-WROOM-32): black 28 x 51.5 mm PCB, champagne metal RF shield with gold
castellated pads, micro-USB, EN and BOOT buttons, CP2102 USB bridge, AMS1117 regulator, a tantalum
capacitor and small SMD parts, 2 x 15 tinned header pads with white labels and pins underneath.

Laid flat: X across the board, the antenna end toward -Z, the USB end toward +Z."""

from rivet_api.concept.demo.kit import Kit

PCB = "#141517"
TIN = "#cfd3d7"
GOLD = "#d4ad55"
SHIELD = "#cdc5ae"
SILK = "#f1f1ee"

BOARD_W, BOARD_L, BOARD_T = 28.3, 51.5, 1.6
BOARD_BOTTOM = 8.5
TOP = BOARD_BOTTOM + BOARD_T
ROW_X = 12.0
PITCH = 2.54
PINS = [21.4 - i * PITCH for i in range(15)]


def _on_top(k: Kit, name: str, category: str, size, x: float, z: float, color: str, material: str = "plastic", rot=(0, 0, 0), shape: str = "box") -> str:
    """A part sitting on the board's top face."""
    return k.add(name, category, shape, size, (x, TOP + size[1] / 2, z), rot, color, material)


def _print(k: Kit, name: str, w: float, d: float, x: float, z: float, color: str = SILK, raise_mm: float = 0.05, shape: str = "box") -> str:
    """Silkscreen or etching: 0.5 mm thick (the minimum), sunk so it stands proud by `raise_mm`."""
    return k.add(name, "panel", shape, (w, 0.5, d), (x, TOP + raise_mm - 0.25, z), color=color)


def build():
    k = Kit()
    k.add("ESP32 board PCB", "board", "box", (BOARD_W, BOARD_T, BOARD_L), (0, BOARD_BOTTOM + BOARD_T / 2, 0), color=PCB, material="pcb")

    # Mounting holes in the four corners.
    for x in (-11.7, 11.7):
        for z in (-23.3, 23.3):
            k.add("Mounting hole ring", "board", "cylinder", (3.8, BOARD_T + 0.1, 3.8), (x, BOARD_BOTTOM + BOARD_T / 2, z), color=TIN, material="glossy_plastic")
            k.add("Mounting hole", "board", "cylinder", (2.6, BOARD_T + 0.3, 2.6), (x, BOARD_BOTTOM + BOARD_T / 2, z), color="#f4f4f4")

    # ESP-WROOM-32 module: dark module PCB with the antenna end, metal shield, gold castellations.
    mz0, mz1 = -BOARD_L / 2, -0.4
    module_c = (mz0 + mz1) / 2
    _on_top(k, "ESP-WROOM-32 module PCB", "board", (18, 0.8, mz1 - mz0), 0, module_c, "#1b1d22", "pcb")
    shield_z0, shield_z1 = -18.6, -1.2
    k.add("RF shield", "board", "box", (16, 2.4, shield_z1 - shield_z0), (0, TOP + 0.8 + 1.2, (shield_z0 + shield_z1) / 2), color=SHIELD, material="metal")
    shield_top = TOP + 0.8 + 2.4
    for i, (w, z) in enumerate(((9, -15.5), (7, -13.8), (10, -11.4), (6, -9.6), (8, -7.2))):
        k.add("Shield etching", "panel", "box", (w, 0.5, 0.6), (1.5 if i % 2 else 0, shield_top - 0.2, z), color="#a39b85")
    k.add("Shield logo", "panel", "cylinder", (4, 0.5, 4), (-4.2, shield_top - 0.2, -14.2), color="#a39b85")
    k.add("Shield CE mark", "panel", "box", (4, 0.5, 3), (2.4, shield_top - 0.2, -11.6), color="#a39b85")
    k.add("Shield pin-1 dot", "panel", "cylinder", (1.2, 0.5, 1.2), (-6.4, shield_top - 0.18, -6.0), color="#111111")
    for s in (-1, 1):
        for i in range(13):
            k.add("Module castellated pad", "board", "box", (1.0, 0.9, 0.9), (s * 9.05, TOP + 0.45, -17.6 + i * 1.27), color=GOLD, material="glossy_plastic")
    for i in range(10):
        k.add("Module castellated pad", "board", "box", (0.9, 0.9, 1.0), (-5.7 + i * 1.27, TOP + 0.45, mz1 + 0.05), color=GOLD, material="glossy_plastic")
    _print(k, "Antenna keep-out", 17, 6, 0, -22.4, "#202227", raise_mm=0.85)
    _on_top(k, "Status LED", "light", (1.6, 0.8, 1.0), 11.0, -21.8, "#f3e05a", "glossy_plastic")

    # Power and USB section.
    _on_top(k, "Micro USB port", "connector", (7.6, 2.8, 5.6), 0, 23.6, "#d6d9dd", "glossy_plastic")
    k.add("USB port opening", "connector", "box", (6.2, 1.6, 0.6), (0, TOP + 1.4, 26.45), color="#1a1a1a")
    for x, label in ((-9.0, "EN"), (9.0, "BOOT")):
        _on_top(k, f"{label} button body", "button", (5.0, 1.6, 4.2), x, 21.6, "#c3c7cc", "glossy_plastic")
        _on_top(k, f"{label} button plunger", "button", (2.4, 2.6, 2.4), x, 21.6, "#141414", shape="cylinder")
        _print(k, f"{label} label", 3.2 if label == "BOOT" else 2.0, 1.0, x, 18.6)
    _on_top(k, "AMS1117 regulator", "power", (6.5, 1.6, 3.5), -4.6, 9.2, "#1a1a1a")
    _on_top(k, "Regulator tab", "power", (3.2, 0.4, 2.4), -4.6, 6.4, TIN, "glossy_plastic")
    for dx in (-2.3, 0, 2.3):
        _on_top(k, "Regulator lead", "power", (0.7, 0.4, 1.6), -4.6 + dx, 11.6, TIN, "glossy_plastic")
    _print(k, "Regulator marking", 4.6, 0.6, -4.6, 9.2, "#9a9a9a", raise_mm=1.65)
    _on_top(k, "CP2102 USB bridge", "chip", (5.0, 0.9, 5.0), 3.4, 13.6, "#16171a", rot=(0, 12, 0))
    _on_top(k, "CP2102 pad ring", "chip", (5.8, 0.4, 5.8), 3.4, 13.6, TIN, "glossy_plastic", rot=(0, 12, 0))
    _print(k, "CP2102 marking", 3.2, 0.5, 3.4, 13.0, "#9a9a9a", raise_mm=0.95)
    _print(k, "CP2102 marking 2", 3.2, 0.5, 3.4, 14.2, "#9a9a9a", raise_mm=0.95)
    _on_top(k, "Tantalum capacitor", "capacitor", (3.5, 1.9, 2.8), -6.8, 2.2, "#e7a43a", "glossy_plastic")
    _on_top(k, "Capacitor polarity band", "capacitor", (0.7, 1.95, 2.85), -8.2, 2.2, "#8a5a1a", "glossy_plastic")
    for i, (x, z, color) in enumerate(
        ((-1.6, 2.4, "#1c1c1c"), (0.6, 2.4, "#1c1c1c"), (2.8, 2.4, "#1c1c1c"), (5.0, 2.4, "#1c1c1c"), (-1.6, 5.2, "#c9b48a"),
         (2.0, 6.0, "#1c1c1c"), (6.4, 6.0, "#1c1c1c"), (7.2, 10.8, "#c9b48a"), (-8.6, 13.8, "#1c1c1c"), (-1.8, 15.6, "#c9b48a"))
    ):
        _on_top(k, "SMD resistor" if color == "#1c1c1c" else "SMD capacitor", "passive", (1.0, 0.5, 1.8), x, z, color)
        _print(k, "Component outline", 1.6, 2.6, x, z, raise_mm=0.02)
    _on_top(k, "Power LED", "light", (1.0, 0.7, 1.6), 6.4, 3.2, "#ff3030", "glossy_plastic")
    for x, z in ((-0.6, 9.4), (7.0, 8.0)):
        _on_top(k, "SOT-23 transistor", "chip", (2.9, 1.0, 1.6), x, z, "#151515")
        _print(k, "Transistor marking", 1.6, 0.5, x, z, "#9a9a9a", raise_mm=1.05)

    # Headers: tinned pads and white labels on top, black plastic strips and pins underneath.
    header_mid = (PINS[0] + PINS[-1]) / 2
    for s in (-1, 1):
        x = s * ROW_X
        k.add("Pin header strip", "connector", "box", (2.5, 2.5, 15 * PITCH), (x, BOARD_BOTTOM - 1.25, header_mid), color="#111111")
        for z in PINS:
            k.add("Header pad", "connector", "cylinder", (1.9, 0.5, 1.9), (x, TOP - 0.2, z), color=TIN, material="glossy_plastic")
            k.add("Header pin top", "connector", "box", (0.64, 1.0, 0.64), (x, TOP + 0.4, z), color=TIN, material="glossy_plastic")
            k.add("Header pin", "connector", "box", (0.64, BOARD_BOTTOM - 0.5, 0.64), (x, (BOARD_BOTTOM - 0.5) / 2, z), color=TIN, material="glossy_plastic")
            _print(k, "Pin label", 2.8, 0.9, x - s * 3.2, z)

    # Inferred internals: the chip, flash and crystal under the shield. No wires are drawn: on a
    # bare board they would float over the PCB, and the traces are in the board itself.
    k.add("ESP32 chip", "chip", "box", (6, 0.9, 6), (0, TOP + 1.3, -10.5), color="#202020", internal=True)
    k.add("SPI flash", "chip", "box", (5, 0.8, 4), (-3.5, TOP + 1.3, -4.5), color="#202020", internal=True)
    k.add("40 MHz crystal", "chip", "box", (3.2, 0.8, 2.5), (4.5, TOP + 1.3, -4.5), color="#a8adb3", material="metal", internal=True)

    return k.model(
        "ESP32 development board",
        "microcontroller board",
        "An ESP32 DevKit board: black PCB with an ESP-WROOM-32 module under a metal shield, micro-USB, EN and BOOT "
        "buttons, a CP2102 USB bridge, an AMS1117 regulator, and two rows of 15 header pins.",
        [
            "Hand-built model of the uploaded photo; sizes follow the 28 x 51.5 mm 30-pin DevKit",
            "Internal parts are typical for this kind of device, not seen in the photo",
        ],
    )
