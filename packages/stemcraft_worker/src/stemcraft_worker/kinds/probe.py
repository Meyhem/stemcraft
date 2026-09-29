"""A job that does nothing but be observable.

It exists so the queue, leases, progress, cancellation and the WebSocket can be
exercised end to end with no audio, no ffmpeg and no GPU — which is the whole
point of Phase 1.
"""

from __future__ import annotations

import time

from ..registry import JobCancelled, JobContext, register


def run(ctx: JobContext) -> dict:
    steps = int(ctx.payload.get("steps", 10))
    step_seconds = float(ctx.payload.get("step_seconds", 0.5))
    ctx.step("tick")
    for index in range(steps):
        if ctx.cancelled():
            raise JobCancelled
        time.sleep(step_seconds)
        ctx.progress((index + 1) / steps)
    return {"steps": steps}


register("probe", run)
