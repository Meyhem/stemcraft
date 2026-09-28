import subprocess

import pytest
from stemcraft_worker.analysis.beats import InsufficientBeats, detect_beats

SAMPLE_RATE = 48000
# beat_this's smallest published checkpoint (~8 MB vs. final0's ~78 MB) -- plenty
# accurate for these synthetic fixtures and far cheaper to download once in CI/dev.
_TEST_CHECKPOINT = "small0"


def _click_track(path, *, bpm=120, seconds=16, sample_rate=SAMPLE_RATE):
    interval = 60.0 / bpm
    # Click width: empirically, beat_this's small0 checkpoint (dbn=False,
    # "minimal" postprocessing, threshold at prob > 0.5) does not confidently
    # detect a 30ms click at this frequency/amplitude -- framewise beat
    # probabilities peak around 0.28, below the postprocessor's threshold,
    # yielding zero beats. A 20ms click (sharper transient, same tone and
    # amplitude) is detected with high confidence (probabilities > 0.99).
    # final0 (the production default) has no trouble with either width; this
    # only affects the small0 checkpoint these tests deliberately use for
    # speed. Verified via beat_this.inference.Audio2Frames directly.
    subprocess.run(
        ["ffmpeg", "-hide_banner", "-nostdin", "-y", "-f", "lavfi",
         "-i", f"aevalsrc=0.6*sin(2*PI*1000*t)*lt(mod(t\\,{interval})\\,0.02):d={seconds}",
         "-ar", str(sample_rate), "-ac", "1", str(path)],
        check=True, capture_output=True,
    )


def test_click_track_bpm_detected_within_tolerance(tmp_path):
    wav = tmp_path / "click.wav"
    _click_track(wav, bpm=120)

    grid = detect_beats(wav, checkpoint_path=_TEST_CHECKPOINT)

    assert abs(grid.bpm - 120.0) < 2.0
    assert len(grid.beats) >= 10
    assert grid.beats == sorted(grid.beats)


def test_beats_are_48khz_sample_indices_not_seconds(tmp_path):
    wav = tmp_path / "click.wav"
    _click_track(wav, bpm=120, seconds=8)

    grid = detect_beats(wav, checkpoint_path=_TEST_CHECKPOINT)

    # A 120 BPM beat every 0.5s is 24000 samples at 48kHz -- values in the
    # thousands, not in the single digits a seconds-denominated list would be.
    assert all(b > 1000 for b in grid.beats[1:])


def test_downbeats_are_a_subset_of_beats(tmp_path):
    # stemcraft_lib.analysis documents downbeats as a subset of beats.
    # beat_this returns beats and downbeats as two independently-rounded
    # float arrays, so without snapping, a downbeat can land a sample or two
    # off its matching beat -- this asserts detect_beats enforces the
    # invariant by construction.
    wav = tmp_path / "click.wav"
    _click_track(wav, bpm=120)

    grid = detect_beats(wav, checkpoint_path=_TEST_CHECKPOINT)

    assert set(grid.downbeats) <= set(grid.beats)


def test_silence_raises_insufficient_beats(tmp_path):
    silence = tmp_path / "silence.wav"
    subprocess.run(
        ["ffmpeg", "-hide_banner", "-nostdin", "-y", "-f", "lavfi",
         "-i", f"anullsrc=r={SAMPLE_RATE}:cl=mono", "-t", "3", str(silence)],
        check=True, capture_output=True,
    )
    with pytest.raises(InsufficientBeats):
        detect_beats(silence, checkpoint_path=_TEST_CHECKPOINT)
