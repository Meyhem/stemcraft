"""The API. Owns song.json, serves the SPA, enqueues jobs.

It never imports torch (§4) and it has no CORS middleware (D-15): dev is one
origin through the Vite proxy, prod is one origin through the static mount.
"""

from __future__ import annotations

import logging
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from stemcraft_lib.config import settings
from stemcraft_lib.deps import assert_ready

from . import ws
from .routes import albums, health, jobs, practice, songs, theory

log = logging.getLogger("stemcraft.api")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    if not os.environ.get("STEMCRAFT_SKIP_BOOT_CHECKS"):
        # Raises DependencyError, which uvicorn surfaces and exits on (N-08).
        for check in assert_ready():
            log.info("dependency ok: %s (%s)", check.name, check.detail)
    yield


def create_app() -> FastAPI:
    app = FastAPI(title="Stemcraft", lifespan=lifespan)
    app.include_router(health.router)
    app.include_router(songs.router)
    app.include_router(albums.router)
    app.include_router(jobs.router)
    app.include_router(theory.router)
    app.include_router(practice.router)
    app.include_router(ws.router)

    cfg = settings()
    if cfg.dist_dir is not None:
        from .static import mount_spa

        mount_spa(app, cfg.dist_dir)
    return app


def run() -> None:
    import uvicorn

    cfg = settings()
    logging.basicConfig(level=logging.INFO)
    uvicorn.run(create_app(), host=cfg.host, port=cfg.port)
