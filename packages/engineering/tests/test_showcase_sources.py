"""rivet_engine.showcase.sources over recorded real pages (plan-showcase.md 3.3): every linked
part comes with a vendor product URL and a quote from the page; everything else is unsourced."""

from __future__ import annotations

import pytest

from rivet_engine.showcase.sources import dedupe_items, extract_parts, split_quantity, vendor_product_url
from rivet_engine.sourcing.extract import page_text
from rivet_engine.sourcing.fetch import RecordedFetcher
from tests.support.showcase_fixtures import BIKE_LIGHT, JETBOT, RECORDED_SHOWCASE, REDBOT, ROMI


@pytest.fixture(scope="module")
def fetcher() -> RecordedFetcher:
    return RecordedFetcher(RECORDED_SHOWCASE)


def test_adafruit_learn_product_cards(fetcher):
    items, unsourced, meta = extract_parts(fetcher.fetch(BIKE_LIGHT))
    assert [i.url.rsplit("/", 1)[1] for i in items] == ["3333", "3000", "727", "1578", "3064"]
    assert items[0].name == "Circuit Playground Express" and items[0].quantity == 1
    assert unsourced == []
    assert meta.title == "Circuit Playground Bike Light"
    assert meta.image_url.startswith("https://cdn-learn.adafruit.com/") and meta.credit == "Adafruit Industries"


def test_every_bom_quote_is_literal_page_text(fetcher):
    for url in (BIKE_LIGHT, ROMI, JETBOT, REDBOT):
        result = fetcher.fetch(url)
        text = page_text(result.body)
        items, _, _ = extract_parts(result)
        assert items, url
        for item in items:
            assert item.bom_quote and item.name in item.bom_quote
            assert all(piece.strip() in text for piece in item.bom_quote.split(" | ")), (url, item.bom_quote)


def test_pololu_kit_contents_only(fetcher):
    items, unsourced, meta = extract_parts(fetcher.fetch(ROMI))
    assert {(i.url.rsplit("/", 1)[1], i.quantity) for i in items} == {("3510", 1), ("1520", 2), ("3520", 2), ("1429", 2), ("3530", 1), ("3540", 1)}
    assert "1003" not in {i.url.rsplit("/", 1)[1] for i in items}, "AA batteries from 'Additional things you will need' are not kit contents"
    assert unsourced == []
    assert meta.image_url.startswith("https://a.pololu-files.com/") and meta.credit == "Pololu Corporation"


def test_pololu_page_without_contents_block_yields_nothing(fetcher):
    items, unsourced, _ = extract_parts(fetcher.fetch("https://www.pololu.com/product/3510"))
    assert items == [] and unsourced == []


def test_generic_bom_table_keeps_vendor_rows_and_lists_the_rest(fetcher):
    items, unsourced, meta = extract_parts(fetcher.fetch(JETBOT))
    by_sku = {i.url.rsplit("/", 1)[1]: i for i in items}
    assert by_sku["3777"].name == "Motor" and by_sku["3777"].quantity == 2
    assert by_sku["2927"].name == "Motor Driver" and by_sku["2927"].quantity == 1
    assert all(i.url.startswith("https://www.adafruit.com/product/") for i in items)
    names = {u.name for u in unsourced}
    assert {"Jetson Nano", "Micro SD card", "Battery", "Chassis"} <= names
    assert next(u for u in unsourced if u.name == "Micro SD card").note.startswith("linked to amzn.to")
    assert next(u for u in unsourced if u.name == "Chassis").note == "named on the source page without a vendor link"
    assert len(unsourced) > len(items)
    assert meta.image_url is None and meta.license == "see source page"


def test_sparkfun_tutorial_materials_table(fetcher):
    items, unsourced, meta = extract_parts(fetcher.fetch(REDBOT))
    by_sku = {i.url.rsplit("/", 1)[1]: i for i in items}
    assert by_sku["13302"].name == "Motor" and by_sku["13302"].quantity == 2
    assert by_sku["12097"].name == "RedBot Mainboard"
    assert {"Bottom Chassis Plate", "Nub Caster"} <= {u.name for u in unsourced}
    assert meta.license == "CC BY-SA 4.0" and meta.credit == "SparkFun Electronics"


@pytest.mark.parametrize("href, base, expected", [
    ("https://www.adafruit.com/product/3801", BIKE_LIGHT, "https://www.adafruit.com/product/3801"),
    ("/product/1520", ROMI, "https://www.pololu.com/product/1520"),
    ("http://adafru.it/3777", JETBOT, "https://www.adafruit.com/product/3777"),
    ("https://www.sparkfun.com/products/13302?utm_source=x", REDBOT, "https://www.sparkfun.com/products/13302"),
    ("https://www.sparkfun.com/sparkfun-redboard-qwiic.html", REDBOT, "https://www.sparkfun.com/sparkfun-redboard-qwiic.html"),
    ("https://www.adafruit.com/categories/575", BIKE_LIGHT, None),
    ("https://learn.adafruit.com/other-guide", BIKE_LIGHT, None),
    ("https://amzn.to/2Us6bOv", JETBOT, None),
    ("https://www.amazon.com/dp/B01N2S7CX6", JETBOT, None),
    ("http://www.adafruit.com/product/3801", BIKE_LIGHT, None),
    ("javascript:alert(1)", BIKE_LIGHT, None),
])
def test_vendor_product_url(href, base, expected):
    assert vendor_product_url(href, base) == expected


@pytest.mark.parametrize("line, expected", [
    ("2x Motor", (2, "Motor")),
    ("Motor (2)", (2, "Motor")),
    ("Two mini plastic gearmotors", (2, "mini plastic gearmotors")),
    ("A pair of wheels", (2, "wheels")),
    ("One ball caster", (1, "ball caster")),
    ("Wheel x 4", (4, "Wheel")),
    ("Raspberry Pi", (None, "Raspberry Pi")),
])
def test_split_quantity(line, expected):
    assert split_quantity(line) == expected


def test_dedupe_merges_quantities_by_canonical_url():
    from rivet_engine.showcase.sources import BomItem

    items = dedupe_items([
        BomItem("Wheel", 2, "https://www.pololu.com/product/1429", "q1"),
        BomItem("Wheel again", 1, "https://pololu.com/product/1429", "q2"),
        BomItem("Motor", 1, "https://www.pololu.com/product/1520", "q3"),
    ])
    assert [(i.name, i.quantity, i.bom_quote) for i in items] == [("Wheel", 3, "q1"), ("Motor", 1, "q3")]
