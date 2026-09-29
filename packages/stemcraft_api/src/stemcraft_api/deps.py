"""Per-request SQLite connection. Connections are cheap and thread-bound, so a
fresh one per request is simpler and safer than sharing."""

from __future__ import annotations

from collections.abc import Iterator

from stemcraft_lib import jobs as jobs_db
from stemcraft_lib.config import settings


def get_conn() -> Iterator:
    # FastAPI runs a sync generator dependency's setup, the endpoint and the
    # teardown on the threadpool, possibly on different threads. The connection
    # is used by one request at a time, serially, so hand-off is safe.
    conn = jobs_db.connect(settings().jobs_db, check_same_thread=False)
    try:
        yield conn
    finally:
        conn.close()
