"""FastAPI application factory.

Usage:
    uvicorn app.main:app --port 8000
"""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api.container import Container, build_container
from app.api.routes import router


def create_app(container: Container | None = None) -> FastAPI:
    app = FastAPI(title="AI Engine", version="0.1.0", docs_url="/docs", openapi_url="/openapi.json")

    @asynccontextmanager
    async def lifespan(application: FastAPI):
        application.state.container = container or build_container()
        yield

    app.router.lifespan_context = lifespan
    app.include_router(router)
    return app


app = create_app()