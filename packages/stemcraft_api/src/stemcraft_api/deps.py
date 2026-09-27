"""Per-request SQLite connection. Connections are cheap and thread-bound, so a
fresh one per request is simpler and safer than sharing."""

from __future__ import annotations

from collections.abc import Iterator

from stemcraft_lib import jobs as jobs_db
from stemcraft_lib.config import settings


def get_conn() -> Iterator:
    conn = jobs_db.connect(settings().jobs_db)
    try:
        yield conn
    finally:
        conn.close()
