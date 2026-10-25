"""Small helpers for writing hand-built concept models in code.

Coordinates follow `concept/model.py`: millimetres, Y up, +Z toward the object's front, +X to
its right. Rotations are XYZ Euler degrees (three.js order). Cylinders, cones and capsules run
along local Y; wheels along local X; tori and propellers lie in the local X-Z plane.
"""

import math
from collections.abc import Iterable, Sequence

from rivet_api.concept.model import ConceptModel, ConceptPart, ConceptWire, clean_concept, segment_pose

Vec = Sequence[float]

# Rotations that turn a local-Y primitive (cylinder, cone, capsule) onto a world axis,
# and a flat local-XZ primitive (torus, propeller) to face that axis.
ALONG_X = (0.0, 0.0, 90.0)
ALONG_Z = (90.0, 0.0, 0.0)
ALONG_Y = (0.0, 0.0, 0.0)

# Hand-built demo models are far more detailed than a vision reply may be.
DEMO_MAX_PARTS = 600


class Kit:
    def __init__(self) -> None:
        self.parts: list[ConceptPart] = []
        self.wires: list[ConceptWire] = []
        self._names: dict[str, int] = {}
        self._used: set[str] = set()

    def _unique(self, name: str) -> str:
        """Repeats are numbered ("Rim spoke 2"); wires find parts by these names."""
        n = self._names.get(name, 0)
        candidate = name
        while candidate in self._used:
            n += 1
            candidate = f"{name} {n + 1}" if n else name
        self._names[name] = n
        self._used.add(candidate)
        return candidate

    def add(
        self,
        name: str,
        category: str,
        shape: str,
        size: Vec,
        pos: Vec,
        rot: Vec = (0.0, 0.0, 0.0),
        color: str = "#1a1a1a",
        material: str = "plastic",
        internal: bool = False,
    ) -> str:
        """One part placed by its centre; returns its (unique) name."""
        name = self._unique(name)
        self.parts.append(
            ConceptPart(
                name=name,
                category=category,
                shape=shape,
                size_mm=[float(v) for v in size],
                position_mm=[float(v) for v in pos],
                rotation_deg=[float(v) for v in rot],
                color=color,
                material=material,
                internal=internal,
            )
        )
        return name

    def rod(
        self,
        name: str,
        category: str,
        a: Vec,
        b: Vec,
        width: float,
        depth: float | None = None,
        color: str = "#1a1a1a",
        material: str = "plastic",
        shape: str = "cylinder",
        internal: bool = False,
    ) -> str:
        """A long part stretched from `a` to `b` (local Y along the segment, local Z vertical)."""
        centre, rot, length = segment_pose([float(v) for v in a], [float(v) for v in b])
        return self.add(name, category, shape, (width, max(length, 0.5), depth or width), centre, rot, color, material, internal)

    def ring(
        self,
        name: str,
        category: str,
        centre: Vec,
        axis: Vec,
        diameter: float,
        thickness: float,
        color: str = "#1a1a1a",
        material: str = "plastic",
        shape: str = "torus",
    ) -> str:
        """A torus (or other flat local-XZ shape) centred at `centre`, facing along `axis`."""
        a = [centre[i] - axis[i] for i in range(3)]
        b = [centre[i] + axis[i] for i in range(3)]
        _, rot, _ = segment_pose(a, b)
        return self.add(name, category, shape, (diameter, thickness, diameter), centre, rot, color, material)

    def polyline(
        self,
        name: str,
        category: str,
        points: Sequence[Vec],
        width: float,
        color: str = "#1a1a1a",
        material: str = "plastic",
        shape: str = "cylinder",
    ) -> list[str]:
        """A bent rod or visible cable as straight segments, with a joint ball at every bend."""
        names = []
        for i in range(len(points) - 1):
            names.append(self.rod(name, category, points[i], points[i + 1], width, color=color, material=material, shape=shape))
            if 0 < i + 1 < len(points) - 1 and shape == "cylinder":
                self.add(f"{name} bend", category, "sphere", (width, width, width), points[i + 1], color=color, material=material)
        return names

    def wire(self, name: str, a: str, b: str, kind: str, color: str, thickness: float = 1.5, via: Iterable[Vec] = ()) -> None:
        self.wires.append(
            ConceptWire(
                name=name, from_part=a, to_part=b, kind=kind, color=color, thickness_mm=thickness,
                via_mm=[[float(v) for v in p] for p in via],
            )
        )

    def model(self, title: str, object_type: str, summary: str, assumptions: list[str]) -> ConceptModel:
        raw = ConceptModel(
            title=title,
            object_type=object_type,
            summary=summary,
            parts=self.parts,
            wires=self.wires,
            assumptions=assumptions,
            confidence="high",
        )
        cleaned = clean_concept(raw, DEMO_MAX_PARTS)
        # The cleaner stacks overlapping internal parts apart; hand-placed ones must not need it.
        moved = [a.name for a, b in zip(raw.parts, cleaned.parts) if a.internal and a.position_mm != b.position_mm]
        if moved:
            raise ValueError(f"internal parts overlap and would be moved: {moved}")
        return cleaned


def ring_points(centre: Vec, radius: float, start_deg: float, end_deg: float, count: int, plane: str = "xz") -> list[tuple[float, float, float]]:
    """Points on an arc. `plane` "xz" is horizontal (angle from +X toward +Z); "yz" is a wheel
    face seen from the side (angle from +Y toward +Z); "xy" faces +Z (angle from +X toward +Y)."""
    cx, cy, cz = centre
    out = []
    for i in range(count):
        t = math.radians(start_deg + (end_deg - start_deg) * i / max(1, count - 1))
        c, s = math.cos(t) * radius, math.sin(t) * radius
        out.append((cx + c, cy, cz + s) if plane == "xz" else (cx, cy + c, cz + s) if plane == "yz" else (cx + c, cy + s, cz))
    return out


def mirror_x(p: Vec) -> tuple[float, float, float]:
    return (-p[0], p[1], p[2])
