#!/usr/bin/env python3
"""Final submission verification for the Hour 34-36 gate (issue #42).

Runs the automatable items of the submission checklist (docs/final-verification.md maps
them to docs/implementation.md section 7 and docs/project.md section 11) against this
checkout and prints one row per check: `item | status | evidence`.

  PASS    the check ran here and its condition held
  FAIL    the check ran here and its condition did not hold
  SKIP    the check could not run here (missing tool, dependency or network); the
          evidence says why and how to run it
  MANUAL  a person has to do it; the evidence says exactly what

The script itself is stdlib only (Python 3.11+). Heavier work runs in child processes with
the same interpreter: the repo's own scripts and tests, the engine and API imported through
PYTHONPATH, and the targeted web unit tests when apps/web/node_modules exists. Children run
the API with the offline mock vision provider and without provider keys, so no paid AI call
is possible. Nothing touches the network unless the supplier-link checker
(`python -m rivet_engine.verify_links`) exists and the network is reachable.

Usage (from any directory):
  python3 scripts/final_verification.py              # table
  python3 scripts/final_verification.py --markdown   # Markdown table for docs
  python3 scripts/final_verification.py --json       # machine-readable result
Options: --no-web skips the Vitest subset, --offline never touches the network,
--artifacts DIR keeps the generated plan, firmware project and reports in DIR.

Exit codes: 0 no FAIL, 1 at least one FAIL, 2 bad usage.
"""

from __future__ import annotations

import argparse
import copy
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import textwrap
import time
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlparse

REPO_ROOT = Path(__file__).resolve().parents[1]
ENGINE_DIR = REPO_ROOT / "packages" / "engineering"
API_DIR = REPO_ROOT / "services" / "api"
WEB_DIR = REPO_ROOT / "apps" / "web"
ENGINE_CATALOG = ENGINE_DIR / "rivet_engine" / "data" / "components.json"
SEED_CATALOG = REPO_ROOT / "fixtures" / "catalog" / "seed-components.json"
SHARED_PLAN = REPO_ROOT / "fixtures" / "plans" / "rover_obstacle_v1.json"
FAILING_PLAN = REPO_ROOT / "fixtures" / "plans" / "rover_failing_driver_v1.json"
REFERENCE_IMAGE = REPO_ROOT / "fixtures" / "images" / "rover-reference.png"
PLAN_SCHEMA = REPO_ROOT / "contracts" / "build-plan.schema.json"
WEB_SAVED_CATALOG = WEB_DIR / "src" / "lib" / "rivet" / "fixtures" / "sourced-seed-components.json"
SIM_E2E_SPEC = WEB_DIR / "e2e" / "simulation.spec.ts"

LINK_STATUSES = ("verified_product", "manufacturer_reference_only", "not_available")
VERIFIED_STATUSES = ("verified", "verified_with_warnings")
LINK_PROBE_HOST = ("www.adafruit.com", 443)

# Web unit tests that cover the browser half of an item: (file under apps/web, top-level
# describe block or None for the whole file). Run once with Vitest; each row needs every
# mapped file present with at least one test and no failures.
WEB_TESTS: dict[str, tuple[tuple[str, str | None], ...]] = {
    "2c": (
        ("src/components/three/parts/__tests__/PartAssembly.test.tsx", None),
        ("src/components/three/interactions/__tests__/selection-controller.test.ts", None),
        ("src/components/studio/panels/__tests__/panels.test.tsx", "PartInspector"),
        ("src/components/studio/panels/__tests__/panels.test.tsx", "BOMPanel"),
        ("src/lib/rivet/__tests__/integrity.test.ts", None),
        ("tests/viewer.test.tsx", None),
    ),
    "4c": (("src/components/studio/panels/__tests__/panels.test.tsx", "VerificationPanel"),),
    "5c": (("src/components/studio/panels/__tests__/panels.test.tsx", "BOMPanel"),),
    "6b": (
        ("src/components/three/assembly/__tests__/computeAssemblyView.test.ts", None),
        ("src/components/three/assembly/__tests__/timeline.test.ts", None),
        ("src/components/three/assembly/__tests__/AssemblyTimelineControls.test.tsx", None),
    ),
    "7b": (
        ("src/components/sim/engine/__tests__/behavior.test.ts", None),
        ("src/components/sim/engine/__tests__/determinism.test.ts", None),
        ("src/components/sim/visual/__tests__/RoverSimulationView.test.tsx", None),
        ("tests/sim.test.tsx", None),
        ("tests/shared-fixtures.test.ts", None),
    ),
}
PLAYWRIGHT = {
    "2c": "e2e/inspector.spec.ts",
    "6b": "e2e/assembly.spec.ts",
    "7b": "e2e/simulation.spec.ts",
}

# Product-copy audit (item 10). A hit is allowed only when the same clause negates it
# before the match, it sits under a "must not claim" heading, or it is listed in
# COPY_ALLOWLIST with a reason. Everything else is a violation.
COPY_PATTERNS = {
    "universal compatibility": (
        r"\buniversal(?:ly)?\b",
        r"\b(?:compatible|works?) with (?:any|all|every)\b",
        r"\bfully compatible\b",
        r"\b(?:any|all|every) (?:hardware|robots?|devices?|drones?)\b",
    ),
    "safety certification": (
        r"\bcertif(?:y|ied|ies|ication|ications|icate|icates)\b",
        r"\bguarantee[ds]?\b",
        r"\b(?:proven|completely|totally|100%) safe\b",
        r"\bsafety[- ](?:approved|rated)\b",
    ),
    "exact reconstruction": (
        r"\bexact(?:ly)? (?:replica|reconstruction|copy|clone|reproduction|match)\b",
        r"\bexactly (?:reconstructs?|replicates?|recreates?|reproduces?|copies|matches)\b",
        r"\breverse[- ]engineer(?:ed|s|ing)?\b",
        r"\bidentical\b",
        r"\bpixel[- ]perfect\b",
        r"\b(?:1:1|one-to-one) (?:replica|copy|reconstruction)\b",
        r"\bhigh[- ]fidelity reconstruction\b",
    ),
}
COPY_REGEX = re.compile(
    "|".join(f"(?P<g{i}>{'|'.join(p)})" for i, p in enumerate(COPY_PATTERNS.values())), re.IGNORECASE
)
COPY_CATEGORIES = list(COPY_PATTERNS)
NEGATION = re.compile(
    r"\b(?:not|no|never|nor|cannot|can['\u2019]t|isn['\u2019]t|aren['\u2019]t|doesn['\u2019]t|don['\u2019]t"
    r"|won['\u2019]t|without|avoids?|instead of|rather than|nothing)\b",
    re.IGNORECASE,
)
CLAUSE_BOUNDARY = re.compile(r"[.!?;:|](?=\s)")
COPY_ALLOWLIST = (
    (
        "docs/project.md",
        "Hackathon guarantee target",
        "column header of the section 4 promise-vs-proof table (what the hackathon build commits to)",
    ),
    (
        "docs/project.md",
        "thermal modeling and electrical certification",
        "'Later' column of the section 4 promise-vs-proof table: future scope, not a current claim",
    ),
)

SECRET_ENV = re.compile(r"API_?KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL", re.IGNORECASE)
PROVIDER_ENV_PREFIXES = ("OPENAI_", "BACKBOARD_", "ANTHROPIC_", "GEMINI_", "AZURE_OPENAI")

PREFLIGHT = r"""
import importlib, json, sys
out = {"python": sys.version.split()[0], "modules": {}}
for name in ("pydantic", "fastapi", "httpx", "PIL", "python_multipart|multipart", "jsonschema", "pytest",
             "rivet_engine", "rivet_api"):
    error = None
    for candidate in name.split("|"):
        try:
            mod = importlib.import_module(candidate)
            out["modules"][name] = {"ok": True, "file": getattr(mod, "__file__", None)}
            break
        except Exception as exc:
            error = f"{type(exc).__name__}: {exc}"
    else:
        out["modules"][name] = {"ok": False, "error": error}
print(json.dumps(out))
"""

EDIT_PROBE = r"""
import copy, json, sys
import rivet_engine
plan = json.load(open(sys.argv[1], encoding="utf-8"))
before = copy.deepcopy(plan)
move = {"op": "set_mount_offset_within_template", "instance_id": "sensor-1", "offset_mm": [0, 15, 0]}
first, second = rivet_engine.apply_edit(plan, move), rivet_engine.apply_edit(plan, move)
too_far = rivet_engine.apply_edit(plan, dict(move, offset_mm=[0, 40, 0]))
budget = rivet_engine.apply_edit(plan, {"op": "set_budget", "amount": "60", "currency": "USD"})

def pose(p):
    return next((c["pose"] for c in p["components"] if c["instance_id"] == "sensor-1"), None)

def strip(p):
    return {k: v for k, v in p.items() if k != "created_at"} if isinstance(p, dict) else None

new = first.get("plan") or {}
print(json.dumps({
    "input_unchanged": plan == before,
    "accepted": [first.get("accepted"), second.get("accepted")],
    "deterministic": strip(first.get("plan")) == strip(second.get("plan")),
    "build_id": [plan["build_id"], new.get("build_id")],
    "revision": [plan["revision"], new.get("revision")],
    "pose": [pose(plan), pose(new) if new else None],
    "status": new.get("status"),
    "overall": (new.get("verification") or {}).get("overall"),
    "findings": len((new.get("verification") or {}).get("findings", [])),
    "too_far": [too_far.get("accepted"), too_far.get("finding")],
    "budget": [budget.get("accepted"), budget.get("finding")],
}))
"""

VERIFY_PROBE = r"""
import copy, json, sys
import rivet_engine
plan = json.load(open(sys.argv[1], encoding="utf-8"))
catalog = json.load(open(sys.argv[2], encoding="utf-8"))
report = rivet_engine.verify(plan, catalog=catalog)
forged = copy.deepcopy(plan)
forged["status"] = forged["verification"]["overall"] = "verified"
forged["verification"]["findings"] = [f for f in forged["verification"]["findings"] if f["result"] == "PASS"]
blocking = [f for f in report["findings"] if f["severity"] == "blocking" and f["result"] in ("FAIL", "UNKNOWN")]
print(json.dumps({
    "fixture_status": plan["status"],
    "overall": report["overall"],
    "blocking": len(blocking),
    "current": [{k: f[k] for k in ("result", "severity", "affected_instance_ids")}
                for f in blocking if f["rule_id"] == "electrical.motor_driver_current"],
    "forged_overall": rivet_engine.verify(forged, catalog=catalog)["overall"],
}))
"""


class Outcome(Exception):
    """Ends a check early with a status other than the check's normal result."""

    def __init__(self, status: str, evidence: str, details: dict[str, Any] | None = None) -> None:
        super().__init__(evidence)
        self.status, self.evidence, self.details = status, evidence, details or {}


@dataclass
class Result:
    id: str
    title: str
    status: str
    evidence: str
    seconds: float
    details: dict[str, Any] = field(default_factory=dict)


@dataclass
class Proc:
    cmd: list[str]
    code: int | None
    out: str
    err: str
    seconds: float

    def tail(self, lines: int = 6) -> str:
        text = "\n".join(x for x in (self.out + "\n" + self.err).splitlines() if x.strip())
        return " / ".join(text.splitlines()[-lines:])[:600]


def rel(path: Path) -> str:
    try:
        return path.resolve().relative_to(REPO_ROOT).as_posix()
    except ValueError:
        return str(path)


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def catalog_records(doc: Any) -> list[dict[str, Any]]:
    return doc["components"] if isinstance(doc, dict) else doc


def run_cmd(cmd: list[str], *, cwd: Path = REPO_ROOT, env: dict[str, str] | None = None, timeout: int = 300) -> Proc:
    start = time.monotonic()
    try:
        done = subprocess.run(cmd, cwd=cwd, env=env, capture_output=True, text=True, timeout=timeout)
        return Proc(cmd, done.returncode, done.stdout, done.stderr, time.monotonic() - start)
    except subprocess.TimeoutExpired as exc:
        out = exc.stdout.decode(errors="replace") if isinstance(exc.stdout, bytes) else exc.stdout or ""
        err = exc.stderr.decode(errors="replace") if isinstance(exc.stderr, bytes) else exc.stderr or ""
        return Proc(cmd, None, out, err + f"\ntimed out after {timeout}s", time.monotonic() - start)
    except OSError as exc:
        return Proc(cmd, None, "", f"{type(exc).__name__}: {exc}", time.monotonic() - start)


def git(*args: str) -> str | None:
    proc = run_cmd(["git", *args], timeout=30)
    return proc.out.strip() if proc.code == 0 else None


def https_with_host(url: Any) -> bool:
    if not isinstance(url, str):
        return False
    parsed = urlparse(url)
    return parsed.scheme == "https" and bool(parsed.netloc)


def decimal_or_none(value: Any) -> Decimal | None:
    if value is None:
        return None
    try:
        return Decimal(str(value))
    except InvalidOperation:
        return None


class Verifier:
    def __init__(self, args: argparse.Namespace, workdir: Path) -> None:
        self.args = args
        self.workdir = workdir
        self.current = ""
        self.cache: dict[str, Any] = {}

    # ---- environment and shared prerequisites --------------------------------------------

    def env(self, *, mode: str = "fixture", with_engine: bool = True, data_root: Path | None = None) -> dict[str, str]:
        """Child environment: no provider keys, offline mock vision, this checkout first on PYTHONPATH."""
        env = {k: v for k, v in os.environ.items() if not SECRET_ENV.search(k) and not k.startswith(PROVIDER_ENV_PREFIXES)}
        paths = [str(ENGINE_DIR)] if with_engine else []
        env.update(
            {
                "PYTHONPATH": os.pathsep.join(paths + [str(API_DIR)]),
                "PYTHONDONTWRITEBYTECODE": "1",
                "RIVET_MODE": mode,
                "RIVET_VISION_PROVIDER": "mock",
                "RIVET_VISION_MODEL": "",
                "RIVET_ENABLE_ESTELLE": "false",
                "RIVET_DATA_ROOT": str(data_root or self.workdir / "api-data"),
                "NEXT_PUBLIC_RIVET_USE_FIXTURES": "true",
                "NEXT_TELEMETRY_DISABLED": "1",
            }
        )
        return env

    def once(self, key: str, compute: Callable[[], Any]) -> Any:
        if key not in self.cache:
            self.cache[key] = compute()
        return self.cache[key]

    def need(self, key: str, owner: str, compute: Callable[[], Any]) -> Any:
        """Shared prerequisite. `compute` returns a value or raises Outcome; a FAIL is reported
        once, by `owner`, and every other row that needs it is a SKIP pointing there."""

        def guarded() -> tuple[str, Any]:
            try:
                return ("ok", compute())
            except Outcome as exc:
                return ("err", exc)

        state, value = self.once(key, guarded)
        if state == "ok":
            return value
        if value.status == "FAIL" and self.current != owner:
            raise Outcome("SKIP", f"prerequisite failed, see {owner}: {value.evidence}")
        raise Outcome(value.status, value.evidence, value.details)

    def preflight(self) -> dict[str, Any]:
        def compute() -> dict[str, Any]:
            proc = run_cmd([sys.executable, "-c", PREFLIGHT], env=self.env(), timeout=120)
            try:
                return json.loads(proc.out.strip().splitlines()[-1])
            except (ValueError, IndexError):
                return {"python": sys.version.split()[0], "modules": {}, "error": proc.tail()}

        return self.once("preflight", compute)

    def require(self, *modules: str) -> None:
        info = self.preflight()
        for name in modules:
            mod = info["modules"].get(name, {"ok": False, "error": info.get("error", "preflight failed")})
            if not mod["ok"]:
                raise Outcome("SKIP", f"Python module {name.split('|')[0]} not importable with {sys.executable} ({mod['error']})")
            if name.startswith("rivet_") and not str(mod.get("file") or "").startswith(str(REPO_ROOT)):
                raise Outcome("SKIP", f"{name} resolves outside this checkout ({mod.get('file')}); remove that install")

    def engine_plan(self) -> dict[str, Any]:
        def compute() -> dict[str, Any]:
            self.require("pydantic", "rivet_engine")
            out = self.workdir / "default-plan.json"
            proc = run_cmd(
                [sys.executable, "-m", "rivet_engine.demo", "--sample", "--output", str(out)],
                cwd=ENGINE_DIR,
                env=self.env(),
                timeout=180,
            )
            if proc.code != 0 or not out.exists():
                raise Outcome("FAIL", f"python -m rivet_engine.demo --sample exited {proc.code}: {proc.tail()}")
            return {"path": out, "plan": load_json(out), "summary": proc.err.strip().splitlines()[:3]}

        return self.need("engine_plan", "2a", compute)

    def engine_catalog(self) -> dict[str, dict[str, Any]]:
        return self.once("engine_catalog", lambda: {r["catalog_id"]: r for r in catalog_records(load_json(ENGINE_CATALOG))})

    def contracts(self) -> Proc:
        def compute() -> Proc:
            self.require("jsonschema")
            return run_cmd([sys.executable, str(REPO_ROOT / "scripts" / "validate_contracts.py")], env=self.env(), timeout=180)

        return self.need("contracts", "0", compute)

    def smoke(self, mode: str) -> dict[str, Any]:
        """services/api/scripts/smoke.py --in-process, parsed. mode: fixture | live-engine."""

        def compute() -> dict[str, Any]:
            self.require("fastapi", "httpx", "PIL", "python_multipart|multipart", "rivet_api")
            live = mode == "live-engine"
            if live:
                self.require("pydantic", "rivet_engine")
            data_root = self.workdir / f"smoke-{mode}"
            data_root.mkdir(parents=True, exist_ok=True)
            proc = run_cmd(
                [sys.executable, str(API_DIR / "scripts" / "smoke.py"), "--in-process"],
                cwd=API_DIR,
                env=self.env(mode="live" if live else "fixture", with_engine=live, data_root=data_root),
                timeout=300,
            )
            (self.workdir / f"smoke-{mode}.log").write_text(proc.out + proc.err, encoding="utf-8")
            steps = {}
            for line in proc.out.splitlines():
                match = re.match(r"^\[(PASS|SKIP|FAIL)\] ([^:]+): (.*)$", line)
                if match:
                    steps[match.group(2)] = (match.group(1), match.group(3))
            summary = re.search(r"^(\d+) passed, (\d+) skipped, (\d+) failed$", proc.out, re.MULTILINE)
            if not steps or not summary:
                raise Outcome("FAIL", f"smoke.py --in-process ({mode}) exited {proc.code} without a step report: {proc.tail()}")
            project = steps.get("project", ("missing", ""))
            gen = re.search(r"generation_mode=(\w+)", project[1])
            status = re.search(r"status=(\w+)", project[1])
            return {
                "proc": proc,
                "steps": steps,
                "counts": tuple(int(x) for x in summary.groups()),
                "generation_mode": gen.group(1) if gen else None,
                "plan_status": status.group(1) if status else None,
                "saved_build_note": "SAVED DEMO BUILD" in proc.out,
            }

        return self.need(f"smoke-{mode}", "1a" if mode == "fixture" else "1c", compute)

    def vitest(self) -> dict[str, Any]:
        def compute() -> dict[str, Any]:
            files = sorted({f for entries in WEB_TESTS.values() for f, _ in entries})
            if self.args.no_web:
                raise Outcome("SKIP", "web tests not run (--no-web)")
            binary = WEB_DIR / "node_modules" / ".bin" / "vitest"
            if not binary.exists():
                raise Outcome("SKIP", "apps/web/node_modules missing (run pnpm install --frozen-lockfile, then rerun)")
            if shutil.which("node") is None:
                raise Outcome("SKIP", "node is not on PATH (Node 20 needed for the web tests)")
            present = [f for f in files if (WEB_DIR / f).exists()]
            if not present:
                raise Outcome("FAIL", "none of the web test files mapped in WEB_TESTS exists; update scripts/final_verification.py")
            report = self.workdir / "vitest.json"
            proc = run_cmd(
                [str(binary), "run", "--maxWorkers=2", "--minWorkers=1", "--reporter=json", f"--outputFile={report}", *present],
                cwd=WEB_DIR,
                env=self.env(),
                timeout=600,
            )
            if not report.exists():
                raise Outcome("FAIL", f"vitest exited {proc.code} without a JSON report: {proc.tail()}")
            data = load_json(report)
            by_file: dict[str, list[dict[str, Any]]] = {}
            for suite in data.get("testResults", []):
                name = rel(Path(suite["name"])).removeprefix("apps/web/")
                by_file[name] = suite.get("assertionResults", [])
                if suite.get("status") == "failed" and not by_file[name]:
                    by_file[name] = [{"status": "failed", "fullName": suite.get("message", "suite failed")[:200], "ancestorTitles": []}]
            return {"files": by_file, "seconds": proc.seconds, "totals": (data.get("numPassedTests"), data.get("numTotalTests"))}

        return self.need("vitest", "2c", compute)

    def firmware(self) -> dict[str, Any]:
        def compute() -> dict[str, Any]:
            self.require("pydantic", "rivet_api")
            plan = self.engine_plan()
            out = self.workdir / "firmware"
            proc = run_cmd(
                [
                    sys.executable,
                    str(REPO_ROOT / "scripts" / "ci_firmware_check.py"),
                    "--plan",
                    str(plan["path"]),
                    "--out",
                    str(out),
                    "--timeout",
                    str(self.args.pio_timeout),
                ],
                env=self.env(),
                timeout=self.args.pio_timeout + 120,
            )
            (self.workdir / "firmware.log").write_text(proc.out + proc.err, encoding="utf-8")
            if proc.code == 2:
                raise Outcome("FAIL", f"firmware refused for the default plan: {proc.tail(2)}")
            generated = re.search(r"^generated (\d+) files in .*?: (.*)$", proc.out, re.MULTILINE)
            compiled = re.search(r"^compile_status: (\w+) \((.*)\)$", proc.out, re.MULTILINE)
            if not generated or not compiled:
                raise Outcome("FAIL", f"ci_firmware_check.py exited {proc.code} without its report lines: {proc.tail()}")
            return {
                "proc": proc,
                "out": out,
                "files": [f.strip() for f in generated.group(2).split(",")],
                "compile_status": compiled.group(1),
                "compile_summary": compiled.group(2),
                "plan": plan["plan"],
            }

        return self.need("firmware", "8a", compute)

    def pytest(self, lane_dir: Path, *selection: str) -> Proc:
        """A lane's own tests, run the way its CI job runs them (the API job has no engine)."""
        self.require("pytest")
        return run_cmd(
            [sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider", *selection],
            cwd=lane_dir,
            env=self.env(with_engine=lane_dir == ENGINE_DIR),
            timeout=300,
        )

    def probe(self, key: str, code: str, *argv: str) -> dict[str, Any]:
        self.require("pydantic", "rivet_engine")
        proc = run_cmd([sys.executable, "-c", code, *argv], cwd=ENGINE_DIR, env=self.env(), timeout=180)
        try:
            return json.loads(proc.out.strip().splitlines()[-1])
        except (ValueError, IndexError):
            raise Outcome("FAIL", f"engine probe '{key}' exited {proc.code}: {proc.tail()}") from None

    # ---- 0 baseline ------------------------------------------------------------------------

    def check_0(self) -> tuple[str, str]:
        proc = self.contracts()
        lines = [ln for ln in proc.out.splitlines() if re.match(r"^(ok|FAIL)\s", ln)]
        failed = [re.sub(r"\s+", " ", ln[4:].strip()) for ln in lines if ln.startswith("FAIL")]
        rejections = sum(1 for ln in lines if " rejects " in f" {ln[4:].strip()} ")
        if proc.code == 0 and not failed and "all contract checks passed" in proc.out:
            return "PASS", f"scripts/validate_contracts.py: {len(lines)} checks ok ({rejections} of them rejection cases), exit 0"
        return "FAIL", f"scripts/validate_contracts.py exited {proc.code}; failing: {'; '.join(failed[:5]) or proc.tail()}"

    # ---- 1 reference image -> IntentSpec -> BuildPlan ---------------------------------------

    def check_1a(self) -> tuple[str, str]:
        smoke = self.smoke("fixture")
        steps, (passed, skipped, failed) = smoke["steps"], smoke["counts"]
        problems = [f"{name}: {detail}" for name, (status, detail) in steps.items() if status == "FAIL"]
        if steps.get("upload image", ("",))[0] != "PASS" or steps.get("generate job", ("",))[0] != "PASS":
            problems.append("upload or generate did not pass")
        if smoke["generation_mode"] != "fixture":
            problems.append(f"saved build labeled generation_mode={smoke['generation_mode']}, expected fixture")
        if not smoke["saved_build_note"]:
            problems.append("no 'SAVED DEMO BUILD' disclosure printed")
        skips = "; ".join(f"{n} SKIP ({d.split(':')[0]})" for n, (s, d) in steps.items() if s == "SKIP")
        evidence = (
            f"smoke.py --in-process (RIVET_MODE=fixture): {passed} PASS, {skipped} SKIP, {failed} FAIL; "
            f"test PNG upload -> job -> plan status={smoke['plan_status']} generation_mode={smoke['generation_mode']}; "
            f"'SAVED DEMO BUILD' note printed; {skips or 'no skips'}"
        )
        return ("FAIL", "; ".join(problems) + f" | {evidence}") if problems or failed else ("PASS", evidence)

    def check_1b(self) -> tuple[str, str]:
        self.require("fastapi", "httpx", "rivet_api")
        proc = self.pytest(API_DIR, "tests/test_engineering_adapter.py", "-k", "falls_back_labeled")
        passed = re.search(r"(\d+) passed", proc.out)
        if proc.code == 0 and passed:
            return "PASS", (
                f"services/api pytest tests/test_engineering_adapter.py -k falls_back_labeled: {passed.group(1)} passed "
                "(engine missing or not ready in live mode -> saved fixture labeled generation_mode=fallback)"
            )
        return "FAIL", f"services/api pytest -k falls_back_labeled exited {proc.code}: {proc.tail(3)}"

    def check_1c(self) -> tuple[str, str]:
        smoke = self.smoke("live-engine")
        steps, (passed, skipped, failed) = smoke["steps"], smoke["counts"]
        problems = [f"{name}: {detail}" for name, (status, detail) in steps.items() if status == "FAIL"]
        if smoke["generation_mode"] == "live":
            problems.append("labeled generation_mode=live although vision was the offline mock")
        elif smoke["generation_mode"] != "fallback":
            problems.append(f"generation_mode={smoke['generation_mode']}, expected fallback")
        if steps.get("bom csv", ("",))[0] != "PASS":
            problems.append("BOM CSV did not export, so the plan did not come from the real engine")
        detail = {k: steps.get(k, ("missing", ""))[1] for k in ("catalog", "contract", "bom csv", "firmware")}
        evidence = (
            f"smoke.py --in-process (RIVET_MODE=live, real rivet_engine, mock vision): {passed} PASS, {skipped} SKIP, "
            f"{failed} FAIL; plan status={smoke['plan_status']} generation_mode={smoke['generation_mode']} "
            f"(intent not live, so not labeled live); catalog {detail['catalog']}; contract {detail['contract']}; "
            f"BOM CSV {detail['bom csv']}; firmware {detail['firmware']}"
        )
        return ("FAIL", "; ".join(problems) + f" | {evidence}") if problems or failed else ("PASS", evidence)

    def check_1d(self) -> tuple[str, str]:
        image = "missing"
        if REFERENCE_IMAGE.exists():
            head = REFERENCE_IMAGE.read_bytes()[:24]
            if head.startswith(b"\x89PNG\r\n\x1a\n"):
                width, height = int.from_bytes(head[16:20], "big"), int.from_bytes(head[20:24], "big")
                image = f"PNG {width}x{height}, {REFERENCE_IMAGE.stat().st_size // 1024} KB"
        return "MANUAL", (
            f"Not automatable without a paid vision call. {rel(REFERENCE_IMAGE)} ({image}) is never interpreted here: "
            "the mock vision ignores image content. With a provider key, run the API with RIVET_MODE=live, "
            "RIVET_VISION_PROVIDER=openai (or backboard) and RIVET_VISION_MODEL set, upload this image in the studio and "
            "confirm project_family=rover, support_status=supported, generation_mode=live; with the provider off, "
            "confirm the studio labels the result fallback or Saved demo build"
        )

    # ---- 2 viewer renders the plan; selection ids match BOM rows ---------------------------

    def check_2a(self) -> tuple[str, str]:
        plan = self.engine_plan()  # this row owns a failure to generate the plan
        p = plan["plan"]
        summary = (
            f"rivet_engine.demo --sample: status {p['status']}, {len(p['components'])} parts, "
            f"{len(p['connections'])} wires, {len(p['assembly_steps'])} steps"
        )
        try:
            self.require("jsonschema")
        except Outcome as exc:
            raise Outcome("SKIP", f"{summary}; contract check not run: {exc.evidence}") from None
        proc = run_cmd(
            [
                sys.executable,
                str(REPO_ROOT / "scripts" / "validate_contracts.py"),
                "--plan",
                str(plan["path"]),
                "--catalog",
                str(ENGINE_CATALOG),
            ],
            env=self.env(),
            timeout=120,
        )
        if proc.code == 0 and "all contract checks passed" in proc.out:
            return "PASS", f"{summary}; validate_contracts.py --plan --catalog {rel(ENGINE_CATALOG)}: schema and section 3.4 references ok"
        return "FAIL", f"{summary}; validate_contracts.py --plan exited {proc.code}: {proc.tail(4)}"

    def check_2b(self) -> tuple[str, str]:
        plan = self.engine_plan()["plan"]
        catalog = self.engine_catalog()
        comps = plan["components"]
        by_id = {c["instance_id"]: c for c in comps}
        problems = []
        if len(by_id) != len(comps):
            problems.append("duplicate instance_id")
        rows_for: dict[str, list[str]] = {}
        for row in plan["bom"]["items"]:
            if row["quantity"] != len(row["instance_ids"]):
                problems.append(f"{row['catalog_id']}: quantity {row['quantity']} != {len(row['instance_ids'])} instances")
            for iid in row["instance_ids"]:
                rows_for.setdefault(iid, []).append(row["catalog_id"])
                comp = by_id.get(iid)
                if comp is None:
                    problems.append(f"BOM row {row['catalog_id']} lists unknown instance {iid}")
                elif comp["catalog_id"] != row["catalog_id"]:
                    problems.append(f"{iid} is {comp['catalog_id']} but listed under {row['catalog_id']}")
        for comp in comps:
            count = len(rows_for.get(comp["instance_id"], []))
            if count != 1:
                problems.append(f"{comp['instance_id']} is in {count} BOM rows")
            if comp["catalog_id"] not in catalog:
                problems.append(f"{comp['instance_id']}: {comp['catalog_id']} is not in {rel(ENGINE_CATALOG)}")
        hidden = [c for c in comps if (c.get("render_overrides") or {}).get("visible") is False]
        hidden_core = [c["instance_id"] for c in hidden if c["role"] != "accessory"]
        if hidden_core:
            problems.append(f"physical parts hidden from the viewer: {hidden_core}")
        engine_rule = next((f["result"] for f in plan["verification"]["findings"] if f["rule_id"] == "integrity.bom"), "absent")
        evidence = (
            f"{len(comps)} components = {len(comps) - len(hidden)} rendered + {len(hidden)} loose kit items "
            "(role accessory, render_overrides.visible=false, documented in packages/engineering/README.md Limits; "
            f"listed, not modeled); {len(plan['bom']['items'])} BOM rows; every component in exactly one row with the "
            f"same catalog_id; every catalog_id in the engine catalog; engine rule integrity.bom {engine_rule}"
        )
        return ("FAIL", "; ".join(problems[:6])) if problems else ("PASS", evidence)

    def web_row(self) -> tuple[str, str]:
        try:
            report = self.vitest()
        except Outcome as exc:
            if exc.status != "SKIP":
                raise
            files = sorted({f"apps/web/{path}" for path, _ in WEB_TESTS[self.current]})
            raise Outcome("SKIP", f"{exc.evidence}; covered by {', '.join(files)} (not PASS until they run)") from None
        lines, problems, total = [], [], 0
        for path, describe in WEB_TESTS[self.current]:
            label = Path(path).name + (f" [{describe}]" if describe else "")
            if not (WEB_DIR / path).exists():
                problems.append(f"mapped test file missing: apps/web/{path} (update WEB_TESTS)")
                continue
            tests = [
                t for t in report["files"].get(path, []) if describe is None or (t.get("ancestorTitles") or [None])[0] == describe
            ]
            failing = [t.get("fullName", "?") for t in tests if t.get("status") != "passed"]
            if not tests:
                problems.append(f"{label}: no tests ran")
            elif failing:
                problems.append(f"{label}: {len(failing)} failing ({'; '.join(failing[:2])})")
            total += len(tests)
            lines.append(f"{label} {len(tests)}")
        e2e = PLAYWRIGHT.get(self.current)
        note = f"; Playwright {e2e} not run here (needs a browser: pnpm --dir apps/web e2e)" if e2e else ""
        if problems:
            return "FAIL", "; ".join(problems)
        return "PASS", f"Vitest: {total} tests passed ({', '.join(lines)}){note}"

    check_2c = check_4c = check_5c = check_6b = check_7b = web_row

    # ---- 3 a user edit triggers deterministic validation -----------------------------------

    def check_3a(self) -> tuple[str, str]:
        steps = self.smoke("live-engine")["steps"]
        edit, stale = steps.get("edit", ("missing", "")), steps.get("stale edit", ("missing", ""))
        evidence = f"smoke (real engine): edit {edit[0]} '{edit[1]}'; stale edit {stale[0]} '{stale[1]}'"
        if edit[0] == "PASS" and stale[0] == "PASS" and "accepted" in edit[1]:
            return "PASS", evidence + " (set_behavior_parameter re-verified by rivet_engine.apply_edit)"
        return "FAIL", evidence

    def check_3b(self) -> tuple[str, str]:
        plan = self.engine_plan()
        r = self.probe("edit", EDIT_PROBE, str(plan["path"]))
        problems = []
        if r["accepted"] != [True, True]:
            problems.append(f"sensor-1 +15 mm edit accepted={r['accepted']}")
        if not r["deterministic"]:
            problems.append("two identical edits produced different plans (ignoring created_at)")
        if not r["input_unchanged"]:
            problems.append("apply_edit mutated its input")
        if r["build_id"][0] != r["build_id"][1] or r["revision"][1] != r["revision"][0] + 1:
            problems.append(f"build_id/revision {r['build_id']} {r['revision']}")
        before, after = r["pose"]
        moved = None
        if before and after:
            moved = round(after["position_mm"][1] - before["position_mm"][1], 3)
        if moved != 15.0:
            problems.append(f"sensor-1 moved {moved} mm vertically, expected 15")
        if not r["findings"] or r["overall"] != r["status"]:
            problems.append(f"new revision not re-verified (findings={r['findings']}, overall={r['overall']})")
        far_ok, far = r["too_far"]
        budget_ok, budget = r["budget"]
        if far_ok is not False or not far:
            problems.append("out-of-range sensor offset was not rejected with a finding")
        if budget_ok is not False or not budget or not str(budget.get("rule_id", "")).startswith("budget."):
            problems.append(f"over-budget edit not rejected by a budget rule ({budget})")
        if problems:
            return "FAIL", "; ".join(problems)
        return "PASS", (
            f"apply_edit sensor-1 +15 mm: accepted r{r['revision'][0]}->r{r['revision'][1]}, same build_id, "
            f"pose y {before['position_mm'][1]}->{after['position_mm'][1]} mm, re-verified ({r['findings']} findings, "
            f"{r['status']}), identical across 2 runs, input untouched; +40 mm rejected ({far['rule_id']}); "
            f"budget 60 USD rejected ({budget['rule_id']}: {budget['message'][:120]})"
        )

    # ---- 4 a failing check is shown and cannot become verified ------------------------------

    def check_4a(self) -> tuple[str, str]:
        r = self.probe("verify", VERIFY_PROBE, str(FAILING_PLAN), str(SEED_CATALOG))
        problems = []
        if r["fixture_status"] in VERIFIED_STATUSES:
            problems.append(f"fixture status is {r['fixture_status']}")
        if r["overall"] in VERIFIED_STATUSES:
            problems.append(f"engine verify() gave {r['overall']}")
        if not any(f["result"] in ("FAIL", "UNKNOWN") for f in r["current"]):
            problems.append("no blocking electrical.motor_driver_current finding")
        if r["forged_overall"] in VERIFIED_STATUSES:
            problems.append(f"a copy marked verified with its failures removed re-verified as {r['forged_overall']}")
        if problems:
            return "FAIL", "; ".join(problems)
        current = r["current"][0]
        return "PASS", (
            f"verify({rel(FAILING_PLAN)}, seed catalog): overall {r['overall']}, {r['blocking']} blocking FAIL/UNKNOWN "
            f"incl. electrical.motor_driver_current {current['result']} on {', '.join(current['affected_instance_ids'])}; "
            f"fixture status {r['fixture_status']}; a copy relabeled verified with non-PASS findings deleted "
            f"re-verifies as {r['forged_overall']}"
        )

    def check_4b(self) -> tuple[str, str]:
        proc = self.contracts()
        wanted = {
            "rejects verified with a blocking UNKNOWN": None,
            f"failing {rel(FAILING_PLAN)}": None,
        }
        for line in proc.out.splitlines():
            match = re.match(r"^(ok|FAIL)\s+(.*\S)\s*$", line)
            if match and re.sub(r"\s+", " ", match.group(2)) in wanted:
                wanted[re.sub(r"\s+", " ", match.group(2))] = match.group(1)
        rule = schema_verified_rule(load_json(PLAN_SCHEMA))
        problems = [f"validate_contracts.py line '{k}' is {v or 'missing'}" for k, v in wanted.items() if v != "ok"]
        if not rule["verified"]:
            problems.append(f"{rel(PLAN_SCHEMA)} has no rule forbidding verified with a blocking FAIL/UNKNOWN")
        if problems:
            return "FAIL", "; ".join(problems)
        gap = "" if rule["verified_with_warnings"] else (
            "; gap: the schema does not reject verified_with_warnings with a blocking FAIL/UNKNOWN "
            "(the engine's aggregate() never emits it)"
        )
        return "PASS", (
            f"{rel(PLAN_SCHEMA)} allOf: status=verified impossible with a blocking FAIL or UNKNOWN; "
            "validate_contracts.py rejects the 'verified with a blocking UNKNOWN' mutation and checks the failing-driver "
            f"fixture is not verified{gap}"
        )

    # ---- 5 BOM rows ----------------------------------------------------------------------

    def check_5a(self) -> tuple[str, str]:
        plan = self.engine_plan()["plan"]
        catalog = self.engine_catalog()
        bom = plan["bom"]
        problems, zero, unpriced = [], [], []
        total = Decimal("0")
        for row in bom["items"]:
            cid, url, price = row["catalog_id"], row.get("purchase_url"), row.get("unit_price_amount")
            rec = catalog.get(cid) or {}
            src, sku = rec.get("sourcing") or {}, (rec.get("identity") or {}).get("sku")
            if row["link_status"] not in LINK_STATUSES:
                problems.append(f"{cid}: link_status {row['link_status']!r}")
            if row["quantity"] < 1 or row["quantity"] != len(row["instance_ids"]):
                problems.append(f"{cid}: quantity {row['quantity']} vs {len(row['instance_ids'])} instances")
            if url is not None and not https_with_host(url):
                problems.append(f"{cid}: link {url!r} is not https with a host")
            if row["link_status"] == "verified_product":
                if not (sku and url and url == src.get("purchase_url") and src.get("purchase_url_verified_at")):
                    problems.append(f"{cid}: verified_product row not backed by a catalog SKU and verified purchase link")
            expected = src.get("price_amount") if src.get("price_currency") == bom["currency"] else None
            if decimal_or_none(price) != decimal_or_none(expected):
                problems.append(f"{cid}: price {price!r} differs from the catalog's {expected!r}")
            amount = decimal_or_none(price)
            if price is not None and amount is None:
                problems.append(f"{cid}: price {price!r} is not a decimal")
            elif amount is None:
                unpriced.append(cid)
            else:
                total += amount * row["quantity"]
                if amount == 0:
                    zero.append(f"{cid} ({row['link_status']})")
        subtotal = decimal_or_none(bom.get("known_subtotal_amount"))
        if unpriced and bom["total_status"] == "complete":
            problems.append(f"total_status complete with unpriced rows {unpriced}")
        if (bom.get("known_subtotal_amount") is not None or not unpriced) and subtotal != total:
            problems.append(f"known_subtotal_amount {bom.get('known_subtotal_amount')} != sum of priced rows {total}")
        stock_flags = availability_flags(plan, catalog)
        problems += stock_flags["problems"]
        if problems:
            return "FAIL", "; ".join(problems[:6])
        kinds = Counter(row["link_status"] for row in bom["items"])
        return "PASS", (
            f"{len(bom['items'])} rows / {sum(r['quantity'] for r in bom['items'])} units; "
            f"{', '.join(f'{n} {kind}' for kind, n in kinds.most_common())}; every verified_product link is https and equals a catalog entry with SKU and "
            f"purchase_url_verified_at; prices equal the catalog; known subtotal {bom.get('known_subtotal_amount')} "
            f"{bom['currency']} = sum of priced rows, total_status {bom['total_status']}, {len(unpriced)} unpriced; "
            f"0.00 rows: {', '.join(zero) or 'none'}; not in stock: {stock_flags['summary']}"
        )

    def check_5b(self) -> tuple[str, str]:
        plan = load_json(SHARED_PLAN)
        bom = plan["bom"]
        unpriced = [r["catalog_id"] for r in bom["items"] if r.get("unit_price_amount") is None]
        problems = []
        if unpriced and bom["total_status"] == "complete":
            problems.append(f"{rel(SHARED_PLAN)}: total_status complete with {len(unpriced)} unpriced rows")
        if len(unpriced) == len(bom["items"]) and bom.get("known_subtotal_amount") is not None:
            problems.append(f"{rel(SHARED_PLAN)}: subtotal {bom['known_subtotal_amount']} with no priced row")
        fixture = (
            f"{rel(SHARED_PLAN)}: {len(unpriced)}/{len(bom['items'])} rows unpriced -> price null, total_status "
            f"{bom['total_status']}, known_subtotal_amount {json.dumps(bom.get('known_subtotal_amount'))}"
        )
        try:
            self.require("pydantic", "rivet_engine")
        except Outcome as exc:
            if problems:
                return "FAIL", "; ".join(problems)
            raise Outcome("SKIP", f"{fixture}; engine BOM tests not run: {exc.evidence}") from None
        proc = self.pytest(ENGINE_DIR, "tests/test_bom.py")
        passed = re.search(r"(\d+) passed", proc.out)
        if proc.code != 0 or not passed:
            problems.append(f"packages/engineering pytest tests/test_bom.py exited {proc.code}: {proc.tail(3)}")
        if problems:
            return "FAIL", "; ".join(problems)
        return "PASS", (
            f"{fixture}; engine tests/test_bom.py {passed.group(1)} passed (unknown price -> incomplete with known "
            "subtotal, all unknown -> not_available, truthful link status)"
        )

    # ---- 6 assembly timeline ---------------------------------------------------------------

    def check_6a(self) -> tuple[str, str]:
        plan = self.engine_plan()["plan"]
        ids = {c["instance_id"] for c in plan["components"]}
        steps = plan["assembly_steps"]
        problems = []
        numbers = [s["step"] for s in steps]
        if numbers != list(range(1, len(steps) + 1)):
            problems.append(f"steps numbered {numbers}")
        for s in steps:
            if not s["instance_ids"]:
                problems.append(f"step {s['step']} references nothing")
            unknown = sorted(set(s["instance_ids"]) - ids)
            if unknown:
                problems.append(f"step {s['step']} references unknown {unknown}")
        covered = {i for s in steps for i in s["instance_ids"]}
        uncovered = sorted(ids - covered)
        if uncovered:
            problems.append(f"components never assembled: {uncovered}")
        bom_ids = {i for row in plan["bom"]["items"] for i in row["instance_ids"]}
        if bom_ids != ids:
            problems.append("BOM instance ids differ from the components")
        if problems:
            return "FAIL", "; ".join(problems[:6])
        return "PASS", (
            f"{len(steps)} steps numbered 1..{len(steps)}; every step id resolves; {len(covered)}/{len(ids)} components "
            "assembled; step ids = BOM ids = component ids"
        )

    # ---- 7 simulation is a labeled approximation -------------------------------------------

    def check_7a(self) -> tuple[str, str]:
        expected = "Simplified kinematic simulation; not a guarantee of real-world performance"
        e2e_text = SIM_E2E_SPEC.read_text(encoding="utf-8") if SIM_E2E_SPEC.exists() else ""
        asserted = re.search(r"getByTestId\(['\"]sim-disclaimer['\"]\)\)\.toContainText\(\s*['\"]([^'\"]+)['\"]", e2e_text)
        if asserted:
            expected = asserted.group(1)
        problems, defined, rendered = [], [], []
        for path in web_sources((".ts", ".tsx")):
            text = path.read_text(encoding="utf-8", errors="replace")
            for n, line in enumerate(text.splitlines(), 1):
                if expected in line:
                    defined.append(f"{rel(path)}:{n}")
                if re.search(r"data-testid=['\"{]+sim-disclaimer", line):
                    rendered.append(f"{rel(path)}:{n}")
        if not re.search(r"simplified|approximat", expected, re.IGNORECASE):
            problems.append(f"disclaimer {expected!r} does not say simplified/approximation")
        if not defined:
            problems.append(f"disclaimer text {expected!r} not found in apps/web/src")
        if not rendered:
            problems.append("no element with data-testid=sim-disclaimer in apps/web/src")
        try:
            sim = self.engine_plan()["plan"]["simulation"]
            limits = f"engine plan simulation.kind {sim['kind']}, {len(sim['limitations'])} limitations ('{sim['limitations'][0]}')"
            if not sim["limitations"]:
                problems.append("engine plan simulation.limitations is empty")
        except Outcome as exc:
            limits = f"engine plan not checked ({exc.evidence})"
        if problems:
            return "FAIL", "; ".join(problems)
        return "PASS", (
            f"static: '{expected}' at {defined[0]}, rendered as data-testid=sim-disclaimer at {rendered[0]}"
            f"{'; asserted by ' + rel(SIM_E2E_SPEC) if asserted else ''}; {limits}"
        )

    # ---- 8 firmware ------------------------------------------------------------------------

    def check_8a(self) -> tuple[str, str]:
        fw = self.firmware()
        plan, out = fw["plan"], fw["out"]
        problems = []
        try:
            manifest = load_json(out / "manifest.json")
        except (OSError, ValueError) as exc:
            raise Outcome("FAIL", f"generated manifest.json unreadable: {exc}") from None
        for key, want in (("build_id", plan["build_id"]), ("revision", plan["revision"]), ("plan_status", plan["status"])):
            if manifest.get(key) != want:
                problems.append(f"manifest {key}={manifest.get(key)!r}, plan has {want!r}")
        if manifest.get("compile_status") not in ("not_checked", fw["compile_status"]):
            problems.append(f"manifest claims compile_status={manifest.get('compile_status')} but the compile was {fw['compile_status']}")
        header = (out / "include" / "rivet_config.h").read_text(encoding="utf-8") if (out / "include" / "rivet_config.h").exists() else ""
        pins = plan["firmware"]["pin_map"]
        missing = [
            f"{signal}={gpio}"
            for signal, gpio in pins.items()
            if not any(
                signal.replace("_", "") in line.lower().replace("_", "") and re.search(rf"\b{gpio}\b", line)
                for line in header.splitlines()
            )
        ]
        if not pins:
            problems.append("default plan has an empty firmware.pin_map")
        if missing:
            problems.append(f"pins not in include/rivet_config.h: {missing}")
        if problems:
            return "FAIL", "; ".join(problems)
        return "PASS", (
            f"scripts/ci_firmware_check.py: {len(fw['files'])} files ({', '.join(fw['files'])}); manifest build_id "
            f"{manifest['build_id']} r{manifest['revision']}, plan_status {manifest['plan_status']}, compile_status "
            f"{manifest['compile_status']}; all {len(pins)} pin_map GPIOs appear in include/rivet_config.h"
        )

    def check_8b(self) -> tuple[str, str]:
        fw = self.firmware()
        status, summary = fw["compile_status"], fw["compile_summary"]
        blockers = known_compile_blockers(fw["out"])
        note = (
            "; a static scan of the generated project still finds the compile blockers recorded in docs/context.md "
            f"section 6: {'; '.join(blockers)}"
            if blockers
            else "; a static scan finds neither known compile blocker (VL53L0X lib_deps name, DISABLED enum value)"
        )
        if status == "passed":
            return "PASS", f"pio run: passed ({summary})"
        if status == "failed":
            return "FAIL", f"pio run failed: {summary}: {fw['proc'].tail(4)}"
        if status in ("not_checked", "not_supported"):
            return "SKIP", (
                f"compile_status {status} ({summary}); reported as {status}, never as passed. CI's optional firmware job "
                f"compiles with PlatformIO{note}"
            )
        return "FAIL", f"unexpected compile_status {status!r}"

    # ---- 9 supplier links ------------------------------------------------------------------

    def check_9(self) -> tuple[str, str]:
        module = ENGINE_DIR / "rivet_engine" / "verify_links.py"
        package = ENGINE_DIR / "rivet_engine" / "verify_links" / "__main__.py"
        counts = []
        for path in (ENGINE_CATALOG, WEB_SAVED_CATALOG):
            if path.exists():
                urls = {r["sourcing"]["purchase_url"] for r in catalog_records(load_json(path)) if r["sourcing"].get("purchase_url")}
                counts.append(f"{len(urls)} purchase links in {rel(path)}")
        listing = " and ".join(counts)
        if not (module.exists() or package.exists()):
            return "MANUAL", (
                "rivet_engine.verify_links is not in this checkout (issue #68). Before the demo, open every purchase_url "
                f"({listing}; the second file is the studio's saved example) and confirm each page loads and names the "
                "SKU; any that fails must show as unverified or not available. Once #68 lands, rerun this script online"
            )
        if self.args.offline:
            return "SKIP", "offline (--offline): run `python -m rivet_engine.verify_links` in packages/engineering with network"
        if not network_available():
            return "SKIP", (
                f"no network ({LINK_PROBE_HOST[0]}:{LINK_PROBE_HOST[1]} unreachable): run `python -m rivet_engine.verify_links` "
                "in packages/engineering with network"
            )
        self.require("pydantic", "rivet_engine")
        proc = run_cmd([sys.executable, "-m", "rivet_engine.verify_links"], cwd=ENGINE_DIR, env=self.env(), timeout=900)
        (self.workdir / "verify_links.log").write_text(proc.out + proc.err, encoding="utf-8")
        if proc.code == 0:
            return "PASS", f"python -m rivet_engine.verify_links exited 0 ({listing}): {proc.tail(2)}"
        return "FAIL", f"python -m rivet_engine.verify_links exited {proc.code}: {proc.tail(4)}"

    # ---- 10 product copy -------------------------------------------------------------------

    def check_10(self) -> tuple[str, str]:
        audit = copy_audit()
        self.cache["copy_audit"] = audit
        if audit["violations"]:
            hits = "; ".join(f"{v['file']}:{v['line']} [{v['category']}] '{v['match']}'" for v in audit["violations"][:8])
            return "FAIL", f"{len(audit['violations'])} claim(s) without a negation or allowlist entry: {hits}"
        reasons = Counter(a["reason"].split(":")[0] for a in audit["allowed"])
        return "PASS", (
            f"0 violations in {audit['files']} files (apps/web/src TS/TSX strings and JSX text with comments removed, "
            "apps/web/src JSON data, README.md, docs/project.md, firmware README template); "
            f"{len(audit['allowed'])} hits allowed ({', '.join(f'{n} {r}' for r, n in sorted(reasons.items()))}; listed by --json)"
        )

    # ---- 11-12 people --------------------------------------------------------------------

    def facts(self) -> str:
        bits = []
        state, plan = self.cache.get("engine_plan", ("err", None))
        if state == "ok":
            p = plan["plan"]
            bits.append(f"default rover is {p['status']}, known subtotal {p['bom']['known_subtotal_amount']} {p['bom']['currency']}")
        state, smoke = self.cache.get("smoke-live-engine", ("err", None))
        if state == "ok" and "estelle" in smoke["steps"]:
            bits.append(f"Estelle {smoke['steps']['estelle'][1]}")
        return f" Facts from this run: {'; '.join(bits)}." if bits else ""

    def check_11a(self) -> tuple[str, str]:
        return "MANUAL", (
            "Run the timed 3-minute demo twice, once live and once from the labeled saved build, following the "
            "0:00-3:00 beats in docs/project.md section 10; note the time per beat and any beat that fails. Rehearse "
            f"the hardware caveats, Estelle evidence, total price and what is genuinely implemented.{self.facts()} "
            "Record date, timings and result in docs/final-verification.md"
        )

    def check_11b(self) -> tuple[str, str]:
        return "MANUAL", (
            "Record the full demo as a backup video (live path plus the labeled Saved demo build path) and add the "
            "link and date to docs/final-verification.md"
        )

    def check_12(self) -> tuple[str, str]:
        return "MANUAL", (
            "Name one person to drive the UI, one to run the backup environment (fixture mode, offline laptop, recording) "
            "and one to answer architecture questions; write the names in docs/final-verification.md"
        )


# ---- helpers used by checks ----------------------------------------------------------------

CHECKS: tuple[tuple[str, str], ...] = (
    ("0", "Contracts and shared fixtures validate"),
    ("1a", "Image upload to saved build is disclosed (API, fixture mode)"),
    ("1b", "Engine down: saved fixture is labeled fallback (API tests)"),
    ("1c", "Image to real engine plan, labeled fallback not live (API, real engine, mock vision)"),
    ("1d", "Live vision on the reference image"),
    ("2a", "Engine default plan passes contracts and section 3.4 references"),
    ("2b", "Every component maps to one BOM row and a catalog item"),
    ("2c", "Viewer renders plan occurrences; selection matches BOM (web)"),
    ("3a", "User edit through the API makes a new revision (real engine)"),
    ("3b", "Edits are re-verified deterministically (engine)"),
    ("4a", "Failing fixture stays blocked; relabeling does not verify it (engine)"),
    ("4b", "Contract forbids verified with a blocking FAIL/UNKNOWN"),
    ("4c", "Verification panel shows failing findings first (web)"),
    ("5a", "Default BOM: quantities, link types, https links, catalog prices"),
    ("5b", "Unknown prices stay unknown (fixture, engine BOM tests)"),
    ("5c", "BOM panel shows Unknown and no invented total (web)"),
    ("6a", "Assembly steps use the plan's instance ids and cover every part"),
    ("6b", "Assembly timeline drives the model (web)"),
    ("7a", "Simulation is labeled a simplified approximation"),
    ("7b", "Obstacle-avoidance behavior runs deterministically (web)"),
    ("8a", "Firmware project generated from the plan"),
    ("8b", "Firmware compile status reported honestly"),
    ("9", "Supplier links checked working or labeled"),
    ("10", "Product copy avoids universal, certification and exact-copy claims"),
    ("11a", "Timed 3-minute rehearsal"),
    ("11b", "Backup recording"),
    ("12", "Roles assigned"),
)


def schema_verified_rule(schema: dict[str, Any]) -> dict[str, bool]:
    """Which statuses the schema forbids while a blocking FAIL/UNKNOWN finding exists."""
    found = {"verified": False, "verified_with_warnings": False}

    def forbids_blocking(node: Any) -> bool:
        if isinstance(node, dict):
            props = node.get("not", {}).get("properties", {}) if isinstance(node.get("not"), dict) else {}
            if props.get("severity", {}).get("const") == "blocking" and {"FAIL", "UNKNOWN"} <= set(props.get("result", {}).get("enum", [])):
                return True
            return any(forbids_blocking(v) for v in node.values())
        if isinstance(node, list):
            return any(forbids_blocking(v) for v in node)
        return False

    def walk(node: Any) -> None:
        if isinstance(node, dict):
            status = node.get("if", {}).get("properties", {}).get("status", {}) if isinstance(node.get("if"), dict) else {}
            targets = [status["const"]] if "const" in status else list(status.get("enum", []))
            if targets and forbids_blocking(node.get("then")):
                for target in targets:
                    if target in found:
                        found[target] = True
            for value in node.values():
                walk(value)
        elif isinstance(node, list):
            for value in node:
                walk(value)

    walk(schema)
    return found


def availability_flags(plan: dict[str, Any], catalog: dict[str, dict[str, Any]]) -> dict[str, Any]:
    """Parts not listed in stock must carry a non-PASS completeness.availability finding."""
    flagged = {
        i
        for f in plan["verification"]["findings"]
        if f["rule_id"] == "completeness.availability" and f["result"] != "PASS"
        for i in f["affected_instance_ids"]
    }
    problems, seen = [], []
    for comp in plan["components"]:
        status = ((catalog.get(comp["catalog_id"]) or {}).get("sourcing") or {}).get("availability_status")
        if status != "in_stock":
            seen.append(f"{comp['catalog_id']} {status}")
            if comp["instance_id"] not in flagged:
                problems.append(f"{comp['instance_id']} is {status} but no completeness.availability finding says so")
    summary = (", ".join(seen) + " (flagged by completeness.availability)") if seen else "none"
    return {"problems": problems, "summary": summary}


def known_compile_blockers(out: Path) -> list[str]:
    """The two PlatformIO errors recorded in docs/context.md section 6, found statically."""
    found = []
    ini = out / "platformio.ini"
    main = out / "src" / "main.cpp"
    if ini.exists() and re.search(r"adafruit/Adafruit VL53L0X@", ini.read_text(encoding="utf-8")):
        found.append("lib_deps name 'adafruit/Adafruit VL53L0X' (registry name is adafruit/Adafruit_VL53L0X)")
    if main.exists() and re.search(r"enum\s+class\s+\w+\s*\{[^}]*\bDISABLED\b", main.read_text(encoding="utf-8")):
        found.append("enum value DISABLED (collides with the ESP32 core macro)")
    return found


def network_available() -> bool:
    try:
        with socket.create_connection(LINK_PROBE_HOST, timeout=5):
            return True
    except OSError:
        return False


def web_sources(suffixes: tuple[str, ...]) -> list[Path]:
    """Shipped web source files (tests and test fixtures excluded)."""
    out = []
    for path in sorted((WEB_DIR / "src").rglob("*")):
        if not path.is_file() or path.suffix not in suffixes:
            continue
        if {"__tests__", "__fixtures__", "__mocks__"} & set(path.parts) or re.search(r"\.(test|spec|stories)\.", path.name):
            continue
        out.append(path)
    return out


def mask_comments(src: str) -> str:
    """Blank out // and /* */ comments in TS/TSX, keeping strings, JSX text and line numbers."""
    out, i, n, state = list(src), 0, len(src), ""
    while i < n:
        c = src[i]
        nxt = src[i + 1] if i + 1 < n else ""
        if not state:
            if c == "/" and nxt == "/" and (i == 0 or src[i - 1] != ":"):
                state = "//"
            elif c == "/" and nxt == "*":
                state = "/*"
            elif c in "'\"`":
                state = c
        elif state in "'\"`":
            if c == "\\":
                i += 1
            elif c == state or (c == "\n" and state != "`"):
                state = ""
        if state in ("//", "/*") and c != "\n":
            out[i] = " "
        if state == "//" and nxt == "\n":
            state = ""
        elif state == "/*" and c == "*" and nxt == "/":
            out[i + 1] = " "
            i += 1
            state = ""
        i += 1
    return "".join(out)


def copy_audit() -> dict[str, Any]:
    targets: list[tuple[Path, str]] = [(p, "code") for p in web_sources((".ts", ".tsx", ".js", ".jsx"))]
    targets += [(p, "data") for p in web_sources((".json",))]
    targets += [(REPO_ROOT / "README.md", "markdown"), (REPO_ROOT / "docs" / "project.md", "markdown")]
    targets += [(p, "markdown") for p in sorted(API_DIR.glob("rivet_api/firmware/templates/**/README*.tmpl"))]
    violations, allowed, scanned = [], [], 0
    for path, kind in targets:
        if not path.exists() or path.stat().st_size > 2_000_000:
            continue
        scanned += 1
        text = path.read_text(encoding="utf-8", errors="replace")
        if kind == "code":
            text = mask_comments(text)
        heading = ""
        for number, line in enumerate(text.splitlines(), 1):
            if kind == "markdown" and re.match(r"^#{1,6}\s", line):
                heading = line.lstrip("#").strip()
            for match in COPY_REGEX.finditer(line):
                category = COPY_CATEGORIES[int(next(k for k, v in match.groupdict().items() if v)[1:])]
                hit = {"file": rel(path), "line": number, "category": category, "match": match.group(0), "text": line.strip()[:240]}
                reason = allow_reason(rel(path), line, match, heading)
                if reason:
                    allowed.append(dict(hit, reason=reason))
                else:
                    violations.append(hit)
    return {"files": scanned, "violations": violations, "allowed": allowed}


def allow_reason(path: str, line: str, match: re.Match[str], heading: str) -> str | None:
    for file, phrase, reason in COPY_ALLOWLIST:
        start = line.find(phrase)
        if file == path and start != -1 and start <= match.start() and match.end() <= start + len(phrase):
            return f"allowlisted: {reason}"
    if re.search(r"must not claim", heading, re.IGNORECASE):
        return f"listed under heading: {heading}"
    clause_start = 0
    for boundary in CLAUSE_BOUNDARY.finditer(line, 0, match.start()):
        clause_start = boundary.end()
    negation = NEGATION.search(line, clause_start, match.start())
    if negation:
        return f"negated in the same clause: '{negation.group(0)}'"
    return None


# ---- output ---------------------------------------------------------------------------------


def summarize(results: list[Result]) -> dict[str, Any]:
    counts = Counter(r.status for r in results)
    automated = [r for r in results if r.status != "MANUAL"]
    return {
        "PASS": counts["PASS"],
        "FAIL": counts["FAIL"],
        "SKIP": counts["SKIP"],
        "MANUAL": counts["MANUAL"],
        "automated_pass": f"{counts['PASS']}/{len(automated)}",
    }


def render_table(results: list[Result], meta: dict[str, Any], width: int = 118) -> str:
    lines = [header_line(meta), "", "item | status | evidence", "-----+--------+" + "-" * 40]
    for r in results:
        wrapped = textwrap.wrap(f"{r.title}: {r.evidence}", width=width - 17) or [""]
        lines.append(f"{r.id:<4} | {r.status:<6} | {wrapped[0]}")
        lines += [f"     |        | {w}" for w in wrapped[1:]]
    lines += ["", footer_line(meta)]
    return "\n".join(lines)


def render_markdown(results: list[Result], meta: dict[str, Any]) -> str:
    lines = [header_line(meta), "", "| Item | Status | Evidence |", "|---|---|---|"]
    for r in results:
        evidence = f"**{r.title}.** {r.evidence}".replace("|", "\\|")
        lines.append(f"| {r.id} | {r.status} | {evidence} |")
    lines += ["", footer_line(meta)]
    return "\n".join(lines)


def header_line(meta: dict[str, Any]) -> str:
    dirty = " + uncommitted changes" if meta["dirty"] else ""
    return (
        f"Rivet final verification (issue #42): commit {meta['commit']}{dirty} on {meta['branch']}, "
        f"{meta['date_utc']}, Python {meta['python']}"
    )


def footer_line(meta: dict[str, Any]) -> str:
    s = meta["summary"]
    return (
        f"Automated checks: {s['automated_pass']} PASS, {s['FAIL']} FAIL, {s['SKIP']} SKIP; {s['MANUAL']} MANUAL. "
        f"Wall time {meta['wall_seconds']:.1f} s. Exit {1 if s['FAIL'] else 0}."
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    output = parser.add_mutually_exclusive_group()
    output.add_argument("--json", action="store_true", help="print the result as JSON")
    output.add_argument("--markdown", action="store_true", help="print a Markdown table")
    parser.add_argument("--no-web", action="store_true", help="do not run the targeted Vitest files")
    parser.add_argument("--offline", action="store_true", help="never touch the network (link check becomes SKIP)")
    parser.add_argument("--artifacts", type=Path, help="keep generated plan, firmware and reports in this directory")
    parser.add_argument("--pio-timeout", type=int, default=600, help="seconds allowed for `pio run` when PlatformIO is installed")
    args = parser.parse_args(argv)

    started = time.monotonic()
    tmp = None
    if args.artifacts:
        workdir = args.artifacts.resolve()
        workdir.mkdir(parents=True, exist_ok=True)
    else:
        tmp = tempfile.TemporaryDirectory(prefix="rivet-final-verification-")
        workdir = Path(tmp.name)
    try:
        verifier = Verifier(args, workdir)
        results = []
        for check_id, title in CHECKS:
            verifier.current = check_id
            begin = time.monotonic()
            details: dict[str, Any] = {}
            try:
                status, evidence = getattr(verifier, f"check_{check_id}")()
            except Outcome as exc:
                status, evidence, details = exc.status, exc.evidence, exc.details
            except Exception as exc:  # a bug here must not read as a pass
                status, evidence = "FAIL", f"verification script error: {type(exc).__name__}: {exc}"
            if check_id == "10" and "copy_audit" in verifier.cache:
                details = verifier.cache["copy_audit"]
            results.append(Result(check_id, title, status, evidence, round(time.monotonic() - begin, 2), details))

        meta = {
            "commit": git("rev-parse", "--short=7", "HEAD") or "unknown",
            "branch": git("rev-parse", "--abbrev-ref", "HEAD") or "unknown",
            "dirty": bool(git("status", "--porcelain", "--untracked-files=no")),
            "date_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "python": sys.version.split()[0],
            "wall_seconds": round(time.monotonic() - started, 1),
            "summary": summarize(results),
        }
        document = {"meta": meta, "checks": [r.__dict__ for r in results]}
        if args.artifacts:
            (workdir / "results.json").write_text(json.dumps(document, indent=2, default=str) + "\n", encoding="utf-8")
        if args.json:
            print(json.dumps(document, indent=2, default=str))
        elif args.markdown:
            print(render_markdown(results, meta))
        else:
            print(render_table(results, meta))
            if args.artifacts:
                print(f"Artifacts: {workdir}")
        return 1 if meta["summary"]["FAIL"] else 0
    finally:
        if tmp is not None:
            tmp.cleanup()


if __name__ == "__main__":
    sys.exit(main())
