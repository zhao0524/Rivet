"""Issue #68: sourcing schema rules, link freshness and broken-link rules, BOM downgrade,
fail-safe report loading and packaging. Offline; dates are injected."""

import copy
import json
import tomllib
from datetime import date
from pathlib import Path

import pytest
from pydantic import ValidationError

import rivet_engine
from rivet_engine import link_checks as link_checks_module
from rivet_engine.bom import link_status
from rivet_engine.catalog import catalog_from_records, load_catalog, load_fit_evidence
from rivet_engine.configurator import Builder, parse_intent, solve_intent
from rivet_engine.demo import SAMPLE_INTENT
from rivet_engine.link_checks import LINK_CHECKS_PATH, LinkCheck, LinkChecks, LinkReport, dump_report, load_link_checks
from rivet_engine.models import CatalogComponent
from rivet_engine.ports import CatalogError, VerificationContext
from rivet_engine.validators import sourcing
from rivet_engine.validators.common import PlanView
from tests import support

CREATED = "2026-10-24T12:00:00Z"
SENSOR = "sensor.adafruit_vl53l0x_3317"  # manufacturer reference is a different URL (Learn guide)
MOTOR = "motor.adafruit_tt_bimetal_1to90_3801"  # manufacturer reference is the purchase URL itself
DRIVER = "driver.adafruit_tb6612_2448"


def entry(component, status="pass", checked_at="2026-10-24", **overrides):
    http, sku_found = {"pass": (200, True), "broken": (404, None), "blocked": (403, None), "error": (None, None)}[status]
    data = {
        "catalog_id": component.catalog_id,
        "sku": component.identity.sku,
        "purchase_url": component.sourcing.purchase_url,
        "status": status,
        "http_status": http,
        "final_url": component.sourcing.purchase_url if http else None,
        "checked_at": checked_at,
        "sku_found": sku_found,
        "catalog_price_found": None,
        "stock_text": None,
        "flags": [],
        "detail": f"test {status}",
    }
    data.update(overrides)
    return LinkCheck(**data)


def checks(*entries):
    return LinkChecks({e.catalog_id: e for e in entries})


def linked(catalog):
    return [c for c in catalog.components if c.sourcing.purchase_url]


def build(link_checks=None, created_at=CREATED, catalog=None):
    builder = Builder(catalog or load_catalog(), fit_evidence=load_fit_evidence(), link_checks=link_checks)
    return solve_intent(parse_intent(copy.deepcopy(SAMPLE_INTENT)), builder, created_at=created_at)


def rules(plan, link_checks=None, as_of=None, catalog=None):
    view = PlanView(plan, catalog or load_catalog(), VerificationContext(link_checks=link_checks, as_of=as_of))
    return sourcing.check(view)


def by_rule(findings, rule_id):
    return [f for f in findings if f.rule_id == rule_id]


@pytest.fixture(scope="module")
def plan():
    return build()


def linked_rows(plan):
    catalog = load_catalog()
    return [i for i in plan.bom.items if catalog.require(i.catalog_id).sourcing.purchase_url]


# --- schema rules (models.Sourcing) ---------------------------------------------------------


def _record(**sourcing_changes):
    record = load_catalog().require(SENSOR).to_wire()
    record["sourcing"].update(sourcing_changes)
    return record


@pytest.mark.parametrize(
    "change",
    [
        {"purchase_url": "http://www.adafruit.com/product/3317"},
        {"manufacturer_reference_url": "http://learn.adafruit.com/adafruit-vl53l0x"},
        {"purchase_url": "https://"},
        {"purchase_url": "ftp://www.adafruit.com/product/3317"},
        {"purchase_url": "www.adafruit.com/product/3317"},
    ],
)
def test_purchase_and_manufacturer_links_must_be_https(change):
    with pytest.raises(ValidationError, match="https"):
        CatalogComponent.model_validate(_record(**change))


def test_purchase_url_without_its_verification_date_is_rejected():
    with pytest.raises(ValidationError, match="purchase_url_verified_at"):
        CatalogComponent.model_validate(_record(purchase_url_verified_at=None))


def test_verification_date_without_a_purchase_url_is_rejected():
    with pytest.raises(ValidationError, match="no purchase_url"):
        CatalogComponent.model_validate(_record(purchase_url=None))


@pytest.mark.parametrize("field", ["purchase_url_verified_at", "price_checked_at"])
@pytest.mark.parametrize("value", ["2026-13-45", "2026-02-30", "24/10/2026", "2026-10-24T10:00:00", "2026-10-24 10:00:00Z", "soon", ""])
def test_impossible_or_non_iso_dates_are_rejected(field, value):
    with pytest.raises(ValidationError):
        CatalogComponent.model_validate(_record(**{field: value}))


@pytest.mark.parametrize("field", ["purchase_url_verified_at", "price_checked_at"])
@pytest.mark.parametrize("value", ["2026-10-24", "2026-10-24T10:00:00Z", "2026-10-24T10:00:00.123Z"])
def test_dates_and_utc_timestamps_are_accepted(field, value):
    assert getattr(CatalogComponent.model_validate(_record(**{field: value})).sourcing, field) == value


def test_catalog_loader_reports_schema_rule_violations():
    with pytest.raises(CatalogError) as err:
        catalog_from_records([_record(purchase_url="http://www.adafruit.com/product/3317")], "v")
    assert any("https" in e for e in err.value.details["errors"])


# --- freshness ------------------------------------------------------------------------------


def test_links_are_fresh_through_day_30(plan):
    found = by_rule(rules(plan, as_of=date(2026, 11, 23)), "sourcing.link_freshness")
    assert len(found) == 1 and found[0].result == "PASS" and found[0].severity == "advisory"
    assert set(found[0].affected_instance_ids) == {i for row in linked_rows(plan) for i in row.instance_ids}


def test_links_older_than_30_days_are_advisory_unknown(plan):
    found = by_rule(rules(plan, as_of=date(2026, 11, 24)), "sourcing.link_freshness")
    assert len(found) == len(linked_rows(plan)) and len(found) > 0
    assert all(f.result == "UNKNOWN" and f.severity == "advisory" and "31 days" in f.message for f in found)
    assert sourcing.MAX_LINK_AGE_DAYS == 30


def test_default_evaluation_date_is_the_plan_created_at():
    assert by_rule(rules(build(created_at=CREATED)), "sourcing.link_freshness")[0].result == "PASS"
    stale = by_rule(rules(build(created_at="2026-12-01T00:00:00Z")), "sourcing.link_freshness")
    assert stale and all(f.result == "UNKNOWN" and "2026-12-01" in f.message for f in stale)


def test_a_passing_check_refreshes_a_link_but_blocked_and_error_do_not(plan):
    catalog = load_catalog()
    report = checks(entry(catalog.require(SENSOR), "pass", "2026-11-20"), entry(catalog.require(DRIVER), "blocked", "2026-11-20"))
    found = by_rule(rules(plan, report, as_of=date(2026, 12, 10)), "sourcing.link_freshness")
    stale_ids = {i for f in found for i in f.affected_instance_ids}
    assert "sensor-1" not in stale_ids  # passing check 20 days old
    assert "driver-1" in stale_ids  # catalog date 47 days old; the blocked check proves nothing
    driver = next(f for f in found if f.affected_instance_ids == ["driver-1"])
    assert "blocked" in driver.message and "2026-10-24" in driver.message


def test_freshness_is_deterministic_for_the_same_inputs_and_date(plan):
    report = checks(entry(load_catalog().require(SENSOR), "pass", "2026-11-20"))
    assert rules(plan, report, as_of=date(2026, 12, 10)) == rules(plan, report, as_of=date(2026, 12, 10))


def test_without_a_report_only_the_date_rule_applies(plan):
    found = rules(plan, None, as_of=date(2026, 10, 24))
    assert not by_rule(found, "sourcing.link_broken")
    assert [f.result for f in by_rule(found, "sourcing.link_freshness")] == ["PASS"]


# --- broken links ---------------------------------------------------------------------------


def _report_with_broken(catalog, **broken):
    entries = {c.catalog_id: entry(c) for c in linked(catalog)}
    entries.update(broken)
    return LinkChecks(entries)


def test_broken_link_blocks_and_the_bom_row_is_no_longer_a_verified_product():
    catalog = load_catalog()
    sensor, motor = catalog.require(SENSOR), catalog.require(MOTOR)
    report = _report_with_broken(
        catalog,
        **{
            SENSOR: entry(sensor, "broken"),
            MOTOR: entry(motor, "broken", http_status=200, sku_found=False, flags=["redirected"], final_url="https://www.adafruit.com/category/34"),
        },
    )
    result = build(report)
    rows = {i.catalog_id: i for i in result.bom.items}
    assert (rows[SENSOR].link_status, rows[SENSOR].purchase_url) == ("manufacturer_reference_only", None)
    assert (rows[MOTOR].link_status, rows[MOTOR].purchase_url) == ("not_available", None)  # its reference is the dead link
    broken = by_rule(result.verification.findings, "sourcing.link_broken")
    assert {tuple(f.affected_instance_ids) for f in broken} == {("sensor-1",), ("motor-left-1", "motor-right-1")}
    assert all(f.result == "UNKNOWN" and f.severity == "blocking" for f in broken)
    messages = " ".join(f.message for f in broken)
    assert "HTTP 404" in messages and "no longer names SKU 3801" in messages and "category/34" in messages
    # Needs review, not unbuildable: repair does not swap parts over a dead link.
    assert result.status == "needs_review"
    assert {c.catalog_id for c in result.components} >= {SENSOR, MOTOR}
    # Not double-reported as stale, and the downgraded rows still match the catalog.
    fresh = by_rule(result.verification.findings, "sourcing.link_freshness")
    assert all("sensor-1" not in f.affected_instance_ids for f in fresh)
    assert [f.result for f in by_rule(result.verification.findings, "integrity.bom")] == ["PASS"]
    # Public verify of the same plan with the same report agrees.
    again = Builder(catalog, fit_evidence=load_fit_evidence(), link_checks=report).verify(result)
    assert by_rule(again.findings, "sourcing.link_broken") == broken


def test_link_status_downgrade_rules():
    catalog = load_catalog()
    sensor, motor = catalog.require(SENSOR), catalog.require(MOTOR)
    assert link_status(sensor) == link_status(sensor, checks(entry(sensor))) == "verified_product"
    assert link_status(sensor, checks(entry(sensor, "broken"))) == "manufacturer_reference_only"
    assert link_status(motor, checks(entry(motor, "broken"))) == "not_available"
    for inconclusive in ("blocked", "error"):
        assert link_status(sensor, checks(entry(sensor, inconclusive))) == "verified_product"


def test_a_catalog_reverification_after_the_failed_check_supersedes_it():
    records = load_catalog().to_wire()
    next(r for r in records if r["catalog_id"] == SENSOR)["sourcing"]["purchase_url_verified_at"] = "2026-11-02"
    catalog = catalog_from_records(records, "reverified")
    report = checks(entry(catalog.require(SENSOR), "broken", "2026-11-01"))
    assert report.broken_entry(catalog.require(SENSOR)) is None
    assert link_status(catalog.require(SENSOR), report) == "verified_product"


def test_a_broken_check_on_the_curation_day_still_counts():
    sensor = load_catalog().require(SENSOR)  # verified 2026-10-24
    assert checks(entry(sensor, "broken", "2026-10-24")).broken_entry(sensor) is not None


def test_a_check_of_another_url_or_sku_does_not_apply(plan):
    sensor = load_catalog().require(SENSOR)
    other_url = checks(entry(sensor, "broken", purchase_url="https://www.adafruit.com/product/9999"))
    other_sku = checks(entry(sensor, "broken", sku="9999"))
    for report in (other_url, other_sku):
        assert report.entry_for(sensor) is None and link_status(sensor, report) == "verified_product"
        assert not by_rule(rules(plan, report), "sourcing.link_broken")


def test_an_all_pass_report_gives_one_pass_naming_the_checked_parts(plan):
    catalog = load_catalog()
    found = by_rule(rules(plan, checks(*(entry(c) for c in linked(catalog)))), "sourcing.link_broken")
    assert len(found) == 1 and found[0].result == "PASS" and found[0].severity == "blocking"
    assert set(found[0].affected_instance_ids) == {i for row in linked_rows(plan) for i in row.instance_ids}
    assert f"(2026-10-24): {len(linked_rows(plan))} purchase link(s)" in found[0].message and "none broken" in found[0].message


def test_unconfirmed_checks_are_counted_but_never_passed(plan):
    catalog = load_catalog()
    report = _report_with_broken(catalog, **{SENSOR: entry(catalog.require(SENSOR), "blocked")})
    found = by_rule(rules(plan, report), "sourcing.link_broken")
    assert found[0].result == "PASS" and "1 not confirmed (blocked or error)" in found[0].message
    assert "sensor-1" not in found[0].affected_instance_ids


def test_a_report_with_no_applicable_entries_claims_nothing():
    synthetic = support.synthetic_plan()
    report = checks(*(entry(c) for c in linked(load_catalog())))
    assert rules(synthetic, report, catalog=support.synthetic_catalog()) == []


# --- fail-safe loading ----------------------------------------------------------------------


def _report_json(**changes):
    sensor = load_catalog().require(SENSOR)
    data = {"schema_version": "1.0", "catalog_version": "x", "results": [entry(sensor).model_dump(mode="json")]}
    data["results"][0].update(changes)
    return json.dumps(data)


@pytest.mark.parametrize(
    "content",
    [
        "not json",
        "{}",
        _report_json().replace('"1.0"', '"2.0"', 1),
        _report_json(http_status=404),  # a "pass" without HTTP 200
        _report_json(status="broken", http_status=200, sku_found=True),  # a "broken" page that names the SKU
        _report_json(checked_at="2026-02-30"),
        _report_json(http_status="200"),  # strings are not numbers
        _report_json(price_amount="2.25"),  # unknown keys are refused
        json.dumps({"schema_version": "1.0", "catalog_version": "x", "results": [json.loads(_report_json())["results"][0]] * 2}),
    ],
)
def test_a_corrupt_report_fails_safe(tmp_path, content):
    path = tmp_path / "link_checks.json"
    path.write_text(content)
    loaded = load_link_checks(path)
    assert loaded is not None and loaded.problem and dict(loaded.entries) == {}


def test_a_missing_report_is_no_report(tmp_path):
    assert load_link_checks(tmp_path / "missing.json") is None


def test_an_unreadable_report_fails_safe(tmp_path):
    loaded = load_link_checks(tmp_path)  # a directory
    assert loaded is not None and loaded.problem and not loaded.entries


def test_a_corrupt_report_is_reported_and_otherwise_ignored(plan):
    found = rules(plan, LinkChecks(problem="link_checks.json is malformed (results: Field required)"), as_of=date(2026, 10, 24))
    broken = by_rule(found, "sourcing.link_broken")
    assert len(broken) == 1 and broken[0].result == "UNKNOWN" and broken[0].severity == "advisory"
    assert broken[0].affected_instance_ids == [] and "could not be used" in broken[0].message
    assert [f.result for f in by_rule(found, "sourcing.link_freshness")] == ["PASS"]


def test_public_entry_points_survive_a_corrupt_packaged_report(monkeypatch, tmp_path):
    bad = tmp_path / "link_checks.json"
    bad.write_text("{not json")
    monkeypatch.setattr(link_checks_module, "LINK_CHECKS_PATH", bad)
    plan = rivet_engine.solve(copy.deepcopy(SAMPLE_INTENT))
    assert plan["status"] == "needs_review"
    broken = [f for f in plan["verification"]["findings"] if f["rule_id"] == "sourcing.link_broken"]
    assert len(broken) == 1 and broken[0]["severity"] == "advisory" and "could not be used" in broken[0]["message"]
    catalog = load_catalog()
    for row in plan["bom"]["items"]:  # nothing is downgraded by an unusable report
        if catalog.require(row["catalog_id"]).sourcing.purchase_url:
            assert row["link_status"] == "verified_product"
    assert rivet_engine.verify(plan)["overall"] == plan["status"]


def test_public_entry_points_work_without_a_report(monkeypatch, tmp_path):
    monkeypatch.setattr(link_checks_module, "LINK_CHECKS_PATH", tmp_path / "absent.json")
    plan = rivet_engine.solve(copy.deepcopy(SAMPLE_INTENT))
    assert not [f for f in plan["verification"]["findings"] if f["rule_id"] == "sourcing.link_broken"]
    assert rivet_engine.verify(plan)["findings"] == plan["verification"]["findings"]


# --- the packaged report --------------------------------------------------------------------


def test_packaged_report_is_valid_canonical_and_covers_every_linked_entry():
    loaded = load_link_checks()
    assert loaded is not None and loaded.problem is None
    catalog = load_catalog()
    expected = {c.catalog_id: c for c in linked(catalog)}
    assert set(loaded.entries) == set(expected)
    for catalog_id, component in expected.items():
        assert loaded.entry_for(component) is loaded.entries[catalog_id]  # same URL and SKU as the catalog
    text = LINK_CHECKS_PATH.read_text()
    assert dump_report(LinkReport.model_validate_json(text)) == text


def test_packaged_report_is_package_data():
    root = Path(rivet_engine.__file__).resolve().parents[1]
    globs = tomllib.loads((root / "pyproject.toml").read_text())["tool"]["setuptools"]["package-data"]["rivet_engine"]
    package = LINK_CHECKS_PATH.parents[1]
    assert any(LINK_CHECKS_PATH in set(package.glob(g)) for g in globs)
