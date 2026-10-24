import csv
import io
import json

import pytest

from rivet_api.bom_csv import bom_to_csv

BEHAVIOR_EDIT = {
    "base_revision": 1,
    "operation": {"op": "set_behavior_parameter", "name": "turn_duration_ms", "value": 800},
}


def rows(text: str) -> list[list[str]]:
    return list(csv.reader(io.StringIO(text)))


def priced(plan: dict) -> None:
    for item in plan["bom"]["items"]:
        item["unit_price_amount"] = "12.50"
        item["link_status"] = "verified_product"
        item["purchase_url"] = "https://example.com/p?a=1,2"
    plan["bom"]["known_subtotal_amount"] = "112.50"
    plan["bom"]["total_status"] = "complete"


# ---- bom_to_csv --------------------------------------------------------------------


def test_header_and_row_layout(plan_dict):
    out = rows(bom_to_csv(plan_dict))
    assert out[0] == [
        "catalog_id", "quantity", "instance_ids", "unit_price_amount", "currency", "purchase_url", "link_status",
    ]
    items = plan_dict["bom"]["items"]
    assert len(out) == 1 + len(items) + 1  # header + items + TOTAL
    assert [r[0] for r in out[1:-1]] == [i["catalog_id"] for i in items]


def test_null_prices_stay_empty_never_zero(plan_dict):
    out = rows(bom_to_csv(plan_dict))
    assert all(r[3] == "" and r[5] == "" for r in out[1:-1])
    assert all(r[6] == "not_available" for r in out[1:-1])
    total = out[-1]
    assert total[0] == "TOTAL" and total[3] == "" and total[6] == "total_status:not_available"
    assert "0.00" not in bom_to_csv(plan_dict)


def test_quantity_and_instance_ids_match_the_plan(plan_dict):
    first = plan_dict["bom"]["items"][0]
    row = rows(bom_to_csv(plan_dict))[1]
    assert row[1] == str(first["quantity"])
    assert row[2].split(";") == first["instance_ids"]
    assert row[4] == plan_dict["bom"]["currency"]


def test_prices_links_and_subtotal_pass_through_unchanged(plan_dict):
    priced(plan_dict)
    out = rows(bom_to_csv(plan_dict))
    assert out[1][3] == "12.50" and out[1][5] == "https://example.com/p?a=1,2"
    assert out[-1][3] == "112.50" and out[-1][6] == "total_status:complete"


def test_subtotal_is_never_computed_by_the_api(plan_dict):
    priced(plan_dict)
    plan_dict["bom"]["known_subtotal_amount"] = None
    plan_dict["bom"]["total_status"] = "incomplete"
    total = rows(bom_to_csv(plan_dict))[-1]
    assert total[3] == "" and total[6] == "total_status:incomplete"


@pytest.mark.parametrize("danger", ["=HYPERLINK(\"http://x\")", "+cmd|' /C calc'!A0", "@SUM(1+1)", "-2+3", "\t=1+1", "\r=1"])
def test_cells_cannot_start_a_spreadsheet_formula(plan_dict, danger):
    plan_dict["bom"]["items"][0]["catalog_id"] = danger
    plan_dict["bom"]["items"][0]["purchase_url"] = danger
    row = rows(bom_to_csv(plan_dict))[1]
    assert row[0].startswith("'") and row[5].startswith("'")
    assert row[0][1:] == danger


def test_plain_decimal_prices_are_not_escaped(plan_dict):
    plan_dict["bom"]["items"][0]["unit_price_amount"] = "7.25"
    assert rows(bom_to_csv(plan_dict))[1][3] == "7.25"


def test_commas_quotes_and_newlines_round_trip(plan_dict):
    plan_dict["bom"]["items"][0]["catalog_id"] = 'a,"b"\nc'
    assert rows(bom_to_csv(plan_dict))[1][0] == 'a,"b"\nc'


# ---- routes -----------------------------------------------------------------------------


@pytest.fixture
def project(generate):
    def _make(**kwargs):
        client, app, job = generate(**kwargs)
        assert job["status"] == "complete"
        return client, app, job["build_id"]

    return _make


def priced_total(plan: dict) -> None:
    plan["bom"]["known_subtotal_amount"] = "112.50"
    plan["bom"]["total_status"] = "complete"


def test_bom_csv_is_refused_for_the_synthetic_fixture(project):
    client, _, build_id = project()
    resp = client.get(f"/api/projects/{build_id}/exports/bom.csv")
    assert resp.status_code == 422 and resp.json()["error"]["code"] == "EXPORT_REFUSED_SYNTHETIC"
    assert "demo.tb6612" in resp.json()["error"]["details"]["synthetic_catalog_ids"]


def test_build_json_for_the_synthetic_fixture_is_flagged(project):
    client, _, build_id = project()
    resp = client.get(f"/api/projects/{build_id}/exports/build.json")
    assert resp.status_code == 200 and resp.headers["x-rivet-synthetic"] == "true"


def test_bom_csv_route_headers_and_content(project, stub_engine_cls):
    client, _, build_id = project(engine=stub_engine_cls(real=True))
    resp = client.get(f"/api/projects/{build_id}/exports/bom.csv")
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/csv")
    assert resp.headers["content-disposition"] == f'attachment; filename="{build_id}-r1-bom.csv"'
    assert resp.headers["x-content-type-options"] == "nosniff"
    assert resp.headers["x-rivet-generation-mode"] == "fallback"
    assert resp.headers["x-rivet-synthetic"] == "false"
    body = rows(resp.text)
    assert body[-1][0] == "TOTAL" and body[-1][6] == "total_status:not_available"
    assert body[1][5].startswith("https://shop.test/") and body[1][6] == "verified_product"


def test_bom_csv_route_with_prices_from_the_engine(project, stub_engine_cls):
    engine = stub_engine_cls(real=True, price="12.50", mutate_plan=priced_total)
    client, _, build_id = project(engine=engine)
    body = rows(client.get(f"/api/projects/{build_id}/exports/bom.csv").text)
    assert body[1][3] == "12.50" and body[-1][3] == "112.50"
    assert client.get(f"/api/projects/{build_id}/exports/bom.csv").headers["x-rivet-generation-mode"] == "fallback"


def test_build_json_equals_stored_revision_and_defaults_to_latest(project):
    client, app, build_id = project()
    assert client.post(f"/api/projects/{build_id}/edits", json=BEHAVIOR_EDIT).status_code == 200
    latest = client.get(f"/api/projects/{build_id}/exports/build.json")
    assert latest.status_code == 200 and latest.headers["content-type"].startswith("application/json")
    assert latest.headers["content-disposition"] == f'attachment; filename="{build_id}-r2.json"'
    assert latest.json() == app.state.deps.store.get(build_id, 2)
    first = client.get(f"/api/projects/{build_id}/exports/build.json?revision=1")
    assert first.json() == app.state.deps.store.get(build_id, 1)
    assert first.json()["behavior"]["parameters"]["turn_duration_ms"] == 600


def test_bom_csv_revision_param(project, stub_engine_cls):
    client, _, build_id = project(engine=stub_engine_cls(real=True))
    client.post(f"/api/projects/{build_id}/edits", json=BEHAVIOR_EDIT)
    r1 = client.get(f"/api/projects/{build_id}/exports/bom.csv?revision=1")
    assert 'filename="' + build_id + '-r1-bom.csv"' in r1.headers["content-disposition"]


@pytest.mark.parametrize("kind", ["bom.csv", "build.json"])
def test_export_errors(project, kind):
    client, _, build_id = project()
    assert client.get(f"/api/projects/{build_id}/exports/{kind}?revision=9").status_code == 404
    assert client.get(f"/api/projects/{build_id}/exports/{kind}?revision=abc").status_code == 400
    assert client.get(f"/api/projects/{build_id}/exports/{kind}?revision=0").status_code == 400
    assert client.get(f"/api/projects/nope-nope-nope/exports/{kind}").status_code == 404
    assert client.get(f"/api/projects/BAD_ID/exports/{kind}").status_code == 400


def test_exports_do_not_modify_stored_revisions(project, tmp_path):
    client, _, build_id = project()
    path = tmp_path / "projects" / build_id / "revision-1.json"
    before = path.read_bytes()
    client.get(f"/api/projects/{build_id}/exports/bom.csv")
    client.get(f"/api/projects/{build_id}/exports/build.json")
    assert path.read_bytes() == before
    assert sorted(p.name for p in path.parent.iterdir()) == ["revision-1.json"]


def test_unknown_export_kind_is_404(project):
    client, _, build_id = project()
    assert client.get(f"/api/projects/{build_id}/exports/secrets.txt").status_code == 404
