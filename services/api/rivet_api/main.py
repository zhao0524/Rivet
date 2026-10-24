from fastapi import FastAPI

from rivet_api.config import Settings, get_settings
from rivet_api.errors import register_error_handlers
from rivet_api.orchestration.jobs import JobManager
from rivet_api.routes import health, jobs


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    app = FastAPI(title="Rivet API", version="0.1.0")
    app.state.settings = settings
    app.state.jobs = JobManager(settings.data_root / "jobs")
    register_error_handlers(app)
    app.include_router(health.router)
    app.include_router(jobs.router)
    return app


app = create_app()
