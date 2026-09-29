import json

import pytest
from stemcraft_lib.song import (
    SCHEMA_VERSION,
    STEM_NAMES,
    Loop,
    SongUnreadable,
    create_song_dir,
    derive_files,
    find_song_dir,
    new_song,
    read_song,
    write_song,
)  # noqa: F401


def test_new_song_defaults_every_stem_unmuted_at_unity():
    song = new_song(
        title="My Song",
        artist="Artist",
        source_kind="upload",
        source_value="original.mp3",
    )
    assert set(song.mix) == set(STEM_NAMES)
    assert all(m.gain_db == 0 and m.muted is False for m in song.mix.values())
    assert song.playback.tempo == 1.0
    assert song.playback.pitch_semitones == 0
    assert song.loops == []


def test_round_trips_through_disk(tmp_path):
    song = new_song(title="T", artist="A", source_kind="upload", source_value="original.mp3")
    song.mix["bass"].muted = True
    write_song(tmp_path, song)
    assert read_song(tmp_path).mix["bass"].muted is True


def test_written_json_contains_no_status_field(tmp_path):
    # D-01/§5: state is derived from which files exist. Storing it would create
    # a second source of truth that can desync from the filesystem.
    write_song(
        tmp_path,
        new_song(
            title="T",
            artist="A",
            source_kind="upload",
            source_value="o.mp3",
        ),
    )
    raw = json.loads((tmp_path / "song.json").read_text())
    assert "status" not in raw and "state" not in raw
    assert raw["schema_version"] == SCHEMA_VERSION


def test_corrupt_json_raises_with_a_reason(tmp_path):
    (tmp_path / "song.json").write_text("{not json")
    with pytest.raises(SongUnreadable) as err:
        read_song(tmp_path)
    assert "song.json" in str(err.value)


def test_future_schema_version_refuses_rather_than_guessing(tmp_path):
    (tmp_path / "song.json").write_text(json.dumps({"schema_version": 99, "id": "x", "title": "t"}))
    with pytest.raises(SongUnreadable) as err:
        read_song(tmp_path)
    assert "99" in str(err.value)


def test_state_is_derived_from_files_present(tmp_path):
    write_song(
        tmp_path,
        new_song(
            title="T",
            artist="A",
            source_kind="upload",
            source_value="o.mp3",
        ),
    )
    assert derive_files(tmp_path).state == "imported"

    (tmp_path / "stems").mkdir()
    for name in STEM_NAMES:
        (tmp_path / "stems" / f"{name}.wav").write_bytes(b"")
        (tmp_path / "stems" / f"{name}.opus").write_bytes(b"")
    assert derive_files(tmp_path).state == "separated"

    (tmp_path / "analysis.json").write_text("{}")
    assert derive_files(tmp_path).state == "analyzed"


def test_partial_stems_do_not_count_as_separated(tmp_path):
    # A cancelled or crashed separation must not read as a finished one.
    (tmp_path / "stems").mkdir()
    (tmp_path / "stems" / "bass.wav").write_bytes(b"")
    assert derive_files(tmp_path).has_stems is False


def test_wav_without_opus_does_not_count_as_separated(tmp_path):
    # D-04: .opus is the only thing ever served for playback -- a Song with WAV
    # masters but no Opus copies isn't ready for Phase 6's playback yet.
    stems = tmp_path / "stems"
    stems.mkdir()
    for name in STEM_NAMES:
        (stems / f"{name}.wav").write_bytes(b"")
    assert derive_files(tmp_path).has_stems is False


def test_create_song_dir_matches_song_dirname_and_is_findable(tmp_path):
    song = new_song(title="Army of Me", artist="Björk", source_kind="upload", source_value="o.mp3")
    song_dir = create_song_dir(tmp_path, song)

    assert song_dir.name == f"{song.id}-army-of-me"
    assert song_dir.parent == tmp_path
    assert read_song(song_dir).id == song.id
    assert find_song_dir(tmp_path, song.id) == song_dir


def test_find_song_dir_returns_none_for_unknown_id(tmp_path):
    assert find_song_dir(tmp_path, "no-such-id") is None
    # Must not raise even when songs_dir doesn't exist yet.
    assert find_song_dir(tmp_path / "missing", "no-such-id") is None


def test_find_song_dir_ignores_a_directory_with_no_song_json(tmp_path):
    (tmp_path / "01J9-stray").mkdir()
    assert find_song_dir(tmp_path, "01J9") is None


def test_new_song_defaults_to_no_active_loop_no_metronome_no_count_in():
    song = new_song(title="T", artist="", source_kind="upload", source_value="original.mp3")
    assert song.schema_version == SCHEMA_VERSION
    assert song.active_loop is None
    assert song.metronome is False
    assert song.count_in_bars == 0


def test_active_loop_round_trips_through_disk(tmp_path):
    song = new_song(title="T", artist="", source_kind="upload", source_value="original.mp3")
    song.active_loop = Loop(name="Chorus", start_bar=16, end_bar=24)
    song.metronome = True
    song.count_in_bars = 2
    song_dir = tmp_path / "song"
    song_dir.mkdir()
    write_song(song_dir, song)

    reloaded = read_song(song_dir)
    assert reloaded.active_loop == Loop(name="Chorus", start_bar=16, end_bar=24)
    assert reloaded.metronome is True
    assert reloaded.count_in_bars == 2


def test_a_v1_song_migrates_forward_with_v1_fields_intact(tmp_path):
    song_dir = tmp_path / "song"
    song_dir.mkdir()
    (song_dir / "song.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "id": "abc123",
                "title": "Old Song",
                "artist": "Someone",
                "source": {"kind": "upload", "value": "original.mp3"},
                "created_at": "2026-09-01T00:00:00+00:00",
                "mix": {"vocals": {"gain_db": -3.0, "muted": True}},
                "playback": {"tempo": 0.8, "pitch_semitones": -2},
                "loops": [{"name": "Verse", "start_bar": 4, "end_bar": 12}],
            }
        )
    )

    song = read_song(song_dir)
    assert song.schema_version == SCHEMA_VERSION
    # Everything v1 knew is preserved verbatim; only the new fields are defaulted.
    assert song.title == "Old Song"
    assert song.mix["vocals"].muted is True
    assert song.playback.tempo == 0.8
    assert song.loops == [Loop(name="Verse", start_bar=4, end_bar=12)]
    assert song.active_loop is None
    assert song.metronome is False
    assert song.count_in_bars == 0


def test_new_song_defaults_play_along_to_top_key_and_quarter_triads():
    song = new_song(title="T", artist="", source_kind="upload", source_value="original.mp3")
    assert song.schema_version == 3
    assert song.play_along.key is None
    assert song.play_along.pattern.notes == "triad_chord"
    assert song.play_along.pattern.rhythm == "quarter"
    assert song.play_along.pattern.approach == "none"


def test_a_v2_song_migrates_to_v3_with_default_play_along(tmp_path):
    song_dir = tmp_path / "song"
    song_dir.mkdir()
    (song_dir / "song.json").write_text(
        json.dumps(
            {
                "schema_version": 2,
                "id": "abc123",
                "title": "V2 Song",
                "artist": "",
                "source": {"kind": "upload", "value": "original.mp3"},
                "created_at": "2026-09-01T00:00:00+00:00",
                "active_loop": {"name": "", "start_bar": 4, "end_bar": 8},
                "metronome": True,
                "count_in_bars": 1,
            }
        )
    )

    song = read_song(song_dir)
    assert song.schema_version == 3
    # v2's fields survive; only play_along is defaulted.
    assert song.active_loop == Loop(name="", start_bar=4, end_bar=8)
    assert song.metronome is True
    assert song.play_along.key is None
    assert song.play_along.pattern.notes == "triad_chord"


def test_play_along_round_trips_through_disk(tmp_path):
    from stemcraft_lib.song import PlayAlong, PlayAlongKey, PlayAlongPattern

    song = new_song(title="T", artist="", source_kind="upload", source_value="original.mp3")
    song.play_along = PlayAlong(
        key=PlayAlongKey(tonic="Bb", mode="major"),
        pattern=PlayAlongPattern(notes="seventh", rhythm="eighth", approach="chromatic"),
    )
    song_dir = tmp_path / "song"
    song_dir.mkdir()
    write_song(song_dir, song)
    assert read_song(song_dir).play_along == song.play_along


def test_play_along_rejects_an_unknown_pattern_or_tonic():
    from pydantic import ValidationError
    from stemcraft_lib.song import PlayAlongKey, PlayAlongPattern

    with pytest.raises(ValidationError):
        PlayAlongPattern(notes="arpeggio")
    with pytest.raises(ValidationError):
        PlayAlongKey(tonic="H", mode="major")
