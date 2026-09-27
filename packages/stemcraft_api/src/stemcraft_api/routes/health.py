from __future__ import annotations

from fastapi import APIRouter
from stemcraft_lib.config import SAMPLE_RATE
from stemcraft_lib.deps import check_all

router = APIRouter()


@router.get("/api/health")
def health() -> dict:
    """Reports; never refuses. Boot refusal happens in the lifespan (N-08), but
    the UI still needs to render a banner naming what is wrong."""
    return {
        "deps": [{"name": c.name, "ok": c.ok, "detail": c.detail} for c in check_all()],
        # Phase 4 fills this from the worker's latest job row. Until then the
        # API has no way to know, and must not guess.
        "device": None,
        "sample_rate": SAMPLE_RATE,
    }
