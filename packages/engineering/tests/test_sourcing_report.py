from rivet_engine import get_catalog, get_sourcing_report


def test_read_only_report_covers_catalog_and_has_reproducible_freshness():
    catalog = get_catalog()
    current = get_sourcing_report('2026-10-24')
    old = get_sourcing_report('2027-10-24')
    assert set(current) == {c['catalog_id'] for c in catalog}
    assert current == get_sourcing_report('2026-10-24')
    assert any(item['fresh'] for item in current.values())
    assert all(not item['fresh'] for item in old.values())
    assert get_catalog() == catalog
    assert all(set(item) == {'status', 'checked_at', 'catalog_verified_at', 'verified_at', 'fresh', 'flags', 'detail'} for item in current.values())
