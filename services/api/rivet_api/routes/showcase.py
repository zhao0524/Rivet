from typing import Any

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from rivet_api.offers.models import OfferListParams
from rivet_api.routes.offers import list_params
from rivet_api.showcase.models import Category
from rivet_api.showcase.service import part_offers

router = APIRouter()


@router.get("/api/showcase/products")
def list_products(request: Request, category: Category | None = None) -> dict[str, Any]:
    return request.app.state.deps.showcase.list(category).model_dump(mode="json")


@router.get("/api/showcase/products/{product_id}")
def get_product(product_id: str, request: Request) -> dict[str, Any]:
    return request.app.state.deps.showcase.product(product_id).model_dump(mode="json")


@router.get("/api/showcase/products/{product_id}/parts/{part_id}/offers")
def get_part_offers(
    product_id: str,
    part_id: str,
    request: Request,
    refresh: bool = False,
    params: OfferListParams = Depends(list_params),
) -> JSONResponse:
    status, body = part_offers(product_id, part_id, params, refresh, request.app.state.deps)
    return JSONResponse(status_code=status, content=body)
