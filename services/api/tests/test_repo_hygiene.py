"""Guards against files that exist locally but never reach git.

`git add <dir>` silently skips ignored files, so a module can pass every local test and
still be missing from a fresh checkout. This happened twice (a root `exports/` rule and a
local `data/` rule), so it is tested.
"""

import shutil
import subprocess
from pathlib import Path

import pytest

API_ROOT = Path(__file__).resolve().parents[1]

pytestmark = pytest.mark.skipif(shutil.which("git") is None, reason="git not available")


def git(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["git", *args], cwd=API_ROOT, capture_output=True, text=True, timeout=30)


@pytest.fixture(scope="module", autouse=True)
def inside_a_git_checkout():
    if git("rev-parse", "--is-inside-work-tree").stdout.strip() != "true":
        pytest.skip("not inside a git checkout")


def test_no_source_or_data_file_is_ignored_by_git():
    out = git("ls-files", "--others", "--ignored", "--exclude-standard", "--", "rivet_api", "tests", "scripts")
    ignored = [
        line
        for line in out.stdout.splitlines()
        if "__pycache__" not in line and not line.endswith(".pyc") and ".egg-info" not in line
    ]
    assert not ignored, f"these files exist but git ignores them, so a fresh checkout lacks them: {ignored}"


def test_package_data_files_the_code_reads_are_tracked():
    tracked = set(git("ls-files", "--", "rivet_api").stdout.splitlines())
    needed = [
        "rivet_api/data/fixtures/intent/rover_obstacle_v1.json",
        "rivet_api/data/fixtures/plans/rover_obstacle_v1.json",
        "rivet_api/data/fixtures/catalog/seed-components.json",
        "rivet_api/data/fixtures/offers/adafruit-3801.json",
        "rivet_api/data/fixtures/offers/sparkfun-rob-13301.json",
        "rivet_api/data/fixtures/offers/not-found-9999999.json",
        "rivet_api/data/fixtures/offers/synthetic-multivendor.json",
        "rivet_api/data/fixtures/offers/refused-synthetic-demo-part.json",
        "rivet_api/firmware/templates/esp32_rover/main.cpp.tmpl",
        "rivet_api/firmware/templates/esp32_rover/platformio.ini.tmpl",
        "rivet_api/firmware/templates/esp32_rover/rivet_config.h.tmpl",
        "rivet_api/firmware/templates/esp32_rover/README.md.tmpl",
    ]
    missing = [n for n in needed if n not in tracked]
    assert not missing, f"not tracked by git: {missing}"


def test_every_imported_module_file_is_tracked():
    """Every .py under rivet_api/ on disk must be tracked (or at least not ignored)."""
    tracked = set(git("ls-files", "--", "rivet_api").stdout.splitlines())
    on_disk = {p.relative_to(API_ROOT).as_posix() for p in (API_ROOT / "rivet_api").rglob("*.py")}
    on_disk = {p for p in on_disk if "__pycache__" not in p}
    untracked_ignored = [p for p in sorted(on_disk - tracked) if git("check-ignore", "-q", p).returncode == 0]
    assert not untracked_ignored, untracked_ignored
