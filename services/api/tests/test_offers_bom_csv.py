"""BOM CSV trailing `sku`, `vendor`, `offer_url` columns: appended, catalog-backed, empty when unknown."""

import csv
import io

from rivet_api.bom_csv import HEADER, bom_to_csv

OLD_HEADER = ["catalog_id", "quantity", "instance_ids", "unit_price_amount", "currency", "purchase_url", "link_status"]


def rows(text: str) -> list[list[str]]:
    return list(csv.reader(io.StringIO(text)))


def test_old_columns_keep_their_order_and_the_new_ones_trail():
    assert HEADER[: len(OLD_HEADER)] == OLD_HEADER and HEADER[len(OLD_HEADER) :] == ["sku", "vendor", "offer_url"]


def test_without_a_catalog_the_new_columns_are_empty(plan_dict):
    out = rows(bom_to_csv(plan_dict))
    assert all(r[7:] == ["", "", ""] for r in out[1:])
    assert all(len(r) == len(HEADER) for r in out)


def test_synthetic_catalog_without_skus_leaves_sku_and_offer_url_empty(plan_dict, catalog):
    out = rows(bom_to_csv(plan_dict, catalog))
    assert all(r[7] == "" and r[9] == "" for r in out[1:-1])


def test_columns_come_from_the_catalog_entry(plan_dict, catalog):
    first = plan_dict["bom"]["items"][0]["catalog_id"]
    entry = next(e for e in catalog if e["catalog_id"] == first)
    entry["identity"].update(sku="3801", manufacturer="Adafruit")
    entry["sourcing"].update(purchase_url="https://www.adafruit.com/product/3801", purchase_url_verified_at="2026-10-24")
    row = rows(bom_to_csv(plan_dict, catalog))[1]
    assert row[7:] == ["3801", "Adafruit", "https://www.adafruit.com/product/3801"]


def test_unverified_or_non_https_purchase_links_are_not_offer_urls(plan_dict, catalog):
    first = plan_dict["bom"]["items"][0]["catalog_id"]
    entry = next(e for e in catalog if e["catalog_id"] == first)
    entry["identity"].update(sku="X-1", manufacturer=None)
    entry["sourcing"].update(purchase_url="https://shop.example/x", purchase_url_verified_at=None)
    assert rows(bom_to_csv(plan_dict, catalog))[1][7:] == ["X-1", "", ""]
    entry["sourcing"].update(purchase_url="http://shop.example/x", purchase_url_verified_at="2026-10-24")
    assert rows(bom_to_csv(plan_dict, catalog))[1][7:] == ["X-1", "", ""]


def test_vendor_falls_back_to_the_verified_purchase_host(plan_dict, catalog):
    first = plan_dict["bom"]["items"][0]["catalog_id"]
    entry = next(e for e in catalog if e["catalog_id"] == first)
    entry["identity"].update(sku="X-1", manufacturer=None)
    entry["sourcing"].update(purchase_url="https://www.pololu.com/product/1", purchase_url_verified_at="2026-10-24")
    assert rows(bom_to_csv(plan_dict, catalog))[1][7:] == ["X-1", "www.pololu.com", "https://www.pololu.com/product/1"]


def test_total_row_has_empty_trailing_cells(plan_dict, catalog):
    total = rows(bom_to_csv(plan_dict, catalog))[-1]
    assert total[0] == "TOTAL" and total[7:] == ["", "", ""]


def test_route_fills_the_columns_from_the_engine_catalog(generate, stub_engine_cls):
    client, _, job = generate(engine=stub_engine_cls(real=True))
    body = rows(client.get(f"/api/projects/{job['build_id']}/exports/bom.csv").text)
    assert body[0] == HEADER
    assert body[1][7].startswith("TEST-") and body[1][8] == "Test Vendor" and body[1][9] == body[1][5]
