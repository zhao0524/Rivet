import io
import json
import zipfile

from fastapi import APIRouter, Query, Request
from fastapi.responses import Response

from rivet_api.bom_csv import bom_to_csv
from rivet_api.firmware.generate import generate_firmware
from rivet_api.provenance import plan_is_synthetic, refuse_if_synthetic

router = APIRouter()


def _download(content: str, media_type: str, filename: str, plan: dict, catalog: list) -> Response:
    return Response(
        content=content,
        media_type=media_type,
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "X-Content-Type-Options": "nosniff",
            "X-Rivet-Generation-Mode": plan["provenance"]["generation_mode"],
            "X-Rivet-Synthetic": str(plan_is_synthetic(plan, catalog)).lower(),
        },
    )


@router.get("/api/projects/{build_id}/exports/bom.csv")
def export_bom(build_id: str, request: Request, revision: int | None = Query(default=None, ge=1)) -> Response:
    deps = request.app.state.deps
    plan, catalog = deps.store.get(build_id, revision), deps.engine.get_catalog()
    refuse_if_synthetic(plan, catalog, "EXPORT_REFUSED_SYNTHETIC", "A BOM export")
    return _download(bom_to_csv(plan), "text/csv", f"{build_id}-r{plan['revision']}-bom.csv", plan, catalog)


@router.get("/api/projects/{build_id}/exports/build.json")
def export_build(build_id: str, request: Request, revision: int | None = Query(default=None, ge=1)) -> Response:
    deps = request.app.state.deps
    plan, catalog = deps.store.get(build_id, revision), deps.engine.get_catalog()
    return _download(
        json.dumps(plan, indent=2), "application/json", f"{build_id}-r{plan['revision']}.json", plan, catalog
    )


@router.get("/api/projects/{build_id}/exports/firmware.zip")
def export_firmware(
    build_id: str,
    request: Request,
    revision: int | None = Query(default=None, ge=1),
    compile: bool = False,
) -> Response:
    deps = request.app.state.deps
    plan, catalog = deps.store.get(build_id, revision), deps.engine.get_catalog()
    refuse_if_synthetic(plan, catalog, "FIRMWARE_REFUSED", "Firmware")
    bundle = generate_firmware(plan, compile=compile)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as archive:
        for path, data in bundle.files.items():
            info = zipfile.ZipInfo(path, date_time=(2026, 1, 1, 0, 0, 0))
            info.external_attr = 0o644 << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, data)
    response = Response(
        content=buf.getvalue(),
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{build_id}-r{plan["revision"]}-firmware.zip"',
            "X-Content-Type-Options": "nosniff",
            "X-Rivet-Generation-Mode": plan["provenance"]["generation_mode"],
            "X-Rivet-Synthetic": "false",
            "X-Rivet-Compile-Status": bundle.manifest["compile_status"],
        },
    )
    return response
