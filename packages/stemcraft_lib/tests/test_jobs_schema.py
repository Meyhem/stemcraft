import sqlite3

import pytest
from stemcraft_lib.jobs import (
    JOBS_SCHEMA_VERSION,
    JobsSchemaError,
    connect,
    data_version,
    enqueue,
    get_job,
    get_worker_status,
    list_jobs,
    set_worker_status,
)


def test_pragmas_match_the_spec(tmp_path):
    conn = connect(tmp_path / "jobs.sqlite")
    assert conn.execute("PRAGMA journal_mode").fetchone()[0].lower() == "wal"
    assert conn.execute("PRAGMA busy_timeout").fetchone()[0] == 5000
    assert conn.execute("PRAGMA synchronous").fetchone()[0] == 1  # NORMAL


def test_schema_has_every_documented_column(tmp_path):
    conn = connect(tmp_path / "jobs.sqlite")
    cols = {r[1] for r in conn.execute("PRAGMA table_info(jobs)")}
    assert cols == {
        "id", "song_id", "kind", "payload", "state", "cancel_requested", "progress",
        "device", "lease_until", "created_at", "started_at", "finished_at", "error", "result",
    }


def test_enqueue_starts_queued_at_zero_progress(tmp_path):
    conn = connect(tmp_path / "jobs.sqlite")
    job_id = enqueue(conn, kind="probe", payload={"steps": 3})
    job = get_job(conn, job_id)
    assert job.state == "queued"
    assert job.progress == 0
    assert job.payload == {"steps": 3}
    assert job.created_at > 0
    assert job.started_at is None


def test_connecting_twice_is_idempotent(tmp_path):
    path = tmp_path / "jobs.sqlite"
    enqueue(connect(path), kind="probe")
    assert len(list_jobs(connect(path))) == 1


def test_list_is_newest_first_and_filterable(tmp_path):
    conn = connect(tmp_path / "jobs.sqlite")
    first = enqueue(conn, kind="probe")
    second = enqueue(conn, kind="probe")
    assert [j.id for j in list_jobs(conn)] == [second, first]
    assert list_jobs(conn, states=("done",)) == []


def test_a_fresh_database_is_stamped_with_the_current_schema_version(tmp_path):
    conn = connect(tmp_path / "jobs.sqlite")
    assert conn.execute("PRAGMA user_version").fetchone()[0] == JOBS_SCHEMA_VERSION == 1


def test_a_newer_schema_version_is_refused_rather_than_guessed_at(tmp_path):
    path = tmp_path / "jobs.sqlite"
    setup = sqlite3.connect(path)
    setup.execute("PRAGMA user_version = 99")
    setup.close()

    with pytest.raises(JobsSchemaError) as err:
        connect(path)
    assert "99" in str(err.value)


def test_worker_status_is_none_before_any_worker_boots(tmp_path):
    conn = connect(tmp_path / "jobs.sqlite")
    assert get_worker_status(conn) is None


def test_worker_status_round_trips(tmp_path):
    conn = connect(tmp_path / "jobs.sqlite")
    set_worker_status(conn, device="cuda", fallback_reason=None)
    status = get_worker_status(conn)
    assert status.device == "cuda"
    assert status.fallback_reason is None
    assert status.updated_at > 0


def test_worker_status_upserts_a_single_row(tmp_path):
    conn = connect(tmp_path / "jobs.sqlite")
    set_worker_status(conn, device="cuda", fallback_reason=None)
    set_worker_status(conn, device="cpu", fallback_reason="no cuda device found")
    status = get_worker_status(conn)
    assert status.device == "cpu"
    assert status.fallback_reason == "no cuda device found"
    assert conn.execute("SELECT COUNT(*) FROM worker_status").fetchone()[0] == 1


def test_data_version_changes_when_a_different_connection_writes(tmp_path):
    # data_version() exists for the WebSocket handler's read-only connection to
    # detect writes made by OTHER connections (REST API requests, the worker).
    # PRAGMA data_version does not reflect the querying connection's own
    # writes, by design, so this must be tested across two connections.
    path = tmp_path / "jobs.sqlite"
    writer = connect(path)
    reader = connect(path)
    before = data_version(reader)
    enqueue(writer, kind="probe")
    after = data_version(reader)
    assert after != before


def test_connect_defaults_to_same_thread_checking(tmp_path):
    import threading

    conn = connect(tmp_path / "jobs.sqlite")
    errors = []

    def use():
        try:
            conn.execute("SELECT 1")
        except sqlite3.ProgrammingError as exc:
            errors.append(exc)

    t = threading.Thread(target=use)
    t.start()
    t.join()
    conn.close()
    assert len(errors) == 1
