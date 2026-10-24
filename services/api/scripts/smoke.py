"""Run the API smoke check: `python scripts/smoke.py --in-process` or `--base-url http://localhost:8000`."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from rivet_api.smoke import main  # noqa: E402

if __name__ == "__main__":
    sys.exit(main())
