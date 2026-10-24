"""Bounded PlatformIO compile check.

Runs a fixed argv (no shell, nothing derived from plans, prompts or images) with a
timeout and a scrubbed environment. Absence of the toolchain is `not_checked`, never
`passed`.
"""

import os
import re
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Literal

_ANSI_RE = re.compile(r"\x1b\[[0-9;?]*[A-Za-z]")
_ENV_KEEP = ("PATH", "HOME", "LANG", "LC_ALL", "TMPDIR", "USER", "SYSTEMROOT")
LOG_TAIL_LINES = 40


@dataclass(frozen=True)
class CompileResult:
    status: Literal["passed", "failed", "not_checked"]
    summary: str
    log_tail: str = ""


def _scrubbed_env() -> dict[str, str]:
    env = {k: v for k, v in os.environ.items() if k in _ENV_KEEP or k.startswith("PLATFORMIO_")}
    env.setdefault("PATH", os.defpath)
    return env


def _tail(text: str) -> str:
    lines = _ANSI_RE.sub("", text).splitlines()
    return "\n".join(line[:300] for line in lines[-LOG_TAIL_LINES:])


def compile_firmware(
    project_dir: Path,
    timeout_s: int = 120,
    runner: Callable | None = None,
    which: Callable[[str], str | None] | None = None,
) -> CompileResult:
    runner = runner or subprocess.run  # resolved at call time so tests can patch the module
    which = which or shutil.which
    pio = which("pio")
    if pio is None:
        return CompileResult("not_checked", "PlatformIO (pio) is not installed; nothing was compiled")
    try:
        proc = runner(
            [pio, "run", "-d", str(project_dir)],
            cwd=str(project_dir),
            env=_scrubbed_env(),
            capture_output=True,
            text=True,
            timeout=timeout_s,
        )
    except subprocess.TimeoutExpired:
        return CompileResult("failed", f"timeout after {timeout_s}s")
    except OSError as exc:
        return CompileResult("not_checked", f"PlatformIO could not be started ({type(exc).__name__})")
    log = (proc.stdout or "") + (proc.stderr or "")
    if proc.returncode == 0:
        return CompileResult("passed", "pio run succeeded", _tail(log))
    return CompileResult("failed", f"pio run exited with status {proc.returncode}", _tail(log))
