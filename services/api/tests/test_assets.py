import io
import os
import struct
import zlib

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from rivet_api.assets.store import AssetStore
from rivet_api.config import Settings
from rivet_api.errors import ApiError
from rivet_api.main import create_app


def encode(fmt: str, size=(16, 12), color=(200, 30, 30), **save_kwargs) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, fmt, **save_kwargs)
    return buf.getvalue()


def bomb_png(width=30000, height=30000) -> bytes:
    """A tiny, well-formed PNG whose header claims a huge canvas."""

    def chunk(kind: bytes, data: bytes) -> bytes:
        crc = zlib.crc32(kind + data) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", crc)

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(b""))
        + chunk(b"IEND", b"")
    )


@pytest.fixture
def store(tmp_path) -> AssetStore:
    return AssetStore(tmp_path / "assets")


@pytest.fixture
def client(tmp_path):
    def _make(**store_kwargs):
        assets = AssetStore(tmp_path / "assets", **store_kwargs)
        app = create_app(Settings(mode="fixture", data_root=tmp_path), assets=assets)
        return TestClient(app), assets

    return _make


def upload(client, data: bytes, filename="x.png", content_type="image/png", **headers):
    return client.post(
        "/api/assets/images", files={"file": (filename, data, content_type)}, headers=headers
    )


@pytest.mark.parametrize(
    "fmt,mime", [("PNG", "image/png"), ("JPEG", "image/jpeg"), ("WEBP", "image/webp")]
)
def test_valid_images_accepted_and_previewable(client, fmt, mime):
    c, _ = client()
    resp = upload(c, encode(fmt))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert set(body) == {"asset_id", "mime_type", "size_bytes", "preview_url"}
    assert body["mime_type"] == mime and body["size_bytes"] > 0
    assert body["asset_id"].startswith("asset-") and len(body["asset_id"]) == 6 + 32
    preview = c.get(body["preview_url"])
    assert preview.status_code == 200
    assert preview.headers["content-type"] == mime
    assert preview.headers["x-content-type-options"] == "nosniff"
    assert Image.open(io.BytesIO(preview.content)).format == fmt


def test_text_file_named_png_is_rejected_whatever_the_claimed_type(client):
    c, _ = client()
    resp = upload(c, b"this is definitely not an image", "evil.png", "image/png")
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "INVALID_IMAGE"


@pytest.mark.parametrize("data", [b"", b"\x89PNG\r\n\x1a\n", b"GIF89a" + b"\x00" * 20])
def test_empty_and_header_only_files_rejected(client, data):
    c, _ = client()
    assert upload(c, data).json()["error"]["code"] == "INVALID_IMAGE"


def test_truncated_jpeg_rejected_and_nothing_stored(client, tmp_path):
    c, _ = client()
    whole = encode("JPEG", size=(64, 64))
    resp = upload(c, whole[: len(whole) // 2], "cut.jpg", "image/jpeg")
    assert resp.status_code == 400 and resp.json()["error"]["code"] == "INVALID_IMAGE"
    assert not list((tmp_path / "assets").glob("asset-*"))


@pytest.mark.parametrize("fmt", ["GIF", "BMP", "TIFF"])
def test_other_image_formats_rejected(client, fmt):
    c, _ = client()
    resp = upload(c, encode(fmt), f"x.{fmt.lower()}", "image/png")
    assert resp.status_code == 400 and resp.json()["error"]["code"] == "INVALID_IMAGE"


def test_svg_rejected(client):
    c, _ = client()
    svg = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
    assert upload(c, svg, "x.svg", "image/svg+xml").json()["error"]["code"] == "INVALID_IMAGE"


def test_over_size_limit_is_413(client):
    c, _ = client(max_bytes=1000)
    noise = Image.frombytes("RGB", (64, 64), os.urandom(64 * 64 * 3))
    buf = io.BytesIO()
    noise.save(buf, "PNG")
    resp = upload(c, buf.getvalue())
    assert resp.status_code == 413
    assert resp.json()["error"]["code"] == "FILE_TOO_LARGE"


def test_default_limit_is_ten_megabytes(store):
    assert store.max_bytes == 10 * 1024 * 1024


def test_decompression_bomb_rejected_before_decoding(client, tmp_path):
    c, _ = client()
    resp = upload(c, bomb_png())
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "INVALID_IMAGE"
    assert not list((tmp_path / "assets").glob("asset-*"))


def test_pixel_budget_is_enforced_below_pillow_default(client):
    c, _ = client(max_pixels=1000)
    resp = upload(c, encode("PNG", size=(100, 100)))  # 10,000 pixels
    assert resp.status_code == 400 and resp.json()["error"]["code"] == "INVALID_IMAGE"


def test_large_valid_image_is_downscaled_keeping_aspect(client):
    c, assets = client()
    body = upload(c, encode("PNG", size=(3000, 1000))).json()
    data, mime = assets.read_bytes(body["asset_id"])
    w, h = Image.open(io.BytesIO(data)).size
    assert max(w, h) == 2048 and abs(w / h - 3.0) < 0.02


def test_small_image_is_not_resized(client):
    c, assets = client()
    body = upload(c, encode("PNG", size=(40, 30))).json()
    data, _ = assets.read_bytes(body["asset_id"])
    assert Image.open(io.BytesIO(data)).size == (40, 30)


def test_exif_gps_is_stripped(client):
    exif = Image.Exif()
    exif[0x010F] = "SecretCam"  # Make
    gps = exif.get_ifd(0x8825)
    gps[1], gps[2] = "N", (43.0, 38.0, 0.0)
    data = encode("JPEG", size=(32, 32), exif=exif.tobytes())
    assert Image.open(io.BytesIO(data)).getexif().get_ifd(0x8825)  # sanity: GPS was present
    c, assets = client()
    body = upload(c, data, "gps.jpg", "image/jpeg").json()
    stored, _ = assets.read_bytes(body["asset_id"])
    out = Image.open(io.BytesIO(stored)).getexif()
    assert len(out) == 0 and not out.get_ifd(0x8825)
    assert b"SecretCam" not in stored


def test_exif_orientation_is_applied_before_stripping(client):
    exif = Image.Exif()
    exif[0x0112] = 6  # rotate 90 CW when displayed
    data = encode("JPEG", size=(40, 20), exif=exif.tobytes())
    c, assets = client()
    body = upload(c, data, "r.jpg", "image/jpeg").json()
    stored, _ = assets.read_bytes(body["asset_id"])
    img = Image.open(io.BytesIO(stored))
    assert img.size == (20, 40) and img.getexif().get(0x0112) is None


def test_quota_per_session_returns_429(client):
    c, _ = client(per_session_quota=3)
    for _ in range(3):
        assert upload(c, encode("PNG"), **{"X-Rivet-Session": "alice"}).status_code == 200
    blocked = upload(c, encode("PNG"), **{"X-Rivet-Session": "alice"})
    assert blocked.status_code == 429 and blocked.json()["error"]["code"] == "QUOTA_EXCEEDED"
    assert upload(c, encode("PNG"), **{"X-Rivet-Session": "bob"}).status_code == 200


def test_invalid_uploads_count_against_the_quota(client):
    c, _ = client(per_session_quota=2)
    upload(c, b"junk"), upload(c, b"junk")
    assert upload(c, encode("PNG")).status_code == 429


@pytest.mark.parametrize(
    "asset_id",
    ["..%2f..%2fetc%2fpasswd", "asset-../x", "asset-xyz", "ASSET-" + "a" * 32, "asset-" + "a" * 31, "x"],
)
def test_bad_asset_ids_404_on_preview(client, asset_id):
    c, _ = client()
    assert c.get(f"/api/assets/{asset_id}/preview").status_code in (404,)


def test_unknown_but_well_formed_asset_id_404(client):
    c, _ = client()
    resp = c.get("/api/assets/asset-" + "0" * 32 + "/preview")
    assert resp.status_code == 404 and resp.json()["error"]["code"] == "ASSET_NOT_FOUND"


def test_stored_files_use_only_server_generated_names(client, tmp_path):
    c, _ = client()
    upload(c, encode("PNG"), "../../../etc/passwd.png", "image/png")
    names = [p.name for p in (tmp_path / "assets").iterdir()]
    assert len(names) == 1 and names[0].startswith("asset-") and "passwd" not in names[0]


def test_assets_survive_a_new_store_instance(tmp_path):
    first = AssetStore(tmp_path / "assets")
    rec = first.save(encode("PNG"), "s1")
    second = AssetStore(tmp_path / "assets")
    assert second.exists(rec.asset_id)
    assert second.read_bytes(rec.asset_id)[1] == "image/png"


def test_missing_file_field_is_400(client):
    c, _ = client()
    resp = c.post("/api/assets/images", data={"nope": "1"})
    assert resp.status_code == 400 and resp.json()["error"]["code"] == "BAD_REQUEST"


def test_save_raises_api_error_type(store):
    with pytest.raises(ApiError) as exc:
        store.save(b"junk", "s")
    assert exc.value.code == "INVALID_IMAGE"


def test_uploaded_asset_can_drive_a_generate_job(client, wait_job):
    c, _ = client()
    asset_id = upload(c, encode("PNG")).json()["asset_id"]
    resp = c.post(
        "/api/projects/generate",
        json={"input": {"kind": "image_and_text", "image_asset_id": asset_id, "user_text": "rover"}},
    )
    assert resp.status_code == 202
    job = wait_job(c, resp.json()["job_id"])
    assert job["status"] == "complete"
    with c.stream("GET", f"/api/jobs/{job['job_id']}/events") as events:
        assert '"stage": "upload"' in "".join(events.iter_text())


def test_transparent_png_keeps_alpha(client):
    img = Image.new("RGBA", (10, 10), (255, 0, 0, 0))
    buf = io.BytesIO()
    img.save(buf, "PNG")
    c, assets = client()
    body = upload(c, buf.getvalue()).json()
    stored, _ = assets.read_bytes(body["asset_id"])
    assert Image.open(io.BytesIO(stored)).mode == "RGBA"


def test_palette_png_and_cmyk_jpeg_are_accepted(client):
    pal = Image.new("P", (10, 10))
    buf = io.BytesIO()
    pal.save(buf, "PNG")
    cmyk = io.BytesIO()
    Image.new("CMYK", (10, 10), (0, 0, 0, 0)).save(cmyk, "JPEG")
    c, assets = client()
    assert upload(c, buf.getvalue()).status_code == 200
    body = upload(c, cmyk.getvalue(), "c.jpg", "image/jpeg").json()
    stored, _ = assets.read_bytes(body["asset_id"])
    assert Image.open(io.BytesIO(stored)).mode == "RGB"
