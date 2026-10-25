"""Geometry for purchased catalog parts, bound by exact catalog id.

No licensed manufacturer CAD/GLB is bundled with Rivet yet, so every purchased part is a
Rivet-original procedural approximation sized to the catalog's bounding box, labelled
`procedural_approximation` (or `catalog_bounding_box` for the generic fallback) with
`mesh_source_verified: false`. A model can never make a purchased body look "verified"
by choosing its shape: the shape comes from here.
"""
from __future__ import annotations

from collections.abc import Callable

import numpy as np
from OCP.BRepPrimAPI import BRepPrimAPI_MakeBox, BRepPrimAPI_MakeCylinder, BRepPrimAPI_MakeSphere
from OCP.gp import gp_Ax2, gp_Dir, gp_Pnt

from ..design_ir.models import Shape
from . import occ
from .parametric import BrepRegion, build_regions, fillet_all, hollow

PCB = {"name": "pcb", "color": "#1f2a38", "metallic": 0.0, "roughness": 0.55}
GOLD = {"name": "gold_plating", "color": "#d4a72c", "metallic": 1.0, "roughness": 0.3}
CHIP = {"name": "ic_package", "color": "#121316", "metallic": 0.0, "roughness": 0.35}
GLASS = {"name": "sensor_window", "color": "#2c3440", "metallic": 0.2, "roughness": 0.1}
STEEL = {"name": "steel", "color": "#c9ccd1", "metallic": 1.0, "roughness": 0.28}
BLACK_PLASTIC = {"name": "plastic", "color": "#202226", "metallic": 0.0, "roughness": 0.6}
YELLOW_PLASTIC = {"name": "plastic", "color": "#e8b923", "metallic": 0.0, "roughness": 0.5}
WHITE_PLASTIC = {"name": "plastic", "color": "#eef0f2", "metallic": 0.0, "roughness": 0.5}
RED_PLASTIC = {"name": "plastic", "color": "#c23b22", "metallic": 0.0, "roughness": 0.5}


def _box(dx, dy, dz, at=(0, 0, 0)):
    return BRepPrimAPI_MakeBox(gp_Pnt(at[0] - dx / 2, at[1] - dy / 2, at[2] - dz / 2), dx, dy, dz).Shape()


def _cyl(r, h, at=(0, 0, 0), axis=(0, 1, 0)):
    d = np.array(axis, dtype=float)
    start = np.array(at) - d * h / 2
    return BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(*start), gp_Dir(*d)), r, h).Shape()


def _header_row(n, pitch, start, step_axis, pin_axis, pin_len, ring=True):
    """Plated through-holes (gold rings) or pins along one axis."""
    shapes = []
    for i in range(n):
        p = np.array(start, dtype=float) + np.array(step_axis) * pitch * i
        shapes.append(_cyl(0.55 if ring else 0.32, pin_len, tuple(p), pin_axis))
    return occ.fuse_all(shapes)


def _breakout(dims, chip, chip_offset=(0, 0), holes: int = 7, windows: bool = False, mount_holes: bool = True):
    x, y, z = dims
    t = min(1.6, y * 0.6)
    y0 = -y / 2
    board = _box(x, t, z, (0, y0 + t / 2, 0))
    if mount_holes:
        for sx in (-1, 1):
            board = occ.cut(board, _cyl(1.25, t * 3, (sx * (x / 2 - 2.5), y0 + t / 2, z / 2 - 2.5)))
    pin_z = -z / 2 + 1.8
    row = holes * 2.54
    pads = _header_row(holes, 2.54, (-row / 2 + 1.27, y0 + t / 2, pin_z), (1, 0, 0), (0, 1, 0), t + 0.1)
    board = occ.cut(board, _header_row(holes, 2.54, (-row / 2 + 1.27, y0 + t / 2, pin_z), (1, 0, 0), (0, 1, 0), t * 3, ring=False))
    cx, cz, cy = chip
    chip_body = _box(cx, cy, cz, (chip_offset[0], y0 + t + cy / 2, chip_offset[1]))
    regions = [BrepRegion("pcb", board, PCB), BrepRegion("pads", pads, GOLD), BrepRegion("chip", chip_body, CHIP)]
    if windows:
        win = occ.fuse(
            _cyl(0.45, 0.12, (chip_offset[0] - cx * 0.22, y0 + t + cy + 0.05, chip_offset[1])),
            _cyl(0.45, 0.12, (chip_offset[0] + cx * 0.22, y0 + t + cy + 0.05, chip_offset[1])),
        )
        regions.append(BrepRegion("sensor_windows", win, GLASS))
    passives = occ.fuse_all([_box(1.0, 0.5, 0.5, (sx * x * 0.28, y0 + t + 0.25, z * 0.18)) for sx in (-1, 1)])
    regions.append(BrepRegion("passives", passives, {"name": "ceramic", "color": "#8a7a5c", "metallic": 0.0, "roughness": 0.6}))
    return regions


def tof_breakout(dims):
    """VL53L0X/VL53L1X time-of-flight breakout: flat board, small optical package with
    emitter/receiver windows, one header row (and a cable connector on taller boards).
    Never an ultrasonic twin-transducer."""
    regions = _breakout(dims, chip=(4.4, 2.4, min(1.0, dims[1] - 1.7)), chip_offset=(0, 1.5), holes=7, windows=True)
    x, y, z = dims
    t = min(1.6, y * 0.6)
    if y - t > 1.8:
        h = y - t
        connector = _box(6.0, h, 4.2, (-x / 2 + 4.0, -y / 2 + t + h / 2, z / 2 - 2.6))
        regions.append(BrepRegion("connector", connector, {"name": "plastic", "color": "#e9dcc0", "metallic": 0.0, "roughness": 0.6}))
    return regions


def driver_breakout(dims):
    return _breakout(dims, chip=(5.0, 5.0, min(1.0, dims[1] - 1.7)), holes=8, windows=False)


def esp32_devkit(dims):
    x, y, z = dims
    t = 1.6
    pin_len = y - t - 3.2
    board_y = -y / 2 + pin_len + t / 2
    board = _box(x, t, z, (0, board_y, 0))
    top = board_y + t / 2
    shield = _box(18.0, 3.1, 17.6, (0, top + 1.55, z / 2 - 6.4 - 8.8))
    antenna = _box(18.0, 0.8, 6.0, (0, top + 0.4, z / 2 - 3.2))
    usb = _box(7.5, 2.6, 5.6, (0, top + 1.3, -z / 2 + 2.8))
    headers, pins = [], []
    for sx in (-1, 1):
        hx = sx * (x / 2 - 1.27)
        headers.append(_box(2.5, 2.5, 19 * 2.54, (hx, board_y - t / 2 - 1.25, 0)))
        pins.append(_header_row(19, 2.54, (hx, board_y - t / 2 - pin_len / 2, -9 * 2.54), (0, 0, 1), (0, 1, 0), pin_len, ring=False))
    buttons = occ.fuse(_box(3.0, 1.5, 3.0, (-x / 2 + 4, top + 0.75, -z / 2 + 8)), _box(3.0, 1.5, 3.0, (x / 2 - 4, top + 0.75, -z / 2 + 8)))
    return [
        BrepRegion("pcb", board, {"name": "pcb", "color": "#151719", "metallic": 0.0, "roughness": 0.55}),
        BrepRegion("rf_shield", shield, STEEL),
        BrepRegion("antenna", antenna, {"name": "pcb", "color": "#1d3b6e", "metallic": 0.0, "roughness": 0.5}),
        BrepRegion("usb", usb, STEEL),
        BrepRegion("headers", occ.fuse_all(headers), BLACK_PLASTIC),
        BrepRegion("pins", occ.fuse_all(pins), GOLD),
        BrepRegion("buttons", buttons, BLACK_PLASTIC),
    ]


def tt_motor(dims):
    x, y, z = dims
    gear_len = z * 0.56
    gearbox = fillet_all(_box(x, y, gear_len, (0, 0, z / 2 - gear_len / 2)), 1.5)
    can_len = z - gear_len - 2
    can = _cyl(min(x, y) / 2 - 0.6, can_len, (0, 0, -z / 2 + can_len / 2 + 2), (0, 0, 1))
    cap = _cyl(min(x, y) / 2 - 2.5, 2.0, (0, 0, -z / 2 + 1.0), (0, 0, 1))
    shaft = _cyl(2.7, 2.0, (x / 2 - 1.0, 0, z / 2 - 11.0), (1, 0, 0))
    tabs = occ.fuse(_box(1.0, 3.0, 0.4, (-3, y * 0.38, -z / 2 + 0.2)), _box(1.0, 3.0, 0.4, (3, y * 0.38, -z / 2 + 0.2)))
    return [
        BrepRegion("gearbox", gearbox, YELLOW_PLASTIC),
        BrepRegion("motor_can", occ.fuse(can, cap), STEEL),
        BrepRegion("output_shaft", shaft, WHITE_PLASTIC),
        BrepRegion("tabs", tabs, GOLD),
    ]


def tt_wheel(dims):
    width, d1, d2 = dims
    shape = Shape(type="wheel", radius_mm=min(d1, d2) / 2, height_mm=width, wall_mm=min(d1, d2) * 0.13, spokes=6, axis="X")
    regions = build_regions(shape)
    return [BrepRegion(r.name, r.shape, r.material or YELLOW_PLASTIC) for r in regions]


def nub_caster(dims):
    x, y, z = dims
    r = min(x, z) / 2
    post = _cyl(r * 0.55, y - r, (0, r / 2, 0))
    dome = BRepPrimAPI_MakeSphere(gp_Pnt(0, -y / 2 + r, 0), r).Shape()
    dome = occ.common(dome, _box(2 * r, r, 2 * r, (0, -y / 2 + r / 2, 0)))
    return [BrepRegion("post", post, BLACK_PLASTIC), BrepRegion("nub", dome, WHITE_PLASTIC)]


def aa_holder(dims, cells=3):
    x, y, z = dims
    shell = hollow(_box(x, y, z), 1.2, "top")
    cell_r = min(7.0, (x - 3) / cells / 2, (y - 1.2) / 2)
    pitch = (x - 3) / cells
    batteries = occ.fuse_all([_cyl(cell_r, z - 6, (-x / 2 + 1.5 + pitch * (i + 0.5), -y / 2 + 1.2 + cell_r, 0), (0, 0, 1)) for i in range(cells)])
    return [BrepRegion("holder", shell, BLACK_PLASTIC), BrepRegion("cells", batteries, {"name": "battery_wrap", "color": "#2f6fd6", "metallic": 0.3, "roughness": 0.4})]


def power_bank(dims):
    x, y, z = dims
    body = fillet_all(_box(x, y, z), min(y / 2 - 0.5, 4.0))
    port = _box(8.5, 3.0, 4.0, (0, 0, z / 2 - 1.5))
    return [BrepRegion("case", occ.cut(body, port), {"name": "plastic", "color": "#2b2e33", "metallic": 0.1, "roughness": 0.45})]


def shadow_chassis(dims):
    x, y, z = dims
    plate_t = 3.0
    bottom = fillet_all(_box(x, plate_t, z, (0, -y / 2 + plate_t / 2, 0)), 1.2)
    top = fillet_all(_box(x * 0.92, plate_t, z * 0.82, (0, y / 2 - plate_t / 2, -z * 0.03)), 1.2)
    struts = occ.fuse_all([_cyl(3.0, y - 2 * plate_t, (sx * x * 0.38, 0, sz * z * 0.32)) for sx in (-1, 1) for sz in (-1, 1)])
    return [BrepRegion("plates", occ.fuse(bottom, top), RED_PLASTIC), BrepRegion("struts", struts, BLACK_PLASTIC)]


def breadboard(dims):
    x, y, z = dims
    block = _box(x, y, z)
    groove = _box(2.5, y * 0.4, z * 0.96, (0, y / 2 - y * 0.2 + 0.01, 0))
    return [BrepRegion("board", occ.cut(block, groove), WHITE_PLASTIC)]


def generic_envelope(dims, color: str = "#8a96a3"):
    r = min(dims) * 0.12
    solid = _box(*dims)
    if r > 0.3:
        try:
            solid = fillet_all(solid, r)
        except Exception:  # noqa: BLE001
            pass
    return [BrepRegion("envelope", solid, {"name": "plastic", "color": color, "metallic": 0.0, "roughness": 0.6})]


# Exact catalog id -> recipe. Category fallbacks below are labelled approximate envelopes.
CATALOG_RECIPES: dict[str, tuple[str, Callable]] = {
    "sensor.adafruit_vl53l0x_3317": ("tof_breakout", tof_breakout),
    "sensor.adafruit_vl53l1x_3967": ("tof_breakout", tof_breakout),
    "board.esp32_devkitc_v4_wroom32e": ("esp32_devkit", esp32_devkit),
    "driver.adafruit_tb6612_2448": ("driver_breakout", driver_breakout),
    "motor.adafruit_tt_bimetal_1to90_3801": ("tt_motor", tt_motor),
    "motor.adafruit_tt_gearbox_200rpm_3777": ("tt_motor", tt_motor),
    "wheel.adafruit_tt_wheel_3766": ("tt_wheel", tt_wheel),
    "caster.sparkfun_shadow_nub": ("nub_caster", nub_caster),
    "power.adafruit_3xaa_holder_2p1mm_3842": ("aa_holder", lambda d: aa_holder(d, 3)),
    "power.sparkfun_shadow_4xaa_holder": ("aa_holder", lambda d: aa_holder(d, 4)),
    "power.adafruit_usb_power_bank_5000_4288": ("power_bank", power_bank),
    "chassis.sparkfun_shadow_rob13301": ("shadow_chassis", shadow_chassis),
    "accessory.adafruit_half_breadboard_64": ("breadboard", breadboard),
}
CATEGORY_COLORS = {"controller": "#1d2b3a", "motor_driver": "#1f2a38", "distance_sensor": "#1f2a38", "motor": "#e8b923", "wheel": "#1d2024", "power_supply": "#2b2e33", "wiring": "#d23c3c"}


def catalog_regions(entry: dict) -> tuple[list[BrepRegion], dict]:
    """Procedural regions for a catalog component (centred on its bounding box) plus honesty info."""
    d = entry["physical"]["dimensions_mm"]
    dims = (float(d["x"]), float(d["y"]), float(d["z"]))
    cid = entry["catalog_id"]
    recipe_name, recipe = CATALOG_RECIPES.get(cid, (None, None))
    notes = []
    if recipe is not None:
        try:
            regions = recipe(dims)
            source = "procedural_approximation"
        except Exception:  # noqa: BLE001
            notes.append(f"recipe {recipe_name} failed for these dimensions; showing the bounding envelope")
            recipe_name, regions, source = "generic_envelope", generic_envelope(dims), "catalog_bounding_box"
    else:
        category = entry.get("identity", {}).get("category", "")
        recipe_name, regions, source = "generic_envelope", generic_envelope(dims, CATEGORY_COLORS.get(category, "#8a96a3")), "catalog_bounding_box"
        notes.append("no part-specific recipe; rounded bounding envelope from catalog dimensions")
    lo, hi = None, None
    for r in regions:
        a, b = occ.bounds(r.shape)
        lo = a if lo is None else np.minimum(lo, a)
        hi = b if hi is None else np.maximum(hi, b)
    extent = hi - lo
    mismatch = [round(float(e - want), 2) for e, want in zip(extent, dims)]
    if any(abs(m) > 0.6 for m in mismatch):
        notes.append(f"procedural extent differs from catalog bounds by {mismatch} mm")
    info = {
        "catalog_id": cid,
        "recipe": recipe_name,
        "geometry_source": source,
        "asset": None,
        "license": "Rivet original procedural model",
        "unit": "mm",
        "axis": "Y_up",
        "bounds_mm": list(dims),
        "measured_to_datasheet": bool(entry["physical"].get("bounds_verified")),
        "mesh_source_verified": False,
        "notes": notes,
    }
    return regions, info


__all__ = ["CATALOG_RECIPES", "catalog_regions"]
