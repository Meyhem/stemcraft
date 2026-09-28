import subprocess

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
