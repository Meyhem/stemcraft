"""Production serving (D-15): FastAPI hands out the built bundle, so the SPA and
the API are genuinely one origin and a stale bundle is impossible."""

from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles


def mount_spa(app: FastAPI, dist_dir: Path) -> None:
    dist_dir = dist_dir.resolve()
    index = dist_dir / "index.html"
    app.mount("/assets", StaticFiles(directory=dist_dir / "assets"), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa(full_path: str) -> FileResponse:
        # An unknown /api path is a bug, not a route for the client router to
        # handle. Returning index.html here would hide it behind a blank screen.
        # `full_path` is "api" for a bare /api (no trailing segment) and
        # "api/whatever" otherwise -- both must 404, not just the latter.
        if full_path == "api" or full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail=f"no API route /{full_path}")
        # full_path is attacker-controlled and may contain ".." (including
        # percent-encoded forms that bypass ASGI-level dot-segment
        # normalization). Resolve and confirm containment before treating it
        # as a real file, or a request can read anything on disk.
        direct = (dist_dir / full_path).resolve()
        if full_path and direct.is_relative_to(dist_dir) and direct.is_file():
            return FileResponse(direct)
        return FileResponse(index)
