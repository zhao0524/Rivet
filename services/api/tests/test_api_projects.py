def test_catalog_lists_components_and_filters_category(make_client):
    client, _ = make_client()
    body = client.get("/api/catalog").json()
    assert body["schema_version"] == "1.0"
    assert len(body["components"]) == 9
    only = client.get("/api/catalog?category=motor_driver").json()["components"]
    assert only and all(c["identity"]["category"] == "motor_driver" for c in only)
    assert client.get("/api/catalog?category=no_such_category").json()["components"] == []


def test_examples_lists_saved_build_with_honest_labels(make_client):
    client, _ = make_client()
    examples = client.get("/api/projects/examples").json()["examples"]
    assert len(examples) == 1
    ex = examples[0]
    assert ex["generation_mode"] == "fixture"
    assert "synthetic" in ex["title"].lower()
    assert ex["status"] == "needs_review"


def test_get_unknown_project_and_revision_404(generate):
    client, _, job = generate()
    build_id = job["build_id"]
    assert client.get("/api/projects/does-not-exist").status_code == 404
    resp = client.get(f"/api/projects/{build_id}?revision=9")
    assert resp.status_code == 404 and resp.json()["error"]["code"] == "REVISION_NOT_FOUND"


def test_get_project_bad_revision_query_is_400(generate):
    client, _, job = generate()
    assert client.get(f"/api/projects/{job['build_id']}?revision=abc").status_code == 400
    assert client.get(f"/api/projects/{job['build_id']}?revision=0").status_code == 400


def test_bad_build_id_is_400(make_client):
    client, _ = make_client()
    assert client.get("/api/projects/BAD_ID").status_code == 400


def test_revisions_list_ordered(generate):
    client, _, job = generate()
    build_id = job["build_id"]
    edit = {
        "base_revision": 1,
        "operation": {"op": "set_behavior_parameter", "name": "turn_duration_ms", "value": 800},
    }
    assert client.post(f"/api/projects/{build_id}/edits", json=edit).status_code == 200
    revs = client.get(f"/api/projects/{build_id}/revisions").json()["revisions"]
    assert [r["revision"] for r in revs] == [1, 2]
    assert set(revs[0]) == {"revision", "created_at", "status", "title"}


def test_mode_header_on_every_response(make_client):
    client, _ = make_client()
    assert client.get("/api/health").headers["x-rivet-mode"] == "fixture"
    assert client.get("/api/projects/nope-nope-nope").headers["x-rivet-mode"] == "fixture"
