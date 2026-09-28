from __future__ import annotations

import json
import zipfile

import pytest
from pydantic import ValidationError
from stemcraft_lib.album import (
    ALBUM_SCHEMA_VERSION,
    Album,
    AlbumUnreadable,
    SplitRecipe,
    Track,
    create_album_dir,
    derive_album_files,
    find_album_dir,
    list_tracks,
    new_album,
    read_album,
    recipe_from_album,
    track_spans,
    write_album_zip,
    zip_path,
)
from stemcraft_lib.config import SAMPLE_RATE


def _album(**kwargs) -> Album:
    """Constructed through Album(), never model_copy(): model_copy does NOT
    re-run validators, so a helper built on it would make every ValidationError
    test below pass vacuously."""
    base = new_album(title="Kind of Blue", artist="Miles Davis", source_value="original.flac")
    return Album(**{**base.model_dump(), **kwargs})


# --- the document -------------------------------------------------------

def test_new_album_starts_with_one_track_and_no_split_points():
    album = new_album(title="Kind of Blue", artist="Miles Davis", source_value="original.flac")
    # D8-02: N points make N+1 tracks, so zero points is one track -- the whole
    # file. An album that has not been split yet is not an album with no tracks.
    assert album.split_points == []
    assert len(album.tracks) == 1


def test_round_trip_through_disk(tmp_path):
    album = _album(
        split_points=[100, 200],
        tracks=[Track(title="A"), Track(title="B"), Track(title="C")],
    )
    album_dir = create_album_dir(tmp_path, album)
    assert read_album(album_dir) == album


def test_create_album_dir_names_the_folder_id_then_slug(tmp_path):
    album = _album()
    album_dir = create_album_dir(tmp_path, album)
    assert album_dir.name == f"{album.id}-kind-of-blue"
    assert (album_dir / "album.json").is_file()


def test_find_album_dir_matches_on_id_not_slug(tmp_path):
    album = _album()
    album_dir = create_album_dir(tmp_path, album)
    assert find_album_dir(tmp_path, album.id) == album_dir
    assert find_album_dir(tmp_path, "nosuchid") is None


def test_find_album_dir_on_a_missing_tree_is_none_not_an_error(tmp_path):
    assert find_album_dir(tmp_path / "never-created", "whatever") is None


def test_unreadable_album_json_names_the_file_and_the_reason(tmp_path):
    album_dir = create_album_dir(tmp_path, _album())
    (album_dir / "album.json").write_text("{not json")
    with pytest.raises(AlbumUnreadable) as exc:
        read_album(album_dir)
    assert "album.json" in str(exc.value)


def test_a_newer_schema_version_refuses_to_guess(tmp_path):
    album_dir = create_album_dir(tmp_path, _album())
    raw = json.loads((album_dir / "album.json").read_text())
    raw["schema_version"] = ALBUM_SCHEMA_VERSION + 1
    (album_dir / "album.json").write_text(json.dumps(raw))
    with pytest.raises(AlbumUnreadable, match="newer than this build"):
        read_album(album_dir)


# --- validation: loud, never clamped (N-08) -----------------------------

def test_split_points_must_be_strictly_increasing():
    with pytest.raises(ValidationError, match="strictly increasing"):
        _album(split_points=[200, 100], tracks=[Track(), Track(), Track()])


def test_duplicate_split_points_are_rejected():
    # Two boundaries at the same sample would make a zero-length track.
    with pytest.raises(ValidationError, match="strictly increasing"):
        _album(split_points=[100, 100], tracks=[Track(), Track(), Track()])


def test_split_points_must_be_positive():
    # A boundary at sample 0 would make a zero-length first track.
    with pytest.raises(ValidationError, match="greater than 0"):
        _album(split_points=[0], tracks=[Track(), Track()])


def test_track_count_must_be_one_more_than_split_points():
    with pytest.raises(ValidationError, match="1 more than"):
        _album(split_points=[100, 200], tracks=[Track(), Track()])


# --- derivation ---------------------------------------------------------

def test_track_spans_are_contiguous_and_cover_the_whole_album():
    album = _album(
        total_samples=1000,
        split_points=[300, 700],
        tracks=[Track(title="One"), Track(title="Two"), Track(title="Three")],
    )
    spans = track_spans(album)
    assert [(s.start_sample, s.end_sample) for s in spans] == [(0, 300), (300, 700), (700, 1000)]
    # D8-02: no gaps. Every sample of the source lands in exactly one track.
    assert spans[0].start_sample == 0
    assert spans[-1].end_sample == album.total_samples


def test_track_numbers_are_derived_from_position_never_stored():
    album = _album(
        total_samples=1000,
        split_points=[500],
        tracks=[Track(title="One"), Track(title="Two")],
    )
    assert [s.number for s in track_spans(album)] == [1, 2]


def test_track_filename_is_zero_padded_number_then_slug():
    album = _album(total_samples=1000, split_points=[500],
                   tracks=[Track(title="So What"), Track(title="Blue in Green")])
    assert [s.filename for s in track_spans(album)] == ["01-so-what.mp3", "02-blue-in-green.mp3"]


def test_two_tracks_with_the_same_title_still_get_distinct_filenames():
    # The number prefix, not the title, is what makes the name unique.
    album = _album(total_samples=1000, split_points=[500],
                   tracks=[Track(title="Untitled"), Track(title="Untitled")])
    names = [s.filename for s in track_spans(album)]
    assert names == ["01-untitled.mp3", "02-untitled.mp3"]
    assert len(set(names)) == 2


def test_an_untitled_track_falls_back_to_its_number():
    album = _album(total_samples=1000, split_points=[500], tracks=[Track(), Track()])
    assert [s.filename for s in track_spans(album)] == ["01-track-1.mp3", "02-track-2.mp3"]


def test_span_seconds_convert_from_samples_at_48k():
    album = _album(total_samples=SAMPLE_RATE * 10, split_points=[SAMPLE_RATE * 4],
                   tracks=[Track(title="A"), Track(title="B")])
    first, second = track_spans(album)
    assert first.start_seconds == 0.0
    assert first.duration_seconds == pytest.approx(4.0)
    assert second.start_seconds == pytest.approx(4.0)
    assert second.duration_seconds == pytest.approx(6.0)


def test_track_spans_on_an_album_with_no_duration_yet_is_empty():
    # total_samples is 0 until the import job has probed the file. Asking for
    # spans before then yields nothing rather than a track of negative length.
    assert track_spans(_album(total_samples=0)) == []


# --- the payload snapshot (D8-05) ---------------------------------------

def test_recipe_carries_every_value_the_worker_needs():
    album = _album(
        total_samples=1000,
        split_points=[500],
        tracks=[Track(title="So What"), Track(title="Freddie Freeloader")],
    )
    recipe = recipe_from_album(album)
    assert recipe.album_id == album.id
    assert recipe.album_title == "Kind of Blue"
    assert recipe.artist == "Miles Davis"
    assert [t.title for t in recipe.tracks] == ["So What", "Freddie Freeloader"]
    assert [t.start_sample for t in recipe.tracks] == [0, 500]
    assert [t.filename for t in recipe.tracks] == ["01-so-what.mp3", "02-freddie-freeloader.mp3"]
    # D8-05: nothing in here is a pointer to album.json. Round-tripping through
    # JSON is what the job payload actually does.
    assert SplitRecipe.model_validate(json.loads(recipe.model_dump_json())) == recipe


def test_a_recipe_needs_at_least_one_track():
    with pytest.raises(ValidationError):
        SplitRecipe(album_id="x", album_title="y", artist="", tracks=[])


# --- files on disk ------------------------------------------------------

def test_derive_album_files_reads_the_directory_not_a_status_field(tmp_path):
    album_dir = create_album_dir(tmp_path, _album())
    assert derive_album_files(album_dir).has_audio is False
    (album_dir / "audio.wav").write_bytes(b"")
    assert derive_album_files(album_dir).has_audio is True


def test_list_tracks_is_derived_and_ordered_by_name(tmp_path):
    album_dir = create_album_dir(tmp_path, _album())
    tracks = album_dir / "tracks"
    tracks.mkdir()
    (tracks / "02-b.mp3").write_bytes(b"22")
    (tracks / "01-a.mp3").write_bytes(b"1")
    listed = list_tracks(album_dir)
    # Track order, not mtime order -- an album has an intended sequence, unlike
    # exports (D7-08), which are listed newest first.
    assert [t["name"] for t in listed] == ["01-a.mp3", "02-b.mp3"]
    assert [t["bytes"] for t in listed] == [1, 2]


def test_list_tracks_on_a_missing_directory_is_empty(tmp_path):
    assert list_tracks(create_album_dir(tmp_path, _album())) == []


def test_zip_is_stored_not_deflated_and_holds_every_track(tmp_path):
    album_dir = create_album_dir(tmp_path, _album())
    tracks = album_dir / "tracks"
    tracks.mkdir()
    (tracks / "01-a.mp3").write_bytes(b"aaa")
    (tracks / "02-b.mp3").write_bytes(b"bbb")
    written = write_album_zip(album_dir, ["01-a.mp3", "02-b.mp3"])
    assert written == zip_path(album_dir)
    with zipfile.ZipFile(written) as zf:
        assert zf.namelist() == ["01-a.mp3", "02-b.mp3"]
        # D8-09: MP3 is already compressed; deflating it is CPU for nothing.
        assert all(info.compress_type == zipfile.ZIP_STORED for info in zf.infolist())
        assert zf.read("01-a.mp3") == b"aaa"


def test_writing_the_zip_twice_replaces_it_rather_than_appending(tmp_path):
    album_dir = create_album_dir(tmp_path, _album())
    tracks = album_dir / "tracks"
    tracks.mkdir()
    (tracks / "01-a.mp3").write_bytes(b"aaa")
    write_album_zip(album_dir, ["01-a.mp3"])
    write_album_zip(album_dir, ["01-a.mp3"])
    with zipfile.ZipFile(zip_path(album_dir)) as zf:
        assert zf.namelist() == ["01-a.mp3"]


def test_no_tmp_file_survives_a_failed_zip(tmp_path):
    album_dir = create_album_dir(tmp_path, _album())
    (album_dir / "tracks").mkdir()
    with pytest.raises(FileNotFoundError):
        write_album_zip(album_dir, ["01-missing.mp3"])
    assert not zip_path(album_dir).exists()
    assert list(album_dir.glob("*.tmp")) == []
