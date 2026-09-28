import subprocess

import numpy as np
import soundfile as sf

from stemcraft_worker.analysis.chords.recognize import recognize_frames

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
    # Total duration is 9.9s, not a round number: BTC processes audio through
    # a fixed 108-frame window and zero-pads the tail to fill it (see
    # recognize.py's `num_pad` line). At this duration the real audio fills
    # 107 of those 108 frames, leaving only one padding frame -- picked
    # deliberately small. A duration that leaves many zero-padded frames (as
    # the plain 6s fixture above does, incidentally) lets BTC's own tail
    # clamp in recognize.py produce a segment whose start exceeds its end,
    # because a chord "transition" predicted inside the synthetic zero
    # padding is not bounded by the real-audio frame count until after the
    # loop. That's a real latent edge case in recognize.py's trailing-segment
    # logic, not something this test works around by design -- this fixture
    # sidesteps it by keeping the padding to a single frame, so it doesn't
    # accidentally pin a corrupted golden value. See the fix-round-1 entry in
    # task-5-report.md for the full writeup.
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
