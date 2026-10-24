import json
import socket
from collections import Counter
from decimal import Decimal

import pytest

from rivet_engine import catalog as catalog_module
from rivet_engine.catalog import CATALOG_VERSION, DATA_PATH, catalog_from_records, load_catalog
from rivet_engine.ports import CatalogError
from tests import support

REQUIRED_CATEGORIES = {
    "controller": 1,
    "motor_driver": 1,
    "motor": 1,
    "wheel": 1,
    "chassis": 1,
    "caster": 1,
    "distance_sensor": 1,
    "power_supply": 2,
    "wiring": 1,
}


@pytest.fixture
def catalog():
    return load_catalog()


def test_packaged_catalog_size_and_version(catalog):
    assert catalog.version == CATALOG_VERSION
    assert 12 <= len(catalog.components) <= 25


def test_covers_a_coherent_rover_stack(catalog):
    counts = Counter(c.identity.category for c in catalog.components)
    for category, minimum in REQUIRED_CATEGORIES.items():
        assert counts[category] >= minimum, category


def test_no_synthetic_parts_in_shipped_catalog(catalog):
    for c in catalog.components:
        assert not c.is_synthetic
        assert "SYNTHETIC" not in c.identity.manufacturer.upper()


def test_every_part_has_identity_and_source(catalog):
    for c in catalog.components:
        assert c.identity.manufacturer and c.identity.model
        s = c.sourcing
        assert s.manufacturer_reference_url or s.purchase_url, c.catalog_id
        for url in (s.manufacturer_reference_url, s.datasheet_url, s.purchase_url):
            assert url is None or url.startswith("https://"), url
        assert c.evidence.notes, c.catalog_id


def test_prices_have_currency_date_and_evidence(catalog):
    for c in catalog.components:
        s = c.sourcing
        if s.price_amount is None:
            assert s.price_currency is None and c.evidence.price == "unknown"
        else:
            assert Decimal(s.price_amount) >= 0
            assert s.price_currency == "USD" and s.price_checked_at
            assert c.evidence.price == "verified"
        if s.purchase_url:
            assert s.purchase_url_verified_at


def test_zero_prices_are_kit_inclusions_only(catalog):
    for c in catalog.components:
        if c.sourcing.price_amount == "0.00":
            assert c.sourcing.purchase_url is None
            assert any("included" in n.lower() for n in c.evidence.notes), c.catalog_id


def test_verified_electrical_parts_have_rated_ports(catalog):
    driver = catalog.require("driver.adafruit_tb6612_2448")
    assert (driver.port("vm").voltage_min_v, driver.port("vm").voltage_max_v) == (4.5, 13.5)
    assert (driver.port("vcc").voltage_min_v, driver.port("vcc").voltage_max_v) == (2.7, 5.5)
    assert all(driver.port(p).current_limit_a == 1.2 for p in ("ao1", "ao2", "bo1", "bo2"))
    motor = catalog.require("motor.adafruit_tt_gearbox_200rpm_3777")
    assert motor.port("terminal_1").current_limit_a == 1.5
    assert motor.port("terminal_1").voltage_max_v == 6.0
    slow = catalog.require("motor.adafruit_tt_bimetal_1to90_3801")
    assert (slow.port("terminal_1").current_limit_a, slow.port("terminal_1").voltage_max_v) == (1.0, 6.0)


def test_controller_excludes_flash_pins(catalog):
    board = catalog.require("board.esp32_devkitc_v4_wroom32e")
    ids = {p.port_id for p in board.ports}
    assert not ids & {f"gpio{n}" for n in range(6, 12)}
    for n in (34, 35, 36, 39):
        assert board.port(f"gpio{n}").signal == "digital_input"


def test_unknowns_survive_round_trip(catalog):
    holder = catalog.require("power.sparkfun_shadow_4xaa_holder")
    wire = holder.to_wire()
    assert wire["physical"]["mass_g"] is None
    assert next(p for p in wire["ports"] if p["port_id"] == "v_out")["current_limit_a"] is None
    reloaded = catalog_from_records(catalog.to_wire(), catalog.version)
    assert reloaded.to_wire() == catalog.to_wire()


def test_ids_unique_and_sorted(catalog):
    ids = list(catalog.ids)
    assert ids == sorted(set(ids))


def test_file_matches_canonical_serialization():
    data = json.loads(DATA_PATH.read_text())
    assert data["catalog_version"] == CATALOG_VERSION
    assert load_catalog().to_wire() == data["components"]


def test_duplicate_ids_rejected():
    records = [r for r in support.synthetic_catalog_records()][:2]
    with pytest.raises(CatalogError):
        catalog_from_records([records[0], records[0]], "v")


@pytest.mark.parametrize(
    "mutate",
    [
        lambda r: r.pop("identity"),
        lambda r: r["sourcing"].update(price_amount="free"),
        lambda r: r.update(unexpected=True),
    ],
)
def test_malformed_records_rejected(mutate):
    record = support.synthetic_catalog_records()[0]
    mutate(record)
    with pytest.raises(CatalogError) as err:
        catalog_from_records([record], "v")
    assert err.value.details["errors"]


@pytest.mark.parametrize(
    "content",
    ["not json", json.dumps([]), json.dumps({"schema_version": "1.0", "components": []}), json.dumps({"schema_version": "2.0", "catalog_version": "x", "components": []})],
)
def test_bad_catalog_files_rejected(tmp_path, content):
    path = tmp_path / "c.json"
    path.write_text(content)
    with pytest.raises(CatalogError):
        load_catalog(str(path))


def test_missing_file_rejected(tmp_path):
    with pytest.raises(CatalogError):
        load_catalog(str(tmp_path / "missing.json"))


def test_load_uses_no_network(monkeypatch):
    catalog_module._read.cache_clear()

    def refuse(*args, **kwargs):
        raise AssertionError("network access during catalog load")

    monkeypatch.setattr(socket, "socket", refuse)
    monkeypatch.setattr(socket, "create_connection", refuse)
    assert load_catalog().components


def test_load_is_deterministic():
    catalog_module._read.cache_clear()
    first = load_catalog().to_wire()
    catalog_module._read.cache_clear()
    assert load_catalog().to_wire() == first
