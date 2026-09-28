import subprocess

import numpy as np
import soundfile as sf

from stemcraft_worker.analysis.chords.recognize import _predictions_to_segments, recognize_frames

SAMPLE_RATE = 48000


def test_recognize_frames_covers_the_whole_file(tmp_path):
    wav = tmp_path / "chord.wav"
    # A sustained G minor triad for 6 seconds -- longer than BTC's one 10s chunk
    # boundary isn't required to exercise this, just enough real audio to get a
    # non-trivial, stable prediction.
    subprocess.run(
        ["ffmpeg", "-hide_banner", "-nostdin", "-y",
         "-f", "lavfi", "-i", "sine=frequency=196.00:duration=6",
         "-f", "lavfi", "-i", "sine=frequency=233.08:duration=6",
         "-f", "lavfi", "-i", "sine=frequency=293.66:duration=6",
         "-filter_complex", "amix=inputs=3:duration=longest",
         "-ar", str(SAMPLE_RATE), "-ac", "1", str(wav)],
        check=True, capture_output=True,
    )

    segments = recognize_frames(wav)

    assert len(segments) >= 1
    starts = [s for s, _, _ in segments]
    ends = [e for _, e, _ in segments]
    assert starts[0] == 0.0
    assert ends == sorted(ends)
    assert all(isinstance(label, str) and label for _, _, label in segments)
    # Contiguous: each segment's end is the next one's start.
    for (_, end, _), (next_start, _, _) in zip(segments, segments[1:]):
        assert abs(end - next_start) < 1e-6


_NOTE_TO_SEMITONE = {
    "C": 0, "C#": 1, "D": 2, "D#": 3, "E": 4, "F": 5,
    "F#": 6, "G": 7, "G#": 8, "A": 9, "A#": 10, "B": 11,
}


def _note_freq(name: str) -> float:
    pitch, octave = name[:-1], int(name[-1])
    midi = (octave + 1) * 12 + _NOTE_TO_SEMITONE[pitch]
    return 440.0 * 2 ** ((midi - 69) / 12)


def _sawtooth_note(freq: float, n_samples: int, sr: int, n_harmonics: int = 8) -> np.ndarray:
    # A pure sine has no harmonics, and BTC's CQT+chroma-style front end reads
    # harmonic content, not fundamental pitch alone -- the covers-the-whole-file
    # test above uses pure sines for exactly that reason (it doesn't care what
    # label comes out, just that the plumbing produces *some* well-formed
    # segments). A bare sum of harmonics 1/k, k=1..8, at each note's fundamental
    # approximates a sawtooth/instrument-like spectrum, which is enough to move
    # BTC off the degenerate "N" (no-chord) prediction pure tones collapse to.
    t = np.arange(n_samples) / sr
    return sum((1.0 / k) * np.sin(2 * np.pi * freq * k * t) for k in range(1, n_harmonics + 1))


def _chord_signal(notes: list[str], n_samples: int, sr: int) -> np.ndarray:
    sig = sum(_sawtooth_note(_note_freq(n), n_samples, sr) for n in notes)
    return sig / len(notes)


def _make_chord_progression_wav(path, sr: int) -> None:
    # G minor -> C major -> D major, harmonically-rich synthetic triads.
    # Total duration is 9.9s, chosen (originally) so the real audio fills 107
    # of BTC's 108-frame window, leaving only one padding frame -- a
    # defensive sizing that avoided a since-fixed bug where a chord
    # "transition" predicted inside a large zero-padded tail could emit a
    # segment whose start exceeded its end (see the fix-round-1 entry in
    # task-5-report.md). recognize.py's `_predictions_to_segments` now bounds
    # itself by the real frame count directly (fix round 2), so this sizing
    # is no longer load-bearing for correctness -- kept as-is anyway since it
    # doesn't need to change, and the dedicated boundary regression test
    # below now covers the many-padding-frames case explicitly.
    progression = [
        ["G3", "A#3", "D4"],  # G minor
        ["C4", "E4", "G4"],  # C major
        ["D4", "F#4", "A4"],  # D major
    ]
    total_samples = int(sr * 9.9)
    each = total_samples // len(progression)
    chunks = []
    used = 0
    for i, notes in enumerate(progression):
        n = each if i < len(progression) - 1 else total_samples - used
        chunks.append(_chord_signal(notes, n, sr))
        used += n
    audio = np.concatenate(chunks)
    audio = audio / np.max(np.abs(audio)) * 0.8
    sf.write(str(path), audio.astype(np.float32), sr)


def test_recognize_frames_golden_chord_progression(tmp_path):
    """Characterization (golden) test: pins the exact chord-label sequence the
    real BTC-large-voca checkpoint produces on a fixed synthetic fixture.

    Why this exists in addition to the structural test above: that test only
    checks shape (segments cover the file, are contiguous, labels are
    non-empty strings) -- properties a subtly broken model satisfies just as
    well as a correct one. Empirically, skipping feature normalization
    entirely, or normalizing with mean-only (dropping the std term), both
    reproduce the same all-"N" output as the correct, fully-normalized path
    on a pure-tone fixture -- a normalization bug is invisible to a
    structural-only test. This test instead pins actual model output, so it
    breaks on any change to the vendored architecture, the checkpoint, or the
    normalization/feature pipeline.

    Deliberately NOT a "some label is non-'N'" assertion: a randomly
    initialized model of the same architecture (untrained, wrong weights)
    also produces non-"N" labels on this kind of input, so that property
    doesn't discriminate correct from broken. Pinning the exact label
    sequence does, because it's tied to this specific checkpoint's actual
    behavior.

    Verified stable: this fixture's `recognize_frames` output was
    byte-identical across 5 separate process runs before this assertion was
    written.

    To regenerate this golden value (only if the pinned checkpoint is
    intentionally replaced -- see weights.py's `_CHECKPOINT_URL`): call
    `recognize_frames` on the fixture `_make_chord_progression_wav` builds
    and print the resulting labels; do not hand-edit them.
    """
    wav = tmp_path / "progression.wav"
    _make_chord_progression_wav(wav, SAMPLE_RATE)

    segments = recognize_frames(wav)

    labels = [label for _, _, label in segments]
    assert labels == ["G:min", "C", "D"]


def test_predictions_to_segments_ignores_padded_tail_transitions():
    """Regression test for fix round 2: a chord "transition" predicted
    inside BTC's zero-padded tail must never produce a malformed segment
    (start > end), an out-of-range segment (beyond the real audio), or a
    silently-dropped final chord.

    Drives `_predictions_to_segments` directly with a synthetic predictions
    array rather than a real audio fixture: this reproduces the coordinator's
    independently-verified repro exactly (173 real frames, num_pad=43,
    num_instance=2, so num_instance * n_timestep = 216 total predicted
    frames with a transition landing at global index 200, inside the
    padding) deterministically and fast, without depending on what a real
    model happens to predict on any particular fixture.
    """
    n_timestep = 108
    total_frames = 173  # real frames; num_pad = 2 * 108 - 173 = 43
    num_instance = 2
    total_predicted = num_instance * n_timestep  # 216

    # Chord index 5 ("C:maj6") for every real frame, then a "transition" to
    # chord index 9 at global index 200 -- inside the padded tail (>=
    # total_frames=173), exactly reproducing the coordinator's repro.
    predictions = [5] * total_predicted
    predictions[200] = 9
    feature_per_second = 10.0 / n_timestep

    segments = _predictions_to_segments(predictions, total_frames, feature_per_second)

    # The bogus mid-padding transition must not surface as its own segment,
    # and the real chord (index 5) must not silently disappear: exactly one
    # segment, covering the whole real file, labeled with the real chord.
    assert len(segments) == 1
    start, end, label = segments[0]
    assert start == 0.0
    assert end == feature_per_second * total_frames
    assert label == "C:maj6"
    # No segment ever extends past the real audio, and none is inverted or
    # zero/negative-length.
    real_duration = total_frames * feature_per_second
    assert all(s < e for s, e, _ in segments)
    assert all(s <= real_duration and e <= real_duration for s, e, _ in segments)


def test_predictions_to_segments_handles_transition_at_the_exact_boundary():
    """Boundary convention check: a genuine transition at the very last real
    frame (global_i == total_frames - 1) must still be treated as real
    content and produce two segments, not be truncated away as if it were
    padding."""
    n_timestep = 108
    total_frames = 10
    feature_per_second = 10.0 / n_timestep

    # Real chord index 0 ("C:min") for frames [0, 9), chord index 1 ("C",
    # i.e. C major) only at the very last real frame (index 9 ==
    # total_frames - 1), then padding (index >= 10, never attended to,
    # filled with a third chord that must not appear in the output at all).
    predictions = [0] * 9 + [1] + [2] * (n_timestep - 10)

    segments = _predictions_to_segments(predictions, total_frames, feature_per_second)

    assert len(segments) == 2
    assert segments[0] == (0.0, feature_per_second * 9, "C:min")
    assert segments[1][0] == feature_per_second * 9
    assert segments[1][1] == feature_per_second * total_frames
    assert segments[1][2] == "C"
