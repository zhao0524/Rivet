"""Offline, deterministic design author (fixture mode, always labelled `fixture`).

It reads the request with rules and measures an uploaded image (foreground silhouette
aspect ratio and dominant colours), then composes DesignSpecs for a few archetypes with
three distinct strategies. Geometry is still compiled and checked by the real engine;
only the authoring step is rule-based. Live jobs never use this module.
"""
from __future__ import annotations

import copy
import io
import math
import re
from typing import Any

from rivet_engine.design_ir import changed_bodies

ROVER_STACK = {
    "controller": "board.esp32_devkitc_v4_wroom32e", "driver": "driver.adafruit_tb6612_2448", "motor": "motor.adafruit_tt_bimetal_1to90_3801",
    "wheel": "wheel.adafruit_tt_wheel_3766", "caster": "caster.sparkfun_shadow_nub", "sensor": "sensor.adafruit_vl53l0x_3317",
    "battery": "power.adafruit_3xaa_holder_2p1mm_3842", "bank": "power.adafruit_usb_power_bank_5000_4288",
}
COLORS = {"red": "#d03a2f", "orange": "#f08a24", "yellow": "#f2c230", "green": "#2f9e5b", "blue": "#2f6fd6", "purple": "#7a4bd1", "pink": "#e05a9b",
          "black": "#24272c", "white": "#eef0f2", "grey": "#8a9099", "gray": "#8a9099", "silver": "#c3c7cc", "gold": "#d4a72c", "brown": "#8a5a3b", "teal": "#1f9e9a"}
ARCHETYPES = [
    ("vehicle", r"\b(rover|robot car|car|truck|buggy|vehicle|tank|kart|wheeled)\b"),
    ("robot_arm", r"\b(robot arm|robotic arm|arm|manipulator|gripper)\b"),
    ("enclosure", r"\b(enclosure|housing|case|box for|casing)\b"),
    ("organic", r"\b(bird|hummingbird|parrot|duck|dog|cat|fox|horse|animal|fish|creature|dinosaur|rabbit)\b"),
    ("building", r"\b(house|home|building|hut|cabin|cottage|barn)\b"),
]


def image_measurements(data: bytes) -> dict[str, Any]:
    """Foreground silhouette and colours of a photo/sketch (background = border median)."""
    from PIL import Image
    import numpy as np

    img = Image.open(io.BytesIO(data)).convert("RGB")
    img.thumbnail((256, 256))
    a = np.asarray(img).astype(float)
    border = np.concatenate([a[0], a[-1], a[:, 0], a[:, -1]])
    bg = np.median(border, axis=0)
    fg = np.linalg.norm(a - bg, axis=2) > 40
    if fg.sum() < 50:
        return {"foreground": False}
    ys, xs = np.nonzero(fg)
    w, h = xs.max() - xs.min() + 1, ys.max() - ys.min() + 1
    q = (a[fg] // 32).astype(int)
    keys, counts = np.unique(q[:, 0] * 64 + q[:, 1] * 8 + q[:, 2], return_counts=True)
    order = np.argsort(-counts)
    colors = []
    for k in keys[order][:3]:
        r, g, b = (k // 64) * 32 + 16, (k // 8 % 8) * 32 + 16, (k % 8) * 32 + 16
        colors.append(f"#{int(r):02x}{int(g):02x}{int(b):02x}")
    return {"foreground": True, "aspect_w_h": round(float(w / h), 3), "fill": round(float(fg.sum() / (w * h)), 3), "colors": colors}


def _words(text: str) -> str:
    return " " + re.sub(r"[^a-z0-9 ]+", " ", text.lower()) + " "


def distill(text: str, image: tuple[bytes, str] | None, mode: str) -> dict:
    t = _words(text)
    archetype = next((name for name, pattern in ARCHETYPES if re.search(pattern, t)), "vehicle" if not text.strip() and image else "object")
    m = image_measurements(image[0]) if image else {"foreground": False}
    palette = [{"name": w, "hex": h} for w, h in COLORS.items() if f" {w} " in t][:3]
    if m.get("foreground"):
        palette += [{"name": f"image colour {i + 1}", "hex": c} for i, c in enumerate(m["colors"][:2])]
    wheels = 4 if re.search(r"\b(four|4) ?(wheel|wd)|\b4wd\b|\b4x4\b", t) else 6 if re.search(r"\b(six|6) ?wheel", t) else 2 if archetype == "vehicle" else None
    sensor = "high" if re.search(r"\b(tall|taller|high|higher|raised) (sensor|pod)|sensor (high|higher|up)", t) else "low" if re.search(r"\b(low|lower) (sensor|pod)", t) else "mid"
    proportions = {}
    if m.get("foreground"):
        ar = m["aspect_w_h"]
        proportions = {"image_width_height": ar, "length_width": round(min(2.2, max(0.9, ar)), 3), "height_length": round(min(1.2, max(0.25, 1 / max(ar, 0.2) * 0.45)), 3)}
    if " long " in t or " longer " in t:
        proportions["length_width"] = proportions.get("length_width", 1.4) * 1.25
    if " wide " in t or " wider " in t:
        proportions["length_width"] = proportions.get("length_width", 1.4) * 0.8
    features = {
        "vehicle": [f"{wheels} visible wheels", "low protective shell", "front sensor pod", "flat deck"],
        "robot_arm": ["round base", "jointed arm links", "gripper end effector"],
        "enclosure": ["sloped front panel", "rounded top edges", "screw-down base"],
        "organic": ["recognisable head", "smooth blended body", "characteristic appendages"],
        "building": ["pitched roof", "door and windows", "chimney"],
        "object": ["clear silhouette", "distinct base", "proportioned body"],
    }[archetype]
    unsupported = []
    if mode == "engineered" and not (archetype == "vehicle" and wheels == 2):
        unsupported.append(f"Rivet has no tested electrical/firmware profile for a {wheels or ''} {archetype}".replace("  ", " "))
    subject = (text.strip().split(".")[0][:120] or f"{archetype} from the reference image")
    return {
        "subject": subject, "summary": text.strip()[:400] or "Design from the uploaded reference image", "archetype": archetype,
        "goals": ["match the requested look"] + (["working rover electronics"] if mode == "engineered" else []),
        "signature_features": features[:6], "proportions": proportions, "palette": palette[:6], "materials": ["PETG"] if mode == "engineered" else [],
        "functional_behavior": "obstacle avoidance" if "avoid" in t else "", "mechanical_constraints": [], "supported": [], "unsupported": unsupported,
        "simplifications": ["rule-based offline author: shapes come from archetype templates parameterised by the request"],
        "uncertainties": [] if image is None else ["image read by silhouette and colour only; hidden sides are guessed"],
        "wheel_count": wheels, "sensor_height": sensor if archetype == "vehicle" else None,
        "image_observations": [f"silhouette width/height {m['aspect_w_h']}", f"dominant colours {', '.join(m['colors'][:2])}"] if m.get("foreground") else [],
        "source": "rules",
    }


def _color(brief: dict, index: int, default: str) -> str:
    pal = brief.get("palette") or []
    return pal[index]["hex"] if len(pal) > index else default


def _att(parent: str, child: str, offset=(0, 0, 0), **kw) -> dict:
    return {"parent_anchor": parent, "child_anchor": child, "offset_mm": [round(float(v), 2) for v in offset], **kw}


def _vehicle(brief: dict, strategy: str, mode: str) -> list[dict]:
    lw = float((brief.get("proportions") or {}).get("length_width", 1.6))
    eng = mode == "engineered"
    W = 100.0 if eng else 110.0
    L = min(240.0, max(160.0, W * lw)) if eng else min(300.0, max(120.0, W * lw))
    wheels = brief.get("wheel_count") or 2
    shell, deck_c = _color(brief, 0, "#f4a340"), _color(brief, 1, "#2b2f36")
    sensor_up = {"low": 4, "mid": 12, "high": 28}[brief.get("sensor_height") or "mid"]
    fab = "fabricated" if eng else "concept_visual"
    mfg = "3d_print" if eng else "none"
    bodies: list[dict] = []
    deck_shape = ({"type": "extrude_profile", "height_mm": 6, "profile_mm": [[-W / 2 + 2, -L / 2], [W / 2 - 2, -L / 2], [W / 2, L * 0.37], [W * 0.3, L / 2], [-W * 0.3, L / 2], [-W / 2, L * 0.37]]}
                  if strategy == "closest_to_reference" else {"type": "box", "dimensions_mm": [W, 6, L]})
    bodies.append({"id": "deck", "name": "Deck", "role": "chassis", "tags": ["chassis"], "kind": fab, "manufacturing": mfg,
                   "material": {"name": "PETG", "color": deck_c}, "shape": deck_shape,
                   "features": [{"id": "deck_round", "type": "fillet", "radius_mm": 3, "edges": "vertical"}] if strategy != "simpler_manufacture" else []})
    axle_sets = [0.22 * L] if wheels == 2 else [0.3 * L, -0.3 * L] if wheels == 4 else [0.32 * L, 0.0, -0.32 * L]
    for i, z in enumerate(axle_sets):
        for side, sx in (("right", 1), ("left", -1)):
            sid = f"{side}{'' if len(axle_sets) == 1 else '_' + str(i + 1)}"
            if eng:
                bodies.append({"id": f"motor_{sid}", "name": f"{side.title()} motor {i + 1}", "role": "motor", "kind": "purchased", "catalog_id": ROVER_STACK["motor"], "parent_id": "deck",
                               "attachment": _att(f"bottom_{side}", "top_right" if sx > 0 else "bottom_right", (4 * sx, 0, z), joint="bolt", contact="fastened", fasteners={"spec": "M3", "count": 2})})
                bodies.append({"id": f"wheel_{sid}", "name": f"{side.title()} wheel {i + 1}", "role": "wheel", "kind": "purchased", "catalog_id": ROVER_STACK["wheel"], "parent_id": f"motor_{sid}",
                               "attachment": _att("right", "left", joint="shaft", contact="fastened")})
            else:
                radius = 30 * (1.3 if strategy == "signature_geometry" else 1.0)
                bodies.append({"id": f"wheel_{sid}", "name": f"{side.title()} wheel {i + 1}", "role": "wheel", "kind": "concept_visual", "parent_id": "deck",
                               "material": {"name": "rubber", "color": "#25282c"},
                               "shape": {"type": "wheel", "radius_mm": radius, "height_mm": 24, "wall_mm": radius * 0.28, "spokes": 5 if strategy != "simpler_manufacture" else 0},
                               "attachment": _att(side, "left" if sx > 0 else "right", (2 * sx, -radius * 0.55, z), joint="shaft", contact="clearance", clearance_mm=2)})
    if eng and wheels == 2:
        bodies.append({"id": "caster", "name": "Rear caster", "role": "caster", "kind": "purchased", "catalog_id": ROVER_STACK["caster"], "parent_id": "deck",
                       "attachment": _att("bottom", "top", (0, 0, -0.40 * L), joint="bolt", contact="fastened")})
    elif not eng and wheels == 2:
        reach = 30 * (1.3 if strategy == "signature_geometry" else 1.0) * 1.55 - 3
        bodies.append({"id": "skid", "name": "Rear skid", "role": "caster", "kind": "concept_visual", "parent_id": "deck", "material": {"name": "plastic", "color": "#d9dce0"},
                       "shape": {"type": "capsule", "radius_mm": 7, "height_mm": round(reach, 2)}, "attachment": _att("bottom", "top", (0, 0, -0.38 * L), contact="touch")})
    if eng:
        ez = 0.02 * L if strategy == "signature_geometry" else 0.13 * L
        dz = 0.05 * L if strategy == "signature_geometry" else 0.19 * L
        for bid, cid, off in (("controller", ROVER_STACK["controller"], (-W * 0.22, 0, ez)), ("motor_driver", ROVER_STACK["driver"], (W * 0.18 if strategy == "signature_geometry" else W * 0.22, 0, dz)),
                              ("battery", ROVER_STACK["battery"], (W * 0.18, 0, -0.21 * L))):
            bodies.append({"id": bid, "name": bid.replace("_", " ").title(), "role": bid if bid != "battery" else "motor_power", "kind": "purchased", "catalog_id": cid,
                           "parent_id": "deck", "internal": True, "attachment": _att("top", "bottom", off, contact="fastened", fasteners={"spec": "adhesive", "count": 1})})
    H = 34 if strategy == "signature_geometry" else 28
    if strategy == "signature_geometry":
        d = L * 0.85
        cover = {"type": "loft", "ruled": True, "section_heights_mm": [0, H],
                 "sections": [[[-(W - 8) / 2, -d / 2], [(W - 8) / 2, -d / 2], [(W - 8) / 2, d / 2], [-(W - 8) / 2, d / 2]],
                              [[-(W - 8) * 0.45, -d / 2], [(W - 8) * 0.45, -d / 2], [(W - 8) * 0.45, d * 0.2], [-(W - 8) * 0.45, d * 0.2]]]}
        feats = ([{"id": "cover_hollow", "type": "shell", "wall_mm": 2, "open_face": "bottom", "required": True}] if eng else []) + [{"id": "cover_round", "type": "fillet", "radius_mm": 3, "edges": "top"}]
    else:
        cover = {"type": "box", "dimensions_mm": [W - 8, H, L * 0.85]}
        feats = ([{"id": "cover_corners", "type": "fillet", "radius_mm": 8, "edges": "vertical"}, {"id": "cover_top", "type": "fillet", "radius_mm": 6, "edges": "top"}]
                 if strategy == "closest_to_reference" else [])
        feats = feats + ([{"id": "cover_hollow", "type": "shell", "wall_mm": 2, "open_face": "bottom", "required": True}] if eng else [])
        if strategy == "closest_to_reference":
            feats.append({"id": "cover_vents", "type": "grill", "count": 5, "width_mm": 3, "length_mm": 36, "spacing_mm": 8, "depth_mm": 8, "axis": "Y", "pattern_axis": "Z", "position_mm": [0, H / 2 - 1, L * 0.1]})
    bodies.append({"id": "cover", "name": "Cover shell", "role": "shell", "tags": ["shell", "signature"], "kind": fab, "manufacturing": mfg, "parent_id": "deck",
                   "material": {"name": "PETG", "color": shell}, "shape": cover, "features": feats, "attachment": _att("top", "bottom", (0, 0, -0.05 * L), contact="fastened")})
    if eng:
        bodies.append({"id": "power_bank", "name": "USB power bank", "role": "controller_power", "kind": "purchased", "catalog_id": ROVER_STACK["bank"], "parent_id": "cover",
                       "attachment": _att("top", "bottom", (0, 0, -0.08 * L if strategy != "signature_geometry" else -0.2 * L), contact="fastened")})
    pod = {"type": "rounded_box", "dimensions_mm": [min(44, W * 0.5), 28, 18], "radius_mm": 4} if strategy != "simpler_manufacture" else {"type": "box", "dimensions_mm": [min(44, W * 0.5), 26, 6]}
    bodies.append({"id": "sensor_pod", "name": "Sensor pod" if strategy != "simpler_manufacture" else "Sensor bracket", "role": "sensor_housing", "tags": ["signature"], "kind": fab,
                   "manufacturing": mfg if not eng or strategy != "simpler_manufacture" else "laser_cut", "parent_id": "deck",
                   "material": {"name": "PETG" if strategy != "simpler_manufacture" else "acrylic", "color": shell}, "shape": pod,
                   "attachment": _att("front", "back", (0, sensor_up, 0), contact="fastened")})
    if eng:
        bodies.append({"id": "range_sensor", "name": "VL53L0X ToF sensor", "role": "distance_sensor", "kind": "purchased", "catalog_id": ROVER_STACK["sensor"],
                       "parent_id": "sensor_pod", "attachment": _att("front", "bottom", contact="fastened")})
    else:
        bodies.append({"id": "sensor_eye", "name": "Sensor lens", "role": "sensor", "kind": "concept_visual", "parent_id": "sensor_pod", "material": {"name": "glass", "color": "#1b2430", "metallic": 0.3, "roughness": 0.1},
                       "shape": {"type": "cylinder", "radius_mm": 5, "height_mm": 3, "axis": "Z"}, "attachment": _att("front", "back", contact="touch")})
    if strategy == "signature_geometry":
        bodies.append({"id": "antenna", "name": "Antenna", "role": "antenna", "kind": "concept_visual", "parent_id": "cover", "material": {"name": "plastic", "color": "#24272c"},
                       "shape": {"type": "capsule", "radius_mm": 1.5, "height_mm": 50}, "attachment": _att("top", "bottom", (W * 0.3, 0, -L * 0.3), contact="embedded")})
    return bodies


def _robot_arm(brief: dict, strategy: str, mode: str) -> list[dict]:
    accent, links = _color(brief, 0, "#e35d2f"), _color(brief, 1, "#f2f2f2")
    k = {"closest_to_reference": 1.0, "simpler_manufacture": 0.85, "signature_geometry": 1.2}[strategy]
    u, f = 140 * k, 120 * k
    box_link = strategy == "simpler_manufacture"

    def link(bid, name, length, width, value, limits):
        shape = ({"type": "box", "dimensions_mm": [width, length + 2 * width * 0.6, width * 1.1]} if box_link else
                 {"type": "boolean", "operation": "union", "children": [
                     {"type": "rounded_box", "dimensions_mm": [width, length, width * 1.15], "radius_mm": width * 0.24},
                     {"type": "cylinder", "radius_mm": width * 0.58, "height_mm": width, "axis": "X", "frame": {"position_mm": [0, -length / 2, 0]}},
                     {"type": "cylinder", "radius_mm": width * 0.58, "height_mm": width, "axis": "X", "frame": {"position_mm": [0, length / 2, 0]}}]})
        half = shape["dimensions_mm"][1] / 2 - width * 0.6 if box_link else length / 2
        return {"id": bid, "name": name, "role": "arm_link", "kind": "fabricated", "manufacturing": "3d_print", "material": {"name": "PLA", "color": links}, "shape": shape,
                "anchors": [{"id": "base_pivot", "frame": {"position_mm": [0, -half, 0], "rotation_deg": [180, 0, 0]}, "kind": "hinge"},
                            {"id": "tip_pivot", "frame": {"position_mm": [0, half, 0]}, "kind": "hinge"}],
                "attachment": {"parent_anchor": "tip_pivot" if bid == "forearm" else "shoulder_pivot", "child_anchor": "base_pivot", "joint": "hinge", "axis": "X",
                               "value": value, "limits": limits, "contact": "embedded"}}

    bodies = [
        {"id": "base", "name": "Base", "role": "base", "kind": "fabricated", "manufacturing": "3d_print", "material": {"name": "PLA", "color": "#2d3138"},
         "shape": {"type": "revolve_profile", "profile_mm": [[0, 0], [62 * k, 0], [62 * k, 8], [46 * k, 18], [32, 24], [0, 24]]} if not box_link else {"type": "box", "dimensions_mm": [120 * k, 20, 120 * k]}},
        {"id": "turntable", "name": "Turntable", "role": "joint", "kind": "fabricated", "manufacturing": "3d_print", "parent_id": "base", "material": {"name": "PLA", "color": accent},
         "shape": {"type": "cylinder", "radius_mm": 30, "height_mm": 16}, "attachment": {"parent_anchor": "top", "child_anchor": "bottom", "joint": "shaft", "axis": "Y", "contact": "touch"}},
        {"id": "shoulder", "name": "Shoulder", "role": "joint", "kind": "fabricated", "manufacturing": "3d_print", "parent_id": "turntable", "material": {"name": "PLA", "color": accent},
         "shape": {"type": "boolean", "operation": "union", "children": [{"type": "box", "dimensions_mm": [50, 30, 40]},
                   {"type": "cylinder", "radius_mm": 18, "height_mm": 50, "axis": "X", "frame": {"position_mm": [0, 15, 0]}}]},
         "anchors": [{"id": "shoulder_pivot", "frame": {"position_mm": [0, 15, 0]}, "kind": "hinge"}],
         "attachment": {"parent_anchor": "top", "child_anchor": "bottom", "contact": "fastened"}},
    ]
    up = link("upper_arm", "Upper arm", u, 24, -20, [-60, 60])
    up["parent_id"] = "shoulder"
    bodies.append(up)
    last = "upper_arm"
    if strategy != "simpler_manufacture":
        fa = link("forearm", "Forearm", f, 20, 50, [-10, 120])
        fa["parent_id"] = "upper_arm"
        bodies.append(fa)
        last = "forearm"
    bodies += [
        {"id": "wrist", "name": "Wrist", "role": "joint", "kind": "fabricated", "manufacturing": "3d_print", "parent_id": last, "material": {"name": "PLA", "color": accent},
         "shape": {"type": "cylinder", "radius_mm": 10, "height_mm": 16}, "attachment": {"parent_anchor": "top", "child_anchor": "bottom", "joint": "shaft", "axis": "Y", "contact": "touch"}},
        {"id": "palm", "name": "Gripper palm", "role": "gripper", "kind": "fabricated", "manufacturing": "3d_print", "parent_id": "wrist", "material": {"name": "PLA", "color": "#2d3138"},
         "shape": {"type": "box", "dimensions_mm": [40, 8, 20]}, "attachment": {"parent_anchor": "top", "child_anchor": "bottom", "contact": "fastened"}},
    ]
    for side, sx, lim in (("left", -1, [-8, 0]), ("right", 1, [0, 8])):
        bodies.append({"id": f"finger_{side}", "name": f"{side.title()} finger", "role": "gripper_finger", "kind": "fabricated", "manufacturing": "3d_print", "parent_id": "palm",
                       "material": {"name": "PLA", "color": "#2d3138"}, "shape": {"type": "box", "dimensions_mm": [6, 30 * k, 14]},
                       "attachment": {"parent_anchor": "top", "child_anchor": "bottom", "joint": "slide", "axis": "X", "offset_mm": [10 * sx, 0, 0], "value": 0, "limits": lim, "contact": "touch"}})
    return bodies


def _enclosure(brief: dict, strategy: str, mode: str) -> list[dict]:
    body_c = _color(brief, 0, "#e8eaed")
    eng = mode == "engineered"
    fab = "fabricated" if eng else "concept_visual"
    mfg = "3d_print" if eng else "none"
    bodies = [{"id": "base_plate", "name": "Base plate", "role": "base", "kind": fab, "manufacturing": mfg, "material": {"name": "PETG", "color": "#30343b"},
               "shape": {"type": "plate", "dimensions_mm": [84, 4, 64]},
               "features": [{"id": "plate_round", "type": "fillet", "radius_mm": 4, "edges": "vertical"},
                            {"id": "holes", "type": "hole", "radius_mm": 1.6, "depth_mm": 10, "position_mm": [0, 0, 27], "count": 2, "spacing_mm": 74, "pattern_axis": "X"}]}]
    if strategy == "closest_to_reference":
        shape = {"type": "loft", "ruled": True, "sections": [[[-40, -30], [40, -30], [40, 30], [-40, 30]], [[-40, -30], [40, -30], [40, 6], [-40, 6]]], "section_heights_mm": [0, 42]}
        feats = [{"id": "hollow", "type": "shell", "wall_mm": 2.4, "open_face": "bottom", "required": True}, {"id": "top_round", "type": "fillet", "radius_mm": 3, "edges": "top"},
                 {"id": "sensor_window", "type": "window", "width_mm": 10, "length_mm": 14, "depth_mm": 30, "axis": "Z", "pattern_axis": "X", "position_mm": [0, 0, 18]}]
        anchors = [{"id": "sensor_mount", "frame": {"position_mm": [0, -1.19, 15.92], "rotation_deg": [-119.74, 0, 0]}, "kind": "face"}]
    elif strategy == "simpler_manufacture":
        shape = {"type": "box", "dimensions_mm": [80, 40, 60]}
        feats = [{"id": "hollow", "type": "shell", "wall_mm": 2.4, "open_face": "bottom", "required": True},
                 {"id": "sensor_window", "type": "window", "width_mm": 10, "length_mm": 14, "depth_mm": 8, "axis": "Z", "pattern_axis": "X", "position_mm": [0, 4, 29]}]
        anchors = [{"id": "sensor_mount", "frame": {"position_mm": [0, 4, 27.6], "rotation_deg": [-90, 0, 0]}, "kind": "face"}]
    else:
        shape = {"type": "rounded_box", "dimensions_mm": [80, 44, 60], "radius_mm": 10}
        feats = [{"id": "hollow", "type": "shell", "wall_mm": 2.4, "open_face": "bottom", "required": True},
                 {"id": "vents", "type": "grill", "count": 5, "width_mm": 2.5, "length_mm": 30, "spacing_mm": 7, "depth_mm": 10, "axis": "Y", "pattern_axis": "Z", "position_mm": [0, 20, -6]},
                 {"id": "sensor_window", "type": "window", "width_mm": 10, "length_mm": 14, "depth_mm": 8, "axis": "Z", "pattern_axis": "X", "position_mm": [0, 4, 29]}]
        anchors = [{"id": "sensor_mount", "frame": {"position_mm": [0, 4, 27.6], "rotation_deg": [-90, 0, 0]}, "kind": "face"}]
    bodies.append({"id": "housing", "name": "Housing", "role": "enclosure", "tags": ["signature"], "kind": fab, "manufacturing": mfg, "parent_id": "base_plate",
                   "material": {"name": "PETG", "color": body_c}, "shape": shape, "features": feats, "anchors": anchors,
                   "attachment": {"parent_anchor": "top", "child_anchor": "bottom", "contact": "fastened"}})
    if eng:
        bodies += [
            {"id": "controller", "name": "ESP32 controller", "role": "controller", "kind": "purchased", "catalog_id": ROVER_STACK["controller"], "parent_id": "base_plate", "internal": True,
             "attachment": {"parent_anchor": "top", "child_anchor": "bottom", "rotation_deg": [0, 90, 0], "offset_mm": [0, 0, -8], "contact": "fastened"}},
            {"id": "range_sensor", "name": "VL53L0X ToF sensor", "role": "distance_sensor", "kind": "purchased", "catalog_id": ROVER_STACK["sensor"], "parent_id": "housing", "internal": True,
             "attachment": {"parent_anchor": "sensor_mount", "child_anchor": "top", "contact": "fastened"}},
        ]
    return bodies


def _organic(brief: dict, strategy: str, mode: str) -> list[dict]:
    subject = _words(brief.get("subject", "") + " " + brief.get("summary", ""))
    main, accent = _color(brief, 0, "#2f8f5b"), _color(brief, 1, "#b3123b")
    s = {"closest_to_reference": 1.0, "simpler_manufacture": 0.9, "signature_geometry": 1.15}[strategy]
    blend = strategy != "simpler_manufacture"
    cv = "concept_visual"
    if re.search(r"\b(dog|cat|fox|horse|animal|rabbit|dinosaur)\b", subject):
        torso = [{"type": "ellipsoid", "dimensions_mm": [60, 54, 120 * s]}, {"type": "sphere", "radius_mm": 24 * s, "frame": {"position_mm": [0, 34, 62 * s]}},
                 {"type": "ellipsoid", "dimensions_mm": [22, 20, 34], "frame": {"position_mm": [0, 28, 88 * s]}}]
        body_shape = {"type": "occupancy", "smoothing_mm": 10, "pitch_mm": 2.5, "children": torso} if blend else torso[0]
        bodies = [{"id": "body", "name": "Body and head", "role": "body", "tags": ["signature"], "kind": cv, "material": {"name": "fur", "color": main, "roughness": 0.8}, "shape": body_shape}]
        if not blend:
            bodies.append({"id": "head", "name": "Head", "role": "head", "kind": cv, "parent_id": "body", "material": {"name": "fur", "color": main, "roughness": 0.8},
                           "shape": {"type": "sphere", "radius_mm": 24}, "attachment": _att("front", "back", (0, 30, -10), contact="embedded")})
        for side, sx in (("left", -1), ("right", 1)):
            bodies.append({"id": f"ear_{side}", "name": f"{side.title()} ear", "role": "ear", "tags": ["signature"], "kind": cv, "parent_id": "body", "material": {"name": "fur", "color": main},
                           "shape": {"type": "cone", "radius_mm": 8 * s, "radius_top_mm": 1, "height_mm": 22 * s}, "attachment": _att("top", "bottom", (12 * sx, -6, 58 * s), contact="embedded")})
            for end, sz in (("front", 1), ("back", -1)):
                bodies.append({"id": f"leg_{end}_{side}", "name": f"{end.title()} {side} leg", "role": "leg", "kind": cv, "parent_id": "body", "material": {"name": "fur", "color": main},
                               "shape": {"type": "capsule", "radius_mm": 8, "height_mm": 60 * s}, "attachment": _att("bottom", "top", (18 * sx, 18, 38 * sz * s), contact="embedded")})
        bodies.append({"id": "tail", "name": "Tail", "role": "tail", "tags": ["signature"], "kind": cv, "parent_id": "body", "material": {"name": "fur", "color": main},
                       "shape": {"type": "capsule", "radius_mm": 5, "height_mm": 56 * s}, "attachment": _att("back", "bottom", (0, 18, 6), rotation_deg=[-50, 0, 0], contact="embedded")})
        bodies.append({"id": "nose", "name": "Nose", "role": "nose", "kind": cv, "parent_id": "body", "material": {"name": "glossy", "color": "#141414", "roughness": 0.2},
                       "shape": {"type": "sphere", "radius_mm": 5}, "attachment": _att("front", "back", (0, 4, -2), contact="embedded")})
        return bodies
    # bird (default organic)
    parts = [{"type": "ellipsoid", "dimensions_mm": [34 * s, 32 * s, 62 * s]}, {"type": "sphere", "radius_mm": 12.5 * s, "frame": {"position_mm": [0, 17 * s, 30 * s]}}]
    bodies = [
        {"id": "perch_base", "name": "Base", "role": "base", "kind": cv, "material": {"name": "wood", "color": "#8a5a3b", "roughness": 0.7},
         "shape": {"type": "revolve_profile", "profile_mm": [[0, 0], [45, 0], [45, 6], [38, 10], [0, 10]]}},
        {"id": "perch_post", "name": "Perch post", "role": "support", "kind": cv, "parent_id": "perch_base", "material": {"name": "wood", "color": "#8a5a3b"},
         "shape": {"type": "cylinder", "radius_mm": 4, "height_mm": 80}, "attachment": _att("top", "bottom", contact="touch")},
        {"id": "body", "name": "Body and head", "role": "body", "tags": ["signature"], "kind": cv, "parent_id": "perch_post",
         "material": {"name": "feathers", "color": main, "metallic": 0.3, "roughness": 0.35},
         "shape": {"type": "occupancy", "smoothing_mm": 7, "pitch_mm": 1.6, "children": parts} if blend else parts[0],
         "attachment": _att("top", "bottom", (0, -3, -4), contact="embedded")},
        {"id": "beak", "name": "Beak", "role": "beak", "tags": ["signature"], "kind": cv, "parent_id": "body", "material": {"name": "keratin", "color": "#121212"},
         "shape": {"type": "cone", "radius_mm": 2.2, "radius_top_mm": 0.3, "height_mm": 34 * s, "axis": "Z"}, "attachment": _att("front", "back", (0, 10 * s, -1.5), contact="embedded")},
        {"id": "throat_patch", "name": "Throat patch", "role": "marking", "kind": cv, "parent_id": "body", "material": {"name": "feathers", "color": accent, "metallic": 0.4},
         "shape": {"type": "ellipsoid", "dimensions_mm": [16, 12, 12]}, "attachment": _att("front", "back", (0, -2, -9), contact="embedded")},
    ]
    if not blend:
        bodies.append({"id": "head", "name": "Head", "role": "head", "kind": cv, "parent_id": "body", "material": {"name": "feathers", "color": main},
                       "shape": {"type": "sphere", "radius_mm": 12.5}, "attachment": _att("front", "back", (0, 17, -8), contact="embedded")})
    for side, sx in (("left", -1), ("right", 1)):
        bodies.append({"id": f"wing_{side}", "name": f"{side.title()} wing", "role": "wing", "tags": ["signature"], "kind": cv, "parent_id": "body",
                       "material": {"name": "feathers", "color": "#1f6b45", "metallic": 0.2}, "shape": {"type": "ellipsoid", "dimensions_mm": [5, 24 * s, 66 * s]},
                       "attachment": _att(side, "right" if sx < 0 else "left", (3 * -sx, 6, -8), rotation_deg=[22, 0, 18 * sx], contact="embedded")})
    bodies.append({"id": "tail", "name": "Tail", "role": "tail", "tags": ["signature"], "kind": cv, "parent_id": "body", "material": {"name": "feathers", "color": "#1f6b45"},
                   "shape": {"type": "extrude_profile", "height_mm": 2.5, "profile_mm": [[-6, 0], [6, 0], [14 * s, -38 * s], [0, -28 * s], [-14 * s, -38 * s]]},
                   "attachment": _att("back", "front", (0, -4, 3), rotation_deg=[-18, 0, 0], contact="embedded")})
    return bodies


def _building(brief: dict, strategy: str, mode: str) -> list[dict]:
    wall, roof = _color(brief, 0, "#e9dfcf"), _color(brief, 1, "#8f3b2c")
    W, D, H = 160.0, 120.0, 90.0
    pitch = {"closest_to_reference": 55, "simpler_manufacture": 20, "signature_geometry": 85}[strategy]
    cv = "concept_visual"
    bodies = [{"id": "walls", "name": "Walls", "role": "walls", "kind": cv, "material": {"name": "plaster", "color": wall, "roughness": 0.8},
               "shape": {"type": "box", "dimensions_mm": [W, H, D]},
               "features": [{"id": "windows_front", "type": "window", "width_mm": 22, "length_mm": 24, "depth_mm": 12, "axis": "Z", "pattern_axis": "X", "position_mm": [0, 10, D / 2], "count": 2, "spacing_mm": 80},
                            {"id": "windows_side", "type": "window", "width_mm": 22, "length_mm": 24, "depth_mm": 12, "axis": "X", "pattern_axis": "Z", "position_mm": [W / 2, 10, 0]}]},
              {"id": "roof", "name": "Roof", "role": "roof", "tags": ["signature"], "kind": cv, "parent_id": "walls", "material": {"name": "tiles", "color": roof, "roughness": 0.7},
               "shape": {"type": "extrude_profile", "axis": "X", "height_mm": W + 16, "profile_mm": [[-D / 2 - 8, 0], [D / 2 + 8, 0], [0, pitch]]},
               "attachment": _att("top", "bottom", contact="touch")},
              {"id": "door", "name": "Door", "role": "door", "kind": cv, "parent_id": "walls", "material": {"name": "wood", "color": "#5b3a24"},
               "shape": {"type": "box", "dimensions_mm": [26, 46, 3]}, "attachment": _att("front", "back", (0, -H / 2 + 23, 0), contact="touch")}]
    if strategy != "simpler_manufacture":
        bodies.append({"id": "chimney", "name": "Chimney", "role": "chimney", "tags": ["signature"], "kind": cv, "parent_id": "roof", "material": {"name": "brick", "color": "#7a3b2e"},
                       "shape": {"type": "box", "dimensions_mm": [16, pitch * 0.9, 16]}, "attachment": _att("bottom", "bottom", (W * 0.28, 0, -D * 0.18), contact="embedded")})
    if strategy == "signature_geometry":
        bodies.append({"id": "porch", "name": "Porch roof", "role": "porch", "kind": cv, "parent_id": "walls", "material": {"name": "tiles", "color": roof},
                       "shape": {"type": "plate", "dimensions_mm": [60, 4, 26]}, "attachment": _att("front", "back", (0, 2, 0), contact="touch")})
    return bodies


def _object(brief: dict, strategy: str, mode: str) -> list[dict]:
    text = _words(brief.get("subject", "") + " " + brief.get("summary", ""))
    c0, c1 = _color(brief, 0, "#d9822b"), _color(brief, 1, "#2b2f36")
    cv = "concept_visual"
    if " lamp " in text:
        stem = {"type": "tube", "radius_mm": 4, "wall_mm": 1, "height_mm": 160}
        shade = {"closest_to_reference": {"type": "cone", "radius_mm": 50, "radius_top_mm": 26, "height_mm": 50}, "simpler_manufacture": {"type": "tube", "radius_mm": 42, "wall_mm": 2, "height_mm": 46},
                 "signature_geometry": {"type": "sphere", "radius_mm": 40}}[strategy]
        return [{"id": "base", "name": "Base", "role": "base", "kind": cv, "material": {"name": "metal", "color": c1, "metallic": 0.6}, "shape": {"type": "cylinder", "radius_mm": 50, "height_mm": 12}},
                {"id": "stem", "name": "Stem", "role": "stem", "kind": cv, "parent_id": "base", "material": {"name": "metal", "color": "#c3c7cc", "metallic": 0.9}, "shape": stem, "attachment": _att("top", "bottom")},
                {"id": "shade", "name": "Shade", "role": "shade", "tags": ["signature"], "kind": cv, "parent_id": "stem", "material": {"name": "fabric", "color": c0}, "shape": shade, "attachment": _att("top", "bottom", contact="embedded")}]
    body = {"closest_to_reference": {"type": "revolve_profile", "profile_mm": [[0, 0], [40, 0], [46, 30], [38, 90], [22, 110], [0, 110]]},
            "simpler_manufacture": {"type": "cylinder", "radius_mm": 40, "height_mm": 110},
            "signature_geometry": {"type": "occupancy", "smoothing_mm": 12, "pitch_mm": 2.5, "children": [{"type": "sphere", "radius_mm": 45}, {"type": "ellipsoid", "dimensions_mm": [50, 80, 50], "frame": {"position_mm": [0, 40, 0]}}]}}[strategy]
    return [{"id": "base", "name": "Base", "role": "base", "kind": cv, "material": {"name": "plastic", "color": c1}, "shape": {"type": "cylinder", "radius_mm": 48, "height_mm": 10}},
            {"id": "body", "name": "Body", "role": "body", "tags": ["signature"], "kind": cv, "parent_id": "base", "material": {"name": "plastic", "color": c0}, "shape": body, "attachment": _att("top", "bottom", contact="embedded")},
            {"id": "cap", "name": "Cap", "role": "cap", "kind": cv, "parent_id": "body", "material": {"name": "plastic", "color": c1}, "shape": {"type": "cylinder", "radius_mm": 16, "height_mm": 14}, "attachment": _att("top", "bottom", contact="embedded")}]


GENERATORS = {"vehicle": _vehicle, "robot_arm": _robot_arm, "enclosure": _enclosure, "organic": _organic, "building": _building, "object": _object}


def author(brief: dict, strategy: str, seed: int, mode: str) -> dict:
    archetype = brief.get("archetype") if brief.get("archetype") in GENERATORS else "object"
    bodies = GENERATORS[archetype](brief, strategy, mode)
    palette = [p for p in (brief.get("palette") or []) if re.match(r"^#[0-9a-fA-F]{6}$", p.get("hex", ""))][:8]
    return {
        "schema_version": "2.0", "mode": mode, "subject": brief.get("subject", archetype)[:240], "seed": seed, "strategy": strategy,
        "visual_goal": {"signature_features": list(brief.get("signature_features", []))[:12], "description": brief.get("summary", "")[:2000],
                        "palette": [{"name": p["name"][:60], "hex": p["hex"]} for p in palette],
                        "proportion_targets": {k: v for k, v in (brief.get("proportions") or {}).items() if isinstance(v, (int, float)) and 0 < v <= 100}},
        "constraints": {"max_bounds_mm": [600, 600, 600], "min_wall_mm": 1.6 if mode == "engineered" else 1.0,
                        "min_general_clearance_mm": 1.0 if mode == "engineered" else 0.0, "must_be_stable": True},
        "bodies": bodies,
        "notes": ["authored offline by Rivet's rule-based design author (fixture mode)"],
    }


def _diff_patch(old: dict, new: dict, reason: str) -> dict | None:
    diff = changed_bodies(old, new)
    old_b = {b["id"]: b for b in old["bodies"]}
    new_b = {b["id"]: b for b in new["bodies"]}
    ops = [{"operation": "add", "body_id": i, "body": new_b[i]} for i in diff["added"]]
    ops += [{"operation": "replace", "body_id": i, "body": new_b[i]} for i in diff["changed"] if old_b[i].get("catalog_id") == new_b[i].get("catalog_id")]
    ops += [{"operation": "remove", "body_id": i} for i in diff["removed"] if not old_b[i].get("required", True)]
    return {"reason": reason, "operations": ops} if ops else None


def _scale(body: dict, axis: int, factor: float) -> dict:
    shape = body.get("shape") or {}
    if shape.get("type") in ("box", "plate", "rounded_box", "ellipsoid"):
        dims = list(shape["dimensions_mm"])
        dims[axis] = round(dims[axis] * factor, 2)
        return {"shape.dimensions_mm": dims}
    if shape.get("type") == "extrude_profile" and (shape.get("axis") or "Y") == "Y" and axis in (0, 2):
        k = 0 if axis == 0 else 1
        return {"shape.profile_mm": [[round(p[0] * (factor if k == 0 else 1), 2), round(p[1] * (factor if k == 1 else 1), 2)] for p in shape["profile_mm"]]}
    if shape.get("type") == "loft" and axis in (0, 2):
        k = 0 if axis == 0 else 1
        return {"shape.sections": [[[round(p[0] * (factor if k == 0 else 1), 2), round(p[1] * (factor if k == 1 else 1), 2)] for p in s] for s in shape["sections"]]}
    return {}


def edit(spec: dict, instruction: str, brief: dict | None = None) -> dict:
    """Rule-based NL edit compiler -> DesignPatch dict (empty operations = no change understood)."""
    t = _words(instruction)
    bodies = spec["bodies"]
    root = next(b for b in bodies if b.get("parent_id") is None)
    ops: list[dict] = []

    def update(body: dict, values: dict):
        if values:
            ops.append({"operation": "update", "body_id": body["id"], "set": values})

    targets = [b for b in bodies if any(w in t for w in (f" {b['role'].replace('_', ' ')} ", f" {b['name'].lower()} ", f" {b['id'].replace('_', ' ')} "))]
    shells = [b for b in bodies if b.get("role") in ("shell", "enclosure", "walls") and b.get("kind") != "purchased"]
    wheel_words = re.search(r"\b(four|4|six|6|two|2) ?(wheel|wd)", t)
    if wheel_words and brief and brief.get("archetype") == "vehicle":
        count = {"four": 4, "4": 4, "six": 6, "6": 6, "two": 2, "2": 2}[wheel_words.group(1)]
        regenerated = author({**brief, "wheel_count": count}, spec.get("strategy", "closest_to_reference") if spec.get("strategy") in ("closest_to_reference", "simpler_manufacture", "signature_geometry") else "closest_to_reference", spec.get("seed", 0), spec["mode"])
        patch = _diff_patch(spec, regenerated, f"change to {count} wheels")
        if patch:
            return patch
    for word, axis, factor in ((" wider ", 0, 1.2), (" narrower ", 0, 1 / 1.2), (" longer ", 2, 1.2), (" shorter ", 2, 1 / 1.2), (" taller ", 1, 1.2)):
        if word in t and not re.search(r"(sensor|pod)", t):
            chosen = [b for b in targets if b.get("kind") != "purchased"] or [root] + ([b for b in shells if b is not root] if axis != 1 else shells)
            for b in chosen:
                update(b, _scale(b, axis, factor))
    if re.search(r"(sensor|pod).*(higher|up|taller|raise)|(raise|move).*(sensor|pod).*(up|higher)", t):
        pod = next((b for b in bodies if b.get("role") == "sensor_housing"), None)
        if pod:
            off = list(pod["attachment"].get("offset_mm", [0, 0, 0]))
            update(pod, {"attachment.offset_mm": [off[0], off[1] + 16, off[2]]})
    if re.search(r"(sensor|pod).*(lower|down)", t):
        pod = next((b for b in bodies if b.get("role") == "sensor_housing"), None)
        if pod:
            off = list(pod["attachment"].get("offset_mm", [0, 0, 0]))
            update(pod, {"attachment.offset_mm": [off[0], max(0.0, off[1] - 10), off[2]]})
    color = next((h for w, h in COLORS.items() if f" {w} " in t), None)
    if color:
        for b in ([x for x in targets if x.get("kind") != "purchased"] or shells or [root]):
            update(b, {"material.color": color})
    if " thicker " in t and " wall" in t:
        for b in shells:
            for i, f in enumerate(b.get("features") or []):
                if f["type"] == "shell":
                    update(b, {f"features.{i}.wall_mm": round(f.get("wall_mm", 2) + 1, 2)})
    if " window " in t and shells:
        b = shells[0]
        dims = (b["shape"].get("dimensions_mm") or [80, 30, 60])
        feats = list(b.get("features") or []) + [{"id": f"window_{len(b.get('features') or []) + 1}", "type": "window", "width_mm": max(6, dims[1] * 0.3), "length_mm": max(10, dims[0] * 0.3),
                                                   "depth_mm": 12, "axis": "X", "pattern_axis": "Z", "position_mm": [dims[0] / 2, 0, 0]}]
        update(b, {"features": feats})
    if " panel " in t or " bracket " in t:
        name = "bracket" if " bracket " in t else "panel"
        ops.append({"operation": "add", "body_id": f"added_{name}_{len(bodies)}", "body": {
            "id": f"added_{name}_{len(bodies)}", "name": f"Added {name}", "role": name, "kind": "fabricated" if spec["mode"] == "engineered" else "concept_visual",
            "manufacturing": "3d_print" if spec["mode"] == "engineered" else "none", "parent_id": root["id"], "required": False, "material": {"name": "PETG", "color": "#c3c7cc"},
            "shape": {"type": "plate", "dimensions_mm": [40, 3, 30]}, "attachment": {"parent_anchor": "back", "child_anchor": "front", "offset_mm": [0, 0, 0], "contact": "fastened"}}})
    merged: dict[str, dict] = {}
    rest = []
    for op in ops:
        if op["operation"] == "update":
            merged.setdefault(op["body_id"], {}).update(op["set"])
        else:
            rest.append(op)
    final = [{"operation": "update", "body_id": k, "set": v} for k, v in merged.items()] + rest
    return {"reason": instruction[:400] or "edit", "operations": final}


def critic_patch(spec: dict, issues: list[dict]) -> dict | None:
    """Translate deterministic critic issues into a bounded patch (proportions and colours)."""
    ops = []
    by_id = {b["id"]: b for b in spec["bodies"]}
    for issue in issues:
        body = by_id.get(issue.get("body_id") or "")
        if body is None or body.get("kind") == "purchased":
            continue
        change = issue.get("patch") or {}
        if "scale_axis" in change:
            values = _scale(copy.deepcopy(body), change["scale_axis"], change["factor"])
            if values:
                ops.append({"operation": "update", "body_id": body["id"], "set": values})
        if "color" in change:
            ops.append({"operation": "update", "body_id": body["id"], "set": {"material.color": change["color"]}})
    return {"reason": "critic-guided revision", "operations": ops[:8]} if ops else None


def round_mm(v: float) -> float:
    return round(v, 2) if math.isfinite(v) else 0.0
