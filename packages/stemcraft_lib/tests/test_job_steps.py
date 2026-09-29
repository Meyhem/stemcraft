import pytest
from stemcraft_lib import job_steps
from stemcraft_lib.job_steps import StepError, UnknownJobKind


def states(steps):
    return [(s["id"], s["state"]) for s in steps]


@pytest.fixture
def three():
    job_steps.declare("t_three", [("a", "A", 0.5), ("b", "B", 0.25), ("c", "C", 0.25)])
    return job_steps.seed("t_three")


def test_seed_writes_every_declared_step_pending(three):
    assert states(three) == [("a", "pending"), ("b", "pending"), ("c", "pending")]
    assert three[0] == {
        "id": "a", "label": "A", "weight": 0.5, "state": "pending", "progress": 0.0,
        "detail": None, "started_at": None, "finished_at": None,
    }


def test_seed_refuses_an_undeclared_kind():
    with pytest.raises(UnknownJobKind, match="t_nobody_declared_this"):
        job_steps.seed("t_nobody_declared_this")


def test_every_built_in_kind_is_declared_with_at_least_one_step():
    for kind in ("import", "separate", "analyze", "export", "import_album", "split_album", "probe"):
        assert job_steps.seed(kind), kind


def test_duplicate_step_ids_are_refused():
    with pytest.raises(ValueError, match="duplicate"):
        job_steps.declare("t_dup", [("a", "A", 1.0), ("a", "A again", 1.0)])


def test_advance_closes_the_running_step_and_opens_the_next(three):
    s = job_steps.advance(three, "a", now=10.0)
    s = job_steps.advance(s, "b", detail="1 of 2", now=12.5)
    assert states(s) == [("a", "done"), ("b", "running"), ("c", "pending")]
    assert s[0]["finished_at"] == 12.5 and s[0]["progress"] == 1.0
    assert s[1]["started_at"] == 12.5 and s[1]["detail"] == "1 of 2"


def test_advance_does_not_mutate_its_input(three):
    job_steps.advance(three, "a")
    assert states(three)[0] == ("a", "pending")


def test_advancing_past_a_pending_step_is_an_error(three):
    with pytest.raises(StepError, match="'a' is still pending"):
        job_steps.advance(three, "b")


def test_going_backwards_is_an_error(three):
    s = job_steps.advance(job_steps.advance(three, "a"), "b")
    with pytest.raises(StepError, match="not pending"):
        job_steps.advance(s, "a")


def test_an_unknown_step_id_is_an_error(three):
    with pytest.raises(StepError, match="no step 'z'"):
        job_steps.advance(three, "z")


def test_skip_records_the_reason_and_lets_the_next_step_start(three):
    s = job_steps.skip(three, "a", "uploaded file", now=3.0)
    s = job_steps.advance(s, "b")
    assert states(s)[:2] == [("a", "skipped"), ("b", "running")]
    assert s[0]["detail"] == "uploaded file" and s[0]["finished_at"] == 3.0


def test_progress_and_detail_apply_to_the_running_step(three):
    s = job_steps.set_progress(job_steps.advance(three, "a"), 0.4)
    s = job_steps.set_detail(s, "segment 3 of 7")
    assert s[0]["progress"] == 0.4 and s[0]["detail"] == "segment 3 of 7"


def test_progress_is_clamped(three):
    s = job_steps.advance(three, "a")
    assert job_steps.set_progress(s, 7)[0]["progress"] == 1.0
    assert job_steps.set_progress(s, -1)[0]["progress"] == 0.0


def test_progress_with_nothing_running_is_an_error(three):
    with pytest.raises(StepError, match="no step is running"):
        job_steps.set_progress(three, 0.5)


def test_overall_is_the_weighted_mean(three):
    s = job_steps.set_progress(job_steps.advance(three, "a"), 0.5)
    assert job_steps.overall(s) == pytest.approx(0.25)
    s = job_steps.set_progress(job_steps.advance(s, "b"), 0.5)
    assert job_steps.overall(s) == pytest.approx(0.625)


def test_skipped_steps_leave_the_denominator(three):
    s = job_steps.skip(three, "a", "not needed")
    s = job_steps.set_progress(job_steps.advance(s, "b"), 1.0)
    assert job_steps.overall(s) == pytest.approx(0.5)


def test_overall_of_no_steps_is_none():
    assert job_steps.overall([]) is None


def test_complete_closes_the_running_step(three):
    s = job_steps.advance(job_steps.advance(job_steps.advance(three, "a"), "b"), "c")
    assert states(job_steps.complete(s)) == [("a", "done"), ("b", "done"), ("c", "done")]


def test_complete_with_a_step_still_pending_is_an_error(three):
    with pytest.raises(StepError, match="never ran: c"):
        job_steps.complete(job_steps.advance(job_steps.advance(three, "a"), "b"))


def test_fail_marks_the_running_step(three):
    s = job_steps.fail_running(job_steps.advance(three, "a"), now=9.0)
    assert states(s)[0] == ("a", "failed") and s[0]["finished_at"] == 9.0


def test_fail_before_any_step_ran_lands_on_the_first_pending_step(three):
    # A kind that fails its own preconditions (no song dir, bad payload) fails
    # before its first ctx.step(). The error still needs a step to sit under.
    failed = job_steps.fail_running(three)
    assert states(failed)[0] == ("a", "failed")
    assert failed[0]["detail"] == "failed before this step started"


def test_cancel_marks_the_running_step_and_keeps_its_detail(three):
    s = job_steps.set_detail(job_steps.advance(three, "a"), "4 of 11 rendered")
    s = job_steps.cancel_running(s)
    assert states(s)[0] == ("a", "cancelled") and s[0]["detail"] == "4 of 11 rendered"


def test_cancel_with_nothing_running_changes_nothing(three):
    assert job_steps.cancel_running(three) == three


def test_reset_returns_every_step_to_pending(three):
    s = job_steps.fail_running(job_steps.skip(three, "a", "x"))
    assert job_steps.reset(s) == job_steps.seed("t_three")


def test_all_declarations_lists_ids_labels_and_weights():
    decls = job_steps.all_declarations()
    assert decls["import"] == [
        {"id": "download", "label": "Download", "weight": 0.3},
        {"id": "decode", "label": "Decode to 48 kHz", "weight": 0.6},
        {"id": "peaks", "label": "Waveform peaks", "weight": 0.1},
    ]
