"""Estelle (Fate Labs) repo-grounding client.

Only what Estelle's docs actually specify is used: the CLI command `estelle ask "<question>"`
(answers cite file and line; it says so when it cannot ground an answer) and `estelle doctor`.
The docs give no parameters or output formats for the MCP tools (find_definition,
find_references, blast_radius, verify, gate), so MCP mode and `verify_change` report
"unavailable" instead of guessing.

Estelle's output is untrusted text. A citation counts as evidence only if the cited file
exists inside the repository, the line is in range, and (for symbol grounding) the file
really contains the symbol. Nothing is ever recorded as evidence from a failed run.
"""

import json
import logging
import os
import re
import subprocess
import tempfile
import threading
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Literal

from rivet_api.config import Settings
from rivet_api.errors import ApiError

log = logging.getLogger("rivet_api")

TEMPLATE_DIR_REL = "services/api/rivet_api/firmware/templates/esp32_rover"
EVIDENCE_FILE = "estelle_evidence.json"
RAW_TAIL_CHARS = 4000
MAX_CITATIONS = 20
MAX_FILE_BYTES = 2_000_000
ASK_TIMEOUT_S = 60
DOCTOR_TIMEOUT_S = 30

_IDENTIFIER_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,79}$")
_ANSI_RE = re.compile(r"\x1b\[[0-9;?]*[A-Za-z]")
_CITATION_RE = re.compile(r"(?<![\w./~-])((?:[A-Za-z0-9_.-]+/)*[A-Za-z0-9_.-]+\.[A-Za-z0-9]{1,5}):(\d+)")
_ENV_KEEP = ("PATH", "HOME", "LANG", "LC_ALL", "TMPDIR", "USER", "SYSTEMROOT", "XDG_CONFIG_HOME", "XDG_DATA_HOME")

Status = Literal["ok", "ungrounded", "unavailable"]


@dataclass(frozen=True)
class Citation:
    path: str
    line: int
    symbol_in_file: bool


@dataclass
class GroundingResult:
    status: Status
    tool: str | None
    question: str
    timestamp: str
    exit_code: int | None = None
    citations: list[Citation] = field(default_factory=list)
    raw_output_tail: str = ""
    reason: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _env() -> dict[str, str]:
    env = {k: v for k, v in os.environ.items() if k in _ENV_KEEP or k.startswith("ESTELLE_")}
    env.setdefault("PATH", os.defpath)
    return env


def _check_symbol(name: str) -> str:
    if not isinstance(name, str) or not _IDENTIFIER_RE.match(name):
        raise ApiError(
            "INVALID_SYMBOL", "Symbol names must be plain identifiers (letters, digits, underscore)", 400
        )
    return name


class RepoGrounder:
    def __init__(
        self,
        enabled: bool,
        mode: str,
        repo_root: Path,
        evidence_dir: Path,
        runner: Callable | None = None,
        which: Callable[[str], str | None] | None = None,
    ):
        self.enabled = enabled
        self.mode = mode
        self.repo_root = Path(repo_root)
        self.evidence_dir = Path(evidence_dir)
        self._runner = runner
        self._which = which
        self._evidence_lock = threading.Lock()

    @classmethod
    def from_settings(cls, settings: Settings) -> "RepoGrounder":
        default_root = Path(__file__).resolve().parents[4]
        return cls(
            enabled=settings.enable_estelle,
            mode=settings.estelle_mode,
            repo_root=settings.estelle_repo_root or default_root,
            evidence_dir=settings.data_root / "estelle",
        )

    # -- availability -----------------------------------------------------------
    def _unavailable_reason(self) -> str | None:
        import shutil

        if not self.enabled:
            return "Estelle is disabled (RIVET_ENABLE_ESTELLE is not true)"
        if self.mode != "cli":
            return "Estelle MCP mode is not implemented: the MCP tool parameters are not documented"
        if (self._which or shutil.which)("estelle") is None:
            return "The estelle CLI is not installed (npm i -g @fatelabs/estelle)"
        if not (self.repo_root / ".git").exists():
            return "The configured path is not a git repository"
        return None

    def _estelle(self) -> str:
        import shutil

        return (self._which or shutil.which)("estelle") or "estelle"

    def _run(self, args: list[str], timeout: int) -> subprocess.CompletedProcess:
        runner = self._runner or subprocess.run
        return runner(
            [self._estelle(), *args],
            cwd=str(self.repo_root),
            env=_env(),
            stdin=subprocess.DEVNULL,
            capture_output=True,
            text=True,
            timeout=timeout,
        )

    def _unavailable(self, question: str, reason: str, **extra: Any) -> GroundingResult:
        return GroundingResult("unavailable", extra.pop("tool", None), question, _now(), reason=reason, **extra)

    # -- grounding ---------------------------------------------------------------
    def locate_symbols(self, name: str) -> GroundingResult:
        name = _check_symbol(name)
        return self._ask(name, f"Where is {name} defined? Cite the file and line.")

    def inspect_dependencies(self, name: str) -> GroundingResult:
        name = _check_symbol(name)
        return self._ask(name, f"What calls or depends on {name}? Cite the file and line.")

    def _ask(self, symbol: str, question: str) -> GroundingResult:
        reason = self._unavailable_reason()
        if reason:
            return self._unavailable(question, reason)
        try:
            proc = self._run(["ask", question], ASK_TIMEOUT_S)
        except subprocess.TimeoutExpired:
            return self._unavailable(question, f"estelle ask timed out after {ASK_TIMEOUT_S}s", tool="estelle ask")
        except OSError as exc:
            return self._unavailable(question, f"estelle could not be started ({type(exc).__name__})")
        output = _ANSI_RE.sub("", (proc.stdout or "") + (proc.stderr or ""))[-RAW_TAIL_CHARS:]
        if proc.returncode != 0:
            return self._unavailable(
                question,
                f"estelle ask exited with status {proc.returncode}",
                tool="estelle ask",
                exit_code=proc.returncode,
                raw_output_tail=output,
            )
        citations = self._verified_citations(output, symbol)
        status: Status = "ok" if any(c.symbol_in_file for c in citations) else "ungrounded"
        return GroundingResult(
            status,
            "estelle ask",
            question,
            _now(),
            exit_code=0,
            citations=citations,
            raw_output_tail=output,
            reason="" if status == "ok" else "No citation could be verified against the repository",
        )

    def _verified_citations(self, output: str, symbol: str) -> list[Citation]:
        root = self.repo_root.resolve()
        symbol_re = re.compile(rf"\b{re.escape(symbol)}\b")
        found: list[Citation] = []
        seen: set[tuple[str, int]] = set()
        for raw_path, raw_line in _CITATION_RE.findall(output):
            if raw_path.startswith("/") or ".." in raw_path.split("/"):
                continue
            target = (root / raw_path).resolve()
            try:
                rel = target.relative_to(root)
            except ValueError:
                continue
            key = (rel.as_posix(), int(raw_line))
            if key in seen or not target.is_file() or target.stat().st_size > MAX_FILE_BYTES:
                continue
            text = target.read_text(errors="replace")
            if not 1 <= key[1] <= len(text.splitlines()):
                continue
            seen.add(key)
            found.append(Citation(key[0], key[1], bool(symbol_re.search(text))))
            if len(found) >= MAX_CITATIONS:
                break
        return found

    # -- verification --------------------------------------------------------------
    def verify_change(self, paths: list[str]) -> GroundingResult:
        allowed = (self.repo_root / TEMPLATE_DIR_REL).resolve()
        for raw in paths:
            if not isinstance(raw, str) or raw.startswith("/") or ".." in raw.split("/"):
                raise ApiError("PATH_NOT_ALLOWED", "Only firmware template files may be changed", 400)
            resolved = (self.repo_root / raw).resolve()
            try:
                resolved.relative_to(allowed)
            except ValueError:
                raise ApiError("PATH_NOT_ALLOWED", "Only firmware template files may be changed", 400) from None
        return self._unavailable(
            "verify_change",
            "Estelle's verify/gate command usage is not documented, so no verification was run; "
            "use compile_firmware for build results",
        )

    # -- evidence ------------------------------------------------------------------
    def capture_evidence(self, result: GroundingResult) -> Path | None:
        if result.status != "ok":
            return None
        entry = {
            "tool": result.tool,
            "question": result.question,
            "timestamp": result.timestamp,
            "exit_code": result.exit_code,
            "citations": [asdict(c) for c in result.citations],
            "raw_output_tail": result.raw_output_tail,
        }
        path = self.evidence_dir / EVIDENCE_FILE
        with self._evidence_lock:
            entries: list[Any] = []
            if path.exists():
                try:
                    entries = json.loads(path.read_text())["entries"]
                except (ValueError, KeyError, TypeError):
                    log.warning("could not read existing Estelle evidence; starting a new file")
            entries.append(entry)
            self.evidence_dir.mkdir(parents=True, exist_ok=True)
            fd, tmp = tempfile.mkstemp(dir=self.evidence_dir, prefix=".tmp-", suffix=".json")
            with os.fdopen(fd, "w") as f:
                json.dump({"entries": entries}, f, indent=2)
            os.replace(tmp, path)
        return path

    # -- status ---------------------------------------------------------------------
    def status(self) -> dict[str, Any]:
        reason = self._unavailable_reason()
        base: dict[str, Any] = {"enabled": self.enabled, "mode": self.mode, "available": False, "doctor": None}
        if reason:
            return {**base, "reason": reason}
        try:
            proc = self._run(["doctor"], DOCTOR_TIMEOUT_S)
        except subprocess.TimeoutExpired:
            return {**base, "reason": f"estelle doctor timed out after {DOCTOR_TIMEOUT_S}s"}
        except OSError as exc:
            return {**base, "reason": f"estelle could not be started ({type(exc).__name__})"}
        tail = _ANSI_RE.sub("", (proc.stdout or "") + (proc.stderr or ""))[-1000:]
        ok = proc.returncode == 0
        return {
            **base,
            "available": ok,
            "reason": "" if ok else f"estelle doctor exited with status {proc.returncode}",
            "doctor": {"exit_code": proc.returncode, "output_tail": tail},
        }
