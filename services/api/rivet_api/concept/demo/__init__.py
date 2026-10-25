"""Hand-built concept models for the demo photos.

When one of the demo photos is uploaded (recognised by its file name or its exact bytes), the
concept build serves the matching hand-built model instead of asking the vision model. The
models are still concept models: appearance only, labelled `manual_template`, never sourced.
"""

import hashlib
import importlib
import re
from dataclasses import dataclass
from functools import cache
from pathlib import PurePath

from rivet_api.concept.model import ConceptModel


@dataclass(frozen=True)
class DemoEntry:
    key: str  # also the module in this package whose `build()` makes the model
    names: tuple[str, ...]  # normalised file stems that select this model
    sha256: str  # the original photo's bytes


_ENTRIES = (
    DemoEntry("drone", ("drone",), "ce1c21c74961882612162462718b868c8b55a14787f537f850cc44710b432b3e"),
    DemoEntry("fpv_car", ("mini gizmofpv black", "mini gizmofpv"), "c781a9c9aa7cc4a9c188141951c0eb36aa947b4de615683372edb65da6c35a0c"),
    DemoEntry("rc_truck", ("rc car",), "0c6ea553b36da6bc829e5822ab7334e80fdbe719c84232398da5fa7f67aae026"),
    DemoEntry("boat", ("boat",), "0a398a6e2c86555a523bd90ae5d177abaa36e28ecc05863b5f741932d9de54e6"),
    DemoEntry("arm", ("mechanical arm",), "6e69b51dc408238152dbf8ae59ece3fad91f260ee90a78fb18c1cb831d07d3d9"),
    DemoEntry("robot_dog", ("robot dog",), "caf4840ad1c0911f7f2b9d62d2926d20e5576331fe557e4a646d62a7290d8890"),
    DemoEntry("pi_camera", ("raspberry pi camera",), "4934d5940f12f2697cb38bd378ada580b5d581570306a3de0266c8d1663f81fc"),
    DemoEntry("esp32", ("microconstroller", "microcontroller"), "5e87a8eb7f9d65a128c4bcc3765b4f8fa54abc54a0497af63fd671e74b21f917"),
)


def _entries() -> tuple[DemoEntry, ...]:
    return _ENTRIES


_SEPARATORS = re.compile(r"[\s_\-.]+")
# Browsers and OSes add these when a file is saved twice: "drone (1).jpg", "drone copy.jpg".
_COPY_SUFFIX = re.compile(r"(\s*\(\d+\)|\s+copy(\s+\d+)?)$")


def normalise_name(filename: str) -> str:
    stem = PurePath(filename.replace("\\", "/")).stem.lower().strip()
    stem = _COPY_SUFFIX.sub("", stem)
    return _SEPARATORS.sub(" ", stem).strip()


def match_upload(filename: str | None, data: bytes) -> str | None:
    """The demo key for an upload, by exact bytes first, then by file name."""
    digest = hashlib.sha256(data).hexdigest()
    entries = _entries()
    for entry in entries:
        if entry.sha256 == digest:
            return entry.key
    if filename:
        name = normalise_name(filename)
        for entry in entries:
            if name in entry.names:
                return entry.key
    return None


def demo_keys() -> list[str]:
    return [e.key for e in _entries()]


@cache
def _built(key: str) -> ConceptModel:
    if key not in demo_keys():
        raise KeyError(key)
    return importlib.import_module(f"{__name__}.{key}").build()


def demo_concept(key: str) -> ConceptModel:
    """The hand-built model for a demo key (a fresh copy; the cached one is never handed out)."""
    return _built(key).model_copy(deep=True)
