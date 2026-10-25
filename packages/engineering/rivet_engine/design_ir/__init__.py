"""Versioned, offline Rivet design intermediate representation (DesignSpec v2)."""

from .models import (
    BodyPatch,
    DesignBody,
    DesignPatch,
    DesignSpec,
    Shape,
    apply_patch,
    changed_bodies,
    implicit_anchor_axes,
    json_schema,
    normalize_spec_shapes,
    spec_digest,
    topology_signature,
)

__all__ = [
    "BodyPatch", "DesignBody", "DesignPatch", "DesignSpec", "Shape", "apply_patch", "changed_bodies",
    "implicit_anchor_axes", "json_schema", "normalize_spec_shapes", "spec_digest", "topology_signature",
]
