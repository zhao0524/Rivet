"""Raspberry Pi Camera Module 3 style board: green 25 x 24 mm PCB with four yellow mounting pads,
a square champagne-metal autofocus lens housing with a black lens, the sensor flex with its QR
label at the top, white silkscreen, and a 15-way ribbon cable leaving the bottom edge.

Laid flat: X across the board, the photo's top edge toward -Z, the ribbon toward +Z."""

import math

from rivet_api.concept.demo.kit import Kit

PCB = "#3e9b45"
PAD = "#e6d43a"
SILK = "#f3f6f2"
GOLD = "#cfae55"
HOUSING = "#c9c2b2"

BOARD_W, BOARD_D, BOARD_T = 25.0, 24.0, 1.0
BOARD_BOTTOM = 2.4
TOP = BOARD_BOTTOM + BOARD_T


def _flat(k: Kit, name: str, category: str, w: float, d: float, x: float, z: float, color: str, material: str = "plastic", raise_mm: float = 0.06, shape: str = "box", rot=(0, 0, 0)) -> str:
    """A print or sticker on the board face: 0.5 mm thick (the minimum), sunk so it stands proud by `raise_mm`."""
    return k.add(name, category, shape, (w, 0.5, d), (x, TOP + raise_mm - 0.25, z), rot, color, material)


def build():
    k = Kit()
    k.add("Camera PCB", "board", "box", (BOARD_W, BOARD_T, BOARD_D), (0, BOARD_BOTTOM + BOARD_T / 2, 0), color=PCB, material="pcb")

    # Four mounting holes with yellow pads.
    for x, z in ((-10.6, -10.3), (10.6, -10.3), (-10.6, 2.5), (10.6, 2.5)):
        k.add("Mounting pad", "board", "cylinder", (5.2, BOARD_T + 0.1, 5.2), (x, BOARD_BOTTOM + BOARD_T / 2, z), color=PAD, material="glossy_plastic")
        k.add("Mounting hole", "board", "cylinder", (2.3, BOARD_T + 0.3, 2.3), (x, BOARD_BOTTOM + BOARD_T / 2, z), color="#f4f4f4")

    # Autofocus lens: rounded-square champagne housing, black octagonal holder, barrel and glass.
    lx, lz = 0.0, 2.4
    k.add("Lens housing", "camera", "rounded_box", (11, 4.4, 11), (lx, TOP + 2.2, lz), color=HOUSING, material="glossy_plastic")
    k.add("Housing top plate", "camera", "rounded_box", (10.2, 0.6, 10.2), (lx, TOP + 4.5, lz), color="#bdb6a6", material="glossy_plastic")
    for i in range(8):
        a = math.radians(i * 45 + 22.5)
        k.add("Lens holder facet", "camera", "box", (3.2, 1.6, 0.8), (lx + math.cos(a) * 3.85, TOP + 5.3, lz + math.sin(a) * 3.85), (0, 90 - i * 45 - 22.5, 0), color="#1a1b1d")
    k.add("Lens holder", "camera", "cylinder", (7.8, 1.8, 7.8), (lx, TOP + 5.3, lz), color="#141517")
    k.add("Lens barrel", "camera", "cylinder", (6.0, 2.6, 6.0), (lx, TOP + 6.4, lz), color="#0f1012")
    k.add("Lens barrel ring", "camera", "torus", (6.2, 0.8, 6.2), (lx, TOP + 7.6, lz), color="#2a2c30")
    k.add("Lens glass", "camera", "hemisphere", (3.6, 0.9, 3.6), (lx, TOP + 7.9, lz), color="#0a0b10", material="glass")

    # Sensor flex at the top edge: black stiffener, gold Kapton window, white QR sticker, part label.
    k.add("Sensor flex stiffener", "cable", "box", (10, 0.8, 3.9), (-1.4, TOP + 0.4, -8.7), color="#121212")
    _flat(k, "Flex copper window", "cable", 4.2, 3.4, -4.2, -8.7, "#b9853a", "glossy_plastic", 0.9)
    for dx, dz in ((-5.0, -9.2), (-3.6, -8.2), (-4.6, -7.9)):
        _flat(k, "Flex copper mark", "cable", 0.9, 0.9, dx, dz, "#1a1206", raise_mm=0.95, shape="cylinder")
    _flat(k, "QR code sticker", "panel", 2.9, 3.0, 1.6, -8.7, "#f2f2f2", raise_mm=0.9)
    for i in range(4):
        for j in range(4):
            if (i * 3 + j * 5) % 3:
                _flat(k, "QR code dot", "panel", 0.5, 0.5, 0.65 + i * 0.62, -9.65 + j * 0.62, "#111111", raise_mm=0.95)
    _flat(k, "Part number label", "panel", 7.2, 1.3, -0.4, -5.0, "#151515", raise_mm=0.1)
    _flat(k, "Part number print", "panel", 5.6, 0.5, -0.4, -5.0, "#e8e8e8", raise_mm=0.15)

    # Silkscreen: raspberry logo, vertical board text, regulatory marks.
    for dx, dz in ((0, 0), (-1.1, 0.8), (1.1, 0.8), (-1.6, -0.4), (1.6, -0.4), (-0.6, -1.3), (0.6, -1.3), (0, 1.7), (-0.9, 2.4), (0.9, 2.4)):
        _flat(k, "Raspberry logo dot", "panel", 1.05, 1.05, -9.4 + dx, -4.4 + dz, SILK, shape="cylinder")
    for dx in (-0.9, 0.9):
        _flat(k, "Raspberry logo leaf", "panel", 1.6, 0.8, -9.4 + dx, -7.0, SILK, rot=(0, -30 if dx < 0 else 30, 0))
    _flat(k, "Silkscreen text Raspberry Pi", "panel", 0.9, 13.5, -7.2, 4.7, SILK)
    _flat(k, "Silkscreen text Camera Module 3", "panel", 0.9, 13.6, 6.9, -0.6, SILK)
    for i, z in enumerate((9.2, 10.4)):
        _flat(k, "Silkscreen code text", "panel", 0.7, 3.2, 3.0 + i * 1.2, z, SILK)
    _flat(k, "Silkscreen date text", "panel", 0.7, 3.8, 5.0, 9.6, SILK)
    _flat(k, "Regulatory mark", "panel", 1.8, 1.8, -1.6, 9.8, SILK)
    _flat(k, "Regulatory mark 2", "panel", 1.4, 1.4, 0.4, 9.2, SILK)
    _flat(k, "Copyright mark", "panel", 1.3, 1.3, -6.9, 11.0, SILK, shape="cylinder")
    _flat(k, "Data matrix", "panel", 4.0, 4.0, 9.0, 8.4, GOLD, "glossy_plastic")
    for i in range(5):
        for j in range(5):
            if (i + 2 * j) % 3 == 0:
                _flat(k, "Data matrix cell", "panel", 0.6, 0.6, 7.4 + i * 0.8, 6.8 + j * 0.8, "#6f6331", raise_mm=0.1)
    _flat(k, "Test pad ring", "board", 3.2, 3.2, -10.4, 8.6, "#7b5a2a", "glossy_plastic", shape="cylinder")
    _flat(k, "Test pad", "board", 2.3, 2.3, -10.4, 8.6, GOLD, "glossy_plastic", raise_mm=0.1, shape="cylinder")

    # FPC connector under the bottom edge, and the ribbon cable.
    k.add("Ribbon connector", "connector", "box", (21, 2.2, 4), (0, 1.1, 10.4), color="#121212")
    k.add("Connector latch", "connector", "box", (21.6, 0.8, 1.4), (0, 2.0, 12.4), color="#1d1d1d")
    k.add("Connector contacts", "connector", "box", (18, 0.5, 0.8), (0, 1.0, 12.6), color=GOLD, material="glossy_plastic")
    ribbon_len = 46.0
    k.add("Ribbon cable", "cable", "box", (16, 0.5, ribbon_len), (0, 0.6, 12.6 + ribbon_len / 2), color="#e9ebed")
    for i in range(15):
        k.add("Ribbon conductor", "cable", "box", (0.5, 0.5, ribbon_len - 1), (-7 + i, 0.66, 12.6 + ribbon_len / 2), color="#c9cdd2")

    # Inferred internals: image sensor and autofocus coil under the housing. No wires are drawn:
    # on a bare board they would float over the PCB, and the traces are in the board itself.
    k.add("Image sensor chip", "sensor", "box", (7, 0.8, 6), (lx, TOP + 0.5, lz), color="#2a2240", internal=True)
    k.add("Autofocus voice coil", "motor", "torus", (8.6, 1.4, 8.6), (lx, TOP + 2.6, lz), color="#b87333", material="metal", internal=True)

    return k.model(
        "Raspberry Pi camera module",
        "camera module",
        "A Raspberry Pi Camera Module 3 style board: green PCB with yellow mounting pads, a square metal autofocus lens "
        "housing with a black lens, the sensor flex and QR label at the top, and a ribbon cable at the bottom.",
        [
            "Hand-built model of the uploaded photo; sizes follow the 25 x 24 mm camera board",
            "Internal parts are typical for this kind of device, not seen in the photo",
        ],
    )
