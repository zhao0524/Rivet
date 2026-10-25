"""Rigid transforms in millimetres, right-handed, Y up.

Euler angles follow the three.js 'XYZ' convention used throughout Rivet (R = Rx Ry Rz),
so a renderer can apply `rotation_deg` directly. Matrices are 4x4 numpy arrays acting on
column vectors.
"""
from __future__ import annotations

import math
from collections.abc import Sequence

import numpy as np

AXES = {"X": np.array([1.0, 0.0, 0.0]), "Y": np.array([0.0, 1.0, 0.0]), "Z": np.array([0.0, 0.0, 1.0])}

# Proper rotations that carry local +Y (the build axis of every axis-oriented primitive)
# onto the requested axis. For profiles drawn in the plane normal to the axis this maps
# 2D points (a, b) to: Y -> (x=a, z=b), Z -> (x=a, y=b), X -> (z=a, y=b).
_ALIGN = {
    "Y": np.eye(3),
    "Z": np.array([[1.0, 0.0, 0.0], [0.0, 0.0, 1.0], [0.0, -1.0, 0.0]]),
    "X": np.array([[0.0, 1.0, 0.0], [0.0, 0.0, 1.0], [1.0, 0.0, 0.0]]),
}


def euler_xyz(rotation_deg: Sequence[float]) -> np.ndarray:
    a, b, c = (math.radians(float(v)) for v in rotation_deg)
    ca, sa, cb, sb, cc, sc = math.cos(a), math.sin(a), math.cos(b), math.sin(b), math.cos(c), math.sin(c)
    rx = np.array([[1, 0, 0], [0, ca, -sa], [0, sa, ca]])
    ry = np.array([[cb, 0, sb], [0, 1, 0], [-sb, 0, cb]])
    rz = np.array([[cc, -sc, 0], [sc, cc, 0], [0, 0, 1]])
    return rx @ ry @ rz


def to_euler_xyz(r: np.ndarray) -> tuple[float, float, float]:
    """Inverse of euler_xyz (three.js Euler.setFromRotationMatrix, order XYZ), degrees."""
    m13 = float(np.clip(r[0, 2], -1.0, 1.0))
    ry = math.asin(m13)
    if abs(m13) < 0.9999999:
        rx, rz = math.atan2(-r[1, 2], r[2, 2]), math.atan2(-r[0, 1], r[0, 0])
    else:
        rx, rz = math.atan2(r[2, 1], r[1, 1]), 0.0
    return (math.degrees(rx), math.degrees(ry), math.degrees(rz))


def matrix(position: Sequence[float] = (0, 0, 0), rotation_deg: Sequence[float] = (0, 0, 0)) -> np.ndarray:
    m = np.eye(4)
    m[:3, :3] = euler_xyz(rotation_deg)
    m[:3, 3] = [float(v) for v in position]
    return m


def from_rotation(r: np.ndarray, t: Sequence[float] = (0, 0, 0)) -> np.ndarray:
    m = np.eye(4)
    m[:3, :3] = r
    m[:3, 3] = t
    return m


def translation(t: Sequence[float]) -> np.ndarray:
    return from_rotation(np.eye(3), t)


def inverse(m: np.ndarray) -> np.ndarray:
    r = m[:3, :3]
    out = np.eye(4)
    out[:3, :3] = r.T
    out[:3, 3] = -r.T @ m[:3, 3]
    return out


def apply(m: np.ndarray, points: np.ndarray) -> np.ndarray:
    pts = np.asarray(points, dtype=float)
    return pts @ m[:3, :3].T + m[:3, 3]


def apply_dir(m: np.ndarray, dirs: np.ndarray) -> np.ndarray:
    return np.asarray(dirs, dtype=float) @ m[:3, :3].T


def align_y_to(axis: str) -> np.ndarray:
    return _ALIGN[axis].copy()


def rotation_about(axis: Sequence[float], angle_deg: float) -> np.ndarray:
    k = np.asarray(axis, dtype=float)
    k = k / np.linalg.norm(k)
    a = math.radians(angle_deg)
    kx = np.array([[0, -k[2], k[1]], [k[2], 0, -k[0]], [-k[1], k[0], 0]])
    return np.eye(3) + math.sin(a) * kx + (1 - math.cos(a)) * (kx @ kx)


def frame_from_normal(position: Sequence[float], normal: Sequence[float], tangent_hint: Sequence[float]) -> np.ndarray:
    """Right-handed frame with +Y = normal and +Z = the hint projected onto the face plane."""
    n = np.asarray(normal, dtype=float)
    n = n / np.linalg.norm(n)
    t2 = np.asarray(tangent_hint, dtype=float) - n * float(np.dot(tangent_hint, n))
    if np.linalg.norm(t2) < 1e-9:
        alt = np.array([0.0, 0.0, 1.0]) if abs(n[2]) < 0.9 else np.array([1.0, 0.0, 0.0])
        t2 = alt - n * float(np.dot(alt, n))
    t2 = t2 / np.linalg.norm(t2)
    t1 = np.cross(n, t2)
    r = np.column_stack([t1, n, t2])
    return from_rotation(r, position)


def quantize(m: np.ndarray, digits: int = 6) -> list[float]:
    """Row-major 16 floats rounded for hashing and JSON."""
    out = []
    for v in np.asarray(m, dtype=float).reshape(-1):
        r = round(float(v), digits)
        out.append(0.0 if r == 0 else r)
    return out
