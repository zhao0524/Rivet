"""The shared golden set (fixtures/golden/verified_parts.json) passes offline (#87)."""

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


def test_golden_set_passes_and_no_fabricated_sku_is_verified():
    script = ROOT / "scripts" / "golden_verified_parts.py"
    if not script.exists():
        import pytest

        pytest.skip("shared golden runner not present (packaged install)")
    proc = subprocess.run([sys.executable, str(script)], capture_output=True, text=True, check=False)
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert "no fabricated SKU is verified" in proc.stdout
