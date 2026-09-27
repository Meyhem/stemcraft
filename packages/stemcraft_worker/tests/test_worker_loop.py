import pytest
from stemcraft_lib.jobs import connect, enqueue, get_job, request_cancel
from stemcraft_worker.main import run_one
from stemcraft_worker.registry import JobCancelled, JobContext, register


@pytest.fixture
def conn(tmp_path):
    return connect(tmp_path / "jobs.sqlite")


def test_runs_a_job_and_records_its_result(conn):
    register("t_ok", lambda ctx: {"doubled": ctx.payload["n"] * 2})
    job_id = enqueue(conn, kind="t_ok", payload={"n": 21})

    assert run_one(conn, device="cpu") == job_id
    done = get_job(conn, job_id)
    assert done.state == "done"
    assert done.result == {"doubled": 42}
    assert done.progress == 1.0


def test_empty_queue_returns_none(conn):
    assert run_one(conn, device="cpu") is None


def test_progress_reaches_the_row_while_running(conn):
    seen = []

    def kind(ctx: JobContext) -> None:
        ctx.progress(0.5)
        seen.append(get_job(ctx.conn, ctx.job_id).progress)

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

    register("t_cancel", kind)
    job_id = enqueue(conn, kind="t_cancel")
    run_one(conn, device="cpu")
    cancelled = get_job(conn, job_id)
    assert cancelled.state == "cancelled"
    assert cancelled.error is None


def test_exception_fails_the_job_with_the_real_traceback(conn):
    def kind(ctx: JobContext) -> None:
        raise RuntimeError("boom")

    register("t_boom", kind)
    job_id = enqueue(conn, kind="t_boom")
    run_one(conn, device="cpu")
    failed = get_job(conn, job_id)
    assert failed.state == "failed"
    assert "RuntimeError: boom" in failed.error
    assert "Traceback" in failed.error


def test_unknown_kind_fails_loudly_instead_of_being_skipped(conn):
    job_id = enqueue(conn, kind="t_does_not_exist")
    run_one(conn, device="cpu")
    failed = get_job(conn, job_id)
    assert failed.state == "failed"
    assert "t_does_not_exist" in failed.error


def test_probe_kind_completes_and_reports_its_steps(conn):
    import stemcraft_worker.kinds.probe  # noqa: F401  (registers on import)

    job_id = enqueue(conn, kind="probe", payload={"steps": 3, "step_seconds": 0.01})
    run_one(conn, device="cpu")
    assert get_job(conn, job_id).result == {"steps": 3}
