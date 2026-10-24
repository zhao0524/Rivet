"""Builds the v2 design services from settings. RIVET_3D_MODE=live must be explicit and
needs real credentials; anything else runs the labelled offline (fixture) author."""
from __future__ import annotations

import os
from pathlib import Path

from rivet_api.config import Settings

from . import procedural
from .artifacts import DesignStore
from .orchestrator import DesignServices
from .providers import CallLedger, OpenAIDesignProvider, OpenAIImageProvider


class ProceduralProvider:
    mode = "fixture"
    name = "rivet-procedural-author/1"

    def __init__(self, ledger: CallLedger):
        self.ledger = ledger

    def distill(self, text, image, mode):
        return procedural.distill(text, image, mode)

    def author(self, brief, strategy, seed, mode, catalog, feedback):
        return procedural.author(brief, strategy, seed, mode)

    def critique(self, brief, references, shots, bodies):  # deterministic critic is used instead
        raise NotImplementedError

    def patch(self, spec, instruction, issues, focus):
        return procedural.edit(spec, instruction)

    def compare_views(self, views):
        return {"consistent": True, "contradictions": [], "uncertainties": ["no view comparison offline"]}


def build_design_services(settings: Settings, catalog: list[dict], provider_factory=None) -> DesignServices:
    root = Path(settings.data_root) / "design"
    web_root = Path(__file__).resolve().parents[4] / "apps" / "web"
    names = {"design": ProceduralProvider.name, "images": "none"}
    mode = "fixture"
    if provider_factory is None and settings.design_mode == "live":
        key = os.environ.get("OPENAI_API_KEY")
        if not key:
            raise ValueError("RIVET_3D_MODE=live needs OPENAI_API_KEY (live mode never falls back to fixtures)")
        import openai

        client = openai.OpenAI(api_key=key, timeout=120.0, max_retries=1)
        model = settings.design_model or settings.vision_model or "gpt-4o"
        image_model = settings.image_model if settings.image_provider == "openai" else None

        def provider_factory(ledger: CallLedger):
            images = OpenAIImageProvider(client, image_model, settings.image_size, settings.image_quality, ledger) if image_model else None
            return OpenAIDesignProvider(client, model, ledger), images

        names = {"design": f"openai:{model}", "images": f"openai:{image_model}" if image_model else "none"}
        mode = "live"
    elif provider_factory is None:
        provider_factory = lambda ledger: (ProceduralProvider(ledger), None)  # noqa: E731
    else:
        mode = getattr(provider_factory, "mode", "live")
        names = getattr(provider_factory, "names", {"design": "injected", "images": "injected"})
    store = DesignStore(root)
    store.recover_interrupted()
    svc = DesignServices(store=store, mode=mode, provider_factory=provider_factory, catalog=catalog, work_root=root / "work", web_root=web_root, renderer=settings.renderer)
    svc.provider_names = names  # type: ignore[attr-defined]
    return svc
