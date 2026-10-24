from fastapi import FastAPI

from rivet_api.adapters.engineering import build_engineering_port
from rivet_api.agents.vision import build_vision_port
from rivet_api.assets.null import NullAssetStore
from rivet_api.config import Settings, get_settings
from rivet_api.errors import register_error_handlers
from rivet_api.orchestration.jobs import JobManager
from rivet_api.orchestration.pipeline import Deps
from rivet_api.orchestration.versions import ProjectStore
from rivet_api.routes import health, jobs, projects


class ModeHeaderMiddleware:
    """Adds X-Rivet-Mode to every response (pure ASGI so SSE streams are untouched)."""

    def __init__(self, app, mode: str):
        self.app = app
        self.mode = mode.encode()

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)

        async def send_with_header(message):
            if message["type"] == "http.response.start":
                message["headers"] = [*message.get("headers", []), (b"x-rivet-mode", self.mode)]
            await send(message)

        await self.app(scope, receive, send_with_header)


def create_app(
    settings: Settings | None = None,
    *,
    vision=None,
    engine=None,
    assets=None,
    store: ProjectStore | None = None,
    job_manager: JobManager | None = None,
) -> FastAPI:
    settings = settings or get_settings()
    app = FastAPI(title="Rivet API", version="0.1.0")
    deps = Deps(
        settings=settings,
        vision=vision or build_vision_port(settings),
        engine=engine or build_engineering_port(settings),
        store=store or ProjectStore(settings.data_root / "projects"),
        jobs=job_manager or JobManager(settings.data_root / "jobs"),
        assets=assets or NullAssetStore(),
    )
    app.state.settings = settings
    app.state.deps = deps
    app.state.jobs = deps.jobs
    register_error_handlers(app)
    app.add_middleware(ModeHeaderMiddleware, mode=settings.mode)
    app.include_router(health.router)
    app.include_router(jobs.router)
    app.include_router(projects.router)
    return app


app = create_app()
