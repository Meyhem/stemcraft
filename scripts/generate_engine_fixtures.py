"""Generates dev-only fixtures for the Phase 3 engine harness. Not part of the
product; run once and the output is committed to frontend/src/dev/fixtures/.

Usage: uv run python scripts/generate_engine_fixtures.py
"""

import subprocess
from pathlib import Path

SAMPLE_RATE = 48_000
OUT_DIR = Path(__file__).parent.parent / "frontend" / "src" / "dev" / "fixtures"
BPM = 120
CLICK_DURATION_S = 16  # 8 bars at 120 BPM, 4/4

# Frequencies chosen so none divides evenly into CLICK_DURATION_S at BPM's period —
# a naive uncrossfaded loop at any of these produces an audible, unmistakable click.
STEM_FREQUENCIES = {"vocals": 437, "drums": 511, "bass": 663, "other": 829}


def run(*args: str) -> None:
    subprocess.run(["ffmpeg", "-y", *args], check=True, capture_output=True)


def generate_click_track() -> None:
    beat_period = 60 / BPM
    # A short gate pulse once per beat: 1 for 5 ms after each beat boundary, else 0.
    expr = f"if(lt(mod(t,{beat_period}),0.005),1,0)"
    run(
        "-f", "lavfi",
        "-i", f"aevalsrc='{expr}':s={SAMPLE_RATE}:d={CLICK_DURATION_S}",
        "-ac", "2",
        str(OUT_DIR / "click.wav"),
    )


def generate_stem_fixtures() -> None:
    for name, freq in STEM_FREQUENCIES.items():
        run(
            "-f", "lavfi",
            "-i", f"sine=frequency={freq}:sample_rate={SAMPLE_RATE}:duration={CLICK_DURATION_S}",
            "-ac", "2",
            str(OUT_DIR / f"stem-{name}.wav"),
        )


if __name__ == "__main__":
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    generate_click_track()
    generate_stem_fixtures()
    print(f"wrote fixtures to {OUT_DIR}")
