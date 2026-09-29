# packages/stemcraft_lib/tests/test_jobs_steps.py
import sqlite3

import pytest
from stemcraft_lib import job_steps
from stemcraft_lib.job_steps import UnknownJobKind
from stemcraft_lib.jobs import (
    JOBS_SCHEMA_VERSION,
    JobsSchemaError,
    cancelled,
    claim_next,
    connect,
    enqueue,
    fail,
    get_job,
    list_jobs,
    reclaim_expired,
    request_cancel,
    set_steps,
)


def states(job):
    return [(s["id"], s["state"]) for s in job.steps]


def test_enqueue_seeds_the_declared_steps_as_pending(tmp_path):
    conn = connect(tmp_path / "j.sqlite")
    job = get_job(conn, enqueue(conn, kind="import", song_id="s1"))
    assert states(job) == [("download", "pending"), ("decode", "pending"), ("peaks", "pending")]


def test_enqueue_refuses_an_undeclared_kind_and_writes_no_row(tmp_path):
    conn = connect(tmp_path / "j.sqlite")
    with pytest.raises(UnknownJobKind):
        enqueue(conn, kind="t_never_declared")
    assert list_jobs(conn) == []


def test_set_steps_stores_steps_and_the_weighted_progress(tmp_path):
    conn = connect(tmp_path / "j.sqlite")
    job_id = enqueue(conn, kind="import")
    job = claim_next(conn, device="cpu")
    steps = job_steps.skip(job.steps, "download", "uploaded file")
    steps = job_steps.set_progress(job_steps.advance(steps, "decode"), 0.5)
    set_steps(conn, job_id, steps)
    stored = get_job(conn, job_id)
    assert states(stored)[:2] == [("download", "skipped"), ("decode", "running")]
    assert stored.progress == pytest.approx(0.6 * 0.5 / 0.7)


def test_set_steps_is_ignored_once_the_job_is_no_longer_running(tmp_path):
    conn = connect(tmp_path / "j.sqlite")
    job_id = enqueue(conn, kind="probe")
    set_steps(conn, job_id, job_steps.advance(get_job(conn, job_id).steps, "tick"))
    assert states(get_job(conn, job_id)) == [("tick", "pending")]


def test_fail_marks_the_running_step_failed(tmp_path):
    conn = connect(tmp_path / "j.sqlite")
    job_id = enqueue(conn, kind="probe")
    job = claim_next(conn, device="cpu")
    set_steps(conn, job_id, job_steps.advance(job.steps, "tick"))
    fail(conn, job_id, "Traceback...\nRuntimeError: boom")
    assert states(get_job(conn, job_id)) == [("tick", "failed")]


def test_cancelled_marks_the_running_step_cancelled(tmp_path):
    conn = connect(tmp_path / "j.sqlite")
    job_id = enqueue(conn, kind="probe")
    job = claim_next(conn, device="cpu")
    set_steps(conn, job_id, job_steps.advance(job.steps, "tick"))
    cancelled(conn, job_id)
    assert states(get_job(conn, job_id)) == [("tick", "cancelled")]


def test_a_queued_cancel_leaves_the_steps_pending(tmp_path):
    conn = connect(tmp_path / "j.sqlite")
    job_id = enqueue(conn, kind="probe")
    request_cancel(conn, job_id)
    assert states(get_job(conn, job_id)) == [("tick", "pending")]


def test_reclaim_resets_the_steps_with_the_progress(tmp_path):
    conn = connect(tmp_path / "j.sqlite")
    job_id = enqueue(conn, kind="import")
    job = claim_next(conn, device="cpu", lease_seconds=-1)
    set_steps(conn, job_id, job_steps.advance(job_steps.skip(job.steps, "download", "x"), "decode"))
    assert reclaim_expired(conn) == [job_id]
    requeued = get_job(conn, job_id)
    assert requeued.steps == job_steps.seed("import")
    assert requeued.progress == 0


def test_list_jobs_filters_by_song(tmp_path):
    conn = connect(tmp_path / "j.sqlite")
    mine = enqueue(conn, kind="import", song_id="s1")
    enqueue(conn, kind="import", song_id="s2")
    assert [j.id for j in list_jobs(conn, song_id="s1")] == [mine]


def test_a_v1_database_is_migrated_and_its_old_rows_have_no_steps(tmp_path):
    path = tmp_path / "j.sqlite"
    old = sqlite3.connect(path)
    old.executescript(
        "CREATE TABLE jobs (id INTEGER PRIMARY KEY, song_id TEXT, kind TEXT, payload TEXT,"
        " state TEXT, cancel_requested INTEGER DEFAULT 0, progress REAL DEFAULT 0,"
        " device TEXT, lease_until REAL, created_at REAL, started_at REAL,"
        " finished_at REAL, error TEXT, result TEXT);"
        "INSERT INTO jobs (kind, payload, state, progress) VALUES ('separate', '{}', 'done', 1);"
        "PRAGMA user_version = 1;"
    )
    old.close()

    conn = connect(path)
    assert conn.execute("PRAGMA user_version").fetchone()[0] == JOBS_SCHEMA_VERSION == 2
    assert list_jobs(conn)[0].steps == []
    assert states(get_job(conn, enqueue(conn, kind="probe"))) == [("tick", "pending")]


def test_a_v3_database_is_still_refused(tmp_path):
    path = tmp_path / "j.sqlite"
    setup = sqlite3.connect(path)
    setup.execute("PRAGMA user_version = 3")
    setup.close()
    with pytest.raises(JobsSchemaError):
        connect(path)


def _v1_database(path, *, with_steps_column=False):
    old = sqlite3.connect(path)
    old.executescript(
        "CREATE TABLE jobs (id INTEGER PRIMARY KEY, song_id TEXT, kind TEXT, payload TEXT,"
        " state TEXT, cancel_requested INTEGER DEFAULT 0, progress REAL DEFAULT 0,"
        " device TEXT, lease_until REAL, created_at REAL, started_at REAL,"
        " finished_at REAL, error TEXT, result TEXT"
        + (", steps TEXT" if with_steps_column else "")
        + "); PRAGMA user_version = 1;"
    )
    old.close()


def test_connecting_twice_to_a_v1_database_is_idempotent(tmp_path):
    path = tmp_path / "j.sqlite"
    _v1_database(path)
    connect(path).close()
    conn = connect(path)
    assert conn.execute("PRAGMA user_version").fetchone()[0] == 2


def test_a_half_migrated_database_is_finished_not_refused(tmp_path):
    # The crash scenario: the column exists but user_version was never stamped.
    path = tmp_path / "j.sqlite"
    _v1_database(path, with_steps_column=True)
    conn = connect(path)
    assert conn.execute("PRAGMA user_version").fetchone()[0] == JOBS_SCHEMA_VERSION == 2
