from __future__ import annotations

import pytest
from pydantic import ValidationError
from stemcraft_lib.export import (
    EXPORT_BITRATE,
    ExportRecipe,
    ExportStem,
    export_name,
    export_path,
    list_exports,
    stem_wav_paths,
)


def _recipe(**overrides) -> ExportRecipe:
    base = dict(
        song_id="01ABC",
        name="tightrope-no-bass-82",
        stems=[ExportStem(name="vocals"), ExportStem(name="drums", gain_db=-6.0)],
        tempo=0.82,
        pitch_semitones=-2,
        title="Tightrope",
        artist="Walk the Moon",
    )
    return ExportRecipe(**{**base, **overrides})


def test_bitrate_is_320k_and_not_configurable():
    # D7-09: one format, one bitrate. A test so a later "make it a field" is a decision.
    assert EXPORT_BITRATE == "320k"


def test_pitch_scale_is_the_equal_tempered_ratio():
    assert _recipe(pitch_semitones=0).pitch_scale == pytest.approx(1.0)
    assert _recipe(pitch_semitones=-2).pitch_scale == pytest.approx(0.8908987, abs=1e-6)
    assert _recipe(pitch_semitones=12).pitch_scale == pytest.approx(2.0)


def test_is_identity_only_when_both_tempo_and_pitch_are_neutral():
    # D7-05: this property is what drops the rubberband filter from the graph.
    assert _recipe(tempo=1.0, pitch_semitones=0).is_identity
    assert not _recipe(tempo=0.82, pitch_semitones=0).is_identity
    assert not _recipe(tempo=1.0, pitch_semitones=-2).is_identity


def test_stems_must_be_a_non_empty_subset_of_the_four_names():
    with pytest.raises(ValidationError):
        _recipe(stems=[])
    with pytest.raises(ValidationError):
        _recipe(stems=[ExportStem(name="guitar")])
    with pytest.raises(ValidationError):
        _recipe(stems=[ExportStem(name="bass"), ExportStem(name="bass")])


def test_one_stem_alone_is_valid():
    # Domain spec, "Export": one stem alone works the same way.
    assert len(_recipe(stems=[ExportStem(name="bass")]).stems) == 1


def test_stems_are_ordered_canonically_whatever_order_they_arrive_in():
    recipe = _recipe(stems=[ExportStem(name="other"), ExportStem(name="vocals")])
    assert [s.name for s in recipe.stems] == ["vocals", "other"]


def test_out_of_range_tempo_or_pitch_is_rejected_not_clamped():
    # N-08: a recipe the engine could never have produced is a bug upstream,
    # and a clamp would hide it behind a file that sounds almost right.
    with pytest.raises(ValidationError):
        _recipe(tempo=1.5)
    with pytest.raises(ValidationError):
        _recipe(tempo=0.0)
    with pytest.raises(ValidationError):
        _recipe(tempo=0.01)
    with pytest.raises(ValidationError):
        _recipe(pitch_semitones=25)


def test_name_pattern_has_a_hard_anchor_not_a_soft_one():
    # A soft `$` also matches just before a trailing newline; NAME_PATTERN is
    # the boundary between a user-controlled path segment and the filesystem,
    # so it must behave like one.
    from stemcraft_lib.export import NAME_PATTERN

    assert NAME_PATTERN.match("tightrope\n") is None


def test_export_name_slugifies_and_falls_back():
    assert export_name("Tightrope — no bass, 82%", fallback="song") == "tightrope-no-bass-82"
    assert export_name("   ", fallback="tightrope") == "tightrope"
    assert export_name("///", fallback="tightrope") == "tightrope"


def test_export_path_is_under_exports_with_an_mp3_suffix(tmp_path):
    assert export_path(tmp_path, "mix-82") == tmp_path / "exports" / "mix-82.mp3"


def test_stem_wav_paths_are_the_masters_in_recipe_order(tmp_path):
    recipe = _recipe(stems=[ExportStem(name="vocals"), ExportStem(name="drums")])
    assert stem_wav_paths(tmp_path, recipe) == [
        tmp_path / "stems" / "vocals.wav",
        tmp_path / "stems" / "drums.wav",
    ]


def test_list_exports_is_derived_from_the_directory_newest_first(tmp_path):
    exports = tmp_path / "exports"
    exports.mkdir()
    (exports / "old.mp3").write_bytes(b"a" * 10)
    (exports / "new.mp3").write_bytes(b"b" * 20)
    import os
    os.utime(exports / "old.mp3", (1000, 1000))
    os.utime(exports / "new.mp3", (2000, 2000))
    (exports / "notes.txt").write_text("ignored")

    entries = list_exports(tmp_path)
    assert [e["name"] for e in entries] == ["new", "old"]
    assert entries[0] == {
        "name": "new",
        "file": "exports/new.mp3",
        "bytes": 20,
        "modified_at": 2000.0,
    }


def test_list_exports_of_a_song_with_no_exports_dir_is_empty(tmp_path):
    assert list_exports(tmp_path) == []
