from fastapi import FastAPI

from rivet_api.config import Settings, get_settings
from rivet_api.errors import register_error_handlers
from rivet_api.routes import health


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    app = FastAPI(title="Rivet API", version="0.1.0")
    app.state.settings = settings
    register_error_handlers(app)
    app.include_router(health.router)
    return app


app = create_app()
