from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import JSONResponse

from rivet_api.offers.models import Currency, Money, OfferListParams, OfferSearchRequest, SortKey, VendorTier
from rivet_api.offers.service import build_query, lookup, part_query, render

router = APIRouter()


def list_params(
    sort: SortKey = "reliability",
    vendor_tier: Annotated[list[VendorTier] | None, Query()] = None,
    in_stock: bool | None = None,
    min_rating: Annotated[float | None, Query(ge=0, le=5)] = None,
    max_price: Money | None = None,
    currency: Currency | None = None,
) -> OfferListParams:
    return OfferListParams(
        sort=sort,
        vendor_tier=vendor_tier or [],
        in_stock=in_stock,
        min_rating=min_rating,
        max_price=max_price,
        currency=currency,
    )


@router.get("/api/parts/{catalog_id}/offers")
def part_offers(catalog_id: str, request: Request, params: OfferListParams = Depends(list_params)) -> JSONResponse:
    deps = request.app.state.deps
    query = part_query(catalog_id, deps.engine.get_catalog())
    status, body = lookup(query, params, deps)
    return JSONResponse(status_code=status, content=body)


@router.post("/api/offers/search")
def search_offers(req: OfferSearchRequest, request: Request) -> JSONResponse:
    query = build_query(sku=req.sku, mpn=req.mpn, gtin=req.gtin, manufacturer=req.manufacturer)
    status, body = lookup(query, req.list_params(), request.app.state.deps)
    return JSONResponse(status_code=status, content=body)


@router.get("/api/offers/{offer_set_id}")
def get_offer_set(offer_set_id: str, request: Request) -> dict[str, Any]:
    return render(request.app.state.deps.offer_sets.get(offer_set_id))
