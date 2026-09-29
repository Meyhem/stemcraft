import time

import pytest
from stemcraft_lib import job_steps
from stemcraft_lib import jobs as jobs_db
from stemcraft_lib.jobs import connect, enqueue, get_job, request_cancel
from stemcraft_worker.main import run_one
from stemcraft_worker.registry import JobCancelled, JobContext, register


@pytest.fixture
def conn(tmp_path):
    return connect(tmp_path / "jobs.sqlite")


def test_runs_a_job_and_records_its_result(conn):
    seen_worker_state = []
    job_steps.declare("t_ok", [])
    register(
        "t_ok",
        lambda ctx: seen_worker_state.append(ctx.worker_state) or {"doubled": ctx.payload["n"] * 2},
    )
    job_id = enqueue(conn, kind="t_ok", payload={"n": 21})

    assert run_one(conn, device="cpu") == job_id
    done = get_job(conn, job_id)
    assert done.state == "done"
    assert done.result == {"doubled": 42}
    assert done.progress == 1.0
    assert seen_worker_state == [None]


def test_empty_queue_returns_none(conn):
    assert run_one(conn, device="cpu") is None


def test_progress_reaches_the_row_while_running(conn):
    seen = []

    def kind(ctx: JobContext) -> None:
        ctx.progress(0.5)
        seen.append(get_job(ctx.conn, ctx.job_id).progress)

    job_steps.declare("t_progress", [])

    register("t_progress", kind)
    enqueue(conn, kind="t_progress")
    run_one(conn, device="cpu")
    assert seen == [0.5]


def test_cancel_requested_mid_run_lands_as_cancelled(conn):
    def kind(ctx: JobContext) -> None:
        request_cancel(ctx.conn, ctx.job_id)
        if ctx.cancelled():
            raise JobCancelled
        raise AssertionError("cancel flag was not visible to the job")

    job_steps.declare("t_cancel", [])

    register("t_cancel", kind)
    job_id = enqueue(conn, kind="t_cancel")
    run_one(conn, device="cpu")
    cancelled = get_job(conn, job_id)
    assert cancelled.state == "cancelled"
    assert cancelled.error is None


def test_exception_fails_the_job_with_the_real_traceback(conn):
    def kind(ctx: JobContext) -> None:
        raise RuntimeError("boom")

    job_steps.declare("t_boom", [])

    register("t_boom", kind)
    job_id = enqueue(conn, kind="t_boom")
    run_one(conn, device="cpu")
    failed = get_job(conn, job_id)
    assert failed.state == "failed"
    assert "RuntimeError: boom" in failed.error
    assert "Traceback" in failed.error


def test_unknown_kind_fails_loudly_instead_of_being_skipped(conn):
    job_steps.declare("t_does_not_exist", [])
    job_id = enqueue(conn, kind="t_does_not_exist")
    run_one(conn, device="cpu")
    failed = get_job(conn, job_id)
    assert failed.state == "failed"
    assert "t_does_not_exist" in failed.error


def test_renewal_thread_actually_renews_the_conns_own_database(conn, monkeypatch):
    # _renew_until's loop reads jobs_db.LEASE_SECONDS by attribute each
    # iteration (`stop.wait(jobs_db.LEASE_SECONDS / 3)`), so patching the
    # module attribute shrinks the renewal interval to ~0.1s without waiting
    # on the real ~10s default. The job body sleeps 0.5s, giving ~4-5 real
    # renewal ticks a chance to fire before it finishes.
    monkeypatch.setattr(jobs_db, "LEASE_SECONDS", 0.3)
    seen: dict[str, float | None] = {}

    def kind(ctx: JobContext) -> None:
        # Read through ctx.conn -- the SAME connection/file run_one was given.
        # If the renewal thread wrote to a different database (the bug this
        # test guards against), lease_until would never move here.
        seen["before"] = get_job(ctx.conn, ctx.job_id).lease_until
        time.sleep(0.5)
        seen["after"] = get_job(ctx.conn, ctx.job_id).lease_until

    job_steps.declare("t_renew", [])

    register("t_renew", kind)
    job_id = enqueue(conn, kind="t_renew")
    run_one(conn, device="cpu")

    done = get_job(conn, job_id)
    assert done.state == "done"
    assert seen["before"] is not None
    assert seen["after"] is not None
    assert seen["after"] > seen["before"]


def test_probe_kind_completes_and_reports_its_steps(conn):
    import stemcraft_worker.kinds.probe  # noqa: F401  (registers on import)

    job_id = enqueue(conn, kind="probe", payload={"steps": 3, "step_seconds": 0.01})
    run_one(conn, device="cpu")
    assert get_job(conn, job_id).result == {"steps": 3}


def test_reclaimed_lease_is_logged_at_restart(conn, caplog):
    # §9: a worker that died holding a lease leaves the job 'running' with a
    # lease_until in the past. Simulate that directly, exactly like
    # packages/stemcraft_lib/tests/test_jobs_lease.py's own reclaim test does,
    # by claiming with a negative lease_seconds instead of actually crashing
    # a process. The restarted worker's first run_one() call must both
    # requeue it AND log that it did, so an operator has something to grep
    # for (this is the log line Task 14's review found missing).
    job_steps.declare("t_reclaim_log", [])
    register("t_reclaim_log", lambda ctx: {"ok": True})
    job_id = enqueue(conn, kind="t_reclaim_log")
    jobs_db.claim_next(conn, device="cpu", lease_seconds=-1)

    with caplog.at_level("INFO", logger="stemcraft.worker"):
        run_one(conn, device="cpu")

    assert f"reclaimed expired lease(s) for job(s): [{job_id}]" in caplog.text


def test_no_reclaim_log_when_nothing_is_expired(conn, caplog):
    job_steps.declare("t_no_reclaim_log", [])
    register("t_no_reclaim_log", lambda ctx: {"ok": True})
    enqueue(conn, kind="t_no_reclaim_log")

    with caplog.at_level("INFO", logger="stemcraft.worker"):
        run_one(conn, device="cpu")

    assert "reclaimed expired lease" not in caplog.text


def _states(job):
    return [(s["id"], s["state"]) for s in job.steps]


def test_steps_advance_live_and_close_when_the_kind_returns(conn):
    seen = []
    job_steps.declare("t_steps", [("one", "One", 1.0), ("two", "Two", 1.0)])

    def kind(ctx: JobContext) -> None:
        ctx.step("one")
        ctx.progress(0.5)
        row = get_job(ctx.conn, ctx.job_id)
        seen.append((_states(row), row.progress))
        ctx.step("two", detail="half way")

    register("t_steps", kind)
    job_id = enqueue(conn, kind="t_steps")
    run_one(conn, device="cpu")

    assert seen == [([("one", "running"), ("two", "pending")], 0.25)]
    done = get_job(conn, job_id)
    assert done.state == "done"
    assert _states(done) == [("one", "done"), ("two", "done")]


def test_a_kind_that_forgets_a_step_fails_naming_it(conn):
    job_steps.declare("t_forgot", [("one", "One", 1.0), ("two", "Two", 1.0)])
    register("t_forgot", lambda ctx: ctx.step("one"))
    job_id = enqueue(conn, kind="t_forgot")
    run_one(conn, device="cpu")
    failed = get_job(conn, job_id)
    assert failed.state == "failed"
    assert "never ran: two" in failed.error


def test_an_exception_marks_the_step_it_happened_in(conn):
    job_steps.declare("t_step_boom", [("one", "One", 1.0), ("two", "Two", 1.0)])

    def kind(ctx: JobContext) -> None:
        ctx.step("one")
        ctx.step("two")
        raise RuntimeError("boom in two")

    register("t_step_boom", kind)
    job_id = enqueue(conn, kind="t_step_boom")
    run_one(conn, device="cpu")
    assert _states(get_job(conn, job_id)) == [("one", "done"), ("two", "failed")]


def test_a_cancel_marks_the_step_it_stopped_in(conn):
    job_steps.declare("t_step_cancel", [("one", "One", 1.0)])

    def kind(ctx: JobContext) -> None:
        ctx.step("one")
        ctx.detail("3 of 9")
        raise JobCancelled

    register("t_step_cancel", kind)
    job_id = enqueue(conn, kind="t_step_cancel")
    run_one(conn, device="cpu")
    job = get_job(conn, job_id)
    assert job.state == "cancelled"
    assert _states(job) == [("one", "cancelled")] and job.steps[0]["detail"] == "3 of 9"


def test_probe_reports_its_tick_step(conn):
    import stemcraft_worker.kinds.probe  # noqa: F401

    job_id = enqueue(conn, kind="probe", payload={"steps": 2, "step_seconds": 0.01})
    run_one(conn, device="cpu")
    assert _states(get_job(conn, job_id)) == [("tick", "done")]
