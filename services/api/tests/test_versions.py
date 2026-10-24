import json
import threading

import pytest

from rivet_api.errors import ApiError
from rivet_api.orchestration.versions import ProjectStore


@pytest.fixture
def store(tmp_path) -> ProjectStore:
    return ProjectStore(tmp_path / "projects")


def test_create_then_get_round_trips(store, plan_dict):
    created = store.create(plan_dict, build_id="demo-build-001")
    assert created["build_id"] == "demo-build-001"
    assert created["revision"] == 1
    assert store.get("demo-build-001") == created
    assert store.get("demo-build-001", 1) == created


def test_create_without_build_id_generates_valid_unique_ids(store, plan_dict):
    a = store.create(plan_dict)["build_id"]
    b = store.create(plan_dict)["build_id"]
    assert a != b
    assert store.get(a)["build_id"] == a


def test_create_existing_build_id_conflicts(store, plan_dict):
    store.create(plan_dict, build_id="demo-build-001")
    with pytest.raises(ApiError) as exc:
        store.create(plan_dict, build_id="demo-build-001")
    assert exc.value.status == 409


def test_create_does_not_mutate_caller_plan(store, plan_dict):
    before = json.dumps(plan_dict, sort_keys=True)
    store.create(plan_dict, build_id="demo-build-001")
    assert json.dumps(plan_dict, sort_keys=True) == before


def test_append_increments_revision_and_preserves_old(store, plan_dict, tmp_path):
    store.create(plan_dict, build_id="demo-build-001")
    rev1_file = tmp_path / "projects" / "demo-build-001" / "revision-1.json"
    rev1_bytes = rev1_file.read_bytes()
    new = dict(plan_dict, title="Edited title")
    assert store.append_revision("demo-build-001", 1, new) == 2
    assert rev1_file.read_bytes() == rev1_bytes
    assert store.get("demo-build-001")["revision"] == 2
    assert store.get("demo-build-001")["title"] == "Edited title"
    assert store.get("demo-build-001", 1)["title"] == plan_dict["title"]


def test_append_forces_build_id_and_never_changes_status(store, plan_dict):
    store.create(plan_dict, build_id="demo-build-001")
    tampered = dict(plan_dict, build_id="other-project", status="verified")
    store.append_revision("demo-build-001", 1, tampered)
    stored = store.get("demo-build-001")
    assert stored["build_id"] == "demo-build-001"
    assert stored["status"] == "verified"  # stored exactly as given; store never edits status


def test_stale_base_revision_409(store, plan_dict):
    store.create(plan_dict, build_id="demo-build-001")
    store.append_revision("demo-build-001", 1, plan_dict)
    with pytest.raises(ApiError) as exc:
        store.append_revision("demo-build-001", 1, plan_dict)
    assert exc.value.status == 409
    assert exc.value.code == "STALE_REVISION"
    assert len(store.list_revisions("demo-build-001")) == 2


def test_concurrent_appends_same_base_one_wins(store, plan_dict, tmp_path):
    store.create(plan_dict, build_id="demo-build-001")
    results = []

    def attempt():
        try:
            results.append(store.append_revision("demo-build-001", 1, plan_dict))
        except ApiError as e:
            results.append(e.status)

    threads = [threading.Thread(target=attempt) for _ in range(8)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert results.count(2) == 1
    assert results.count(409) == 7
    files = sorted(p.name for p in (tmp_path / "projects" / "demo-build-001").glob("revision-*.json"))
    assert files == ["revision-1.json", "revision-2.json"]


@pytest.mark.parametrize("bad", ["../x", "a/b", "", "UPPER", "..", "a" * 80, "-leading", "x\\y", "ab"])
def test_bad_build_id_rejected_without_touching_disk(store, tmp_path, bad):
    with pytest.raises(ApiError) as exc:
        store.get(bad)
    assert exc.value.status == 400
    assert exc.value.code == "BAD_BUILD_ID"
    with pytest.raises(ApiError):
        store.create({"x": 1}, build_id=bad)
    assert not list(tmp_path.rglob("revision-*.json"))


def test_missing_project_and_revision_404(store, plan_dict):
    with pytest.raises(ApiError) as exc:
        store.get("does-not-exist")
    assert exc.value.status == 404 and exc.value.code == "PROJECT_NOT_FOUND"
    store.create(plan_dict, build_id="demo-build-001")
    with pytest.raises(ApiError) as exc:
        store.get("demo-build-001", 7)
    assert exc.value.status == 404 and exc.value.code == "REVISION_NOT_FOUND"


def test_reload_from_disk_after_new_store_instance(store, plan_dict, tmp_path):
    store.create(plan_dict, build_id="demo-build-001")
    store.append_revision("demo-build-001", 1, dict(plan_dict, title="v2"))
    fresh = ProjectStore(tmp_path / "projects")
    assert fresh.get("demo-build-001")["title"] == "v2"
    assert [r["revision"] for r in fresh.list_revisions("demo-build-001")] == [1, 2]
    assert fresh.append_revision("demo-build-001", 2, plan_dict) == 3


def test_list_revisions_summaries(store, plan_dict):
    store.create(plan_dict, build_id="demo-build-001")
    summary = store.list_revisions("demo-build-001")[0]
    assert set(summary) == {"revision", "created_at", "status", "title"}
    assert summary["status"] == plan_dict["status"]


def test_returned_plans_are_copies(store, plan_dict):
    store.create(plan_dict, build_id="demo-build-001")
    got = store.get("demo-build-001")
    got["title"] = "mutated"
    assert store.get("demo-build-001")["title"] == plan_dict["title"]


def test_edit_log_is_append_only(store, plan_dict):
    store.create(plan_dict, build_id="demo-build-001")
    store.log_edit("demo-build-001", {"instruction": "first", "accepted": True})
    first_snapshot = store.read_edit_log("demo-build-001")
    store.log_edit("demo-build-001", {"instruction": "second", "accepted": False})
    log = store.read_edit_log("demo-build-001")
    assert log[:1] == first_snapshot
    assert [e["instruction"] for e in log] == ["first", "second"]
    assert all("logged_at" in e for e in log)
