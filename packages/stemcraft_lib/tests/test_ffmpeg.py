import shutil
import subprocess
import wave

import pytest
from stemcraft_lib.ffmpeg import FfmpegError, decode_to_wav, encode_mp3, encode_opus, probe

pytestmark = pytest.mark.skipif(
    shutil.which("ffmpeg") is None, reason="ffmpeg not installed on this host"
)


def _make_sine(path, *, seconds=0.5, sample_rate=44100, extra_args=()):
    subprocess.run(
        [
            "ffmpeg", "-hide_banner", "-nostdin", "-y", "-f", "lavfi",
            "-i", f"sine=frequency=440:duration={seconds}:sample_rate={sample_rate}",
            "-ac", "2", *extra_args, str(path),
        ],
        check=True, capture_output=True,
    )


def test_decode_to_wav_is_exactly_48k_stereo(tmp_path):
    # The roadmap's own Phase 2 exit criterion: asserted in a test, not assumed.
    src = tmp_path / "in.mp3"
    _make_sine(src, sample_rate=22050, extra_args=["-codec:a", "libmp3lame"])

    dst = tmp_path / "audio.wav"
    decode_to_wav(src, dst, sample_rate=48000)

    with wave.open(str(dst), "rb") as wav:
        assert wav.getframerate() == 48000
        assert wav.getnchannels() == 2
        assert wav.getnframes() > 0


def test_decode_of_garbage_raises_with_ffmpegs_own_message_and_no_output(tmp_path):
    src = tmp_path / "garbage.mp3"
    src.write_bytes(b"this is not audio, just some bytes\x00\x01\x02")
    dst = tmp_path / "audio.wav"

    with pytest.raises(FfmpegError) as err:
        decode_to_wav(src, dst)
    assert str(err.value)  # ffmpeg's real stderr, not a generic message
    assert not dst.exists()
    assert [p.name for p in tmp_path.iterdir()] == ["garbage.mp3"]


def test_decode_leaves_previous_good_output_intact_on_failure(tmp_path):
    src_ok = tmp_path / "ok.mp3"
    _make_sine(src_ok, extra_args=["-codec:a", "libmp3lame"])
    dst = tmp_path / "audio.wav"
    decode_to_wav(src_ok, dst)
    good_bytes = dst.read_bytes()

    src_bad = tmp_path / "bad.mp3"
    src_bad.write_bytes(b"nope")
    with pytest.raises(FfmpegError):
        decode_to_wav(src_bad, dst)

    assert dst.read_bytes() == good_bytes


def test_encode_mp3_round_trips(tmp_path):
    wav = tmp_path / "in.wav"
    _make_sine(wav, sample_rate=48000)
    mp3 = tmp_path / "out.mp3"
    encode_mp3(wav, mp3)

    assert mp3.stat().st_size > 0
    result = probe(mp3)
    assert result.duration_seconds > 0


def test_encode_opus_round_trips(tmp_path):
    wav = tmp_path / "in.wav"
    _make_sine(wav, sample_rate=48000)
    opus = tmp_path / "out.opus"
    encode_opus(wav, opus)

    assert opus.stat().st_size > 0
    result = probe(opus)
    assert result.duration_seconds > 0


def test_probe_reads_tags_when_present(tmp_path):
    mp3 = tmp_path / "tagged.mp3"
    subprocess.run(
        [
            "ffmpeg", "-hide_banner", "-nostdin", "-y", "-f", "lavfi",
            "-i", "sine=frequency=440:duration=0.2:sample_rate=44100",
            "-ac", "2", "-codec:a", "libmp3lame",
            "-metadata", "title=Test Title", "-metadata", "artist=Test Artist",
            str(mp3),
        ],
        check=True, capture_output=True,
    )
    result = probe(mp3)
    assert result.title == "Test Title"
    assert result.artist == "Test Artist"
    assert result.duration_seconds == pytest.approx(0.2, abs=0.1)


def test_probe_returns_none_tags_when_absent_not_an_error(tmp_path):
    mp3 = tmp_path / "untagged.mp3"
    _make_sine(mp3, extra_args=["-codec:a", "libmp3lame"])
    result = probe(mp3)
    assert result.title is None
    assert result.artist is None


def test_probe_of_unreadable_file_raises_with_ffprobes_message(tmp_path):
    garbage = tmp_path / "garbage.mp3"
    garbage.write_bytes(b"not audio")
    with pytest.raises(FfmpegError) as err:
        probe(garbage)
    assert str(err.value)
