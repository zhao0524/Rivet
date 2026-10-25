"""`python -m rivet_engine.showcase build` over recorded pages (plan-showcase.md 3.2, acceptance 2):
replay reproduces every file byte for byte, outputs validate, rejections are listed."""

from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest

from rivet_engine.ecommerce.models import OfferSet
from rivet_engine.showcase.__main__ import main
from rivet_engine.showcase.build import build, offers_file_name, trim_source_html
from rivet_engine.sourcing.fetch import RecordedFetcher
from tests.support.showcase_fixtures import MANIFEST, RECORDED_SHOWCASE, index_errors, product_errors
from tests.test_ecommerce_models import schema_errors as offer_schema_errors


def snapshot(directory: Path) -> dict[str, bytes]:
    return {str(p.relative_to(directory)): p.read_bytes() for p in sorted(directory.rglob("*.json")) if "recorded" not in p.parts}


@pytest.fixture(scope="module")
def built(tmp_path_factory) -> Path:
    out = tmp_path_factory.mktemp("showcase")
    report = build(MANIFEST, out, fetcher=RecordedFetcher(RECORDED_SHOWCASE), offers=True)
    assert [p.product_id for p in report.accepted] == ["circuit-playground-bike-light", "pololu-romi-chassis-kit"]
    return out


def test_products_and_index_validate(built):
    index = json.loads((built / "index.json").read_text(encoding="utf-8"))
    assert index_errors(index) == []
    assert [p["product_id"] for p in index["products"]] == ["circuit-playground-bike-light", "pololu-romi-chassis-kit"]
    for entry in index["products"]:
        product = json.loads((built / "products" / f"{entry['product_id']}.json").read_text(encoding="utf-8"))
        assert product_errors(product) == []
        assert product["synthetic"] is False
        assert entry["parts_total"] == product["totals"]["parts_total"] and entry["status"] == product["status"]
    assert index["generated_at"] == max(json.loads(p.read_text())["generated_at"] for p in (built / "products").glob("*.json"))


def test_rejected_list_is_auditable(built):
    rejected = json.loads((built / "rejected.json").read_text(encoding="utf-8"))
    assert {(r["product_id"], r["reason"]) for r in rejected} == {("nvidia-jetbot", "mostly_unsourced"), ("sparkfun-redbot-shadow-chassis", "mostly_unsourced")}
    assert not (built / "products" / "nvidia-jetbot.json").exists()


def test_offer_sets_are_direct_vendor_only_and_valid(built):
    files = sorted((built / "offers").glob("*.json"))
    assert len(files) == 11, "one set per unique part across both products"
    for path in files:
        doc = json.loads(path.read_text(encoding="utf-8"))
        assert offer_schema_errors(doc) == []
        offer_set = OfferSet.model_validate(doc)
        assert path.name == offers_file_name(offer_set.query.normalized_key)
        assert offer_set.synthetic is False
        assert [e.status for e in offer_set.ledger if e.source == "brave-search"] == ["skipped"]
        assert not any(o.vendor.domain.endswith(".example") for o in offer_set.offers)
        assert offer_set.offers, path.name


def test_replay_is_byte_for_byte_deterministic(built, tmp_path):
    again = tmp_path / "again"
    build(MANIFEST, again, fetcher=RecordedFetcher(RECORDED_SHOWCASE), offers=True)
    assert snapshot(again) == snapshot(built)


def test_cli_replay_matches_and_exits_zero_with_rejections(built, tmp_path, capsys):
    out = tmp_path / "cli"
    shutil.copytree(RECORDED_SHOWCASE, out / "recorded")
    code = main(["build", "--manifest", str(MANIFEST), "--out", str(out), "--replay", "--offers"])
    printed = capsys.readouterr().out
    assert code == 0
    assert "accepted circuit-playground-bike-light: parts 5/5 verified" in printed
    assert "rejected nvidia-jetbot: mostly_unsourced" in printed
    assert "2 accepted, 2 rejected, 11 offer sets" in printed
    assert snapshot(out) == snapshot(built)


def test_cli_only_and_limit_keep_previous_results(tmp_path, capsys):
    out = tmp_path / "partial"
    shutil.copytree(RECORDED_SHOWCASE, out / "recorded")
    assert main(["build", "--manifest", str(MANIFEST), "--out", str(out), "--replay", "--only", "pololu-romi-chassis-kit"]) == 0
    assert main(["build", "--manifest", str(MANIFEST), "--out", str(out), "--replay", "--limit", "1"]) == 0
    index = json.loads((out / "index.json").read_text(encoding="utf-8"))
    assert [p["product_id"] for p in index["products"]] == ["circuit-playground-bike-light", "pololu-romi-chassis-kit"]
    assert json.loads((out / "rejected.json").read_text(encoding="utf-8")) == []


def test_cli_crash_exits_one(tmp_path, capsys):
    assert main(["build", "--manifest", str(tmp_path / "missing.json"), "--out", str(tmp_path / "out"), "--replay"]) == 1


def test_trim_keeps_attributes_links_and_jsonld_but_drops_scripts():
    html = ('<html><head><script>var x = 1;</script><style>a{}</style>'
            '<script type="application/ld+json">{"@type":"Product","sku":"1"}</script></head>'
            '<body><!-- hidden --><nav><li class="small-product-content-card" data-qty="2"><a href="https://www.adafruit.com/product/1">P</a></li></nav>'
            "<svg><path/></svg></body></html>")
    trimmed = trim_source_html(html)
    assert "var x" not in trimmed and "a{}" not in trimmed and "hidden" not in trimmed and "<svg" not in trimmed
    assert 'data-qty="2"' in trimmed and 'class="small-product-content-card"' in trimmed and '"sku":"1"' in trimmed
