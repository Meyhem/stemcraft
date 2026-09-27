import math
import wave
from array import array

from stemcraft_worker.peaks import compute_peaks


def _write_wav(path, samples_by_channel, *, sample_rate=48000):
    channels = len(samples_by_channel)
    n_frames = len(samples_by_channel[0])
    interleaved = array("h", [0]) * (n_frames * channels)
    for ch, values in enumerate(samples_by_channel):
        interleaved[ch::channels] = array("h", values)
    with wave.open(str(path), "wb") as wav:
        wav.setnchannels(channels)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        wav.writeframes(interleaved.tobytes())


def test_reports_sample_rate_length_and_channels_verbatim(tmp_path):
    path = tmp_path / "audio.wav"
    _write_wav(path, [[0] * 4800, [0] * 4800], sample_rate=48000)

    peaks = compute_peaks(path)

    assert peaks["sample_rate"] == 48000
    assert peaks["length"] == 4800
    assert peaks["channels"] == 2
    assert peaks["version"] == 1


def test_full_scale_square_wave_hits_plus_minus_one(tmp_path):
    path = tmp_path / "audio.wav"
    # One bucket's worth of a full-scale square wave on one channel, silence
    # on the other.
    square = [32767, -32768] * 240  # 480 frames == one bucket at 48k/100
    _write_wav(path, [square, [0] * 480], sample_rate=48000)

    peaks = compute_peaks(path, buckets_per_second=100)

    left_min, left_max = peaks["peaks"][0][0], peaks["peaks"][0][1]
    assert left_min == -1.0
    assert math.isclose(left_max, 1.0, abs_tol=1e-4)
    right_min, right_max = peaks["peaks"][1][0], peaks["peaks"][1][1]
    assert right_min == 0.0 and right_max == 0.0


def test_silence_is_all_zero_peaks(tmp_path):
    path = tmp_path / "audio.wav"
    _write_wav(path, [[0] * 9600], sample_rate=48000)

    peaks = compute_peaks(path)

    assert all(v == 0.0 for v in peaks["peaks"][0])


def test_bucket_count_matches_duration_exactly_at_the_boundary(tmp_path):
    path = tmp_path / "audio.wav"
    two_seconds = 48000 * 2
    _write_wav(path, [[0] * two_seconds], sample_rate=48000)

    peaks = compute_peaks(path, buckets_per_second=100)

    # min/max pair per bucket -> 2 values per bucket, 200 buckets for 2s.
    assert len(peaks["peaks"][0]) == 200 * 2


def test_empty_file_produces_empty_peaks_not_an_error(tmp_path):
    path = tmp_path / "audio.wav"
    _write_wav(path, [[], []], sample_rate=48000)

    peaks = compute_peaks(path)

    assert peaks["length"] == 0
    assert peaks["peaks"] == [[], []]
