from __future__ import annotations

from pathlib import Path

import pytest
from stemcraft_lib.config import SAMPLE_RATE
from stemcraft_lib.silence import (
    SilenceInterval,
    build_silencedetect_args,
    parse_silencedetect,
    propose_split_points,
)

# Real ffmpeg output. silencedetect writes to stderr, interleaved with whatever
# else ffmpeg has to say, and the two halves of an interval arrive on separate
# lines -- which is the entire reason this parser exists.
SAMPLE_STDERR = """\
[silencedetect @ 0x55f1] silence_start: 10.5
[silencedetect @ 0x55f1] silence_end: 13.5 | silence_duration: 3
[silencedetect @ 0x55f1] silence_start: 100.25
[silencedetect @ 0x55f1] silence_end: 102.25 | silence_duration: 2
"""


def test_argv_asks_for_silencedetect_and_decodes_nothing():
    args = build_silencedetect_args(
        Path("/tmp/audio.wav"), noise_db=-50.0, min_silence_seconds=1.5
    )
    assert args[0] == "ffmpeg"
    joined = " ".join(args)
    assert "silencedetect=noise=-50.0dB:d=1.5" in joined
    # -f null: the filter's report is the only output wanted. Writing an actual
    # file here would double the I/O of a 70-minute album for nothing.
    assert args[-1] == "-"
    assert "-f" in args and "null" in args


def test_parse_pairs_starts_with_ends_and_converts_to_samples():
    intervals = parse_silencedetect(SAMPLE_STDERR, total_samples=SAMPLE_RATE * 200)
    assert intervals == [
        SilenceInterval(int(10.5 * SAMPLE_RATE), int(13.5 * SAMPLE_RATE)),
        SilenceInterval(int(100.25 * SAMPLE_RATE), int(102.25 * SAMPLE_RATE)),
    ]


def test_a_trailing_silence_start_with_no_end_closes_at_the_album_end():
    # ffmpeg emits silence_start with no matching silence_end when the file
    # ends inside the silence. Dropping it would lose the run-out.
    total = SAMPLE_RATE * 200
    intervals = parse_silencedetect(
        "[silencedetect @ 0x1] silence_start: 190.0\n", total_samples=total
    )
    assert intervals == [SilenceInterval(int(190.0 * SAMPLE_RATE), total)]


def test_noise_in_the_log_is_ignored():
    stderr = (
        "Input #0, wav, from 'audio.wav':\n"
        "  Duration: 00:03:20.00, bitrate: 1536 kb/s\n"
        "[silencedetect @ 0x1] silence_start: 10.5\n"
        "[silencedetect @ 0x1] silence_end: 13.5 | silence_duration: 3\n"
        "size=N/A time=00:03:20.00 bitrate=N/A speed=250x\n"
    )
    assert len(parse_silencedetect(stderr, total_samples=SAMPLE_RATE * 200)) == 1


def test_empty_stderr_is_no_intervals_not_an_error():
    assert parse_silencedetect("", total_samples=SAMPLE_RATE * 200) == []


def test_a_proposal_is_the_midpoint_of_its_silence():
    # The midpoint, not the start: cutting at silence_start clips the previous
    # track's decay, cutting at silence_end drops the next one's attack.
    total = SAMPLE_RATE * 200
    intervals = [SilenceInterval(SAMPLE_RATE * 100, SAMPLE_RATE * 102)]
    assert propose_split_points(intervals, total_samples=total) == [SAMPLE_RATE * 101]


def test_leading_and_trailing_silence_are_not_boundaries():
    # A record that opens or closes with silence is not a record with a
    # zero-length first or last track.
    total = SAMPLE_RATE * 200
    intervals = [
        SilenceInterval(0, SAMPLE_RATE * 2),                    # lead-in
        SilenceInterval(SAMPLE_RATE * 100, SAMPLE_RATE * 102),  # a real boundary
        SilenceInterval(SAMPLE_RATE * 198, total),              # run-out
    ]
    assert propose_split_points(intervals, total_samples=total) == [SAMPLE_RATE * 101]


def test_proposals_come_back_strictly_increasing_and_unique():
    total = SAMPLE_RATE * 200
    intervals = [
        SilenceInterval(SAMPLE_RATE * 100, SAMPLE_RATE * 102),
        SilenceInterval(SAMPLE_RATE * 50, SAMPLE_RATE * 52),
    ]
    points = propose_split_points(intervals, total_samples=total)
    assert points == sorted(set(points))
    # Album.split_points validation depends on this, so it is asserted here too.
    assert all(b > a for a, b in zip(points, points[1:], strict=False))


def test_no_intervals_proposes_nothing():
    assert propose_split_points([], total_samples=SAMPLE_RATE * 200) == []


@pytest.mark.parametrize("bad", [0, -1])
def test_a_zero_length_album_proposes_nothing(bad):
    assert propose_split_points(
        [SilenceInterval(1, 2)], total_samples=bad
    ) == []
