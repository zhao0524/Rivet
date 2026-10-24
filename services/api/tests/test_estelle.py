import json
import subprocess
from pathlib import Path

import pytest

from rivet_api.errors import ApiError
from rivet_api.firmware.estelle import RepoGrounder

TEMPLATE_REL = "services/api/rivet_api/firmware/templates/esp32_rover/main.cpp.tmpl"


class Proc:
    def __init__(self, returncode=0, stdout="", stderr=""):
        self.returncode, self.stdout, self.stderr = returncode, stdout, stderr


class Runner:
    def __init__(self, *procs):
        self.procs = list(procs)
        self.calls: list[tuple[list[str], dict]] = []

    def __call__(self, argv, **kw):
        self.calls.append((argv, kw))
        proc = self.procs.pop(0)
        if isinstance(proc, Exception):
            raise proc
        return proc


@pytest.fixture
def repo(tmp_path) -> Path:
    root = tmp_path / "repo"
    (root / ".git").mkdir(parents=True)
    tpl = root / "services/api/rivet_api/firmware/templates/esp32_rover"
    tpl.mkdir(parents=True)
    (tpl / "main.cpp.tmpl").write_text("// one\n// two\nint read_front_distance() {\n  return 1;\n}\n")
    return root


def grounder(repo, tmp_path, runner, *, enabled=True, mode="cli", which=lambda _: "/usr/local/bin/estelle"):
    return RepoGrounder(
        enabled=enabled,
        mode=mode,
        repo_root=repo,
        evidence_dir=tmp_path / "evidence",
        runner=runner,
        which=which,
    )


GOOD_OUT = f"read_front_distance is defined at {TEMPLATE_REL}:3 and used by the main loop."


def evidence_files(tmp_path):
    d = tmp_path / "evidence"
    return list(d.glob("*")) if d.exists() else []


# ---- availability -----------------------------------------------------------------


def test_disabled_never_calls_estelle_and_writes_nothing(repo, tmp_path):
    runner = Runner()
    g = grounder(repo, tmp_path, runner, enabled=False)
    res = g.locate_symbols("read_front_distance")
    assert res.status == "unavailable" and "disabled" in res.reason.lower()
    assert res.citations == [] and runner.calls == []
    assert g.capture_evidence(res) is None and evidence_files(tmp_path) == []


def test_missing_cli_is_unavailable(repo, tmp_path):
    runner = Runner()
    res = grounder(repo, tmp_path, runner, which=lambda _: None).locate_symbols("read_front_distance")
    assert res.status == "unavailable" and "not installed" in res.reason
    assert runner.calls == []


def test_not_a_git_repository_is_unavailable(tmp_path):
    plain = tmp_path / "plain"
    plain.mkdir()
    res = grounder(plain, tmp_path, Runner()).locate_symbols("read_front_distance")
    assert res.status == "unavailable" and "repository" in res.reason


def test_mcp_mode_is_unavailable_because_tool_schemas_are_undocumented(repo, tmp_path):
    runner = Runner()
    res = grounder(repo, tmp_path, runner, mode="mcp").locate_symbols("read_front_distance")
    assert res.status == "unavailable" and "mcp" in res.reason.lower()
    assert runner.calls == []


# ---- grounded answers -------------------------------------------------------------------


def test_verified_citation_is_ok_and_runs_a_fixed_argv(repo, tmp_path, monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-do-not-leak")
    runner = Runner(Proc(0, GOOD_OUT))
    res = grounder(repo, tmp_path, runner).locate_symbols("read_front_distance")
    assert res.status == "ok" and res.tool == "estelle ask"
    assert [(c.path, c.line, c.symbol_in_file) for c in res.citations] == [(TEMPLATE_REL, 3, True)]
    argv, kw = runner.calls[0]
    assert argv[:2] == ["/usr/local/bin/estelle", "ask"] and len(argv) == 3
    assert "read_front_distance" in argv[2] and argv[2] == res.question
    assert not kw.get("shell") and kw["cwd"] == str(repo) and kw["timeout"] > 0
    assert kw["stdin"] == subprocess.DEVNULL
    assert "OPENAI_API_KEY" not in kw["env"] and "HOME" in kw["env"]
    assert res.raw_output_tail == GOOD_OUT and res.exit_code == 0 and res.timestamp.endswith("Z")


def test_inspect_dependencies_uses_the_same_checks(repo, tmp_path):
    runner = Runner(Proc(0, f"Callers of read_front_distance: {TEMPLATE_REL}:3"))
    res = grounder(repo, tmp_path, runner).inspect_dependencies("read_front_distance")
    assert res.status == "ok" and "depend" in res.question.lower() or "call" in res.question.lower()


def test_citation_to_a_nonexistent_file_is_dropped_and_ungrounded(repo, tmp_path):
    res = grounder(repo, tmp_path, Runner(Proc(0, "see firmware/invented.cpp:12"))).locate_symbols("read_front_distance")
    assert res.status == "ungrounded" and res.citations == []
    assert "invented.cpp" in res.raw_output_tail  # raw text kept, but not treated as evidence


@pytest.mark.parametrize("line", [0, 6, 999])
def test_citation_with_an_out_of_range_line_is_dropped(repo, tmp_path, line):
    out = f"{TEMPLATE_REL}:{line}"
    res = grounder(repo, tmp_path, Runner(Proc(0, out))).locate_symbols("read_front_distance")
    assert res.status == "ungrounded" and res.citations == []


@pytest.mark.parametrize("path", ["../../etc/passwd", "/etc/passwd", "~/.ssh/id_rsa", "a/../../b.cpp"])
def test_citations_outside_the_repo_are_dropped(repo, tmp_path, path):
    res = grounder(repo, tmp_path, Runner(Proc(0, f"{path}:1"))).locate_symbols("read_front_distance")
    assert res.status == "ungrounded" and res.citations == []


def test_existing_file_that_lacks_the_symbol_is_not_grounding(repo, tmp_path):
    res = grounder(repo, tmp_path, Runner(Proc(0, f"{TEMPLATE_REL}:1"))).locate_symbols("no_such_function")
    assert res.status == "ungrounded"
    assert [c.symbol_in_file for c in res.citations] == [False]


def test_nonzero_exit_is_unavailable_even_if_output_looks_like_a_citation(repo, tmp_path):
    out = f"error: please run estelle login (see {TEMPLATE_REL}:3)"
    g = grounder(repo, tmp_path, Runner(Proc(1, out)))
    res = g.locate_symbols("read_front_distance")
    assert res.status == "unavailable" and res.citations == [] and res.exit_code == 1
    assert g.capture_evidence(res) is None and evidence_files(tmp_path) == []


def test_timeout_is_unavailable(repo, tmp_path):
    runner = Runner(subprocess.TimeoutExpired(["estelle"], 60))
    res = grounder(repo, tmp_path, runner).locate_symbols("read_front_distance")
    assert res.status == "unavailable" and "timed out" in res.reason


def test_os_error_is_unavailable(repo, tmp_path):
    res = grounder(repo, tmp_path, Runner(OSError("boom"))).locate_symbols("read_front_distance")
    assert res.status == "unavailable"


def test_output_is_ansi_stripped_and_truncated(repo, tmp_path):
    out = "\x1b[32m" + "x" * 9000 + "\x1b[0m " + f"{TEMPLATE_REL}:3"
    res = grounder(repo, tmp_path, Runner(Proc(0, out))).locate_symbols("read_front_distance")
    assert "\x1b" not in res.raw_output_tail and len(res.raw_output_tail) <= 4000
    assert res.status == "ok"  # the citation is at the end, inside the kept tail


@pytest.mark.parametrize(
    "bad", ["foo; rm -rf /", "$(whoami)", "a b", "x\ny", "", "a" * 200, "`id`", "../x", "a|b", "é"]
)
def test_symbol_names_must_be_plain_identifiers(repo, tmp_path, bad):
    runner = Runner()
    g = grounder(repo, tmp_path, runner)
    with pytest.raises(ApiError) as exc:
        g.locate_symbols(bad)
    assert exc.value.status == 400 and exc.value.code == "INVALID_SYMBOL"
    with pytest.raises(ApiError):
        g.inspect_dependencies(bad)
    assert runner.calls == []


# ---- evidence ----------------------------------------------------------------------------


def test_evidence_is_written_only_from_a_verified_result(repo, tmp_path):
    g = grounder(repo, tmp_path, Runner(Proc(0, GOOD_OUT)))
    res = g.locate_symbols("read_front_distance")
    path = g.capture_evidence(res)
    assert path == tmp_path / "evidence" / "estelle_evidence.json"
    data = json.loads(path.read_text())
    entry = data["entries"][0]
    assert entry["tool"] == "estelle ask" and entry["question"] == res.question
    assert entry["timestamp"] == res.timestamp and entry["exit_code"] == 0
    assert entry["citations"] == [{"path": TEMPLATE_REL, "line": 3, "symbol_in_file": True}]
    assert entry["raw_output_tail"] == GOOD_OUT


def test_evidence_accumulates_and_ungrounded_results_are_not_recorded(repo, tmp_path):
    g = grounder(repo, tmp_path, Runner(Proc(0, GOOD_OUT), Proc(0, "nothing useful"), Proc(0, GOOD_OUT)))
    assert g.capture_evidence(g.locate_symbols("read_front_distance")) is not None
    assert g.capture_evidence(g.locate_symbols("read_front_distance")) is None
    g.capture_evidence(g.locate_symbols("read_front_distance"))
    entries = json.loads((tmp_path / "evidence" / "estelle_evidence.json").read_text())["entries"]
    assert len(entries) == 2


# ---- verify_change -----------------------------------------------------------------------


def test_verify_change_rejects_paths_outside_the_template_dir(repo, tmp_path):
    runner = Runner()
    g = grounder(repo, tmp_path, runner)
    for bad in ["services/api/rivet_api/main.py", "../outside.txt", "/etc/passwd", "services/api/rivet_api/firmware/templates/esp32_rover/../../generate.py"]:
        with pytest.raises(ApiError) as exc:
            g.verify_change([bad])
        assert exc.value.status == 400 and exc.value.code == "PATH_NOT_ALLOWED", bad
    assert runner.calls == []


def test_verify_change_rejects_symlink_escapes(repo, tmp_path):
    outside = tmp_path / "secret.txt"
    outside.write_text("x")
    link = repo / "services/api/rivet_api/firmware/templates/esp32_rover/link.tmpl"
    link.symlink_to(outside)
    with pytest.raises(ApiError) as exc:
        grounder(repo, tmp_path, Runner()).verify_change([TEMPLATE_REL.replace("main.cpp.tmpl", "link.tmpl")])
    assert exc.value.code == "PATH_NOT_ALLOWED"


def test_verify_change_for_an_allowed_path_does_not_pretend_to_verify(repo, tmp_path):
    runner = Runner()
    res = grounder(repo, tmp_path, runner).verify_change([TEMPLATE_REL])
    assert res.status == "unavailable" and "not documented" in res.reason
    assert res.citations == [] and runner.calls == []


# ---- status --------------------------------------------------------------------------------


def test_status_reports_disabled_without_running_anything(repo, tmp_path):
    runner = Runner()
    status = grounder(repo, tmp_path, runner, enabled=False).status()
    assert status["enabled"] is False and status["available"] is False and runner.calls == []


def test_status_runs_doctor_when_enabled(repo, tmp_path):
    runner = Runner(Proc(0, "credentials ok"))
    status = grounder(repo, tmp_path, runner).status()
    assert runner.calls[0][0] == ["/usr/local/bin/estelle", "doctor"]
    assert status["available"] is True and status["doctor"]["exit_code"] == 0
    failing = grounder(repo, tmp_path, Runner(Proc(2, "not logged in"))).status()
    assert failing["available"] is False and failing["doctor"]["exit_code"] == 2


# ---- routes --------------------------------------------------------------------------------


def test_routes_default_to_disabled(make_client):
    client, _ = make_client()
    status = client.get("/api/estelle/status").json()
    assert status["enabled"] is False and status["available"] is False
    resp = client.post("/api/estelle/ground", json={"kind": "locate", "name": "read_front_distance"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "unavailable" and body["citations"] == []


def test_route_returns_real_grounding_when_available(make_client, repo, tmp_path):
    g = grounder(repo, tmp_path, Runner(Proc(0, GOOD_OUT)))
    client, _ = make_client(grounder=g)
    body = client.post("/api/estelle/ground", json={"kind": "locate", "name": "read_front_distance"}).json()
    assert body["status"] == "ok" and body["citations"][0]["line"] == 3
    assert body["evidence_file"] == "estelle_evidence.json"
    assert (tmp_path / "evidence" / "estelle_evidence.json").exists()


@pytest.mark.parametrize(
    "body",
    [
        {"kind": "locate", "name": "a; rm -rf /"},
        {"kind": "format_disk", "name": "x"},
        {"kind": "locate"},
        {"name": "x"},
        {"kind": "locate", "name": "x", "extra": 1},
    ],
)
def test_route_rejects_bad_requests(make_client, body):
    client, _ = make_client()
    resp = client.post("/api/estelle/ground", json=body)
    assert resp.status_code == 400
