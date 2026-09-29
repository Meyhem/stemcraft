import stemcraft_worker.kinds  # noqa: F401  (registers every built-in kind)
from stemcraft_lib import job_steps
from stemcraft_worker.registry import KINDS


def test_every_registered_kind_declares_at_least_one_step():
    # D-17: a kind the UI cannot draw steps for is a bug, not a quiet default.
    builtin = {k for k in KINDS if not k.startswith("t_")}
    decls = job_steps.all_declarations()
    missing = sorted(k for k in builtin if not decls.get(k))
    assert missing == []
