import numpy as np
from stemcraft_worker.analysis.bass.notes import SegmentParams, segment


def track(*runs):
    """runs of (frames, midi or None for silence) -> midi, periodicity, rms_db"""
    midi, per, rms = [], [], []
    for frames, m in runs:
        midi += [m if m is not None else 40.0] * frames
        per += [0.9 if m is not None else 0.1] * frames
        rms += [-20.0 if m is not None else -80.0] * frames
    return np.array(midi, float), np.array(per, float), np.array(rms, float)


def test_two_notes_separated_by_silence():
    notes = segment(*track((20, 33.0), (5, None), (30, 36.0)), onsets=[])
    assert [(n.start_frame, n.end_frame, n.midi) for n in notes] == [(0, 20, 33), (25, 55, 36)]


def test_a_pitch_jump_splits_a_legato_run():
    notes = segment(*track((20, 33.0), (20, 35.0)), onsets=[])
    assert [(n.start_frame, n.midi) for n in notes] == [(0, 33), (20, 35)]


def test_an_onset_splits_a_repeated_note():
    notes = segment(*track((40, 31.0)), onsets=[20])
    assert [(n.start_frame, n.end_frame, n.midi) for n in notes] == [(0, 20, 31), (20, 40, 31)]


def test_vibrato_inside_the_jump_threshold_stays_one_note():
    midi, per, rms = track((60, 31.0))
    midi = midi + 0.4 * np.sin(np.arange(60) / 3)
    notes = segment(midi, per, rms, onsets=[])
    assert len(notes) == 1 and notes[0].midi == 31


def test_a_one_frame_glitch_does_not_split():
    midi, per, rms = track((40, 31.0))
    midi[20] = 43.0  # an octave-ish blip shorter than jump_frames
    assert len(segment(midi, per, rms, onsets=[])) == 1


def test_a_short_fragment_merges_into_the_same_pitch_before_it():
    notes = segment(*track((30, 31.0)), onsets=[27])  # a 3-frame tail after an onset
    assert [(n.start_frame, n.end_frame) for n in notes] == [(0, 30)]


def test_a_short_isolated_blip_is_dropped():
    notes = segment(*track((10, None), (3, 40.0), (10, None)), onsets=[])
    assert notes == []


def test_quiet_frames_are_gated_even_when_periodic():
    midi, per, rms = track((30, 31.0))
    rms[:] = -60.0
    assert segment(midi, per, rms, onsets=[]) == []


def test_pitch_is_the_rounded_median_with_cents_and_mean_confidence():
    midi, per, rms = track((10, 31.2))
    per[:] = 0.8
    (n,) = segment(midi, per, rms, onsets=[], params=SegmentParams())
    assert n.midi == 31 and abs(n.cents - 20.0) < 1e-6 and abs(n.confidence - 0.8) < 1e-9


def test_an_onset_too_soon_after_the_attack_does_not_split_the_note():
    # Fortunate Son: one picked eighth (~220 ms) came back as a 60 ms + 160 ms pair,
    # because a second onset peak fired just after the attack.
    notes = segment(*track((22, 31.0)), onsets=[6])
    assert [(n.start_frame, n.end_frame) for n in notes] == [(0, 22)]


def test_a_fast_repeat_at_the_floor_still_splits():
    params = SegmentParams()
    notes = segment(*track((30, 31.0)), onsets=[params.min_repeat_frames])
    assert [n.start_frame for n in notes] == [0, params.min_repeat_frames]
