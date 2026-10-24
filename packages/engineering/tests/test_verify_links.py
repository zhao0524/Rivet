"""verify_links (issue #68) with injected fetchers: no test here touches the network."""

import io
import json
import socket
import urllib.error
import urllib.request
from datetime import date
from email.message import Message

import pytest

from rivet_engine import verify_links
from rivet_engine.catalog import DATA_PATH, load_catalog
from rivet_engine.link_checks import LinkReport, dump_report
from rivet_engine.ports import Catalog
from rivet_engine.verify_links import FetchResult, check_link, fetch_url, main, render_table, run_checks

TODAY = date(2026, 10, 24)
AA = "accessory.adafruit_aa_alkaline_3pack_3521"  # SKU 3521, $2.25, in stock
ESP32 = "board.esp32_devkitc_v4_wroom32e"  # SKU 3269, $15.00, out of stock
CHASSIS = "chassis.sparkfun_shadow_rob13301"  # SKU ROB-13301, $14.95
BREADBOARD = "accessory.adafruit_half_breadboard_64"  # SKU 64: short numeric SKU


def page(sku_line: str = "", price: str = "", stock: str = "", extra: str = "") -> str:
    return (
        "<html><head><title>Product</title><script>var x = 'if the product is out of stock';</script></head>"
        f"<body><h1>Some product</h1><div class='product_id'>{sku_line}</div>"
        f"<div class='price'>{price}</div><div id='prod-stock'>{stock}</div>{extra}</body></html>"
    )


def adafruit(sku: str, price: str, stock: str = "In stock") -> str:
    return page(f"Product ID: <span>{sku}</span>", f"<span>${price}</span>", stock)


def json_ld(sku: str, price: str, availability: str) -> str:
    data = {"@context": "https://schema.org", "@type": "Product", "sku": sku,
            "offers": {"@type": "Offer", "price": price, "priceCurrency": "USD", "availability": f"http://schema.org/{availability}"}}
    return f'<script type="application/ld+json">{json.dumps(data)}</script>'


def fake(responses):
    calls = []

    def fetch(url):
        calls.append(url)
        result = responses[url]
        return result if isinstance(result, FetchResult) else FetchResult(200, url, result)

    fetch.calls = calls
    return fetch


@pytest.fixture(scope="module")
def catalog():
    return load_catalog()


def one(catalog, catalog_id, result):
    component = catalog.require(catalog_id)
    return check_link(component, fake({component.sourcing.purchase_url: result}), TODAY)


def subset(catalog, *ids):
    return Catalog("test-subset", tuple(catalog.require(i) for i in ids))


# --- classification -----------------------------------------------------------------------


def test_200_with_the_sku_passes_and_records_signals(catalog):
    check = one(catalog, AA, adafruit("3521", "2.25"))
    assert (check.status, check.http_status, check.sku_found) == ("pass", 200, True)
    assert check.final_url == "https://www.adafruit.com/product/3521" and check.checked_at == "2026-10-24"
    assert check.catalog_price_found is True and check.stock_text == "in_stock" and check.flags == []


def test_404_is_broken(catalog):
    check = one(catalog, AA, FetchResult(404, "https://www.adafruit.com/product/3521", "Not found"))
    assert check.status == "broken" and check.http_status == 404 and "404" in check.detail
    assert check.sku_found is None


def test_410_is_broken(catalog):
    assert one(catalog, AA, FetchResult(410, "https://www.adafruit.com/product/3521", "")).status == "broken"


def test_200_without_the_sku_is_broken_not_a_pass(catalog):
    check = one(catalog, AA, adafruit("9999", "2.25"))
    assert check.status == "broken" and check.sku_found is False and "SKU 3521" in check.detail


def test_redirect_to_the_same_product_passes_and_is_flagged(catalog):
    final = "https://www.sparkfun.com/shadow-chassis.html"
    check = one(catalog, CHASSIS, FetchResult(200, final, page("SKU: ROB-13301", "$14.95", "In stock")))
    assert check.status == "pass" and check.final_url == final and check.flags == ["redirected"]


def test_redirect_to_a_page_without_the_sku_is_broken(catalog):
    final = "https://www.adafruit.com/category/17"
    check = one(catalog, AA, FetchResult(200, final, page("Batteries", "", "")))
    assert check.status == "broken" and "redirected" in check.flags and final in check.detail


@pytest.mark.parametrize("error", ["URLError: [Errno 8] nodename nor servname provided", "timeout: timed out"])
def test_network_errors_are_errors_never_passes(catalog, error):
    check = one(catalog, AA, FetchResult(None, None, error=error))
    assert check.status == "error" and check.http_status is None and check.sku_found is None
    assert error in check.detail


@pytest.mark.parametrize("status", [401, 403, 407, 429, 451])
def test_refusals_are_blocked(catalog, status):
    check = one(catalog, AA, FetchResult(status, "https://www.adafruit.com/product/3521", adafruit("3521", "2.25")))
    assert check.status == "blocked"


def test_bot_challenge_pages_are_blocked_not_broken(catalog):
    challenge = "<html><head><title>Just a moment...</title></head><body>cf-chl</body></html>"
    assert one(catalog, AA, FetchResult(503, "https://www.adafruit.com/product/3521", challenge)).status == "blocked"
    assert one(catalog, AA, FetchResult(200, "https://www.adafruit.com/product/3521", challenge)).status == "blocked"


@pytest.mark.parametrize("status", [500, 502, 503, 301, 204])
def test_other_statuses_are_errors(catalog, status):
    check = one(catalog, AA, FetchResult(status, "https://www.adafruit.com/product/3521", "oops"))
    assert check.status == "error" and check.http_status == status


def test_short_numeric_sku_must_be_labelled(catalog):
    # "64" appears all over a page (sizes, image names); only a labelled SKU counts.
    noisy = page("Half-size breadboard, 64 rows", "$4.95", "In stock", extra="<img src='/images/64-00.jpg'> 64 GB")
    assert one(catalog, BREADBOARD, noisy).status == "broken"
    assert one(catalog, BREADBOARD, adafruit("64", "4.95")).status == "pass"
    assert one(catalog, BREADBOARD, adafruit("640", "4.95")).status == "broken"


def test_schema_org_sku_counts_as_the_page_naming_it(catalog):
    check = one(catalog, AA, page(extra=json_ld("3521", "2.2500", "InStock")))
    assert check.status == "pass" and check.catalog_price_found is True and check.stock_text == "in_stock"


def test_price_and_stock_changes_are_flags_only(catalog):
    check = one(catalog, AA, page("Product ID: 3521", "$2.25", "", extra=json_ld("3521", "2.95", "OutOfStock")))
    assert check.status == "pass"  # a price or stock change never fails the link...
    assert check.catalog_price_found is False and check.stock_text == "out_of_stock"
    assert check.flags == ["price_differs", "stock_differs"]  # ...it is flagged
    assert load_catalog().require(AA).sourcing.price_amount == "2.25"  # and nothing is edited


def test_stock_text_ignores_scripts_and_back_in_stock_notices(catalog):
    sold_out = adafruit("3269", "15.00", "Out of stock <legend>We will email you when it is back in stock!</legend>")
    check = one(catalog, ESP32, sold_out)
    assert check.stock_text == "out_of_stock" and check.flags == []  # catalog also says out_of_stock


def test_unclear_stock_is_reported_as_mixed(catalog):
    assert one(catalog, AA, adafruit("3521", "2.25", "In stock. Related: Out of stock")).stock_text == "mixed"


def test_entry_without_a_sku_cannot_pass(catalog):
    component = catalog.require(AA).model_copy(update={"identity": catalog.require(AA).identity.model_copy(update={"sku": None})})
    check = check_link(component, fake({component.sourcing.purchase_url: adafruit("3521", "2.25")}), TODAY)
    assert check.status == "error" and check.sku_found is None


# --- run, table, report, CLI ----------------------------------------------------------------


def test_run_checks_is_sequential_with_a_pause_and_skips_unlinked_entries(catalog):
    linked = [c for c in catalog.components if c.sourcing.purchase_url]
    fetch = fake({c.sourcing.purchase_url: adafruit(c.identity.sku, c.sourcing.price_amount) for c in linked})
    pauses = []
    report = run_checks(catalog, fetch, today=TODAY, delay_s=0.5, sleep=pauses.append)
    assert len(report.results) == len(linked) == 17 and len(catalog.components) == 19
    assert fetch.calls == [c.sourcing.purchase_url for c in linked]  # one at a time, catalog order
    assert pauses == [0.5] * (len(linked) - 1)
    assert [r.catalog_id for r in report.results] == sorted(c.catalog_id for c in linked)


def _all_pass(catalog, **overrides):
    responses = {c.sourcing.purchase_url: adafruit(c.identity.sku, c.sourcing.price_amount) for c in catalog.components if c.sourcing.purchase_url}
    responses.update(overrides)
    return fake(responses)


def test_main_prints_a_table_and_exits_0_when_nothing_is_broken(catalog):
    out = io.StringIO()
    assert main([], fetch=_all_pass(catalog), catalog=catalog, today=TODAY, sleep=lambda s: None, out=out) == 0
    text = out.getvalue()
    assert text.splitlines()[0].split()[:3] == ["catalog_id", "sku", "result"]
    assert "17 linked catalog entries checked on 2026-10-24 (UTC): 17 pass, 0 broken, 0 blocked, 0 error" in text
    assert "caster.sparkfun_shadow_nub" in text and "were not checked" in text


def test_main_exits_1_when_a_link_is_broken(catalog):
    url = catalog.require(AA).sourcing.purchase_url
    out = io.StringIO()
    code = main([], fetch=_all_pass(catalog, **{url: FetchResult(404, url, "")}), catalog=catalog, today=TODAY, sleep=lambda s: None, out=out)
    assert code == 1 and "BROKEN" in out.getvalue()


def test_errors_and_blocks_do_not_fail_the_run_but_are_never_passes(catalog):
    url_a, url_b = catalog.require(AA).sourcing.purchase_url, catalog.require(ESP32).sourcing.purchase_url
    fetch = _all_pass(catalog, **{url_a: FetchResult(None, None, error="timeout: timed out"), url_b: FetchResult(403, url_b, "")})
    out = io.StringIO()
    assert main([], fetch=fetch, catalog=catalog, today=TODAY, sleep=lambda s: None, out=out) == 0
    assert "15 pass, 0 broken, 1 blocked, 1 error" in out.getvalue()
    assert "not passes" in out.getvalue()


def test_write_is_deterministic_and_round_trips(catalog, tmp_path):
    target = tmp_path / "link_checks.json"
    catalog_before = DATA_PATH.read_bytes()
    outputs = []
    for _ in range(2):
        assert main(["--write", "--output", str(target)], fetch=_all_pass(catalog), catalog=catalog, today=TODAY,
                    sleep=lambda s: None, out=io.StringIO()) == 0
        outputs.append(target.read_bytes())
    first = outputs[0]
    assert outputs[1] == first and first.endswith(b"\n")
    data = json.loads(first)
    assert list(data) == sorted(data) and [r["catalog_id"] for r in data["results"]] == sorted(r["catalog_id"] for r in data["results"])
    report = LinkReport.model_validate_json(first)
    assert dump_report(report).encode() == first
    assert DATA_PATH.read_bytes() == catalog_before  # the catalog is never edited


def test_report_records_flags_not_prices(catalog):
    report = run_checks(subset(catalog, AA), _all_pass(catalog), today=TODAY, sleep=lambda s: None)
    assert set(report.results[0].model_dump()) == {
        "catalog_id", "sku", "purchase_url", "status", "http_status", "final_url", "checked_at",
        "sku_found", "catalog_price_found", "stock_text", "flags", "detail",
    }


def test_output_needs_write(capsys):
    with pytest.raises(SystemExit) as exc:
        main(["--output", "x.json"], fetch=lambda url: FetchResult(None, None), catalog=Catalog("empty", ()))
    assert exc.value.code == 2


def test_render_table_notes_every_non_pass(catalog):
    url = catalog.require(AA).sourcing.purchase_url
    report = run_checks(subset(catalog, AA), fake({url: FetchResult(None, None, error="timeout: timed out")}), today=TODAY)
    text = render_table(report)
    assert "ERROR" in text and f"{AA}: error - no response: timeout: timed out" in text


# --- the default urllib fetcher, without the network ----------------------------------------------


class _Response(io.BytesIO):
    def __init__(self, body, status=200, url="https://example.test/final", charset="utf-8"):
        super().__init__(body)
        self.status, self._url = status, url
        self.headers = Message()
        self.headers["Content-Type"] = f"text/html; charset={charset}"

    def geturl(self):
        return self._url


def test_fetch_url_sends_a_browser_user_agent_and_timeout(monkeypatch):
    seen = {}

    def urlopen(request, timeout):
        seen["ua"], seen["timeout"] = request.get_header("User-agent"), timeout
        return _Response("Product ID: 1 caf\u00e9".encode())

    monkeypatch.setattr(urllib.request, "urlopen", urlopen)
    got = fetch_url("https://example.test/p/1")
    assert got == FetchResult(200, "https://example.test/final", "Product ID: 1 caf\u00e9")
    assert seen["ua"].startswith("Mozilla/5.0") and seen["timeout"] == verify_links.TIMEOUT_S == 15.0


def test_fetch_url_maps_http_errors_with_their_final_url(monkeypatch):
    def urlopen(request, timeout):
        raise urllib.error.HTTPError("https://example.test/moved", 404, "Not Found", Message(), io.BytesIO(b"gone"))

    monkeypatch.setattr(urllib.request, "urlopen", urlopen)
    assert fetch_url("https://example.test/p/1") == FetchResult(404, "https://example.test/moved", "gone")


@pytest.mark.parametrize(
    "exc",
    [urllib.error.URLError(socket.timeout("timed out")), TimeoutError("timed out"), ConnectionResetError("reset"), ValueError("unknown url type")],
)
def test_fetch_url_turns_network_failures_into_errors(monkeypatch, exc):
    def urlopen(request, timeout):
        raise exc

    monkeypatch.setattr(urllib.request, "urlopen", urlopen)
    got = fetch_url("https://example.test/p/1")
    assert got.status is None and got.final_url is None and got.error
