"""Real-product guard: the API refuses to relay sourcing claims the catalog cannot back."""

import pytest

from conftest import realish
from rivet_api.provenance import (
    check_bom_links,
    is_verified_product,
    is_synthetic_catalog_id,
    plan_is_synthetic,
    sourcing_summary,
)


@pytest.fixture
def real(plan_dict, catalog):
    return realish(plan_dict, catalog)


# ---- synthetic detection --------------------------------------------------------------


@pytest.mark.parametrize("cid", ["demo.esp32", "synthetic.motor"])
def test_synthetic_by_id_prefix(cid):
    assert is_synthetic_catalog_id(cid)


def test_synthetic_by_manufacturer_label_even_without_the_prefix(real):
    _, catalog = real
    catalog[0]["identity"]["manufacturer"] = "Synthetic Demo Only"
    assert is_synthetic_catalog_id(catalog[0]["catalog_id"], catalog)
    assert not is_synthetic_catalog_id(catalog[1]["catalog_id"], catalog)


def test_synthetic_by_catalog_version(real):
    plan, catalog = real
    assert not plan_is_synthetic(plan, catalog)
    plan["provenance"]["catalog_version"] = "SYNTHETIC-BOOTSTRAP"
    assert plan_is_synthetic(plan, catalog)


def test_saved_fixture_is_synthetic(plan_dict, catalog):
    assert plan_is_synthetic(plan_dict, catalog)
    summary = sourcing_summary(plan_dict, catalog)
    assert summary["synthetic"] and "demo.tb6612" in summary["synthetic_catalog_ids"]
    assert summary["sku_missing_count"] == len(plan_dict["bom"]["items"])


# ---- BOM link checks --------------------------------------------------------------------


def test_clean_real_plan_has_no_problems(real):
    plan, catalog = real
    assert check_bom_links(plan, catalog) == []
    assert sourcing_summary(plan, catalog) == {
        "synthetic": False,
        "synthetic_catalog_ids": [],
        "unverified_link_count": 0,
        "sku_missing_count": 0,
    }


def test_invented_url_is_rejected(real):
    plan, catalog = real
    plan["bom"]["items"][0]["purchase_url"] = "https://shop.invented/p/1"
    assert any("not the catalog's verified link" in p for p in check_bom_links(plan, catalog))


def test_http_url_is_rejected(real):
    plan, catalog = real
    item = plan["bom"]["items"][0]
    catalog_entry = next(e for e in catalog if e["catalog_id"] == item["catalog_id"])
    catalog_entry["sourcing"]["purchase_url"] = item["purchase_url"] = "http://shop.test/plain"
    assert any("not an https URL" in p for p in check_bom_links(plan, catalog))


def test_verified_product_needs_a_verified_catalog_link(real):
    plan, catalog = real
    item = plan["bom"]["items"][0]
    entry = next(e for e in catalog if e["catalog_id"] == item["catalog_id"])
    entry["sourcing"]["purchase_url_verified_at"] = None
    assert any("without a verified catalog link" in p for p in check_bom_links(plan, catalog))


def test_verified_product_needs_a_sku(real):
    plan, catalog = real
    item = plan["bom"]["items"][0]
    next(e for e in catalog if e["catalog_id"] == item["catalog_id"])["identity"]["sku"] = None
    assert any("no SKU" in p for p in check_bom_links(plan, catalog))


def test_link_on_a_row_that_is_not_verified_is_rejected(real):
    plan, catalog = real
    plan["bom"]["items"][0]["link_status"] = "manufacturer_reference_only"
    assert any("link_status is manufacturer_reference_only" in p for p in check_bom_links(plan, catalog))


@pytest.mark.parametrize("price", ["99.00", None])
def test_price_must_match_the_catalog(real, price):
    plan, catalog = real
    catalog[0]["sourcing"].update(price_amount="12.50", price_currency="USD")
    for item in plan["bom"]["items"]:
        if item["catalog_id"] == catalog[0]["catalog_id"]:
            item["unit_price_amount"] = price
    assert any("does not match the catalog" in p for p in check_bom_links(plan, catalog))


def test_kit_item_without_sku_or_link_is_legitimate(real):
    plan, catalog = real
    entry = next(e for e in catalog if e["catalog_id"] == plan["bom"]["items"][0]["catalog_id"])
    entry["identity"]["sku"] = None
    entry["sourcing"].update(purchase_url=None, purchase_url_verified_at=None)
    item = plan["bom"]["items"][0]
    item.update(purchase_url=None, link_status="manufacturer_reference_only")
    assert check_bom_links(plan, catalog) == []
    assert not is_verified_product(entry["catalog_id"], catalog)


# ---- pipeline: forged and synthetic live plans ------------------------------------------


def test_forged_verified_link_from_the_engine_is_502_and_nothing_is_stored(generate, stub_engine_cls, tmp_path):
    def forge(plan):
        plan["bom"]["items"][0]["purchase_url"] = "https://shop.invented/p/1"

    _, _, job = generate(engine=stub_engine_cls(real=True, mutate_plan=forge))
    assert job["status"] == "failed" and job["error"]["code"] == "ENGINE_CONTRACT_VIOLATION"
    assert not (tmp_path / "projects").exists() or not list((tmp_path / "projects").iterdir())


def test_live_plan_with_synthetic_parts_is_rejected(generate, stub_engine_cls):
    class LiveVision:
        mode = "live"

        def interpret(self, request, image):
            from rivet_api.agents.vision import MockVisionProvider

            return MockVisionProvider().interpret(request, image)

    _, _, job = generate(engine=stub_engine_cls(), vision=LiveVision())  # synthetic parts, labeled live
    assert job["status"] == "failed" and job["error"]["code"] == "SYNTHETIC_PARTS_IN_LIVE_PLAN"


def test_synthetic_plan_is_accepted_when_labeled_fixture_or_fallback(generate, stub_engine_cls):
    _, _, fixture_job = generate()
    _, _, fallback_job = generate(engine=stub_engine_cls())  # mock vision downgrades "live" to fallback
    assert fixture_job["status"] == "complete" and fallback_job["status"] == "complete"


# ---- API surface -------------------------------------------------------------------------


def test_project_response_carries_the_sourcing_summary_but_storage_does_not(generate):
    client, app, job = generate()
    body = client.get(f"/api/projects/{job['build_id']}").json()
    assert body["provenance"]["sourcing"]["synthetic"] is True
    assert "sourcing" not in app.state.deps.store.get(job["build_id"])["provenance"]


def test_real_project_is_not_flagged_synthetic(generate, stub_engine_cls):
    client, _, job = generate(engine=stub_engine_cls(real=True))
    sourcing = client.get(f"/api/projects/{job['build_id']}").json()["provenance"]["sourcing"]
    assert sourcing["synthetic"] is False and sourcing["synthetic_catalog_ids"] == []


def test_catalog_endpoint_flags_synthetic_entries(make_client, stub_engine_cls):
    client, _ = make_client()
    body = client.get("/api/catalog").json()
    assert body["synthetic"] is True and "demo.tb6612" in body["synthetic_catalog_ids"]
    client, _ = make_client(engine=stub_engine_cls(real=True))
    assert client.get("/api/catalog").json()["synthetic"] is False


# ---- edits ---------------------------------------------------------------------------------


def _swap(client, build_id, catalog_id):
    return client.post(
        f"/api/projects/{build_id}/edits",
        json={"base_revision": 1, "operation": {"op": "replace_optional_sensor", "catalog_id": catalog_id}},
    )


def test_sensor_swap_to_a_synthetic_part_is_rejected_before_the_engine(generate, stub_engine_cls):
    engine = stub_engine_cls(real=True)
    client, _, job = generate(engine=engine)
    body = _swap(client, job["build_id"], "demo.range").json()
    assert body["accepted"] is False and body["finding"]["rule_id"] == "api.real_product_only"
    assert engine.edit_calls == []


@pytest.mark.parametrize(
    "spoil",
    [
        pytest.param(lambda e: e["sourcing"].update(purchase_url_verified_at=None), id="unverified-link"),
        pytest.param(lambda e: e["sourcing"].update(purchase_url="http://vendor.example/sensor"), id="http-link"),
        pytest.param(lambda e: e["sourcing"].update(purchase_url="https://"), id="link-without-host"),
        pytest.param(lambda e: e["identity"].update(sku=None), id="no-sku"),
    ],
)
def test_sensor_swap_to_a_part_that_is_not_a_verified_product_is_rejected_before_the_engine(
    generate, stub_engine_cls, spoil
):
    engine = stub_engine_cls(real=True)
    client, _, job = generate(engine=engine)
    original = engine.get_catalog

    def spoiled():
        catalog = original()
        spoil(next(e for e in catalog if e["catalog_id"] == "test.range"))
        return catalog

    engine.get_catalog = spoiled
    response = _swap(client, job["build_id"], "test.range")
    assert response.status_code == 200
    body = response.json()
    assert body["accepted"] is False and body["finding"]["rule_id"] == "api.real_product_only"
    assert engine.edit_calls == []


def test_sensor_swap_to_a_verified_product_reaches_the_engine(generate, stub_engine_cls):
    engine = stub_engine_cls(real=True)
    client, _, job = generate(engine=engine)
    _swap(client, job["build_id"], "test.range")
    assert len(engine.edit_calls) == 1


def test_sensor_swap_to_an_unknown_catalog_id_is_rejected(generate, stub_engine_cls):
    client, _, job = generate(engine=stub_engine_cls(real=True))
    assert _swap(client, job["build_id"], "made.up_sensor").json()["accepted"] is False
