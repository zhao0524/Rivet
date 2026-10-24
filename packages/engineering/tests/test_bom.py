from decimal import Decimal

import pytest

from rivet_engine.bom import build_bom, link_status
from rivet_engine.catalog import catalog_from_records, load_catalog
from rivet_engine.ports import CatalogError
from tests import support


def _records(**changes):
    records = support.synthetic_catalog_records()
    for cid, update in changes.items():
        record = next(r for r in records if r["catalog_id"] == cid)
        for section, values in update.items():
            record[section].update(values)
    return catalog_from_records(records, "t")


def test_groups_duplicate_instances_with_exact_quantities():
    plan = support.synthetic_plan()
    bom = build_bom(plan.components, support.synthetic_catalog())
    motors = next(i for i in bom.items if i.catalog_id == "synthetic.motor")
    assert motors.quantity == 2 and motors.instance_ids == ["motor-left-1", "motor-right-1"]
    assert [i.catalog_id for i in bom.items] == sorted(i.catalog_id for i in bom.items)
    assert sum(i.quantity for i in bom.items) == len(plan.components)


def test_unknown_price_makes_total_incomplete_but_keeps_known_subtotal():
    bom = build_bom(support.synthetic_plan().components, support.synthetic_catalog())
    sensor = next(i for i in bom.items if i.catalog_id == "synthetic.range_sensor")
    assert sensor.unit_price_amount is None
    assert bom.total_status == "incomplete"
    assert bom.known_subtotal_amount == "50.50"


def test_all_prices_known_is_complete():
    catalog = _records(**{"synthetic.range_sensor": {"sourcing": {"price_amount": "0.10", "price_currency": "USD"}}})
    bom = build_bom(support.synthetic_plan().components, catalog)
    assert bom.total_status == "complete" and bom.known_subtotal_amount == "50.60"


def test_all_unknown_prices_is_not_available():
    records = support.synthetic_catalog_records()
    for r in records:
        r["sourcing"].update(price_amount=None, price_currency=None)
    bom = build_bom(support.synthetic_plan().components, catalog_from_records(records, "t"))
    assert bom.total_status == "not_available" and bom.known_subtotal_amount is None
    assert all(i.unit_price_amount is None for i in bom.items)


def test_mixed_currency_is_excluded_not_converted():
    plan = support.substitute(support.synthetic_plan_dict(), ["motor-left-1", "motor-right-1"], "synthetic.motor_eur")
    from rivet_engine.models import BuildPlan

    bom = build_bom(BuildPlan.model_validate(plan).components, support.synthetic_catalog())
    eur = next(i for i in bom.items if i.catalog_id == "synthetic.motor_eur")
    assert eur.unit_price_amount is None
    assert bom.total_status == "incomplete"
    assert Decimal(bom.known_subtotal_amount) == Decimal("44.50")


def test_link_status_truthful():
    catalog = _records(
        **{
            "synthetic.caster": {"sourcing": {"purchase_url": "https://example.test/caster", "purchase_url_verified_at": "2026-10-24"}},
            "synthetic.chassis": {"sourcing": {"manufacturer_reference_url": "https://example.test/chassis"}},
        }
    )
    items = {i.catalog_id: i for i in build_bom(support.synthetic_plan().components, catalog).items}
    assert items["synthetic.caster"].link_status == "verified_product"
    assert items["synthetic.caster"].purchase_url == "https://example.test/caster"
    assert items["synthetic.chassis"].link_status == "manufacturer_reference_only"


def test_unverified_purchase_link_is_rejected_and_never_shown():
    # The catalog schema refuses a purchase link without its verification date (issue #68)...
    with pytest.raises(CatalogError):
        _records(**{"synthetic.wheel": {"sourcing": {"purchase_url": "https://example.test/wheel"}}})
    # ...and the BOM still never shows one if validation was bypassed.
    wheel = support.synthetic_catalog().require("synthetic.wheel")
    undated = wheel.model_copy(update={"sourcing": wheel.sourcing.model_copy(update={"purchase_url": "https://example.test/wheel"})})
    assert link_status(undated) == "not_available"


def test_pack_items_count_as_one_unit_each():
    catalog = load_catalog()
    jumpers = catalog.require("wiring.adafruit_jumper_mm_40x150_758")
    assert any("one bom unit = one pack" in n.lower() for n in jumpers.evidence.notes)
    plan = support.synthetic_plan()
    bom = build_bom(plan.components, support.synthetic_catalog())
    kit = next(i for i in bom.items if i.catalog_id == "synthetic.wire_kit")
    assert kit.quantity == 1


def test_bom_does_not_mutate_inputs():
    plan = support.synthetic_plan()
    before = [c.to_wire() for c in plan.components]
    build_bom(plan.components, support.synthetic_catalog())
    assert [c.to_wire() for c in plan.components] == before


def test_empty_bom():
    bom = build_bom([], support.synthetic_catalog())
    assert bom.items == [] and bom.total_status == "not_available"
