import os
from pathlib import Path
from typing import Literal

from pydantic import BaseModel


def _flag(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


class Settings(BaseModel):
    mode: Literal["fixture", "live"] = "fixture"
    env: str = "development"
    data_root: Path = Path("./data")
    vision_provider: str = "mock"
    vision_model: str = ""
    demo_fixture: str = "rover_obstacle_v1"
    enable_estelle: bool = False
    estelle_mode: Literal["cli", "mcp"] = "cli"
    allow_fallback: bool = True

    @classmethod
    def from_env(cls) -> "Settings":
        mode = os.environ.get("RIVET_MODE", "fixture")
        if mode not in ("fixture", "live"):
            raise ValueError(f"RIVET_MODE must be 'fixture' or 'live', got {mode!r}")
        estelle_mode = os.environ.get("RIVET_ESTELLE_MODE", "cli")
        if estelle_mode not in ("cli", "mcp"):
            raise ValueError(f"RIVET_ESTELLE_MODE must be 'cli' or 'mcp', got {estelle_mode!r}")
        return cls(
            mode=mode,
            env=os.environ.get("RIVET_ENV", "development"),
            data_root=Path(os.environ.get("RIVET_DATA_ROOT", "./data")),
            vision_provider=os.environ.get("RIVET_VISION_PROVIDER", "mock"),
            vision_model=os.environ.get("RIVET_VISION_MODEL", ""),
            demo_fixture=os.environ.get("RIVET_DEMO_FIXTURE", "rover_obstacle_v1"),
            enable_estelle=_flag("RIVET_ENABLE_ESTELLE"),
            estelle_mode=estelle_mode,
        )


def get_settings() -> Settings:
    return Settings.from_env()
