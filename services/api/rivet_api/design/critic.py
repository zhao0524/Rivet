"""VisualReview: deterministic silhouette/proportion/feature/colour metrics, plus a
multimodal model critique in live mode. Model scores are subjective and labelled as
such; engineering is never scored here. Issues are tied to body ids."""
from __future__ import annotations

import io
import math
import re
from typing import Any

import numpy as np
from PIL import Image

from .models import VisualReview

DETERMINISTIC_JUDGE = "rivet-deterministic-critic/1"


def _norm_mask(mask: np.ndarray, size: int = 64) -> np.ndarray | None:
    ys, xs = np.nonzero(mask)
    if len(xs) < 20:
        return None
    crop = mask[ys.min(): ys.max() + 1, xs.min(): xs.max() + 1]
    return np.asarray(Image.fromarray((crop * 255).astype(np.uint8)).resize((size, size), Image.NEAREST)) > 127


def reference_mask(data: bytes) -> np.ndarray | None:
    img = np.asarray(Image.open(io.BytesIO(data)).convert("RGB").resize((256, 256))).astype(float)
    border = np.concatenate([img[0], img[-1], img[:, 0], img[:, -1]])
    fg = np.linalg.norm(img - np.median(border, axis=0), axis=2) > 40
    return fg if fg.sum() > 100 else None


def silhouette_iou(a: np.ndarray, b: np.ndarray) -> float:
    na, nb = _norm_mask(a), _norm_mask(b)
    if na is None or nb is None:
        return 0.0
    union = np.logical_or(na, nb).sum()
    return float(np.logical_and(na, nb).sum() / union) if union else 0.0


def _extent(mask: np.ndarray) -> tuple[float, float]:
    ys, xs = np.nonzero(mask)
    return (float(xs.max() - xs.min() + 1), float(ys.max() - ys.min() + 1)) if len(xs) else (1.0, 1.0)


def _hex(c: str) -> np.ndarray:
    return np.array([int(c[i: i + 2], 16) for i in (1, 3, 5)], dtype=float)


def _score_ratio(measured: float, target: float) -> float:
    return 10.0 * math.exp(-2.0 * abs(math.log(max(measured, 1e-6) / max(target, 1e-6))))


def deterministic_review(brief: dict, spec: dict, manifest: list[dict], shots: list[dict], references: list[tuple[str, bytes]], render_digest: str) -> dict:
    by_view = {s["view"]: s["mask"] for s in shots}
    width = _extent(by_view["front"])[0]
    length = _extent(by_view["left"])[0]
    height = _extent(by_view["front"])[1]
    measured = {"length_width": length / width, "height_length": height / max(length, 1)}
    targets = {k: float(v) for k, v in (brief.get("proportions") or {}).items() if k in measured}
    body_parts = [p for p in manifest if p.get("status") == "placed"]
    fabricated = [p for p in body_parts if p["kind"] != "purchased"]
    root = next((p for p in body_parts if p.get("parent_id") is None), body_parts[0] if body_parts else None)
    issues: list[dict] = []
    prop_scores = []
    for key, target in targets.items():
        score = _score_ratio(measured[key], target)
        prop_scores.append(score)
        if score < 6 and root is not None:
            axis, factor = (2, target / measured[key]) if key == "length_width" else (1, target / measured[key])
            factor = float(min(1.3, max(0.77, factor)))
            issues.append({"body_id": root["body_id"], "view": "left" if key == "length_width" else "front", "severity": "major",
                           "observed": f"{key.replace('_', ':')} is {measured[key]:.2f}", "target": f"{target:.2f} from the brief",
                           "proposed_change": f"scale {root['name']} {'length' if axis == 2 else 'height'} by {factor:.2f}", "patch": {"scale_axis": axis, "factor": factor}})
    words = " ".join(f"{p['name']} {p['role']} {' '.join(p.get('tags') or [])}" for p in body_parts).lower()
    features = brief.get("signature_features") or []
    present = []
    for f in features:
        tokens = [t for t in re.findall(r"[a-z]+", f.lower()) if len(t) > 3 and t not in ("visible", "front", "with", "large", "small")]
        hit = any(t.rstrip("s") in words for t in tokens) if tokens else True
        present.append(hit)
        if not hit and root is not None:
            issues.append({"body_id": root["body_id"], "view": "perspective", "severity": "minor", "observed": f"no part reads as '{f}'", "target": f, "proposed_change": f"add or emphasise {f}"})
    palette = [p["hex"] for p in (brief.get("palette") or []) if re.match(r"^#[0-9a-fA-F]{6}$", p.get("hex", ""))]
    colour_score = 7.0
    if palette and fabricated:
        biggest = max(fabricated, key=lambda p: p.get("volume_mm3") or 0)
        dist = min(float(np.linalg.norm(_hex(biggest["material"]["color"]) - _hex(c))) for c in palette)
        colour_score = 10.0 * math.exp(-dist / 120.0)
        if colour_score < 5:
            issues.append({"body_id": biggest["body_id"], "view": "perspective", "severity": "minor", "observed": f"main colour {biggest['material']['color']}",
                           "target": f"palette {palette[0]}", "proposed_change": f"recolour {biggest['name']} to {palette[0]}", "patch": {"color": palette[0]}})
    ious = {}
    for label, data in references:
        ref = reference_mask(data)
        if ref is not None:
            ious[label] = max(silhouette_iou(ref, by_view[v]) for v in ("perspective", "front", "left", "right"))
    silhouette = 10.0 * (max(ious.values()) if ious else 0.6)
    scores = {
        "silhouette": round(silhouette, 2),
        "proportions": round(float(np.mean(prop_scores)) if prop_scores else 7.0, 2),
        "signature_features": round(10.0 * (sum(present) / len(present)) if present else 7.0, 2),
        "pose_and_orientation": 8.0 if all(s["mask"].any() for s in shots) else 2.0,
        "colour_and_surface": round(colour_score, 2),
        "reference_consistency": round(silhouette if ious else 6.0, 2),
    }
    overall = round(0.25 * scores["silhouette"] + 0.25 * scores["proportions"] + 0.25 * scores["signature_features"] + 0.1 * scores["pose_and_orientation"] + 0.15 * scores["colour_and_surface"], 2)
    return {
        "scores": scores, "overall": overall, "issues": issues,
        "summary": f"Measured length:width {measured['length_width']:.2f}, height:length {measured['height_length']:.2f}; {sum(present)}/{len(present)} signature features matched by part names"
                   + (f"; best reference silhouette overlap {max(ious.values()):.2f}" if ious else "; no reference image to compare silhouettes"),
        "subjective": True, "judge_model": DETERMINISTIC_JUDGE, "render_digest": render_digest,
        "metrics": {"measured_proportions": {k: round(v, 3) for k, v in measured.items()}, "target_proportions": targets, "features_present": dict(zip(features, present)),
                    "reference_silhouette_iou": {k: round(v, 3) for k, v in ious.items()}, "method": "deterministic silhouette, proportion, part-name and palette metrics"},
    }


def merge_model_review(model: dict, deterministic: dict, body_ids: set[str], judge: str) -> dict:
    """Validate a model critique, keep its subjective scores, bind issues to known bodies,
    and keep the deterministic metrics alongside (never averaged into engineering)."""
    keys = ("silhouette", "proportions", "signature_features", "pose_and_orientation", "colour_and_surface", "reference_consistency")
    raw = model.get("scores") or {}
    scores = {k: round(float(min(10, max(0, float(raw.get(k, deterministic["scores"][k]))))), 2) for k in keys}
    issues = []
    for i in (model.get("issues") or [])[:20]:
        if not isinstance(i, dict):
            continue
        bid = i.get("body_id") if i.get("body_id") in body_ids else None
        sev = i.get("severity") if i.get("severity") in ("minor", "major", "critical") else "minor"
        issues.append({"body_id": bid, "view": str(i.get("view", "perspective"))[:30], "severity": sev, "observed": str(i.get("observed", ""))[:300],
                       "target": str(i.get("target", ""))[:300], "proposed_change": str(i.get("proposed_change", ""))[:300]})
    overall = model.get("overall")
    overall = round(float(min(10, max(0, float(overall)))), 2) if isinstance(overall, (int, float)) else round(float(np.mean(list(scores.values()))), 2)
    return {"scores": scores, "overall": overall, "issues": issues + [i for i in deterministic["issues"] if "patch" in i][:4],
            "summary": str(model.get("summary", ""))[:600] or deterministic["summary"], "subjective": True, "judge_model": judge,
            "render_digest": deterministic["render_digest"], "metrics": {**deterministic["metrics"], "deterministic_scores": deterministic["scores"], "deterministic_overall": deterministic["overall"]}}


def validated(review: dict) -> dict[str, Any]:
    VisualReview.model_validate(review)
    return review
