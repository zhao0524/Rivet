"""Safe image asset storage.

Uploads are never trusted: content is sniffed and fully decoded, pixel and byte
budgets are enforced before and during decoding, EXIF orientation is applied and then
all metadata is dropped by re-encoding from raw pixels, large images are downscaled,
and files are stored under server-generated ids only (the client filename is ignored).
"""

import io
import logging
import os
import re
import tempfile
import threading
import uuid
import warnings
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageOps

from rivet_api.errors import ApiError

log = logging.getLogger("rivet_api")

_ASSET_ID_RE = re.compile(r"^asset-[0-9a-f]{32}$")
_FORMATS = {
    "PNG": (".png", "image/png"),
    "JPEG": (".jpg", "image/jpeg"),
    "WEBP": (".webp", "image/webp"),
}
_MIME_BY_EXT = {ext: mime for ext, mime in _FORMATS.values()}


@dataclass(frozen=True)
class AssetRecord:
    asset_id: str
    mime_type: str
    size_bytes: int


def _invalid(reason: str) -> ApiError:
    return ApiError(
        "INVALID_IMAGE",
        "The upload is not a valid PNG, JPEG or WebP image",
        400,
        {"reason": reason},
    )


class AssetStore:
    def __init__(
        self,
        root: Path,
        max_bytes: int = 10 * 1024 * 1024,
        max_pixels: int = 40_000_000,
        max_edge_px: int = 2048,
        per_session_quota: int = 20,
    ):
        self.root = Path(root)
        self.max_bytes = max_bytes
        self.max_pixels = max_pixels
        self.max_edge_px = max_edge_px
        self.per_session_quota = per_session_quota
        self._uploads: dict[str, int] = {}
        self._guard = threading.Lock()

    # -- lookup --------------------------------------------------------------
    @staticmethod
    def _check_id(asset_id: str) -> str:
        if not isinstance(asset_id, str) or not _ASSET_ID_RE.match(asset_id):
            raise ApiError("ASSET_NOT_FOUND", "No such asset", 404)
        return asset_id

    def _path(self, asset_id: str) -> Path | None:
        self._check_id(asset_id)
        for ext in _MIME_BY_EXT:
            candidate = self.root / f"{asset_id}{ext}"
            if candidate.is_file():
                return candidate
        return None

    def exists(self, asset_id: str) -> bool:
        try:
            return self._path(asset_id) is not None
        except ApiError:
            return False

    def read_bytes(self, asset_id: str) -> tuple[bytes, str]:
        path = self._path(asset_id)
        if path is None:
            raise ApiError("ASSET_NOT_FOUND", "No such asset", 404)
        return path.read_bytes(), _MIME_BY_EXT[path.suffix]

    # -- upload --------------------------------------------------------------
    def save(self, data: bytes, session_id: str) -> AssetRecord:
        self._count_attempt(session_id[:128] or "anonymous")
        if len(data) > self.max_bytes:
            raise ApiError(
                "FILE_TOO_LARGE",
                f"Images must be at most {self.max_bytes} bytes",
                413,
                {"max_bytes": self.max_bytes},
            )
        fmt, clean = self._decode_and_clean(data)
        ext, mime = _FORMATS[fmt]
        encoded = self._encode(clean, fmt)
        asset_id = f"asset-{uuid.uuid4().hex}"
        self._write_atomic(self.root / f"{asset_id}{ext}", encoded)
        return AssetRecord(asset_id=asset_id, mime_type=mime, size_bytes=len(encoded))

    def _count_attempt(self, session_id: str) -> None:
        with self._guard:
            used = self._uploads.get(session_id, 0)
            if used >= self.per_session_quota:
                raise ApiError(
                    "QUOTA_EXCEEDED",
                    "Upload quota for this session is used up",
                    429,
                    {"quota": self.per_session_quota},
                )
            self._uploads[session_id] = used + 1

    def _decode_and_clean(self, data: bytes) -> tuple[str, Image.Image]:
        if not data:
            raise _invalid("empty file")
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("ignore", Image.DecompressionBombWarning)
                img = Image.open(io.BytesIO(data))
                fmt = img.format
                if fmt not in _FORMATS:
                    raise _invalid(f"unsupported format {fmt!r}")
                width, height = img.size
                if width <= 0 or height <= 0 or width * height > self.max_pixels:
                    raise _invalid("image dimensions exceed the pixel budget")
                img.load()  # full decode: catches truncated and corrupt data
        except ApiError:
            raise
        except (OSError, SyntaxError, ValueError, Image.DecompressionBombError) as exc:
            raise _invalid(type(exc).__name__) from exc

        img = ImageOps.exif_transpose(img)  # bake in orientation before metadata is dropped
        keep_alpha = img.mode in ("RGBA", "LA", "PA") or "transparency" in img.info
        if keep_alpha and fmt != "JPEG":
            want = "RGBA"
        else:
            want = "L" if img.mode == "L" else "RGB"
        if img.mode != want:
            img = img.convert(want)
        # Rebuild from raw pixels so no EXIF, ICC, text chunks or XMP survive.
        clean = Image.frombytes(img.mode, img.size, img.tobytes())
        if max(clean.size) > self.max_edge_px:
            clean.thumbnail((self.max_edge_px, self.max_edge_px), Image.LANCZOS)
        return fmt, clean

    @staticmethod
    def _encode(img: Image.Image, fmt: str) -> bytes:
        buf = io.BytesIO()
        if fmt == "JPEG":
            img.convert("RGB").save(buf, "JPEG", quality=90, optimize=True)
        elif fmt == "PNG":
            img.save(buf, "PNG", optimize=True)
        else:
            img.save(buf, "WEBP", quality=90)
        return buf.getvalue()

    def _write_atomic(self, path: Path, data: bytes) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=self.root, prefix=".tmp-")
        try:
            with os.fdopen(fd, "wb") as f:
                f.write(data)
            os.replace(tmp, path)
        except BaseException:
            if os.path.exists(tmp):
                os.unlink(tmp)
            raise
