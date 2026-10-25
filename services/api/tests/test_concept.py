import json

import pytest

from rivet_api.agents.vision import LiveVisionProvider
from rivet_api.concept import build_concept_plan, fixture_concept
from rivet_api.concept.reference_parts import REFERENCE_URLS
from rivet_api.concept.model import MAX_PARTS, ConceptModel, clean_concept, floating_parts, part_bounds
from rivet_api.errors import ApiError
from rivet_api.models.requests import GenerateRequest
from rivet_api.orchestration.pipeline import check_concept_plan

CONCEPT_BODY = {"input": {"kind": "text", "user_text": "a camera drone"}, "interpretation_choice": "concept_model"}


def _part(**over):
    return {
        "name": "Body",
        "category": "body",
        "shape": "box",
        "size_mm": [100, 20, 100],
        "position_mm": [0, 10, 0],
        "rotation_deg": [0, 0, 0],
        "color": "#112233",
        "material": "plastic",
    } | over


class ReplyBackend:
    def __init__(self, *replies):
        self.replies = list(replies)
        self.calls = []

    def complete_json(self, system, user_text, image):
        self.calls.append((system, user_text, image))
        return self.replies.pop(0)


def test_fixture_concept_builds_a_consistent_appearance_only_plan():
    plan = build_concept_plan(fixture_concept(), "intent-1", "image", "fixture")
    check_concept_plan(plan)
    assert plan["status"] == "needs_review" and plan["behavior"] is None
    assert plan["simulation"]["kind"] == "none" and plan["simulation"]["enabled"] is False
    assert plan["provenance"]["catalog_version"].startswith("CONCEPT")
    # Four rotors share one catalog entry; the BOM counts them.
    props = next(i for i in plan["bom"]["items"] if i["catalog_id"] == "concept.propeller")
    assert props["quantity"] == 4
    assert all(e["identity"]["sku"] is None and e["sourcing"]["purchase_url"] is None for e in plan["concept_catalog"])
    finding = plan["verification"]["findings"][0]
    assert finding["rule_id"] == "concept.not_engineered" and finding["severity"] == "blocking"


def test_drone_internals_get_curated_suggestions_never_verified_links():
    plan = build_concept_plan(fixture_concept(), "intent-1", "image", "fixture")
    items = {i["catalog_id"]: i for i in plan["bom"]["items"]}
    suggested = {cid for cid, i in items.items() if i["link_status"] == "manufacturer_reference_only"}
    assert {"concept.flight-controller", "concept.esc", "concept.motor", "concept.propeller", "concept.battery",
            "concept.radio-receiver", "concept.gps-module", "concept.power-distribution-board"} <= suggested
    assert all(items[cid]["purchase_url"] in REFERENCE_URLS and items[cid]["unit_price_amount"] for cid in suggested)
    # Shapes that are not products on their own, and wires, stay unsourced.
    for cid in ("concept.body", "concept.landing-leg", "concept.camera-lens"):
        assert items[cid]["link_status"] == "not_available" and items[cid]["purchase_url"] is None
    assert not any(i["link_status"] == "verified_product" for i in items.values())
    # A 4-in-1 ESC is split across the four ESC parts.
    esc = next(e for e in plan["concept_catalog"] if e["catalog_id"] == "concept.esc")
    assert items["concept.esc"]["unit_price_amount"] == "27.00" and "shared across" in esc["evidence"]["notes"][-1]
    assert plan["bom"]["total_status"] == "incomplete" and plan["bom"]["known_subtotal_amount"] is not None


def test_check_concept_plan_rejects_links_that_are_not_curated():
    plan = build_concept_plan(fixture_concept(), "intent-1", "image", "fixture")
    item = next(i for i in plan["bom"]["items"] if i["link_status"] == "manufacturer_reference_only")
    item["purchase_url"] = "https://attacker.example/buy"
    with pytest.raises(ApiError) as exc:
        check_concept_plan(plan)
    assert "not a curated suggestion" in str(exc.value.details)
    item["purchase_url"], item["link_status"] = next(iter(REFERENCE_URLS)), "verified_product"
    with pytest.raises(ApiError):
        check_concept_plan(plan)


def test_gadget_parts_use_the_hobby_table():
    from rivet_api.concept.reference_parts import suggest

    assert suggest("desk lamp", "Controller board", "controller").sku == "3405"
    assert suggest("robot", "Motor driver", "motor_driver").sku == "ROB-14450"
    assert suggest("quadcopter drone", "Motor", "motor").sku == "23540"
    assert suggest("robot", "Motor", "motor").sku == "ROB-13302"
    assert suggest("drone", "Top cover", "chassis") is None and suggest("robot", "Signal wire", "wire") is None


def test_plan_is_grounded_and_centred():
    concept = ConceptModel(title="t", parts=[_part(position_mm=[500, 900, -300])])
    plan = build_concept_plan(clean_concept(concept), "i", "text", "live")
    assert plan["components"][0]["pose"]["position_mm"] == [0.0, 10.0, 0.0]


def test_clean_concept_clamps_numbers_and_text():
    raw = ConceptModel(
        title="x" * 300,
        parts=[_part(size_mm=[-5, 0, 1e9], color="red", name="a\x00b")] * (MAX_PARTS + 5),
    )
    clean = clean_concept(raw)
    assert len(clean.parts) == MAX_PARTS and len(clean.title) == 80
    part = clean.parts[0]
    assert part.size_mm == [5, 0.5, 20000.0] and part.color == "#9aa0a6" and part.name == "a b"


def test_check_concept_plan_rejects_sourcing_claims():
    plan = build_concept_plan(fixture_concept(), "i", "image", "fixture")
    plan["bom"]["items"][0]["link_status"] = "verified_product"
    with pytest.raises(ApiError) as err:
        check_concept_plan(plan)
    assert err.value.code == "CONCEPT_CONTRACT_VIOLATION"


def test_live_provider_retries_once_then_parses():
    good = json.dumps({"title": "Mug", "object_type": "mug", "parts": [_part(shape="cylinder")]})
    backend = ReplyBackend("not json", good)
    req = GenerateRequest.model_validate(CONCEPT_BODY)
    concept = LiveVisionProvider(backend, "m").concept(req, (b"img", "image/png"))
    assert concept.object_type == "mug" and len(backend.calls) == 2
    assert "rejected" in backend.calls[1][1] and backend.calls[0][2] == (b"img", "image/png")


def test_live_provider_gives_up_after_two_bad_replies():
    req = GenerateRequest.model_validate(CONCEPT_BODY)
    with pytest.raises(ApiError) as err:
        LiveVisionProvider(ReplyBackend("{}", "{}"), "m").concept(req, None)
    assert err.value.code == "CONCEPT_PARSE_FAILED" and err.value.retryable


def test_generate_concept_end_to_end_without_intent(generate):
    client, _, job = generate(CONCEPT_BODY)
    assert job["status"] == "complete", job
    plan = client.get(f"/api/projects/{job['build_id']}").json()
    assert plan["concept_catalog"] and plan["provenance"]["generation_mode"] == "fixture"
    assert any("not a live model" in n for n in plan["provenance"]["notes"])


def test_concept_plans_refuse_bom_and_firmware_export(generate):
    client, _, job = generate(CONCEPT_BODY)
    build_id = job["build_id"]
    bom = client.get(f"/api/projects/{build_id}/exports/bom.csv")
    assert bom.status_code == 422 and bom.json()["error"]["code"] == "EXPORT_REFUSED_CONCEPT"
    assert client.get(f"/api/projects/{build_id}/exports/firmware.zip").status_code == 422


def test_concept_edit_in_words_creates_a_revision(generate):
    client, _, job = generate(CONCEPT_BODY)
    build_id = job["build_id"]
    resp = client.post(f"/api/projects/{build_id}/edits", json={"base_revision": 1, "instruction": "make the propellers blue"})
    assert resp.status_code == 200 and resp.json() == {"accepted": True, "build_id": build_id, "revision": 2}
    plan = client.get(f"/api/projects/{build_id}").json()
    colors = {c["render_overrides"]["color"] for c in plan["components"] if c["role"] == "propeller"}
    assert colors == {"#2563eb"}
    body = next(c for c in plan["components"] if c["role"] == "body")
    assert body["render_overrides"]["color"] != "#2563eb"
    assert any(n.startswith("Edited: make the propellers blue") for n in plan["provenance"]["notes"])


def test_concept_edit_that_changes_nothing_is_not_applied(generate):
    client, _, job = generate(CONCEPT_BODY)
    build_id = job["build_id"]
    resp = client.post(f"/api/projects/{build_id}/edits", json={"base_revision": 1, "instruction": "make it fly faster"})
    assert resp.status_code == 200 and resp.json()["accepted"] is False
    assert resp.json()["finding"]["rule_id"] == "concept.edit_no_change"
    empty = client.post(f"/api/projects/{build_id}/edits", json={"base_revision": 1, "operation": {"op": "set_budget"}})
    assert empty.status_code == 422 and empty.json()["error"]["code"] == "CONCEPT_EDIT_NEEDS_TEXT"
    assert [r["revision"] for r in client.get(f"/api/projects/{build_id}/revisions").json()["revisions"]] == [1]


def test_failed_concept_falls_back_to_the_labelled_rover(generate):
    from rivet_api.agents.vision import MockVisionProvider

    class BrokenConcept(MockVisionProvider):
        def concept(self, request, image):
            raise ApiError("CONCEPT_PARSE_FAILED", "no usable concept", 502, retryable=True)

    body = {"input": {"kind": "text", "user_text": "a desk lamp"}, "interpretation_choice": "concept_model"}
    client, _, job = generate(body, vision=BrokenConcept())
    assert job["status"] == "complete", job
    plan = client.get(f"/api/projects/{job['build_id']}").json()
    assert plan["project_family"] == "rover" and "concept_catalog" not in plan
    note = next(n for n in plan["provenance"]["notes"] if n.startswith("A 3D concept of the upload could not be built"))
    assert "(CONCEPT_PARSE_FAILED)" in note


def test_segment_parts_are_stretched_between_their_ends():
    arm = _part(name="Arm", position_mm=None, from_mm=[0, 30, 0], to_mm=[-80, 30, 80], size_mm=[10, 0, 8])
    part = clean_concept(ConceptModel(title="t", parts=[arm])).parts[0]
    assert part.position_mm == [-40, 30, 40]
    assert part.size_mm[1] == pytest.approx(113.137, abs=0.01) and part.size_mm[0] == 10
    lo, hi = part_bounds(part)
    assert lo[1] == pytest.approx(30 - 4) and hi[1] == pytest.approx(30 + 4)  # depth is vertical, width flat


def test_segment_length_written_into_size_is_dropped():
    arm = _part(position_mm=None, from_mm=[0, 0, 0], to_mm=[100, 0, 0], size_mm=[100, 10, 5])
    assert clean_concept(ConceptModel(title="t", parts=[arm])).parts[0].size_mm == [5, 100, 10]


def test_floating_parts_are_found_and_sent_back_once():
    near, far = _part(name="Body"), _part(name="Lost wheel", position_mm=[900, 10, 0])
    reply = json.dumps({"title": "t", "parts": [near, far]})
    fixed = json.dumps({"title": "t", "parts": [near, _part(name="Wheel", position_mm=[100, 10, 0])]})
    assert floating_parts(clean_concept(ConceptModel.model_validate(json.loads(reply)))) == ["Lost wheel"]
    backend = ReplyBackend(reply, fixed)
    concept = LiveVisionProvider(backend, "m").concept(GenerateRequest.model_validate(CONCEPT_BODY), None)
    assert [p.name for p in concept.parts] == ["Body", "Wheel"]
    assert "Lost wheel" in backend.calls[1][1]


def test_internal_flag_survives_cleaning_and_defaults_to_visible():
    concept = ConceptModel(title="t", parts=[_part(), _part(name="Flight controller", category="board", internal=True)])
    cleaned = clean_concept(concept)
    assert [p.internal for p in cleaned.parts] == [False, True]


def test_fixture_drone_has_inferred_internals_inside_its_body():
    concept = clean_concept(fixture_concept())
    internals = [p for p in concept.parts if p.internal]
    names = {p.name for p in internals}
    assert {"Flight controller", "Power distribution board", "Radio receiver"} <= names
    assert sum("ESC" in n for n in names) == 4  # one per motor
    blo, bhi = part_bounds(next(p for p in concept.parts if p.name == "Centre body"))
    for p in internals:
        lo, hi = part_bounds(p)
        assert all(blo[i] <= lo[i] and hi[i] <= bhi[i] for i in range(3)), p.name
    assert floating_parts(concept) == []


def test_internal_parts_are_labelled_inferred_everywhere_in_the_plan():
    plan = build_concept_plan(clean_concept(fixture_concept()), "i", "image", "fixture")
    check_concept_plan(plan)
    internal_ids = [c["instance_id"] for c in plan["components"] if c["render_overrides"].get("internal")]
    boards = [c for c in plan["components"] if c["render_overrides"].get("internal") and c["role"] != "wire"]
    assert len(boards) == 8 and len(internal_ids) == 8 + 16  # boards plus their wires
    visible = [c for c in plan["components"] if not c["render_overrides"].get("internal")]
    assert visible and all("internal" not in c["render_overrides"] for c in visible)
    finding = next(f for f in plan["verification"]["findings"] if f["rule_id"] == "concept.internals_inferred")
    assert finding["severity"] == "advisory" and finding["affected_instance_ids"] == internal_ids
    assert "inferred rather than seen" in finding["message"]
    # Internals are installed first and are never presented as products or as seen in the image.
    first = plan["assembly_steps"][0]
    assert first["title"].startswith("Place the internal") and set(first["instance_ids"]) <= set(internal_ids)
    by_id = {e["catalog_id"]: e for e in plan["concept_catalog"]}
    for c in plan["components"]:
        if c["instance_id"] in internal_ids:
            entry = by_id[c["catalog_id"]]
            assert entry["identity"]["sku"] is None and entry["evidence"]["dimensions"] == "unknown"
            assert "inferred" in entry["evidence"]["notes"][0]


def test_objects_without_internals_get_no_internals_finding():
    plan = build_concept_plan(clean_concept(ConceptModel(title="chair", parts=[_part()])), "i", "text", "live")
    assert all(f["rule_id"] != "concept.internals_inferred" for f in plan["verification"]["findings"])
    assert not plan["assembly_steps"][0]["title"].startswith("Place the internal")


def test_prompt_asks_for_internals_only_on_working_devices():
    from rivet_api.concept.model import CONCEPT_SYSTEM_PROMPT

    assert '"internal": true' in CONCEPT_SYSTEM_PROMPT and "flight controller" in CONCEPT_SYSTEM_PROMPT
    assert "Do not add internal parts" in CONCEPT_SYSTEM_PROMPT


def test_part_names_keep_hyphenated_numbers_but_group_numbered_repeats():
    from rivet_api.concept.plan import _base_name

    assert _base_name("4-in-1 ESC") == "4-in-1 esc"
    assert _base_name("Motor 2") == _base_name("Motor 1") == "Motor"
    assert _base_name("Front-left rotor") == _base_name("Rear right rotor") == "Rotor"


def test_wires_connect_named_parts_and_survive_a_round_trip():
    from rivet_api.concept import concept_from_plan

    plan = build_concept_plan(fixture_concept(), "i", "image", "fixture")
    check_concept_plan(plan)
    by_id = {c["instance_id"]: c for c in plan["components"]}
    wires = [c for c in plan["components"] if c["role"] == "wire"]
    assert len(wires) == 16 and all(w["render_overrides"]["internal"] for w in wires)
    battery = next(w for w in wires if w["render_overrides"]["label"] == "Battery to PDB")
    a, b = (by_id[i] for i in battery["render_overrides"]["connects"])
    assert (a["render_overrides"]["label"], b["render_overrides"]["label"]) == ("Battery", "Power distribution board")
    # The path starts and ends at the two part centres.
    centre, path = battery["pose"]["position_mm"], battery["render_overrides"]["path_mm"]
    start = [path[0][i] + centre[i] for i in range(3)]
    assert start == pytest.approx(a["pose"]["position_mm"], abs=0.02)
    rebuilt = build_concept_plan(concept_from_plan(plan), "i", "image", "fixture")
    assert [c["render_overrides"] for c in rebuilt["components"]] == [c["render_overrides"] for c in plan["components"]]


def test_wires_to_unknown_or_same_parts_are_dropped():
    raw = ConceptModel.model_validate(
        {
            "title": "t",
            "parts": [_part(name="Board"), _part(name="Motor", position_mm=[50, 10, 0])],
            "wires": [
                {"from_part": "board", "to_part": "MOTOR"},
                {"from_part": "Board", "to_part": "Motor"},
                {"from_part": "Board", "to_part": "Ghost"},
                {"from_part": "Board", "to_part": "Board"},
            ],
        }
    )
    wires = clean_concept(raw).wires
    assert [(w.from_part, w.to_part) for w in wires] == [("Board", "Motor")]


def test_overlapping_internal_boards_are_stacked_and_wires_follow():
    boards = [
        _part(name="Flight controller", category="board", size_mm=[30, 2, 30], position_mm=[0, 10, 0], internal=True),
        _part(name="ESC", category="board", size_mm=[30, 4, 30], position_mm=[0, 9, 0], internal=True),
        _part(name="Receiver", category="board", size_mm=[20, 4, 10], position_mm=[60, 9, 0], internal=True),
    ]
    raw = ConceptModel(title="t", parts=[_part(size_mm=[100, 40, 100], position_mm=[0, 20, 0]), *boards],
                       wires=[{"from_part": "ESC", "to_part": "Flight controller"}])
    clean = clean_concept(raw)
    by = {p.name: p for p in clean.parts}
    esc, fc = part_bounds(by["ESC"]), part_bounds(by["Flight controller"])
    assert fc[0][1] == pytest.approx(esc[1][1] + 1.5)  # FC sits on the ESC with a gap
    assert by["Receiver"].position_mm == [60, 9, 0]  # not overlapping: untouched
    assert clean_concept(clean).parts == clean.parts  # idempotent, so edits do not drift
    plan = build_concept_plan(clean, "i", "text", "live")
    wire = next(c for c in plan["components"] if c["role"] == "wire")
    fc_comp = next(c for c in plan["components"] if c["render_overrides"]["label"] == "Flight controller")
    end = [wire["render_overrides"]["path_mm"][-1][i] + wire["pose"]["position_mm"][i] for i in range(3)]
    assert end == pytest.approx(fc_comp["pose"]["position_mm"], abs=0.02)


class FailingConceptVision:
    """Vision that reads intents like the mock but cannot rebuild a concept (a live model outage)."""

    mode = "live"

    def __init__(self):
        from rivet_api.agents.vision import MockVisionProvider

        self._mock = MockVisionProvider()

    def interpret(self, request, image):
        return self._mock.interpret(request, image)

    def concept(self, request, image):
        raise ApiError("VISION_UNAVAILABLE", "model down", 503)


def test_a_drone_whose_concept_fails_falls_back_to_the_saved_quadcopter(generate):
    client, _, job = generate(CONCEPT_BODY, vision=FailingConceptVision())
    assert job["status"] == "complete", job
    plan = client.get(f"/api/projects/{job['build_id']}").json()
    assert plan["concept_catalog"] and plan["provenance"]["generation_mode"] == "fallback"
    assert any("saved example quadcopter" in n for n in plan["provenance"]["notes"])
    assert any(i["link_status"] == "manufacturer_reference_only" for i in plan["bom"]["items"])



def test_a_single_four_in_one_esc_costs_the_whole_board():
    from rivet_api.concept.reference_parts import suggest

    esc = suggest("drone", "4-in-1 esc", "controller")
    assert esc.pack_size == 4 and esc.unit_price(1) == esc.price and esc.unit_price(4) == "27.00"
