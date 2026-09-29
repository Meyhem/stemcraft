from stemcraft_lib.jobs import (
    JobStats,
    KindDuration,
    claim_next,
    connect,
    enqueue,
    fail,
    finish,
    job_stats,
    request_cancel,
)


def _run(conn, kind, device, seconds, *, ok=True):
    """Enqueue, claim and finish one job, then pin its timestamps so the duration is exact."""
    job_id = enqueue(conn, kind=kind)
    claim_next(conn, device=device)
    (finish if ok else lambda c, i: fail(c, i, "boom"))(conn, job_id)
    conn.execute(
        "UPDATE jobs SET started_at = 100.0, finished_at = ? WHERE id = ?",
        (100.0 + seconds, job_id),
    )
    return job_id


def test_empty_database_has_zero_counts_and_no_durations(tmp_path):
    assert job_stats(connect(tmp_path / "j.sqlite")) == JobStats(passed=0, failed=0, durations=[])


def test_counts_done_as_passed_and_failed_as_failed_but_not_cancelled_or_live(tmp_path):
    conn = connect(tmp_path / "j.sqlite")
    _run(conn, "probe", "cpu", 1)
    _run(conn, "probe", "cpu", 1)
    _run(conn, "probe", "cpu", 1, ok=False)
    request_cancel(conn, enqueue(conn, kind="probe"))  # queued -> cancelled
    enqueue(conn, kind="probe")  # still queued
    stats = job_stats(conn)
    assert (stats.passed, stats.failed) == (2, 1)


def test_average_is_per_kind_and_device_over_done_jobs_only(tmp_path):
    conn = connect(tmp_path / "j.sqlite")
    _run(conn, "separate", "cuda", 20)
    _run(conn, "separate", "cuda", 30)
    _run(conn, "separate", "cpu", 180)
    _run(conn, "separate", "cuda", 999, ok=False)  # a crash's duration must not count
    _run(conn, "analyze", "cpu", 3)
    assert job_stats(conn).durations == [
        KindDuration(kind="analyze", device="cpu", count=1, avg_seconds=3.0),
        KindDuration(kind="separate", device="cpu", count=1, avg_seconds=180.0),
        KindDuration(kind="separate", device="cuda", count=2, avg_seconds=25.0),
    ]


def test_a_done_job_with_no_device_is_its_own_group_not_cpu(tmp_path):
    conn = connect(tmp_path / "j.sqlite")
    job_id = _run(conn, "probe", "cpu", 4)
    conn.execute("UPDATE jobs SET device = NULL WHERE id = ?", (job_id,))
    _run(conn, "probe", "cpu", 2)
    assert job_stats(conn).durations == [
        KindDuration(kind="probe", device=None, count=1, avg_seconds=4.0),
        KindDuration(kind="probe", device="cpu", count=1, avg_seconds=2.0),
    ]


def test_rows_missing_a_timestamp_are_left_out_of_the_average(tmp_path):
    conn = connect(tmp_path / "j.sqlite")
    job_id = _run(conn, "probe", "cpu", 4)
    conn.execute("UPDATE jobs SET started_at = NULL WHERE id = ?", (job_id,))
    stats = job_stats(conn)
    assert stats.passed == 1
    assert stats.durations == []
