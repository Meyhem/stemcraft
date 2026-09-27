import time

import pytest
from stemcraft_lib.jobs import (
    claim_next,
    connect,
    enqueue,
    fail,
    finish,
    get_job,
    is_cancel_requested,
    reclaim_expired,
    renew,
    request_cancel,
    set_progress,
)


def test_claim_marks_running_and_stamps_lease_device_and_start(tmp_path):
    conn = connect(tmp_path / "j.sqlite")
    job_id = enqueue(conn, kind="probe")
    claimed = claim_next(conn, device="cpu", lease_seconds=30)
    assert claimed.id == job_id
    stored = get_job(conn, job_id)
    assert stored.state == "running"
    assert stored.device == "cpu"
    assert stored.started_at > 0
    assert stored.lease_until > time.time()


def test_claims_oldest_first(tmp_path):
    conn = connect(tmp_path / "j.sqlite")
    first = enqueue(conn, kind="probe")
    enqueue(conn, kind="probe")
    assert claim_next(conn, device="cpu").id == first


def test_only_one_job_runs_at_a_time(tmp_path):
    # C-07: strictly serial. One worker, one job.
    conn = connect(tmp_path / "j.sqlite")
    enqueue(conn, kind="probe")
    enqueue(conn, kind="probe")
    assert claim_next(conn, device="cpu") is not None
    assert claim_next(conn, device="cpu") is None


def test_claim_returns_none_on_empty_queue(tmp_path):
    assert claim_next(connect(tmp_path / "j.sqlite"), device="cpu") is None


def test_expired_lease_is_reclaimed_and_rerun_from_the_start(tmp_path):
    # §9 worker crash mid-job. Safe because every kind is idempotent by
    # re-derivation (§6), so re-running reproduces the same outputs.
    conn = connect(tmp_path / "j.sqlite")
    job_id = enqueue(conn, kind="probe")
    claim_next(conn, device="cpu", lease_seconds=-1)
    set_progress(conn, job_id, 0.6)

    assert reclaim_expired(conn) == [job_id]
    requeued = get_job(conn, job_id)
    assert requeued.state == "queued"
    assert requeued.progress == 0
    assert requeued.lease_until is None
    assert claim_next(conn, device="cpu").id == job_id


def test_live_lease_is_not_reclaimed(tmp_path):
    conn = connect(tmp_path / "j.sqlite")
    enqueue(conn, kind="probe")
    claim_next(conn, device="cpu", lease_seconds=60)
    assert reclaim_expired(conn) == []


def test_renew_extends_the_lease(tmp_path):
    conn = connect(tmp_path / "j.sqlite")
    job_id = enqueue(conn, kind="probe")
    claim_next(conn, device="cpu", lease_seconds=1)
    before = get_job(conn, job_id).lease_until
    renew(conn, job_id, lease_seconds=120)
    assert get_job(conn, job_id).lease_until > before


def test_cancelling_a_queued_job_is_immediate_and_it_never_runs(tmp_path):
    conn = connect(tmp_path / "j.sqlite")
    job_id = enqueue(conn, kind="probe")
    assert request_cancel(conn, job_id) == "cancelled"
    assert get_job(conn, job_id).finished_at > 0
    assert claim_next(conn, device="cpu") is None


def test_cancelling_a_running_job_only_sets_the_flag(tmp_path):
    conn = connect(tmp_path / "j.sqlite")
    job_id = enqueue(conn, kind="probe")
    claim_next(conn, device="cpu")
    assert request_cancel(conn, job_id) == "running"
    assert is_cancel_requested(conn, job_id) is True
    assert get_job(conn, job_id).state == "running"


def test_finish_and_fail_record_terminal_state(tmp_path):
    conn = connect(tmp_path / "j.sqlite")
    ok = enqueue(conn, kind="probe")
    claim_next(conn, device="cpu")
    finish(conn, ok, {"steps": 3})
    done = get_job(conn, ok)
    assert done.state == "done" and done.progress == 1.0 and done.result == {"steps": 3}
    assert done.finished_at > 0

    bad = enqueue(conn, kind="probe")
    claim_next(conn, device="cpu")
    fail(conn, bad, "Traceback...\nRuntimeError: boom")
    broken = get_job(conn, bad)
    assert broken.state == "failed"
    assert "RuntimeError: boom" in broken.error


def test_cancel_on_missing_job_raises_key_error_and_leaves_connection_clean(tmp_path):
    conn = connect(tmp_path / "j.sqlite")
    with pytest.raises(KeyError):
        request_cancel(conn, 9999)
    # No transaction left open by the failed rollback-then-rollback bug.
    assert not conn.in_transaction
    # The connection is still fully usable afterward.
    job_id = enqueue(conn, kind="probe")
    assert claim_next(conn, device="cpu").id == job_id


def test_stale_finish_after_reclaim_does_not_overwrite_the_row(tmp_path):
    # A worker whose lease expired gets requeued by reclaim_expired (simulated
    # here with a direct UPDATE). If that same worker is only slow rather than
    # actually dead, it may still call finish() afterward — that write must be
    # a silent no-op, not a stomp of whatever the row now says.
    conn = connect(tmp_path / "j.sqlite")
    job_id = enqueue(conn, kind="probe")
    claim_next(conn, device="gpu-a")
    conn.execute("UPDATE jobs SET state = 'queued' WHERE id = ?", (job_id,))

    finish(conn, job_id, {"steps": 1})

    unchanged = get_job(conn, job_id)
    assert unchanged.state == "queued"
    assert unchanged.result is None
    assert unchanged.finished_at is None
