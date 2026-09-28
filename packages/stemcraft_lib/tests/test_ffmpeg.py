import shutil
import subprocess
import wave

import pytest
from stemcraft_lib.album import TrackSpan
from stemcraft_lib.config import SAMPLE_RATE
from stemcraft_lib.export import EXPORT_BITRATE
from stemcraft_lib.ffmpeg import (
    FfmpegError,
    build_track_args,
    decode_to_wav,
    encode_mp3,
    encode_opus,
    probe,
    render_track,
)

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


def _stem_wavs(tmp_path, names, *, seconds=2.0):
    paths = []
    for index, name in enumerate(names):
        path = tmp_path / f"{name}.wav"
        subprocess.run(
            ["ffmpeg", "-hide_banner", "-nostdin", "-y", "-f", "lavfi",
             "-i", f"sine=frequency={220 * (index + 1)}:duration={seconds}:sample_rate=48000",
             "-ac", "2", "-c:a", "pcm_s16le", str(path)],
            check=True, capture_output=True,
        )
        paths.append(path)
    return paths


def _recipe(**overrides):
    from stemcraft_lib.export import ExportRecipe, ExportStem

    base = dict(
        song_id="01ABC",
        name="mix",
        stems=[ExportStem(name="vocals"), ExportStem(name="drums", gain_db=-6.0)],
        tempo=0.82,
        pitch_semitones=-2,
        title="Tightrope",
        artist="Walk the Moon",
    )
    return ExportRecipe(**{**base, **overrides})


def test_export_args_mix_every_stem_with_its_gain_and_no_normalization(tmp_path):
    from stemcraft_lib.ffmpeg import build_export_args

    paths = _stem_wavs(tmp_path, ["vocals", "drums"])
    args = build_export_args(paths, _recipe(), tmp_path / "out.mp3")
    graph = args[args.index("-filter_complex") + 1]

    assert "[0:a]volume=0.0000dB[g0]" in graph
    assert "[1:a]volume=-6.0000dB[g1]" in graph
    # normalize=0: amix's default divides by input count, which would make a
    # four-stem export quieter than a one-stem export of the same material.
    assert "[g0][g1]amix=inputs=2:normalize=0[mix]" in graph
    assert args[:2] == ["ffmpeg", "-hide_banner"]
    assert args[-1] == str(tmp_path / "out.mp3")


def test_export_args_apply_rubberband_with_the_quality_options(tmp_path):
    from stemcraft_lib.ffmpeg import build_export_args

    paths = _stem_wavs(tmp_path, ["vocals", "drums"])
    args = build_export_args(paths, _recipe(), tmp_path / "out.mp3")
    graph = args[args.index("-filter_complex") + 1]

    # D7-01: this option set *is* D-10's "higher quality than the preview".
    assert "rubberband=tempo=0.820000:pitch=0.890899" in graph
    assert "pitchq=quality" in graph
    assert "channels=together" in graph
    assert "transients=crisp" in graph
    assert args[args.index("-map") + 1] == "[out]"


def test_export_args_omit_rubberband_entirely_for_an_identity_recipe(tmp_path):
    from stemcraft_lib.ffmpeg import build_export_args

    paths = _stem_wavs(tmp_path, ["vocals", "drums"])
    args = build_export_args(paths, _recipe(tempo=1.0, pitch_semitones=0), tmp_path / "o.mp3")
    graph = args[args.index("-filter_complex") + 1]

    # D7-05: a vocoder asked for identity still re-synthesises. Don't ask it.
    assert "rubberband" not in graph
    assert args[args.index("-map") + 1] == "[mix]"


def test_export_args_encode_320k_mp3_at_48k_stereo_with_id3(tmp_path):
    from stemcraft_lib.ffmpeg import build_export_args

    paths = _stem_wavs(tmp_path, ["vocals", "drums"])
    args = build_export_args(paths, _recipe(), tmp_path / "out.mp3")

    assert args[args.index("-b:a") + 1] == "320k"
    assert args[args.index("-ar") + 1] == "48000"  # D-03, never 44.1
    assert args[args.index("-ac") + 1] == "2"
    assert args[args.index("-codec:a") + 1] == "libmp3lame"
    assert "title=Tightrope" in args
    assert "artist=Walk the Moon" in args


def test_export_args_reject_a_stem_count_that_does_not_match_the_recipe(tmp_path):
    from stemcraft_lib.ffmpeg import build_export_args

    paths = _stem_wavs(tmp_path, ["vocals"])
    with pytest.raises(ValueError):
        build_export_args(paths, _recipe(), tmp_path / "out.mp3")


def test_render_export_stretches_the_output_and_tags_it(tmp_path):
    from stemcraft_lib.ffmpeg import render_export

    paths = _stem_wavs(tmp_path, ["vocals", "drums"], seconds=2.0)
    dst = tmp_path / "exports" / "mix.mp3"

    seconds = render_export(paths, _recipe(tempo=0.5), dst, source_seconds=2.0)

    assert dst.is_file()
    # Half speed is twice as long. The roadmap's exit criterion in miniature.
    assert seconds == pytest.approx(4.0, abs=0.2)
    tags = probe(dst)
    assert tags.duration_seconds == pytest.approx(4.0, abs=0.2)
    assert tags.title == "Tightrope"


def test_render_export_of_one_stem_alone_works(tmp_path):
    from stemcraft_lib.export import ExportStem
    from stemcraft_lib.ffmpeg import render_export

    paths = _stem_wavs(tmp_path, ["bass"])
    dst = tmp_path / "exports" / "bass-only.mp3"
    render_export(paths, _recipe(stems=[ExportStem(name="bass")]), dst, source_seconds=2.0)
    assert dst.stat().st_size > 0


def test_render_export_reports_progress_monotonically(tmp_path):
    from stemcraft_lib.ffmpeg import render_export

    paths = _stem_wavs(tmp_path, ["vocals", "drums"], seconds=3.0)
    seen: list[float] = []
    render_export(
        paths, _recipe(), tmp_path / "exports" / "m.mp3",
        source_seconds=3.0, on_progress=seen.append,
    )
    assert seen
    assert seen == sorted(seen)
    assert all(0.0 <= f <= 1.0 for f in seen)


def test_render_export_cancels_and_leaves_nothing_behind(tmp_path):
    from stemcraft_lib.ffmpeg import FfmpegCancelled, render_export

    paths = _stem_wavs(tmp_path, ["vocals", "drums"])
    dst = tmp_path / "exports" / "mix.mp3"

    with pytest.raises(FfmpegCancelled):
        render_export(paths, _recipe(), dst, source_seconds=2.0, should_cancel=lambda: True)

    assert not dst.exists()
    # The atomic temp file went with it -- no .mix.mp3.*.tmp left in exports/.
    assert list((tmp_path / "exports").iterdir()) == []


def test_render_export_failure_carries_ffmpegs_own_message(tmp_path):
    from stemcraft_lib.ffmpeg import FfmpegError, render_export

    bad = tmp_path / "vocals.wav"
    bad.write_bytes(b"not audio at all")
    other = _stem_wavs(tmp_path, ["drums"])[0]
    dst = tmp_path / "exports" / "mix.mp3"

    with pytest.raises(FfmpegError) as err:
        render_export([bad, other], _recipe(), dst, source_seconds=2.0)
    assert str(err.value)  # N-08: ffmpeg's stderr, not a wrapper's paraphrase
    assert not dst.exists()


def test_render_export_overwrites_a_previous_export_of_the_same_name(tmp_path):
    from stemcraft_lib.ffmpeg import render_export

    paths = _stem_wavs(tmp_path, ["vocals", "drums"])
    dst = tmp_path / "exports" / "mix.mp3"
    render_export(paths, _recipe(tempo=1.0, pitch_semitones=0), dst, source_seconds=2.0)
    first = dst.read_bytes()
    render_export(paths, _recipe(tempo=0.6), dst, source_seconds=2.0)

    assert dst.read_bytes() != first  # §6: a re-run overwrites its own output


def test_render_export_watchdog_kills_ffmpeg_that_outlives_the_timeout(tmp_path, monkeypatch):
    # The deadline can't be checked only between progress lines -- `for line in
    # stdout` blocks in readline(), so a hung ffmpeg that stops emitting
    # progress would never let an in-loop check run again. A watchdog timer
    # enforces the timeout independently of whether ffmpeg is still writing
    # anything. 90s of amix+rubberband+libmp3lame reliably takes several real
    # seconds (measured ~2s on this host), so a 0.5s timeout cannot be beaten
    # by a render that legitimately finishes in time -- this is a genuinely
    # slow render, not a simulated hang.
    import stemcraft_lib.ffmpeg as ffmpeg_mod
    from stemcraft_lib.ffmpeg import FfmpegError, render_export

    monkeypatch.setattr(ffmpeg_mod, "_TIMEOUT_SECONDS", 0.5)
    paths = _stem_wavs(tmp_path, ["vocals", "drums"], seconds=90.0)
    dst = tmp_path / "exports" / "mix.mp3"

    with pytest.raises(FfmpegError) as err:
        render_export(paths, _recipe(), dst, source_seconds=90.0)
    assert "timed out" in str(err.value)
    assert not dst.exists()
    assert list((tmp_path / "exports").iterdir()) == []


def _span(number=2, start_s=10.0, end_s=190.0, title="So What"):
    return TrackSpan(
        number=number,
        title=title,
        start_sample=int(start_s * SAMPLE_RATE),
        end_sample=int(end_s * SAMPLE_RATE),
        filename=f"{number:02d}-so-what.mp3",
    )


def test_track_argv_seeks_before_the_input_and_cuts_by_duration(tmp_path):
    args = build_track_args(
        tmp_path / "audio.wav", _span(), tmp_path / "out.tmp",
        album_title="Kind of Blue", artist="Miles Davis", track_total=5,
    )
    # -ss BEFORE -i is the fast seek; with a re-encode it is also accurate, and
    # the source is PCM (D8-03) so there is no frame boundary to land on.
    assert args.index("-ss") < args.index("-i")
    assert args[args.index("-ss") + 1] == "10.000000"
    # -t, not -to: a duration is immune to the off-by-one that an end timestamp
    # relative to a seeked-into stream invites.
    assert args[args.index("-t") + 1] == "180.000000"


def test_track_argv_carries_id3_including_album_and_track_number(tmp_path):
    args = build_track_args(
        tmp_path / "audio.wav", _span(), tmp_path / "out.tmp",
        album_title="Kind of Blue", artist="Miles Davis", track_total=5,
    )
    joined = " ".join(args)
    assert "title=So What" in joined
    assert "artist=Miles Davis" in joined
    assert "album=Kind of Blue" in joined
    # D8-08: track numbering is the tag an export has no concept of, and the
    # reason encode_mp3 was not grown a tags parameter instead.
    assert "track=2/5" in joined


def test_track_argv_reuses_the_export_bitrate_rather_than_redeclaring_it(tmp_path):
    args = build_track_args(
        tmp_path / "audio.wav", _span(), tmp_path / "out.tmp",
        album_title="A", artist="B", track_total=1,
    )
    assert args[args.index("-b:a") + 1] == EXPORT_BITRATE
    assert args[args.index("-ar") + 1] == str(SAMPLE_RATE)  # D-03, restated at the output


def test_an_untitled_track_writes_no_empty_title_tag(tmp_path):
    args = build_track_args(
        tmp_path / "audio.wav", _span(title=""), tmp_path / "out.tmp",
        album_title="A", artist="", track_total=1,
    )
    # An empty tag is worse than an absent one: players show a blank field
    # instead of falling back to the filename.
    assert "title=" not in " ".join(args)
    assert "artist=" not in " ".join(args)


def test_track_argv_names_the_muxer_explicitly(tmp_path):
    # dst is an atomic_output temp path ending .tmp, so ffmpeg has no extension
    # to infer the muxer from -- same reason build_export_args passes -f mp3.
    args = build_track_args(
        tmp_path / "audio.wav", _span(), tmp_path / "out.tmp",
        album_title="A", artist="B", track_total=1,
    )
    assert args[args.index("-f") + 1] == "mp3"


def test_render_track_cuts_at_the_requested_boundary(tmp_path):
    # A 6-second 48 kHz tone, cut from 2.0 s to 5.0 s, must come back 3.0 s long.
    src = tmp_path / "audio.wav"
    subprocess.run(
        ["ffmpeg", "-hide_banner", "-v", "error", "-y", "-f", "lavfi",
         "-i", f"sine=frequency=440:sample_rate={SAMPLE_RATE}:duration=6",
         "-ac", "2", "-c:a", "pcm_s16le", str(src)],
        check=True,
    )
    span = TrackSpan(
        number=1, title="Tone",
        start_sample=2 * SAMPLE_RATE, end_sample=5 * SAMPLE_RATE,
        filename="01-tone.mp3",
    )
    dst = tmp_path / "01-tone.mp3"
    render_track(src, span, dst, album_title="Test", artist="Test", track_total=1)
    assert dst.is_file()
    # MP3 framing means the duration is not exact to the sample; 50 ms is the
    # tolerance that catches a real off-by-a-track-length bug without failing
    # on the encoder's own padding.
    assert probe(dst).duration_seconds == pytest.approx(3.0, abs=0.05)
    assert list(tmp_path.glob("*.tmp")) == []
