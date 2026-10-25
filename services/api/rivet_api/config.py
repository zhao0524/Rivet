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
    resolver_provider: str = "stub"
    offers_provider: str = "stub"
    enable_estelle: bool = False
    estelle_mode: Literal["cli", "mcp"] = "cli"
    estelle_repo_root: Path | None = None
    allow_fallback: bool = True
    # v2 geometry-first generation. RIVET_3D_MODE=live is explicit and needs credentials;
    # otherwise the offline author runs and every result is labelled fixture.
    design_mode: Literal["fixture", "live"] = "fixture"
    design_model: str = ""
    image_provider: Literal["none", "openai"] = "none"
    image_model: str = "gpt-image-1"
    image_size: str = "1024x1024"
    image_quality: str = "medium"
    renderer: Literal["raster", "chromium"] = "raster"

    @classmethod
    def from_env(cls) -> "Settings":
        mode = os.environ.get("RIVET_MODE", "fixture")
        if mode not in ("fixture", "live"):
            raise ValueError(f"RIVET_MODE must be 'fixture' or 'live', got {mode!r}")
        estelle_mode = os.environ.get("RIVET_ESTELLE_MODE", "cli")
        if estelle_mode not in ("cli", "mcp"):
            raise ValueError(f"RIVET_ESTELLE_MODE must be 'cli' or 'mcp', got {estelle_mode!r}")
        offers_provider = os.environ.get("RIVET_OFFERS_PROVIDER", "stub")
        if offers_provider not in ("stub", "recorded", "live"):
            raise ValueError(f"RIVET_OFFERS_PROVIDER must be 'stub', 'recorded' or 'live', got {offers_provider!r}")
        return cls(
            mode=mode,
            env=os.environ.get("RIVET_ENV", "development"),
            data_root=Path(os.environ.get("RIVET_DATA_ROOT", "./data")),
            vision_provider=os.environ.get("RIVET_VISION_PROVIDER", "mock"),
            vision_model=os.environ.get("RIVET_VISION_MODEL", ""),
            demo_fixture=os.environ.get("RIVET_DEMO_FIXTURE", "rover_obstacle_v1"),
            resolver_provider=os.environ.get("RIVET_RESOLVER", "stub"),
            offers_provider=offers_provider,
            enable_estelle=_flag("RIVET_ENABLE_ESTELLE"),
            estelle_mode=estelle_mode,
            estelle_repo_root=Path(os.environ["RIVET_ESTELLE_REPO"]) if os.environ.get("RIVET_ESTELLE_REPO") else None,
            design_mode="live" if os.environ.get("RIVET_3D_MODE") == "live" else "fixture",
            design_model=os.environ.get("RIVET_DESIGN_MODEL", ""),
            image_provider="openai" if os.environ.get("RIVET_IMAGE_PROVIDER") == "openai" else "none",
            image_model=os.environ.get("RIVET_IMAGE_MODEL", "gpt-image-1"),
            image_size=os.environ.get("RIVET_IMAGE_SIZE", "1024x1024"),
            image_quality=os.environ.get("RIVET_IMAGE_QUALITY", "medium"),
            renderer="chromium" if os.environ.get("RIVET_RENDERER") == "chromium" else "raster",
        )


def get_settings() -> Settings:
    return Settings.from_env()
