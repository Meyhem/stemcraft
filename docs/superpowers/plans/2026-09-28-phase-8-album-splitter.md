# Stemcraft Phase 8: Album splitter — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** One long file becomes many tagged MP3s, downloadable as a zip, with split points
proposed by silence detection and then dragged, added and removed by the user.

**Architecture:** A standalone tool beside the library, not part of it. A new `albums/` tree
mirrors `songs/` and its one-writer rule; two new job kinds (`import_album`, `split_album`)
mirror `import`/`export`; the split render is one ffmpeg subprocess per track plus a stdlib
zip. Nothing in this phase reads or writes `song.json`, `songs/`, or any Song code path.

**Tech Stack:** Python 3.12 + FastAPI + pydantic (API), ffmpeg via subprocess (all audio I/O),
`zipfile` from the stdlib, React + TanStack Query + wavesurfer.js (render only). **This phase
adds no new dependency to either process.**

**Spec:** The design is recorded in this document's "Decisions this phase makes" section
rather than a separate spec file — this project's convention (CLAUDE.md) is one
task-fidelity plan doc per phase. Upstream sources this plan argues from:
- [design/domain-spec.md](../../../design/domain-spec.md) §"Album splitter" (the six-step flow)
- [design/tech-spec-stemcraft.md](../../../design/tech-spec-stemcraft.md) §14 Q-04
- [the roadmap](2026-09-27-stemcraft-roadmap.md) §"Phase 8 — Album splitter"

---

## Global Constraints

Copied verbatim from CLAUDE.md and the tech spec. Every task's requirements implicitly
include this section.

- **The API never imports torch.** Blast-radius boundary. This phase adds no torch anywhere —
  both new job kinds are pure ffmpeg, so neither even touches the worker's device path.
- **One writer per file.** The API owns `album.json`. The worker owns `audio.wav`,
  `peaks.json`, `proposals.json`, `tracks/`, `album.zip`. This is the rule that forces
  proposals into their own worker-owned file instead of into `album.json` (D8-04).
- **48 kHz everywhere** (D-03). Not 44.1. **Split points are stored as integer sample indices
  at 48 kHz, never float seconds** — same rule and same reason as the beat grid.
- **All file writes are atomic** — temp file then rename. Use `stemcraft_lib.atomic`; never
  open a final path for writing.
- **The original upload is never modified or deleted.** `albums/<id>/original.<ext>` is
  written once by the API and read-only forever after.
- **Fail loudly** (N-08). No silent fallbacks, no clamping. ffmpeg's own stderr reaches the
  Job Queue verbatim. A split point out of range is a 422 naming it, never a clamp.
- **Every job kind must be idempotent by re-derivation.** Re-running `split_album` must
  reproduce its outputs from inputs that never change. This is why the recipe is snapshotted
  into the payload at enqueue (D8-05), exactly as Phase 7 does for `export`.
- `ffmpeg` is the only audio I/O path (C-04). No format whitelist.
- Match the surrounding code's style. `stemcraft_lib/album.py` is written against
  `stemcraft_lib/song.py` and `stemcraft_lib/export.py` as its models; `routes/albums.py`
  against `routes/songs.py`.

---

## Decisions this phase makes

Numbered D8-NN so later phases can cite them, the same way Phase 7 numbered D7-NN.

- **Q-04 — CLOSED: album output stays a zip; the splitter is a standalone tool.**
  Split tracks do not land in the library as Songs. The splitter never touches the Song write
  path, so `song.py`, `routes/songs.py` and the `songs/` tree are untouched by this phase.
  The domain spec already files "send album-splitter tracks straight into the library as
  Songs" under Backlog; this confirms it rather than reopening it. **The seam:** the finished
  MP3s exist on disk under `albums/<id>/tracks/`, so a later "add to library" is additive —
  it would feed a track through the *existing* `POST /api/songs/upload` path as an ordinary
  import, needing no shared write path and no change to anything built here.

- **D8-01 — A new `albums/` tree, sibling of `songs/`.** `STEMCRAFT_ALBUMS_DIR`, defaulting
  to `albums`. Mirroring `songs/` means the one-writer split, the atomic writes, the
  id-is-authoritative/slug-is-decoration rule and the derive-state-from-files rule all
  transfer unchanged instead of being reinvented.

- **D8-02 — Split points are boundaries, so tracks are contiguous.** N split points make
  exactly N+1 tracks; track N ends at the sample where track N+1 begins. There are no gaps
  and no per-track trimming. The domain spec describes split *points* that get dragged, added
  and removed — not independent start/end pairs — and contiguity is what makes "the tracks
  reconstruct the album" checkable. *Known limitation, accepted:* applause on a live record
  cannot be trimmed away, only assigned to one side of the boundary. Not in scope.

- **D8-03 — Tracks render from `audio.wav`, not from `original.*`.** The decoded 48 kHz PCM
  master makes `-ss`/`-t` exact at the sample, which is the whole point of storing split
  points as sample indices; seeking a compressed original would land on a frame boundary
  instead. *Cost, accepted:* a 70-minute album's `audio.wav` is ~800 MB and is kept until the
  user deletes the album. The alternative trades a permanent correctness loss for disk.

- **D8-04 — Silence proposals live in a worker-owned `proposals.json`, never in
  `album.json`.** The worker computes them; the API owns `album.json`. Writing proposals into
  `album.json` would be the worker writing an API-owned file, breaking invariant 2. The
  frontend reads proposals separately and the user applies them with an explicit action,
  which also means **re-running detection never silently overwrites the user's drags.**

- **D8-05 — `split_album` renders from a payload snapshot, not from `album.json`.** Identical
  reasoning to D7-02: `album.json` is autosaved as the user drags markers and types titles, so
  it is not an input that never changes. The API resolves it into a `SplitRecipe` at enqueue;
  the worker validates that model back out of the payload and never reads `album.json`.

- **D8-06 — One `split_album` job renders every track and the zip.** The worker is strictly
  serial, so per-track jobs would buy no parallelism — only more queue rows, a partial-album
  failure mode, and a parent/child concept the jobs table does not have. Progress is reported
  as tracks completed over tracks total.

- **D8-07 — Album jobs carry `song_id = NULL`; the album id lives in the payload.** The jobs
  table's `song_id` column means *a Song*, and an album is not one. It is already nullable and
  the frontend already types it `string | null`, so no schema change and no migration.

- **D8-08 — 320 kbps CBR with ID3, reusing Phase 7's constant.** `EXPORT_BITRATE` is imported,
  not re-declared, so the two output paths cannot drift. Tracks additionally carry `album`
  and `track` (`N/total`) tags, which an export has no concept of.

- **D8-09 — The zip is built with the stdlib `zipfile`, stored (not deflated).** MP3 is
  already compressed; deflating it burns CPU for ~0 % and makes the job slower on a 12-track
  album. `ZIP_STORED` is the honest setting.

- **D8-10 — Split-point markers are a bespoke overlay, not the wavesurfer regions plugin.**
  The plugin models ranges; a boundary is a point, and U-03/U-05 already establish that this
  project's transport and drag affordances are bespoke. This also keeps wavesurfer's role in
  this screen identical to its role in the Song view — render only, never play (D-07) — and
  adds no plugin import.

- **D8-11 — Preview is a plain `<audio>` element on `audio.wav`.** The Phase 3 engine exists
  for four stems, a live mix and a shared time-stretcher; an album has one file and none of
  those. Invariant 7 still holds: wavesurfer does not play, the `<audio>` element does.

---

## File structure

**New — library (`packages/stemcraft_lib/src/stemcraft_lib/`)**
- `album.py` — `Album`/`Track` models, `album.json` read/write/migrate, directory allocation,
  `TrackSpan` derivation, the `SplitRecipe` payload contract, zip writing, `list_tracks`.
  The album equivalent of `song.py` + `export.py` together; they are one file because the
  recipe and the document it is snapshotted from are the same handful of fields.
- `silence.py` — `silencedetect` argv construction, stderr parsing, and the
  intervals → split points proposal rule. Pure functions plus one thin ffmpeg runner, so the
  parsing is testable as text.

**Modified — library**
- `config.py` — add `albums_dir` to `Settings` and `settings()`.
- `ids.py` — add `new_album_id()` and `album_dirname()`.
- `ffmpeg.py` — add `build_track_args()` and `render_track()`. Existing functions unchanged;
  `encode_mp3` is deliberately left alone rather than grown a tags parameter, because a track
  needs album/track-number tags an export has no notion of.

**New — worker (`packages/stemcraft_worker/src/stemcraft_worker/kinds/`)**
- `import_album.py` — kind `import_album`: decode → `audio.wav`, peaks → `peaks.json`,
  silencedetect → `proposals.json`.
- `split_album.py` — kind `split_album`: render N tracks, then the zip.

**Modified — worker**
- `main.py` — import the two new kind modules so they register.

**New — API (`packages/stemcraft_api/src/stemcraft_api/routes/`)**
- `albums.py` — every `/api/albums*` route.

**Modified — API**
- `app.py` — include the albums router.

**New — frontend**
- `src/screens/AlbumSplitter.module.css`, `src/screens/AlbumSplitter.test.tsx`
- `src/splitter/WaveformMarkers.tsx` + `.module.css` + `.test.tsx` — the waveform and the
  draggable boundary markers.
- `src/splitter/TrackTable.tsx` + `.module.css` + `.test.tsx` — titles, numbers, fill-down.
- `src/splitter/spans.ts` + `spans.test.ts` — the client-side mirror of `track_spans`, so the
  table can label rows without a round trip.

**Modified — frontend**
- `src/screens/AlbumSplitter.tsx` — currently a one-line stub; becomes the screen.
- `src/api/client.ts` — album types and URL helpers.
- `src/api/queries.ts` — album hooks.

**Untouched, deliberately:** `song.py`, `routes/songs.py`, `export.py`, the engine, the Song
view. If a task finds itself editing one of these, the task is wrong — stop and re-read Q-04.

---

## Task 1: The album contract

`album.json`, the directory layout, and the derivation from split points to track spans.
Everything downstream — both job kinds, every route, the whole screen — is expressed in the
types defined here, so this task lands first and alone.

**Files:**
- Create: `packages/stemcraft_lib/src/stemcraft_lib/album.py`
- Create: `packages/stemcraft_lib/tests/test_album.py`
- Modify: `packages/stemcraft_lib/src/stemcraft_lib/config.py` (add `albums_dir`)
- Modify: `packages/stemcraft_lib/src/stemcraft_lib/ids.py` (add `new_album_id`, `album_dirname`)
- Modify: `packages/stemcraft_lib/tests/test_config.py`, `tests/test_ids.py`

**Interfaces:**
- Consumes: `stemcraft_lib.atomic.atomic_write_json`, `atomic_output`; `stemcraft_lib.ids.slugify`;
  `stemcraft_lib.export.EXPORT_BITRATE` (Task 3 only); `stemcraft_lib.config.SAMPLE_RATE`.
- Produces, relied on by every later task:
  - `Album`, `Track`, `AlbumUnreadable`, `ALBUM_SCHEMA_VERSION: int`
  - `new_album(*, title: str, artist: str, source_value: str) -> Album`
  - `read_album(album_dir: Path) -> Album`, `write_album(album_dir: Path, album: Album) -> None`
  - `create_album_dir(albums_dir: Path, album: Album) -> Path`
  - `find_album_dir(albums_dir: Path, album_id: str) -> Path | None`
  - `AlbumFiles`, `derive_album_files(album_dir: Path) -> AlbumFiles`
  - `TrackSpan`, `track_spans(album: Album) -> list[TrackSpan]`
  - `SplitTrack`, `SplitRecipe`, `recipe_from_album(album: Album) -> SplitRecipe`
  - `tracks_dir(p)`, `track_path(p, filename)`, `zip_path(p)`, `list_tracks(p)`
  - `TRACK_FILENAME_PATTERN: re.Pattern`

- [ ] **Step 1: Write the failing tests for identity and the directory rules**

Create `packages/stemcraft_lib/tests/test_ids.py` additions:

```python
from stemcraft_lib.ids import album_dirname, new_album_id


def test_album_id_is_a_ulid_and_unique():
    first, second = new_album_id(), new_album_id()
    assert len(first) == 26
    assert first != second


def test_album_dirname_is_id_then_slug():
    assert album_dirname("01J0", "Kind of Blue!") == "01J0-kind-of-blue"


def test_album_dirname_survives_a_title_with_no_usable_characters():
    # Same fallback as song_dirname: the id still names the folder.
    assert album_dirname("01J0", "!!!") == "01J0-untitled"
```

- [ ] **Step 2: Run them to verify they fail**

Run: `uv run pytest packages/stemcraft_lib/tests/test_ids.py -v`
Expected: FAIL — `ImportError: cannot import name 'album_dirname'`

- [ ] **Step 3: Add the two functions to `ids.py`**

Append to `packages/stemcraft_lib/src/stemcraft_lib/ids.py`:

```python
def new_album_id() -> str:
    return str(ULID())


def album_dirname(album_id: str, title: str) -> str:
    """Deliberately a separate function from song_dirname rather than a shared
    one with a parameter: albums and songs are different trees with different
    owners, and a single helper would be the first thread of the coupling
    Q-04 decided against."""
    return f"{album_id}-{slugify(title)}"
```

- [ ] **Step 4: Run to verify they pass**

Run: `uv run pytest packages/stemcraft_lib/tests/test_ids.py -v`
Expected: PASS

- [ ] **Step 5: Write the failing test for `albums_dir`**

Add to `packages/stemcraft_lib/tests/test_config.py`:

```python
def test_albums_dir_defaults_beside_songs(monkeypatch):
    monkeypatch.delenv("STEMCRAFT_ALBUMS_DIR", raising=False)
    assert settings().albums_dir.name == "albums"


def test_albums_dir_is_overridable(monkeypatch, tmp_path):
    monkeypatch.setenv("STEMCRAFT_ALBUMS_DIR", str(tmp_path / "elsewhere"))
    assert settings().albums_dir == (tmp_path / "elsewhere").resolve()
```

- [ ] **Step 6: Run to verify it fails**

Run: `uv run pytest packages/stemcraft_lib/tests/test_config.py -v`
Expected: FAIL — `AttributeError: 'Settings' object has no attribute 'albums_dir'`

- [ ] **Step 7: Add `albums_dir` to `config.py`**

In the `Settings` dataclass, add after `songs_dir`:

```python
    albums_dir: Path
```

In `settings()`, add after the `songs_dir=` line:

```python
        # D8-01: a sibling of songs/, not a subdirectory of it -- an album is
        # not a Song and never becomes one (Q-04).
        albums_dir=_path("STEMCRAFT_ALBUMS_DIR", "albums"),
```

- [ ] **Step 8: Run to verify it passes**

Run: `uv run pytest packages/stemcraft_lib/tests/test_config.py -v`
Expected: PASS

- [ ] **Step 9: Write the failing tests for the album document and span derivation**

Create `packages/stemcraft_lib/tests/test_album.py`:

```python
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
    album = _album(split_points=[100, 200], tracks=[Track(title="A"), Track(title="B"), Track(title="C")])
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
```

- [ ] **Step 10: Run them to verify they fail**

Run: `uv run pytest packages/stemcraft_lib/tests/test_album.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'stemcraft_lib.album'`

- [ ] **Step 11: Write `album.py`**

Create `packages/stemcraft_lib/src/stemcraft_lib/album.py`:

```python
"""album.json: an album being split, and the recipe a split renders from.

The API is album.json's only writer. Everything else about an album -- whether
it has been decoded, whether proposals exist, whether it has been split -- is
derived from which files exist on disk, never stored. Same rule as song.py, and
for the same reason.

Q-04 is closed here by omission: nothing in this module imports anything from
song.py, and nothing in it can create a Song. An album is a standalone tool's
document that happens to live beside the library.
"""

from __future__ import annotations

import json
import re
import zipfile
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field, ValidationError, model_validator

from .atomic import atomic_output, atomic_write_json
from .config import SAMPLE_RATE
from .ids import album_dirname, new_album_id, slugify

ALBUM_SCHEMA_VERSION = 1

ALBUMS_DIRNAME = "albums"
TRACKS_DIRNAME = "tracks"
ZIP_FILENAME = "album.zip"

AlbumState = Literal["uploaded", "ready", "split"]

# The only shape the track-download route will accept. Produced by
# TrackSpan.filename below and by nothing else, so a name outside this alphabet
# is a name this app never wrote -- matched rather than sanitized, exactly as
# export.NAME_PATTERN is (see the API task's traversal test).
TRACK_FILENAME_PATTERN = re.compile(r"^[0-9]{2,}-[a-z0-9][a-z0-9-]*\.mp3\Z")


class AlbumUnreadable(Exception):
    """One bad album.json never breaks the splitter; it is reported with this
    reason. Mirrors SongUnreadable."""


class Track(BaseModel):
    """A track is only its title. Its number, boundaries, duration and filename
    are all derived (track_spans), because storing them would let them disagree
    with the split points that actually define them."""

    title: str = ""


class Album(BaseModel):
    schema_version: int = ALBUM_SCHEMA_VERSION
    id: str
    title: str
    artist: str = ""
    # Only ever "upload": there is no url import for albums. Kept as a field so
    # the shape matches song.json and a future yt-dlp album import is additive.
    source_value: str
    created_at: str
    # 0 until the import job has decoded the file and measured it. Written by
    # the API from the worker's job result, never by the worker itself (§2).
    total_samples: int = 0
    # D-03/invariant 4: sample indices at 48 kHz, never float seconds.
    split_points: list[int] = Field(default_factory=list)
    tracks: list[Track] = Field(default_factory=lambda: [Track()])

    @model_validator(mode="after")
    def _consistent(self) -> Album:
        points = self.split_points
        if any(p <= 0 for p in points):
            raise ValueError(
                f"split points must be greater than 0 (a boundary at sample 0 "
                f"would make a zero-length first track); got {points}"
            )
        if any(b <= a for a, b in zip(points, points[1:], strict=False)):
            raise ValueError(
                f"split points must be strictly increasing; got {points}. "
                "Two boundaries at the same sample would make a zero-length track."
            )
        if self.total_samples and points and points[-1] >= self.total_samples:
            raise ValueError(
                f"split point {points[-1]} is at or past the end of the album "
                f"({self.total_samples} samples)"
            )
        if len(self.tracks) != len(points) + 1:
            raise ValueError(
                f"{len(self.tracks)} track(s) for {len(points)} split point(s); "
                f"D8-02 requires exactly 1 more track than split points"
            )
        return self


def new_album(*, title: str, artist: str, source_value: str) -> Album:
    return Album(
        id=new_album_id(),
        title=title,
        artist=artist,
        source_value=source_value,
        created_at=datetime.now(UTC).isoformat(),
    )


def _migrate(raw: dict, path: Path) -> dict:
    version = raw.get("schema_version")
    if version == ALBUM_SCHEMA_VERSION:
        return raw
    if not isinstance(version, int):
        raise AlbumUnreadable(f"{path}: missing or non-integer schema_version")
    if version > ALBUM_SCHEMA_VERSION:
        raise AlbumUnreadable(
            f"{path}: schema_version {version} is newer than this build understands "
            f"({ALBUM_SCHEMA_VERSION}); refusing to guess"
        )
    # Only version 1 exists. A v2 migration chain goes here, mirroring song.py.
    raise AlbumUnreadable(f"{path}: no migration from schema_version {version}")


def read_album(album_dir: Path) -> Album:
    path = album_dir / "album.json"
    try:
        raw = json.loads(path.read_text())
    except FileNotFoundError as exc:
        raise AlbumUnreadable(f"{path}: missing") from exc
    except json.JSONDecodeError as exc:
        raise AlbumUnreadable(f"{path}: invalid JSON at line {exc.lineno}: {exc.msg}") from exc
    if not isinstance(raw, dict):
        raise AlbumUnreadable(f"{path}: expected an object")
    try:
        return Album.model_validate(_migrate(raw, path))
    except ValidationError as exc:
        raise AlbumUnreadable(f"{path}: {exc.error_count()} invalid field(s): {exc}") from exc


def write_album(album_dir: Path, album: Album) -> None:
    atomic_write_json(album_dir / "album.json", album.model_dump(mode="json"))


def create_album_dir(albums_dir: Path, album: Album) -> Path:
    album_dir = albums_dir / album_dirname(album.id, album.title)
    album_dir.mkdir(parents=True)
    write_album(album_dir, album)
    return album_dir


def find_album_dir(albums_dir: Path, album_id: str) -> Path | None:
    """The id, not the slug, is authoritative -- the slug is decoration and is
    never parsed back except for this prefix match. Mirrors find_song_dir, and
    returns None rather than raising so each caller picks its own error."""
    if not albums_dir.is_dir():
        return None
    for candidate in albums_dir.iterdir():
        if candidate.name.split("-", 1)[0] == album_id and (candidate / "album.json").is_file():
            return candidate
    return None


@dataclass(frozen=True)
class AlbumFiles:
    has_audio: bool
    has_peaks: bool
    has_proposals: bool
    has_tracks: bool
    has_zip: bool

    @property
    def state(self) -> AlbumState:
        if self.has_zip:
            return "split"
        if self.has_audio and self.has_peaks:
            return "ready"
        return "uploaded"


def derive_album_files(album_dir: Path) -> AlbumFiles:
    tracks = album_dir / TRACKS_DIRNAME
    return AlbumFiles(
        has_audio=(album_dir / "audio.wav").is_file(),
        has_peaks=(album_dir / "peaks.json").is_file(),
        has_proposals=(album_dir / "proposals.json").is_file(),
        has_tracks=tracks.is_dir() and any(tracks.glob("*.mp3")),
        has_zip=(album_dir / ZIP_FILENAME).is_file(),
    )


@dataclass(frozen=True)
class TrackSpan:
    number: int
    title: str
    start_sample: int
    end_sample: int  # exclusive
    filename: str

    @property
    def start_seconds(self) -> float:
        return self.start_sample / SAMPLE_RATE

    @property
    def duration_seconds(self) -> float:
        return (self.end_sample - self.start_sample) / SAMPLE_RATE


def _track_filename(number: int, title: str) -> str:
    slug = slugify(title) if title.strip() else f"track-{number}"
    return f"{number:02d}-{slug}.mp3"


def track_spans(album: Album) -> list[TrackSpan]:
    """D8-02: split points are boundaries, so the spans are contiguous and
    together cover every sample exactly once. Empty until total_samples is
    known, because a span needs an end."""
    if album.total_samples <= 0:
        return []
    edges = [0, *album.split_points, album.total_samples]
    spans = []
    for index, track in enumerate(album.tracks):
        number = index + 1
        spans.append(
            TrackSpan(
                number=number,
                title=track.title,
                start_sample=edges[index],
                end_sample=edges[index + 1],
                filename=_track_filename(number, track.title),
            )
        )
    return spans


class SplitTrack(BaseModel):
    number: int
    title: str
    start_sample: int
    end_sample: int
    filename: str


class SplitRecipe(BaseModel):
    """A split, fully determined. Every value is a number or a string; nothing
    here points at album.json (D8-05), because album.json is autosaved as the
    user drags markers and §6 requires a job's inputs never to change under it."""

    album_id: str
    album_title: str
    artist: str = ""
    tracks: list[SplitTrack] = Field(min_length=1)


def recipe_from_album(album: Album) -> SplitRecipe:
    return SplitRecipe(
        album_id=album.id,
        album_title=album.title,
        artist=album.artist,
        tracks=[
            SplitTrack(
                number=span.number,
                title=span.title,
                start_sample=span.start_sample,
                end_sample=span.end_sample,
                filename=span.filename,
            )
            for span in track_spans(album)
        ],
    )


def tracks_dir(album_dir: Path) -> Path:
    return album_dir / TRACKS_DIRNAME


def track_path(album_dir: Path, filename: str) -> Path:
    return tracks_dir(album_dir) / filename


def zip_path(album_dir: Path) -> Path:
    return album_dir / ZIP_FILENAME


def list_tracks(album_dir: Path) -> list[dict]:
    """Derived from the directory, in track order. Unlike list_exports (D7-08,
    newest first), an album has an intended sequence and the zero-padded number
    prefix means a plain name sort is that sequence."""
    directory = tracks_dir(album_dir)
    if not directory.is_dir():
        return []
    return [
        {
            "name": path.name,
            "file": f"{TRACKS_DIRNAME}/{path.name}",
            "bytes": path.stat().st_size,
        }
        for path in sorted(directory.glob("*.mp3"), key=lambda p: p.name)
    ]


def write_album_zip(album_dir: Path, filenames: list[str]) -> Path:
    """D8-09: stored, not deflated. A missing track raises rather than producing
    a short zip (N-08) -- and atomic_output removes the temp file on the way out,
    so a failed run leaves no partial album.zip and no stray .tmp."""
    destination = zip_path(album_dir)
    with atomic_output(destination) as tmp:
        with zipfile.ZipFile(tmp, "w", compression=zipfile.ZIP_STORED) as archive:
            for filename in filenames:
                source = track_path(album_dir, filename)
                if not source.is_file():
                    raise FileNotFoundError(f"track {filename} is missing from {album_dir}")
                archive.write(source, arcname=filename)
    return destination
```

- [ ] **Step 12: Run the tests to verify they pass**

Run: `uv run pytest packages/stemcraft_lib/tests/test_album.py -v`
Expected: PASS (all of them)

- [ ] **Step 13: Run the whole lib suite and the linter for regressions**

Run: `uv run pytest packages/stemcraft_lib -q && uv run ruff check packages/`
Expected: the pre-existing lib tests still pass (97 before this task) plus the new ones; ruff clean.

- [ ] **Step 14: Commit**

```bash
git add packages/stemcraft_lib/src/stemcraft_lib/album.py packages/stemcraft_lib/src/stemcraft_lib/config.py packages/stemcraft_lib/src/stemcraft_lib/ids.py packages/stemcraft_lib/tests/
git commit -m "feat(lib): the album contract — album.json, track spans, split recipe"
```

---

## Task 2: Silence detection and the proposal rule

ffmpeg's `silencedetect` filter, its stderr parsed into intervals, and the rule that turns
intervals into proposed boundaries. Parsing is separated from running so the interesting
half is testable as text with no audio at all.

**Depends on:** Task 1 (for `SAMPLE_RATE` conventions only — it imports from `config`, not
from `album`). **Can run in parallel with Task 3.**

**Files:**
- Create: `packages/stemcraft_lib/src/stemcraft_lib/silence.py`
- Create: `packages/stemcraft_lib/tests/test_silence.py`

**Interfaces:**
- Consumes: `stemcraft_lib.config.SAMPLE_RATE`; `stemcraft_lib.ffmpeg._run`, `FfmpegError`.
- Produces:
  - `SilenceInterval` (frozen dataclass: `start_sample: int`, `end_sample: int`)
  - `DEFAULT_NOISE_DB: float`, `DEFAULT_MIN_SILENCE_SECONDS: float`, `EDGE_GUARD_SECONDS: float`
  - `build_silencedetect_args(src: Path, *, noise_db: float, min_silence_seconds: float) -> list[str]`
  - `parse_silencedetect(stderr: str, *, total_samples: int) -> list[SilenceInterval]`
  - `propose_split_points(intervals: Sequence[SilenceInterval], *, total_samples: int) -> list[int]`
  - `detect_split_points(src: Path, *, total_samples: int, noise_db: float = DEFAULT_NOISE_DB, min_silence_seconds: float = DEFAULT_MIN_SILENCE_SECONDS) -> list[int]`

- [ ] **Step 1: Write the failing tests**

Create `packages/stemcraft_lib/tests/test_silence.py`:

```python
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
```

- [ ] **Step 2: Run them to verify they fail**

Run: `uv run pytest packages/stemcraft_lib/tests/test_silence.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'stemcraft_lib.silence'`

- [ ] **Step 3: Write `silence.py`**

Create `packages/stemcraft_lib/src/stemcraft_lib/silence.py`:

```python
"""Silence detection: ffmpeg's silencedetect filter, parsed, turned into
proposed split points.

Proposals only. The worker writes them to proposals.json and the user applies
them with an explicit action (D8-04) -- nothing here ever edits album.json, and
re-running detection therefore cannot overwrite the boundaries someone dragged.

Parsing is a pure function of ffmpeg's stderr text so the interesting half needs
no audio to test.
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

from .config import SAMPLE_RATE
from .ffmpeg import FfmpegError, _run

# -50 dBFS for 1.5 s. Between-track gaps on a CD rip are digital black; gaps on
# a vinyl or tape transfer are surface noise well under -50 dB. 1.5 s is longer
# than a musical rest and shorter than the shortest real gap.
DEFAULT_NOISE_DB = -50.0
DEFAULT_MIN_SILENCE_SECONDS = 1.5

# Silence within this far of either end is the lead-in or the run-out, not a
# boundary between two tracks.
EDGE_GUARD_SECONDS = 5.0

_START = re.compile(r"silence_start:\s*(-?[\d.]+)")
_END = re.compile(r"silence_end:\s*(-?[\d.]+)")


@dataclass(frozen=True)
class SilenceInterval:
    start_sample: int
    end_sample: int


def build_silencedetect_args(
    src: Path,
    *,
    noise_db: float = DEFAULT_NOISE_DB,
    min_silence_seconds: float = DEFAULT_MIN_SILENCE_SECONDS,
) -> list[str]:
    """Pure, so the filter string is testable as text."""
    return [
        "ffmpeg", "-hide_banner", "-nostdin", "-i", str(src),
        "-af", f"silencedetect=noise={noise_db}dB:d={min_silence_seconds}",
        # The filter's report on stderr is the only thing wanted; -f null
        # discards the decoded audio instead of re-encoding 70 minutes of it.
        "-f", "null", "-",
    ]


def parse_silencedetect(stderr: str, *, total_samples: int) -> list[SilenceInterval]:
    """silencedetect reports a start and its end on separate lines, interleaved
    with the rest of ffmpeg's log. A start with no end means the file ended
    inside the silence -- closed at the album's end rather than dropped."""
    intervals: list[SilenceInterval] = []
    pending: int | None = None
    for line in stderr.splitlines():
        start = _START.search(line)
        if start:
            pending = max(0, int(float(start.group(1)) * SAMPLE_RATE))
            continue
        end = _END.search(line)
        if end and pending is not None:
            intervals.append(SilenceInterval(pending, int(float(end.group(1)) * SAMPLE_RATE)))
            pending = None
    if pending is not None:
        intervals.append(SilenceInterval(pending, total_samples))
    return intervals


def propose_split_points(
    intervals: Sequence[SilenceInterval], *, total_samples: int
) -> list[int]:
    """The midpoint of each silence, minus the lead-in and run-out.

    The midpoint rather than either edge: cutting at silence_start clips the
    previous track's decay, cutting at silence_end drops the next track's
    attack. The midpoint leaves a symmetric gap on both sides, which is what a
    listener expects between tracks.
    """
    if total_samples <= 0:
        return []
    guard = int(EDGE_GUARD_SECONDS * SAMPLE_RATE)
    points = set()
    for interval in intervals:
        midpoint = (interval.start_sample + interval.end_sample) // 2
        if guard < midpoint < total_samples - guard:
            points.add(midpoint)
    # Album.split_points requires strictly increasing; a set plus sorted is
    # exactly that, and de-duplicates two silences that round to one sample.
    return sorted(points)


def detect_split_points(
    src: Path,
    *,
    total_samples: int,
    noise_db: float = DEFAULT_NOISE_DB,
    min_silence_seconds: float = DEFAULT_MIN_SILENCE_SECONDS,
) -> list[int]:
    proc = _run(
        build_silencedetect_args(
            src, noise_db=noise_db, min_silence_seconds=min_silence_seconds
        )
    )
    if proc.returncode != 0:
        # N-08: ffmpeg's own words, not a wrapper's summary.
        raise FfmpegError(f"silence detection on {src} failed: {proc.stderr.strip()[-500:]}")
    return propose_split_points(
        parse_silencedetect(proc.stderr, total_samples=total_samples),
        total_samples=total_samples,
    )
```

- [ ] **Step 4: Run to verify they pass**

Run: `uv run pytest packages/stemcraft_lib/tests/test_silence.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/stemcraft_lib/src/stemcraft_lib/silence.py packages/stemcraft_lib/tests/test_silence.py
git commit -m "feat(lib): silence detection and the split-point proposal rule"
```

---

## Task 3: Rendering one track

One ffmpeg subprocess per track: seek, cut, encode at 320 kbps, tag. Argv construction is
pure and tested as text, exactly as `build_export_args` is.

**Depends on:** Task 1. **Can run in parallel with Task 2.**

**Files:**
- Modify: `packages/stemcraft_lib/src/stemcraft_lib/ffmpeg.py` (append; change nothing existing)
- Modify: `packages/stemcraft_lib/tests/test_ffmpeg.py`

**Interfaces:**
- Consumes: `stemcraft_lib.album.TrackSpan`; `stemcraft_lib.export.EXPORT_BITRATE`;
  `stemcraft_lib.atomic.atomic_output`; the existing `FfmpegError`, `_run`, `SAMPLE_RATE`.
- Produces:
  - `build_track_args(src: Path, span: TrackSpan, dst: Path, *, album_title: str, artist: str, track_total: int) -> list[str]`
  - `render_track(src: Path, span: TrackSpan, dst: Path, *, album_title: str, artist: str, track_total: int) -> None`

- [ ] **Step 1: Write the failing tests**

Add to `packages/stemcraft_lib/tests/test_ffmpeg.py`:

```python
from stemcraft_lib.album import TrackSpan
from stemcraft_lib.config import SAMPLE_RATE
from stemcraft_lib.export import EXPORT_BITRATE
from stemcraft_lib.ffmpeg import build_track_args


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
```

And one integration test that actually runs ffmpeg, marked like the existing ones in this
file (check how `test_ffmpeg.py` guards its real-ffmpeg tests and follow that convention
exactly — do not invent a new marker):

```python
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
```

- [ ] **Step 2: Run to verify they fail**

Run: `uv run pytest packages/stemcraft_lib/tests/test_ffmpeg.py -v -k track`
Expected: FAIL — `ImportError: cannot import name 'build_track_args'`

- [ ] **Step 3: Append to `ffmpeg.py`**

Add the import at the top (alongside the existing `from .export import ...`):

```python
from .album import TrackSpan
```

Append at the end of the module:

```python
def build_track_args(
    src: Path,
    span: TrackSpan,
    dst: Path,
    *,
    album_title: str,
    artist: str,
    track_total: int,
) -> list[str]:
    """One track cut out of the decoded album master. Pure, so the argv is
    testable as text -- same treatment as build_export_args.

    -ss before -i is the fast seek. With a re-encode it is also exact, and
    D8-03 has already guaranteed the source is PCM WAV, so there is no
    compressed frame boundary for the seek to land on. -t rather than -to
    because a duration is measured from the seek point and cannot drift with it.
    """
    args = [
        "ffmpeg", "-hide_banner", "-nostdin", "-v", "error", "-y",
        "-ss", f"{span.start_seconds:.6f}",
        "-i", str(src),
        "-t", f"{span.duration_seconds:.6f}",
        "-ac", "2",
        "-ar", str(SAMPLE_RATE),  # D-03, restated at the output, never 44.1
        "-codec:a", "libmp3lame",
        "-b:a", EXPORT_BITRATE,   # D8-08: imported, so the two paths cannot drift
    ]
    # An empty tag is worse than an absent one -- players show a blank field
    # rather than falling back to the filename.
    if span.title.strip():
        args += ["-metadata", f"title={span.title}"]
    if artist.strip():
        args += ["-metadata", f"artist={artist}"]
    if album_title.strip():
        args += ["-metadata", f"album={album_title}"]
    args += ["-metadata", f"track={span.number}/{track_total}"]
    args += ["-f", "mp3", str(dst)]
    return args


def render_track(
    src: Path,
    span: TrackSpan,
    dst: Path,
    *,
    album_title: str,
    artist: str,
    track_total: int,
) -> None:
    """Render one track atomically. Unlike render_export there is no progress
    callback and no cancel hook: a single track is seconds of work, and the
    split job's checkpoint is between tracks, where a cancel leaves nothing
    half-written."""
    with atomic_output(dst) as tmp:
        proc = _run(
            build_track_args(
                src, span, tmp,
                album_title=album_title, artist=artist, track_total=track_total,
            )
        )
        if proc.returncode != 0:
            raise FfmpegError(
                f"render of track {span.number} ({span.filename}) failed: "
                f"{proc.stderr.strip()[-500:]}"
            )
```

- [ ] **Step 4: Run to verify they pass**

Run: `uv run pytest packages/stemcraft_lib/tests/test_ffmpeg.py -v`
Expected: PASS, including the pre-existing export-argv tests (unchanged).

> **Watch for an import cycle.** `ffmpeg.py` now imports from `album.py`, and `album.py`
> imports from `atomic`, `config` and `ids` only — never from `ffmpeg`. Keep it that way. If
> a later task is tempted to import `ffmpeg` from `album`, the function belongs in `ffmpeg`.

- [ ] **Step 5: Commit**

```bash
git add packages/stemcraft_lib/src/stemcraft_lib/ffmpeg.py packages/stemcraft_lib/tests/test_ffmpeg.py
git commit -m "feat(lib): render one album track, cut and tagged"
```

---

## Task 4: The `import_album` job kind

Decode the upload to `audio.wav`, compute peaks, propose split points. Writes only
worker-owned files (invariant 2) and reports the measured length back through the job result,
which the API then stamps into `album.json` — the worker never writes `album.json` itself.

**Depends on:** Tasks 1 and 2. **Can run in parallel with Task 5.**

**Files:**
- Create: `packages/stemcraft_worker/src/stemcraft_worker/kinds/import_album.py`
- Create: `packages/stemcraft_worker/tests/test_import_album.py`
- Modify: `packages/stemcraft_worker/src/stemcraft_worker/kinds/__init__.py`

**Interfaces:**
- Consumes: `album.find_album_dir`; `silence.detect_split_points`; `ffmpeg.decode_to_wav`,
  `ffmpeg.probe`; `peaks.compute_peaks`; `registry.JobContext`, `JobCancelled`, `register`.
- Produces: job kind `"import_album"`, payload `{"album_id": str}`, result
  `{"duration_seconds": float, "total_samples": int, "proposed_split_points": list[int]}`.

- [ ] **Step 1: Register the kind**

Modify `packages/stemcraft_worker/src/stemcraft_worker/kinds/__init__.py`:

```python
"""Importing this package registers every built-in job kind."""

from . import (  # noqa: F401
    analyze_song,
    export_song,
    import_album,
    import_song,
    probe,
    separate_song,
    split_album,
)
```

(`split_album` lands in Task 5. If Tasks 4 and 5 run in parallel, **both agents edit this
file** — whichever lands second resolves the conflict by keeping both names. Prefer to let
Task 4 write the whole list as above and Task 5 simply verify it.)

- [ ] **Step 2: Write the failing tests**

Create `packages/stemcraft_worker/tests/test_import_album.py`. The house idiom for a job-kind
test is **enqueue → `run_one(conn, device="cpu")` → `get_job`** against a real temp sqlite —
not a hand-built `JobContext`. Read `packages/stemcraft_worker/tests/test_export_song.py`
and copy its `conn` fixture, its `pytestmark` ffmpeg skip and its shape exactly.

```python
import json
import shutil
import subprocess

import pytest
import stemcraft_worker.kinds.import_album  # noqa: F401  (registers on import)
from stemcraft_lib.album import create_album_dir, new_album, read_album
from stemcraft_lib.jobs import connect, enqueue, get_job, request_cancel
from stemcraft_worker.main import run_one

pytestmark = pytest.mark.skipif(
    shutil.which("ffmpeg") is None, reason="ffmpeg not installed on this host"
)

SAMPLE_RATE = 48000


@pytest.fixture
def conn(tmp_path):
    return connect(tmp_path / "jobs.sqlite")


@pytest.fixture
def albums_dir(tmp_path, monkeypatch):
    d = tmp_path / "albums"
    monkeypatch.setenv("STEMCRAFT_ALBUMS_DIR", str(d))
    return d


def _make_album(albums_dir):
    """A synthetic album: 5 s tone, 2 s silence, 5 s tone. The gap is a known
    boundary, which is what makes the proposal assertable rather than a
    judgement call -- the same trick Phase 3 used with a click track."""
    album = new_album(title="Test Album", artist="Tester", source_value="original.wav")
    album_dir = create_album_dir(albums_dir, album)
    subprocess.run(
        ["ffmpeg", "-hide_banner", "-nostdin", "-y",
         "-f", "lavfi", "-i", f"sine=frequency=440:duration=5:sample_rate={SAMPLE_RATE}",
         "-f", "lavfi", "-i", f"anullsrc=r={SAMPLE_RATE}:cl=stereo",
         "-f", "lavfi", "-i", f"sine=frequency=660:duration=5:sample_rate={SAMPLE_RATE}",
         "-filter_complex",
         "[0]aformat=cl=stereo[a];[1]atrim=duration=2,aformat=cl=stereo[g];"
         "[2]aformat=cl=stereo[b];[a][g][b]concat=n=3:v=0:a=1[out]",
         "-map", "[out]", "-ac", "2", "-c:a", "pcm_s16le",
         str(album_dir / "original.wav")],
        check=True, capture_output=True,
    )
    return album, album_dir


def _queue(conn, album):
    return enqueue(conn, kind="import_album", song_id=None, payload={"album_id": album.id})


def test_import_album_writes_the_three_worker_owned_files(conn, albums_dir):
    album, album_dir = _make_album(albums_dir)
    job_id = _queue(conn, album)
    assert run_one(conn, device="cpu") == job_id

    done = get_job(conn, job_id)
    assert done.state == "done", done.error
    assert (album_dir / "audio.wav").is_file()
    assert (album_dir / "peaks.json").is_file()
    assert (album_dir / "proposals.json").is_file()
    assert done.result["duration_seconds"] == pytest.approx(12.0, abs=0.1)
    assert done.result["total_samples"] == pytest.approx(12 * SAMPLE_RATE, rel=0.01)


def test_import_album_never_writes_album_json(conn, albums_dir):
    # Invariant 2 / D8-04, asserted directly: the API owns album.json.
    album, album_dir = _make_album(albums_dir)
    before = (album_dir / "album.json").read_bytes()
    _queue(conn, album)
    run_one(conn, device="cpu")
    assert (album_dir / "album.json").read_bytes() == before
    # In particular the length is reported, not stamped -- the API does that.
    assert read_album(album_dir).total_samples == 0


def test_the_proposal_lands_in_the_silent_gap(conn, albums_dir):
    album, album_dir = _make_album(albums_dir)
    job_id = _queue(conn, album)
    run_one(conn, device="cpu")

    done = get_job(conn, job_id)
    points = json.loads((album_dir / "proposals.json").read_text())["split_points"]
    assert done.result["proposed_split_points"] == points
    assert len(points) == 1
    # The gap runs 5.0 s -> 7.0 s, so its midpoint is 6.0 s. Half a second of
    # tolerance for the detector's own threshold ramp.
    assert points[0] / SAMPLE_RATE == pytest.approx(6.0, abs=0.5)


def test_the_original_is_never_modified(conn, albums_dir):
    # Invariant 9.
    album, album_dir = _make_album(albums_dir)
    before = (album_dir / "original.wav").read_bytes()
    _queue(conn, album)
    run_one(conn, device="cpu")
    assert (album_dir / "original.wav").read_bytes() == before


def test_rerunning_reproduces_the_same_proposals(conn, albums_dir):
    # §6: idempotent by re-derivation. A lease reclaim re-runs this from the top.
    album, _ = _make_album(albums_dir)
    first_id = _queue(conn, album)
    run_one(conn, device="cpu")
    second_id = _queue(conn, album)
    run_one(conn, device="cpu")
    assert get_job(conn, first_id).result == get_job(conn, second_id).result


def test_a_missing_album_fails_loudly_naming_the_id(conn, albums_dir):
    job_id = enqueue(conn, kind="import_album", song_id=None, payload={"album_id": "nosuchid"})
    run_one(conn, device="cpu")
    done = get_job(conn, job_id)
    assert done.state == "failed"
    # N-08: the id is in the message, not buried in a traceback.
    assert "nosuchid" in done.error


def test_a_cancel_requested_before_the_job_runs_ends_as_cancelled(conn, albums_dir):
    album, album_dir = _make_album(albums_dir)
    job_id = _queue(conn, album)
    request_cancel(conn, job_id)
    run_one(conn, device="cpu")
    done = get_job(conn, job_id)
    assert done.state == "cancelled"
    assert done.error is None  # a cancel is not a failure
```

> Check `request_cancel`'s return value and semantics in `stemcraft_lib/jobs.py` before
> relying on it here — a queued job may be cancelled without ever being claimed, in which
> case `run_one` returns `None` and the assertion above still holds.

- [ ] **Step 3: Run to verify they fail**

Run: `uv run pytest packages/stemcraft_worker/tests/test_import_album.py -v`
Expected: FAIL — `ModuleNotFoundError: ... 'import_album'`

- [ ] **Step 4: Write the kind**

Create `packages/stemcraft_worker/src/stemcraft_worker/kinds/import_album.py`:

```python
"""The `import_album` job kind: original.* -> audio.wav (D-03) -> peaks.json ->
proposals.json.

Writes only worker-owned files. The measured length goes back to the API in the
job result rather than into album.json, because album.json's only writer is the
API (invariant 2) -- and the proposed split points go to their own file for the
same reason, which is also what stops a re-detection from silently overwriting
boundaries the user dragged (D8-04).

No torch: the whole job is two ffmpeg passes and a numpy reduction.

Idempotent by re-derivation (§6): decode, peaks and detection are all
deterministic and all overwrite their own output, so a lease reclaim re-running
this from the top is harmless.
"""

from __future__ import annotations

from pathlib import Path

from stemcraft_lib import ffmpeg, silence
from stemcraft_lib.album import find_album_dir
from stemcraft_lib.atomic import atomic_write_json
from stemcraft_lib.config import SAMPLE_RATE, settings

from .. import peaks as peaks_module
from ..registry import JobCancelled, JobContext, register


def _existing_original(album_dir: Path) -> Path | None:
    matches = sorted(album_dir.glob("original.*"))
    return matches[0] if matches else None


def run(ctx: JobContext) -> dict:
    album_id = ctx.payload["album_id"]
    album_dir = find_album_dir(settings().albums_dir, album_id)
    if album_dir is None:
        raise RuntimeError(f"no album directory for album_id={album_id!r}")

    original = _existing_original(album_dir)
    if original is None:
        # There is no url import for albums, so unlike import_song there is
        # nothing to fall back to -- the API writes original.* at upload.
        raise RuntimeError(f"album {album_id} has no original.* on disk")
    if ctx.cancelled():
        raise JobCancelled

    audio_wav = album_dir / "audio.wav"
    ffmpeg.decode_to_wav(original, audio_wav, sample_rate=SAMPLE_RATE)
    ctx.progress(0.5)
    if ctx.cancelled():
        raise JobCancelled

    duration_seconds = ffmpeg.probe(audio_wav).duration_seconds
    total_samples = int(round(duration_seconds * SAMPLE_RATE))

    atomic_write_json(album_dir / "peaks.json", peaks_module.compute_peaks(audio_wav))
    ctx.progress(0.8)
    if ctx.cancelled():
        raise JobCancelled

    split_points = silence.detect_split_points(audio_wav, total_samples=total_samples)
    atomic_write_json(
        album_dir / "proposals.json",
        {
            "total_samples": total_samples,
            "split_points": split_points,
            # Recorded so a proposal can be read back later and understood --
            # "why did it find nothing?" is answerable from the file itself.
            "noise_db": silence.DEFAULT_NOISE_DB,
            "min_silence_seconds": silence.DEFAULT_MIN_SILENCE_SECONDS,
        },
    )
    ctx.progress(1.0)

    # Unlike import_song, nothing is enqueued next: a split is the user's
    # decision, made after they have looked at the proposed boundaries.
    return {
        "duration_seconds": round(duration_seconds, 3),
        "total_samples": total_samples,
        "proposed_split_points": split_points,
    }


register("import_album", run)
```

- [ ] **Step 5: Run to verify they pass**

Run: `uv run pytest packages/stemcraft_worker/tests/test_import_album.py -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/stemcraft_worker/src/stemcraft_worker/kinds/ packages/stemcraft_worker/tests/test_import_album.py
git commit -m "feat(worker): the import_album job kind — decode, peaks, silence proposals"
```

---

## Task 5: The `split_album` job kind

Render every track from the payload snapshot, then the zip. One job (D8-06), cancellable
between tracks.

**Depends on:** Tasks 1 and 3. **Can run in parallel with Task 4.**

**Files:**
- Create: `packages/stemcraft_worker/src/stemcraft_worker/kinds/split_album.py`
- Create: `packages/stemcraft_worker/tests/test_split_album.py`
- Modify: `packages/stemcraft_worker/src/stemcraft_worker/kinds/__init__.py` (see Task 4 Step 1)

**Interfaces:**
- Consumes: `album.SplitRecipe`, `TrackSpan`, `find_album_dir`, `track_path`, `tracks_dir`,
  `write_album_zip`, `zip_path`; `ffmpeg.render_track`.
- Produces: job kind `"split_album"`, payload = a `SplitRecipe` dumped to JSON, result
  `{"zip": "album.zip", "bytes": int, "tracks": [{"filename": str, "bytes": int}, ...]}`.

- [ ] **Step 1: Write the failing tests**

Create `packages/stemcraft_worker/tests/test_split_album.py`, same idiom as Task 4's:

```python
import shutil
import subprocess
import zipfile

import pytest
import stemcraft_worker.kinds.split_album  # noqa: F401  (registers on import)
from stemcraft_lib.album import SplitRecipe, SplitTrack, create_album_dir, new_album, zip_path
from stemcraft_lib.ffmpeg import probe
from stemcraft_lib.jobs import connect, enqueue, get_job, request_cancel
from stemcraft_worker.main import run_one

pytestmark = pytest.mark.skipif(
    shutil.which("ffmpeg") is None, reason="ffmpeg not installed on this host"
)

SAMPLE_RATE = 48000


@pytest.fixture
def conn(tmp_path):
    return connect(tmp_path / "jobs.sqlite")


@pytest.fixture
def albums_dir(tmp_path, monkeypatch):
    d = tmp_path / "albums"
    monkeypatch.setenv("STEMCRAFT_ALBUMS_DIR", str(d))
    return d


def _ready_album(albums_dir, *, seconds=12):
    album = new_album(title="Test Album", artist="Tester", source_value="original.wav")
    album_dir = create_album_dir(albums_dir, album)
    subprocess.run(
        ["ffmpeg", "-hide_banner", "-nostdin", "-y", "-f", "lavfi",
         "-i", f"sine=frequency=440:duration={seconds}:sample_rate={SAMPLE_RATE}",
         "-ac", "2", "-c:a", "pcm_s16le", str(album_dir / "audio.wav")],
        check=True, capture_output=True,
    )
    return album, album_dir


def _recipe(album, *, boundary_s=6, total_s=12, second_title="Two", second_file="02-two.mp3"):
    return SplitRecipe(
        album_id=album.id, album_title="Test Album", artist="Tester",
        tracks=[
            SplitTrack(number=1, title="One", start_sample=0,
                       end_sample=boundary_s * SAMPLE_RATE, filename="01-one.mp3"),
            SplitTrack(number=2, title=second_title, start_sample=boundary_s * SAMPLE_RATE,
                       end_sample=total_s * SAMPLE_RATE, filename=second_file),
        ],
    )


def _queue(conn, recipe):
    return enqueue(conn, kind="split_album", song_id=None,
                   payload=recipe.model_dump(mode="json"))


def test_split_renders_every_track_and_the_zip(conn, albums_dir):
    album, album_dir = _ready_album(albums_dir)
    job_id = _queue(conn, _recipe(album))
    assert run_one(conn, device="cpu") == job_id

    done = get_job(conn, job_id)
    assert done.state == "done", done.error
    assert (album_dir / "tracks" / "01-one.mp3").is_file()
    assert (album_dir / "tracks" / "02-two.mp3").is_file()
    assert [t["filename"] for t in done.result["tracks"]] == ["01-one.mp3", "02-two.mp3"]
    with zipfile.ZipFile(zip_path(album_dir)) as zf:
        assert zf.namelist() == ["01-one.mp3", "02-two.mp3"]


def test_the_tracks_have_the_durations_the_boundaries_asked_for(conn, albums_dir):
    album, album_dir = _ready_album(albums_dir)
    _queue(conn, _recipe(album, boundary_s=4))
    run_one(conn, device="cpu")
    # 50 ms tolerance: MP3 framing is not sample-exact, but a boundary that is
    # wrong by a track length is caught easily.
    assert probe(album_dir / "tracks" / "01-one.mp3").duration_seconds == pytest.approx(4.0, abs=0.05)
    assert probe(album_dir / "tracks" / "02-two.mp3").duration_seconds == pytest.approx(8.0, abs=0.05)


def test_the_tracks_carry_album_and_track_number_tags(conn, albums_dir):
    album, album_dir = _ready_album(albums_dir)
    _queue(conn, _recipe(album))
    run_one(conn, device="cpu")
    tags = probe(album_dir / "tracks" / "01-one.mp3")
    assert tags.title == "One"
    assert tags.artist == "Tester"


def test_split_never_reads_album_json(conn, albums_dir):
    # D8-05, asserted directly: deleting album.json must not affect the render,
    # because the recipe in the payload is the only input.
    album, album_dir = _ready_album(albums_dir)
    (album_dir / "album.json").unlink()
    job_id = _queue(conn, _recipe(album))
    run_one(conn, device="cpu")
    done = get_job(conn, job_id)
    assert done.state == "done", done.error
    assert len(done.result["tracks"]) == 2


def test_rerunning_overwrites_its_own_output(conn, albums_dir):
    # §6. Byte-identical is deliberately not asserted: LAME writes an encoder
    # delay that is stable in practice but not guaranteed across builds.
    album, album_dir = _ready_album(albums_dir)
    for _ in range(2):
        _queue(conn, _recipe(album))
        run_one(conn, device="cpu")
    assert len(list((album_dir / "tracks").glob("*.mp3"))) == 2
    with zipfile.ZipFile(zip_path(album_dir)) as zf:
        assert zf.namelist() == ["01-one.mp3", "02-two.mp3"]


def test_a_stale_track_from_an_earlier_split_is_not_shipped_in_the_zip(conn, albums_dir):
    # Renaming a track and re-splitting must not leave the old filename in the
    # zip -- the zip is built from the recipe, not from a directory listing.
    album, album_dir = _ready_album(albums_dir)
    _queue(conn, _recipe(album))
    run_one(conn, device="cpu")
    _queue(conn, _recipe(album, second_title="Renamed", second_file="02-renamed.mp3"))
    run_one(conn, device="cpu")
    with zipfile.ZipFile(zip_path(album_dir)) as zf:
        assert zf.namelist() == ["01-one.mp3", "02-renamed.mp3"]
    # The orphan is still on disk; it is simply not part of the album any more.
    assert (album_dir / "tracks" / "02-two.mp3").is_file()


def test_a_missing_audio_wav_fails_loudly(conn, albums_dir):
    album, album_dir = _ready_album(albums_dir)
    (album_dir / "audio.wav").unlink()
    job_id = _queue(conn, _recipe(album))
    run_one(conn, device="cpu")
    done = get_job(conn, job_id)
    assert done.state == "failed"
    assert "audio.wav" in done.error


def test_a_cancel_leaves_no_zip_and_no_temp_file(conn, albums_dir):
    album, album_dir = _ready_album(albums_dir)
    job_id = _queue(conn, _recipe(album))
    request_cancel(conn, job_id)
    run_one(conn, device="cpu")
    assert get_job(conn, job_id).state == "cancelled"
    assert not zip_path(album_dir).exists()
    assert list(album_dir.glob("**/*.tmp")) == []


def test_a_payload_that_is_not_a_recipe_fails_with_pydantics_message(conn, albums_dir):
    job_id = enqueue(conn, kind="split_album", song_id=None, payload={"nonsense": True})
    run_one(conn, device="cpu")
    done = get_job(conn, job_id)
    assert done.state == "failed"
    assert "album_id" in done.error
```

- [ ] **Step 2: Run to verify they fail**

Run: `uv run pytest packages/stemcraft_worker/tests/test_split_album.py -v`
Expected: FAIL — `ModuleNotFoundError: ... 'split_album'`

- [ ] **Step 3: Write the kind**

Create `packages/stemcraft_worker/src/stemcraft_worker/kinds/split_album.py`:

```python
"""The `split_album` job kind: one album master cut into N tagged MP3s and one
zip (D8-06).

Like `export`, this kind deliberately **does not read album.json** (D8-05). Its
input is the SplitRecipe the API snapshotted into the payload at enqueue time,
because §6 requires idempotency by re-derivation from inputs that never change
and album.json is autosaved as the user drags markers and types titles.

The zip is built from the recipe's filenames, not from a directory listing --
so a track renamed between two splits leaves its old file on disk but never
ships in the new zip.

No torch: every track is one ffmpeg subprocess.
"""

from __future__ import annotations

from stemcraft_lib import ffmpeg
from stemcraft_lib.album import (
    SplitRecipe,
    TrackSpan,
    find_album_dir,
    track_path,
    tracks_dir,
    write_album_zip,
    zip_path,
)
from stemcraft_lib.config import settings

from ..registry import JobCancelled, JobContext, register


def run(ctx: JobContext) -> dict:
    # Validated rather than trusted: a payload that does not parse is a bug in
    # whoever enqueued it, and N-08 wants that visible as a failed job carrying
    # pydantic's own message, not as a split of something almost right.
    recipe = SplitRecipe.model_validate(ctx.payload)

    album_dir = find_album_dir(settings().albums_dir, recipe.album_id)
    if album_dir is None:
        raise RuntimeError(f"no album directory for album_id={recipe.album_id!r}")

    source = album_dir / "audio.wav"
    if not source.is_file():
        raise RuntimeError(
            f"album {recipe.album_id} has no audio.wav; the import_album job has not "
            "run or did not finish. Tracks render from the decoded master (D8-03), "
            "never from original.*"
        )

    tracks_dir(album_dir).mkdir(parents=True, exist_ok=True)
    total = len(recipe.tracks)
    rendered = []

    for index, track in enumerate(recipe.tracks):
        # D8-06: the checkpoint is between tracks. render_track writes through
        # atomic_output, so stopping here leaves no partial file behind.
        if ctx.cancelled():
            raise JobCancelled
        span = TrackSpan(
            number=track.number,
            title=track.title,
            start_sample=track.start_sample,
            end_sample=track.end_sample,
            filename=track.filename,
        )
        destination = track_path(album_dir, track.filename)
        ffmpeg.render_track(
            source,
            span,
            destination,
            album_title=recipe.album_title,
            artist=recipe.artist,
            track_total=total,
        )
        rendered.append({"filename": track.filename, "bytes": destination.stat().st_size})
        # Held below 1.0 until the zip has been written too.
        ctx.progress(min(0.95, (index + 1) / (total + 1)))

    if ctx.cancelled():
        raise JobCancelled

    archive = write_album_zip(album_dir, [t.filename for t in recipe.tracks])
    ctx.progress(1.0)

    return {
        "zip": zip_path(album_dir).name,
        "bytes": archive.stat().st_size,
        "tracks": rendered,
    }


register("split_album", run)
```

- [ ] **Step 4: Run to verify they pass**

Run: `uv run pytest packages/stemcraft_worker/tests/test_split_album.py -v`
Expected: PASS

- [ ] **Step 5: Run the whole worker suite**

Run: `uv run pytest packages/stemcraft_worker -q`
Expected: the pre-existing worker tests (61 before this phase) still pass, plus the new ones.

- [ ] **Step 6: Commit**

```bash
git add packages/stemcraft_worker/src/stemcraft_worker/kinds/ packages/stemcraft_worker/tests/test_split_album.py
git commit -m "feat(worker): the split_album job kind, rendered from a payload snapshot"
```

---

## Task 6: API — the album routes

Upload, list, read, autosave, proposals, peaks, audio, queue a split, download a track or the
zip, delete. Modelled line for line on `routes/songs.py`, including its traversal guarding.

**Depends on:** Tasks 1, 4, 5 (it enqueues both kinds by name).

**Files:**
- Create: `packages/stemcraft_api/src/stemcraft_api/routes/albums.py`
- Create: `packages/stemcraft_api/tests/test_albums.py`
- Modify: `packages/stemcraft_api/src/stemcraft_api/app.py`

**Interfaces:**
- Consumes: everything `album.py` produces; `jobs_db.enqueue`; `deps.get_conn`.
- Produces, relied on by Tasks 7 and 8 — the exact wire shapes:
  - `POST /api/albums/upload` (multipart `file`, `title`, `artist`) → 201
    `{"album": Album, "job_id": int}`
  - `GET /api/albums` → `{"albums": [AlbumEntry]}` where
    `AlbumEntry = {"dir": str, "album": Album | null, "state": str | null, "files": {...} | null, "unreadable": str | null}`
  - `GET /api/albums/{id}` → `AlbumEntry`
  - `PUT /api/albums/{id}` (body: `Album`) → `AlbumEntry`
  - `GET /api/albums/{id}/proposals` → `{"total_samples": int, "split_points": int[], ...}` or 404
  - `GET /api/albums/{id}/peaks` → the peaks file
  - `GET /api/albums/{id}/audio.wav` → the decoded master
  - `POST /api/albums/{id}/split` → 201 `{"job_id": int, "tracks": int}`
  - `GET /api/albums/{id}/tracks` → `{"tracks": [{"name","file","bytes"}]}`
  - `GET /api/albums/{id}/tracks/{filename}` → audio/mpeg
  - `GET /api/albums/{id}/album.zip` → application/zip
  - `DELETE /api/albums/{id}` → 204

- [ ] **Step 1: Write the failing tests**

Create `packages/stemcraft_api/tests/test_albums.py`. Read
`packages/stemcraft_api/tests/test_songs.py` first and reuse its `client`/temp-tree fixtures
verbatim rather than building new ones.

```python
from __future__ import annotations

import json

from stemcraft_lib.album import create_album_dir, new_album, read_album
from stemcraft_lib.config import SAMPLE_RATE


def _upload(client, name="album.flac", title="Kind of Blue", artist="Miles Davis"):
    return client.post(
        "/api/albums/upload",
        files={"file": (name, b"\x00\x01\x02", "audio/flac")},
        data={"title": title, "artist": artist},
    )


# --- upload -------------------------------------------------------------

def test_upload_creates_the_album_and_queues_its_import(client, albums_dir, conn):
    response = _upload(client)
    assert response.status_code == 201
    body = response.json()
    album_id = body["album"]["id"]
    album_dir = next(albums_dir.iterdir())
    # §5: the API owns album.json AND original.* -- the bytes are already in
    # hand, so only the slow decode is a job. Same split as song upload.
    assert (album_dir / "album.json").is_file()
    assert (album_dir / "original.flac").is_file()
    job = [j for j in conn.execute("SELECT * FROM jobs")][0]
    assert job["kind"] == "import_album"
    assert json.loads(job["payload"])["album_id"] == album_id
    # D8-07: an album is not a Song, so the Song column is null.
    assert job["song_id"] is None


def test_upload_falls_back_to_the_filename_when_no_title_is_given(client, albums_dir):
    response = _upload(client, name="Live At Leeds.wav", title="")
    assert response.json()["album"]["title"] == "Live At Leeds"


def test_an_extensionless_upload_still_gets_a_file(client, albums_dir):
    _upload(client, name="noextension")
    assert (next(albums_dir.iterdir()) / "original.input").is_file()


# --- read and autosave --------------------------------------------------

def test_get_album_reports_derived_state_not_a_stored_field(client, albums_dir):
    album_id = _upload(client).json()["album"]["id"]
    body = client.get(f"/api/albums/{album_id}").json()
    assert body["state"] == "uploaded"
    assert body["files"]["has_audio"] is False


def test_put_saves_split_points_and_titles(client, albums_dir):
    album_id = _upload(client).json()["album"]["id"]
    album = client.get(f"/api/albums/{album_id}").json()["album"]
    album["total_samples"] = 1000
    album["split_points"] = [400]
    album["tracks"] = [{"title": "So What"}, {"title": "Blue in Green"}]
    response = client.put(f"/api/albums/{album_id}", json=album)
    assert response.status_code == 200
    saved = read_album(next(albums_dir.iterdir()))
    assert saved.split_points == [400]
    assert [t.title for t in saved.tracks] == ["So What", "Blue in Green"]


def test_put_refuses_a_body_whose_id_does_not_match_the_path(client, albums_dir):
    album_id = _upload(client).json()["album"]["id"]
    album = client.get(f"/api/albums/{album_id}").json()["album"]
    album["id"] = "somethingelse"
    assert client.put(f"/api/albums/{album_id}", json=album).status_code == 409


def test_put_cannot_rewrite_provenance(client, albums_dir):
    album_id = _upload(client).json()["album"]["id"]
    album = client.get(f"/api/albums/{album_id}").json()["album"]
    original_created = album["created_at"]
    album["created_at"] = "1999-01-01T00:00:00+00:00"
    album["source_value"] = "somethingelse.mp3"
    client.put(f"/api/albums/{album_id}", json=album)
    saved = read_album(next(albums_dir.iterdir()))
    assert saved.created_at == original_created
    assert saved.source_value == "original.flac"


def test_an_inconsistent_track_count_is_422_not_a_silent_fix(client, albums_dir):
    # N-08: pydantic's own message, never a clamp or a pad.
    album_id = _upload(client).json()["album"]["id"]
    album = client.get(f"/api/albums/{album_id}").json()["album"]
    album["total_samples"] = 1000
    album["split_points"] = [300, 600]
    album["tracks"] = [{"title": "only one"}]
    assert client.put(f"/api/albums/{album_id}", json=album).status_code == 422


def test_a_split_point_past_the_end_is_422(client, albums_dir):
    album_id = _upload(client).json()["album"]["id"]
    album = client.get(f"/api/albums/{album_id}").json()["album"]
    album["total_samples"] = 1000
    album["split_points"] = [5000]
    album["tracks"] = [{"title": "a"}, {"title": "b"}]
    assert client.put(f"/api/albums/{album_id}", json=album).status_code == 422


# --- proposals ----------------------------------------------------------

def test_proposals_are_404_until_the_import_job_has_written_them(client, albums_dir):
    album_id = _upload(client).json()["album"]["id"]
    assert client.get(f"/api/albums/{album_id}/proposals").status_code == 404


def test_proposals_are_served_as_written(client, albums_dir):
    album_id = _upload(client).json()["album"]["id"]
    album_dir = next(albums_dir.iterdir())
    (album_dir / "proposals.json").write_text(
        json.dumps({"total_samples": 1000, "split_points": [400, 700]})
    )
    body = client.get(f"/api/albums/{album_id}/proposals").json()
    assert body["split_points"] == [400, 700]


# --- queueing a split ---------------------------------------------------

def _ready(client, albums_dir, *, split_points=None, titles=None):
    album_id = _upload(client).json()["album"]["id"]
    album_dir = next(albums_dir.iterdir())
    (album_dir / "audio.wav").write_bytes(b"")
    (album_dir / "peaks.json").write_text("{}")
    album = client.get(f"/api/albums/{album_id}").json()["album"]
    album["total_samples"] = SAMPLE_RATE * 12
    album["split_points"] = split_points if split_points is not None else [SAMPLE_RATE * 6]
    album["tracks"] = [{"title": t} for t in (titles or ["One", "Two"])]
    client.put(f"/api/albums/{album_id}", json=album)
    return album_id, album_dir


def test_split_snapshots_the_recipe_into_the_payload(client, albums_dir, conn):
    album_id, _ = _ready(client, albums_dir)
    response = client.post(f"/api/albums/{album_id}/split")
    assert response.status_code == 201
    assert response.json()["tracks"] == 2
    job = [j for j in conn.execute("SELECT * FROM jobs WHERE kind = 'split_album'")][0]
    payload = json.loads(job["payload"])
    # D8-05: resolved at enqueue, not a pointer to album.json.
    assert payload["album_id"] == album_id
    assert payload["album_title"] == "Kind of Blue"
    assert [t["filename"] for t in payload["tracks"]] == ["01-one.mp3", "02-two.mp3"]
    assert [t["start_sample"] for t in payload["tracks"]] == [0, SAMPLE_RATE * 6]


def test_split_before_the_import_finished_is_409_naming_the_reason(client, albums_dir):
    album_id = _upload(client).json()["album"]["id"]
    response = client.post(f"/api/albums/{album_id}/split")
    assert response.status_code == 409
    assert "audio" in response.json()["detail"].lower()


def test_split_of_an_unknown_album_is_404(client, albums_dir):
    assert client.post("/api/albums/nosuchid/split").status_code == 404


def test_split_before_the_length_is_stamped_is_409_not_a_500(client, albums_dir):
    # recipe_from_album() yields no tracks while total_samples is 0, and
    # SplitRecipe requires at least one -- that must surface as a 409 naming the
    # reason, never as a pydantic traceback out of a 500.
    album_id = _upload(client).json()["album"]["id"]
    album_dir = next(albums_dir.iterdir())
    (album_dir / "audio.wav").write_bytes(b"")
    response = client.post(f"/api/albums/{album_id}/split")
    assert response.status_code == 409
    assert "length" in response.json()["detail"].lower()


# --- downloads and traversal -------------------------------------------

def test_track_download_serves_the_file(client, albums_dir):
    album_id, album_dir = _ready(client, albums_dir)
    tracks = album_dir / "tracks"
    tracks.mkdir()
    (tracks / "01-one.mp3").write_bytes(b"audio")
    response = client.get(f"/api/albums/{album_id}/tracks/01-one.mp3")
    assert response.status_code == 200
    assert response.headers["content-type"] == "audio/mpeg"


def test_zip_download_serves_the_archive(client, albums_dir):
    album_id, album_dir = _ready(client, albums_dir)
    (album_dir / "album.zip").write_bytes(b"PK\x03\x04")
    response = client.get(f"/api/albums/{album_id}/album.zip")
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/zip"
    assert "attachment" in response.headers["content-disposition"]


def test_zip_before_a_split_is_404(client, albums_dir):
    album_id, _ = _ready(client, albums_dir)
    assert client.get(f"/api/albums/{album_id}/album.zip").status_code == 404


import pytest


@pytest.mark.parametrize(
    "name",
    [
        "../album.json",
        "..%2F..%2Falbum.json",
        "01-ONE.mp3",        # uppercase is outside the pattern the app writes
        "1-one.mp3",         # unpadded number
        "01-one.wav",        # wrong extension
        "missing.mp3",
    ],
)
def test_track_download_rejects_anything_the_app_never_wrote(client, albums_dir, name):
    # The filename is matched against TRACK_FILENAME_PATTERN rather than
    # sanitized: a name outside that alphabet is a name this app never produced.
    album_id, _ = _ready(client, albums_dir)
    assert client.get(f"/api/albums/{album_id}/tracks/{name}").status_code == 404


# --- delete -------------------------------------------------------------

def test_delete_removes_the_whole_album(client, albums_dir):
    album_id, album_dir = _ready(client, albums_dir)
    assert client.delete(f"/api/albums/{album_id}").status_code == 204
    assert not album_dir.exists()


def test_delete_is_blocked_by_a_live_job(client, albums_dir, conn):
    album_id, _ = _ready(client, albums_dir)
    client.post(f"/api/albums/{album_id}/split")
    response = client.delete(f"/api/albums/{album_id}")
    assert response.status_code == 409
    assert "job" in response.json()["detail"].lower()


def test_one_unreadable_album_does_not_break_the_list(client, albums_dir):
    _upload(client)
    bad = albums_dir / "01BAD-broken"
    bad.mkdir()
    (bad / "album.json").write_text("{not json")
    body = client.get("/api/albums").json()
    assert len(body["albums"]) == 2
    assert sum(1 for a in body["albums"] if a["unreadable"]) == 1
```

- [ ] **Step 2: Run to verify they fail**

Run: `uv run pytest packages/stemcraft_api/tests/test_albums.py -v`
Expected: FAIL — every route 404s (the router does not exist yet).

- [ ] **Step 3: Write the router**

Create `packages/stemcraft_api/src/stemcraft_api/routes/albums.py`:

```python
"""Album splitter routes. A standalone tool beside the library (Q-04): nothing
here imports from song.py or touches the songs/ tree.

Written against routes/songs.py -- same _entry/_find_dir/derived-state idiom,
same traversal guarding on downloads, same one-writer rule (this module writes
album.json and original.*; the worker writes everything else).
"""

from __future__ import annotations

import json
import shutil
import sqlite3
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile
from fastapi.responses import FileResponse
from stemcraft_lib import jobs as jobs_db
from stemcraft_lib.album import (
    ALBUM_SCHEMA_VERSION,
    TRACK_FILENAME_PATTERN,
    Album,
    AlbumUnreadable,
    create_album_dir,
    derive_album_files,
    find_album_dir,
    list_tracks,
    new_album,
    read_album,
    recipe_from_album,
    track_path,
    write_album,
    zip_path,
)
from stemcraft_lib.atomic import atomic_write_bytes
from stemcraft_lib.config import settings

from ..deps import get_conn

router = APIRouter()
Conn = Annotated[sqlite3.Connection, Depends(get_conn)]


def _default_title(filename: str | None) -> str:
    return (Path(filename).stem if filename else "") or "Untitled Album"


def _entry(album_dir: Path) -> dict:
    try:
        album = read_album(album_dir)
    except AlbumUnreadable as exc:
        # §9: one bad file never breaks the list.
        return {"dir": album_dir.name, "album": None, "state": None, "files": None,
                "unreadable": str(exc)}
    files = derive_album_files(album_dir)
    return {
        "dir": album_dir.name,
        "album": album.model_dump(mode="json"),
        "state": files.state,
        "files": {
            "has_audio": files.has_audio,
            "has_peaks": files.has_peaks,
            "has_proposals": files.has_proposals,
            "has_tracks": files.has_tracks,
            "has_zip": files.has_zip,
        },
        "unreadable": None,
    }


def _album_dirs() -> list[Path]:
    albums_dir = settings().albums_dir
    if not albums_dir.is_dir():
        return []
    return sorted(p for p in albums_dir.iterdir() if (p / "album.json").is_file())


def _find_dir(album_id: str) -> Path:
    album_dir = find_album_dir(settings().albums_dir, album_id)
    if album_dir is None:
        raise HTTPException(status_code=404, detail=f"no album with id {album_id}")
    return album_dir


@router.get("/api/albums")
def list_albums() -> dict:
    return {"albums": [_entry(d) for d in _album_dirs()]}


@router.get("/api/albums/{album_id}")
def get_album(album_id: str) -> dict:
    return _entry(_find_dir(album_id))


@router.post("/api/albums/upload", status_code=201)
def upload_album(
    conn: Conn,
    file: Annotated[UploadFile, File()],
    title: Annotated[str, Form()] = "",
    artist: Annotated[str, Form()] = "",
) -> dict:
    # Sync, not async, for the same reason as upload_song: a sqlite3.Connection
    # can only be used from the thread that created it, and FastAPI runs a sync
    # route and its sync dependencies on one threadpool thread.
    ext = Path(file.filename).suffix.lower() if file.filename else ""
    if not ext:
        ext = ".input"
    content = file.file.read()

    album = new_album(
        title=title.strip() or _default_title(file.filename),
        artist=artist.strip(),
        source_value=f"original{ext}",
    )
    album_dir = create_album_dir(settings().albums_dir, album)
    atomic_write_bytes(album_dir / f"original{ext}", content)

    # D8-07: song_id stays NULL -- an album is not a Song and never becomes one.
    job_id = jobs_db.enqueue(
        conn, kind="import_album", song_id=None, payload={"album_id": album.id}
    )
    return {"album": album.model_dump(mode="json"), "job_id": job_id}


@router.put("/api/albums/{album_id}")
def update_album(album_id: str, body: Album) -> dict:
    """Whole-document autosave, mirroring PUT /api/songs/{id}. No ETag and no
    version check: C-01 assumes one active session and accepts last-write-wins.

    A body that violates Album's validators never reaches here -- FastAPI
    rejects it as 422 with pydantic's message, which is what N-08 wants for a
    split point past the end of the album or a track count that disagrees with
    the boundaries.
    """
    album_dir = _find_dir(album_id)
    if body.id != album_id:
        raise HTTPException(
            status_code=409,
            detail=f"body id {body.id!r} does not match path id {album_id!r}",
        )
    current = read_album(album_dir)
    # Provenance is a fact about the upload, not part of what the user edits.
    updated = body.model_copy(
        update={
            "schema_version": ALBUM_SCHEMA_VERSION,
            "id": current.id,
            "created_at": current.created_at,
            "source_value": current.source_value,
        }
    )
    write_album(album_dir, updated)
    return _entry(album_dir)


@router.get("/api/albums/{album_id}/proposals")
def get_proposals(album_id: str) -> dict:
    """D8-04: worker-owned, served separately from album.json so that applying
    them is an explicit user action and re-detecting never overwrites a drag."""
    path = _find_dir(album_id) / "proposals.json"
    if not path.is_file():
        raise HTTPException(
            status_code=404,
            detail=f"album {album_id} has no silence proposals yet; its import job "
            "has not finished",
        )
    return json.loads(path.read_text())


@router.get("/api/albums/{album_id}/peaks")
def get_album_peaks(album_id: str) -> FileResponse:
    path = _find_dir(album_id) / "peaks.json"
    if not path.is_file():
        raise HTTPException(status_code=404, detail=f"album {album_id} has no peaks yet")
    return FileResponse(path, media_type="application/json")


@router.get("/api/albums/{album_id}/audio.wav")
def get_album_audio(album_id: str) -> FileResponse:
    path = _find_dir(album_id) / "audio.wav"
    if not path.is_file():
        raise HTTPException(status_code=404, detail=f"album {album_id} has no decoded audio yet")
    return FileResponse(path, media_type="audio/wav")


@router.post("/api/albums/{album_id}/split", status_code=201)
def queue_split(album_id: str, conn: Conn) -> dict:
    """Resolve the live document into an immutable snapshot and queue the render
    (D8-05). Reads album.json and writes nothing -- the worker owns tracks/ and
    album.zip (§5)."""
    album_dir = _find_dir(album_id)
    album = read_album(album_dir)
    if not derive_album_files(album_dir).has_audio:
        raise HTTPException(
            status_code=409,
            detail=f"album {album_id} has no decoded audio yet; its import job has not "
            "finished, so there is nothing to split",
        )
    if album.total_samples <= 0:
        # The length is measured by the import job and stamped into album.json
        # by a PUT from the client (§2 keeps the worker out of this file). Until
        # that lands, track_spans() is empty and a recipe cannot be built --
        # a 409 naming the reason, never a 500 out of SplitRecipe's min_length.
        raise HTTPException(
            status_code=409,
            detail=f"album {album_id} has no measured length yet; its import job has "
            "finished but total_samples has not been saved",
        )
    recipe = recipe_from_album(album)
    job_id = jobs_db.enqueue(
        conn, kind="split_album", song_id=None, payload=recipe.model_dump(mode="json")
    )
    return {"job_id": job_id, "tracks": len(recipe.tracks)}


@router.get("/api/albums/{album_id}/tracks")
def get_tracks(album_id: str) -> dict:
    # Derived from the directory, like every other fact about an album.
    return {"tracks": list_tracks(_find_dir(album_id))}


@router.get("/api/albums/{album_id}/tracks/{filename}")
def download_track(album_id: str, filename: str) -> FileResponse:
    # Matched against the alphabet the app writes rather than sanitized -- a
    # name outside TRACK_FILENAME_PATTERN is a name this app never produced.
    # Same reasoning as the export download route.
    if not TRACK_FILENAME_PATTERN.match(filename):
        raise HTTPException(status_code=404, detail=f"no track named {filename!r}")
    path = track_path(_find_dir(album_id), filename)
    if not path.is_file():
        raise HTTPException(status_code=404, detail=f"album {album_id} has no track {filename!r}")
    return FileResponse(path, media_type="audio/mpeg", filename=filename)


@router.get("/api/albums/{album_id}/album.zip")
def download_zip(album_id: str) -> FileResponse:
    album_dir = _find_dir(album_id)
    path = zip_path(album_dir)
    if not path.is_file():
        raise HTTPException(
            status_code=404, detail=f"album {album_id} has not been split yet"
        )
    album = read_album(album_dir)
    from stemcraft_lib.ids import slugify

    return FileResponse(
        path, media_type="application/zip", filename=f"{slugify(album.title)}.zip"
    )


@router.delete("/api/albums/{album_id}", status_code=204)
def delete_album(album_id: str, conn: Conn) -> Response:
    album_dir = _find_dir(album_id)
    live = [
        j
        for j in jobs_db.list_jobs(conn, states=("queued", "running"))
        if j.payload.get("album_id") == album_id
    ]
    if live:
        ids = ", ".join(str(j.id) for j in live)
        raise HTTPException(
            status_code=409,
            detail=f"cannot delete album {album_id}: blocked by job(s) {ids} "
            "(queued or running)",
        )
    # The one sanctioned crossing of the one-writer rule, exactly as in
    # delete_song: a deliberate user delete removes the whole folder, gated on
    # there being no live job that could be writing into it right now.
    shutil.rmtree(album_dir)
    return Response(status_code=204)
```

- [ ] **Step 4: Wire the router in**

Modify `packages/stemcraft_api/src/stemcraft_api/app.py`:

```python
from .routes import albums, health, jobs, songs
```

and, beside the existing `include_router` calls:

```python
    app.include_router(albums.router)
```

- [ ] **Step 5: Run to verify they pass**

Run: `uv run pytest packages/stemcraft_api/tests/test_albums.py -v`
Expected: PASS

- [ ] **Step 6: Run the whole API suite and confirm nothing Song-side moved**

Run: `uv run pytest packages/stemcraft_api -q && uv run ruff check packages/`
Expected: the pre-existing API tests (61 before this phase) all still pass.

Then confirm Q-04's boundary held:

```bash
git diff --name-only HEAD~1 | grep -E 'song' || echo "no Song-side file touched — correct"
```

- [ ] **Step 7: Commit**

```bash
git add packages/stemcraft_api/
git commit -m "feat(api): album routes — upload, autosave, proposals, split, zip"
```

---

## Task 7: Frontend API layer and the span mirror

Types, URL helpers and query hooks for albums, plus a client-side mirror of `track_spans` so
the track table can label and time rows without a round trip per drag.

**Depends on:** Task 6 (the wire shapes).

**Files:**
- Modify: `frontend/src/api/client.ts`, `frontend/src/api/queries.ts`
- Create: `frontend/src/splitter/spans.ts`, `frontend/src/splitter/spans.test.ts`

**Interfaces:**
- Produces: `Album`, `AlbumTrack`, `AlbumEntry`, `AlbumFiles`, `AlbumState`, `Proposals`,
  `CreatedAlbum`, `QueuedSplit`; `albumMedia(id)`, `albumZipUrl(id)`, `albumTrackUrl(id, name)`;
  `useAlbums()`, `useAlbum(id)`, `useUploadAlbum()`, `useUpdateAlbum(id)`, `useProposals(id)`,
  `useQueueSplit()`, `useAlbumTracks(id)`, `useDeleteAlbum()`;
  `trackSpans(album): ClientSpan[]` where
  `ClientSpan = { number, title, startSample, endSample, startSeconds, durationSeconds, filename }`.

- [ ] **Step 1: Write the failing tests for the span mirror**

Create `frontend/src/splitter/spans.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import type { Album } from '../api/client';
import { trackSpans } from './spans';

const SAMPLE_RATE = 48000;

function album(overrides: Partial<Album> = {}): Album {
  return {
    schema_version: 1,
    id: '01J0',
    title: 'Kind of Blue',
    artist: 'Miles Davis',
    source_value: 'original.flac',
    created_at: '2026-09-28T00:00:00+00:00',
    total_samples: SAMPLE_RATE * 10,
    split_points: [],
    tracks: [{ title: '' }],
    ...overrides,
  };
}

describe('trackSpans', () => {
  it('is contiguous and covers the whole album (D8-02)', () => {
    const spans = trackSpans(
      album({ split_points: [SAMPLE_RATE * 4], tracks: [{ title: 'A' }, { title: 'B' }] }),
    );
    expect(spans.map((s) => [s.startSample, s.endSample])).toEqual([
      [0, SAMPLE_RATE * 4],
      [SAMPLE_RATE * 4, SAMPLE_RATE * 10],
    ]);
  });

  it('derives numbers from position', () => {
    const spans = trackSpans(
      album({ split_points: [SAMPLE_RATE * 4], tracks: [{ title: 'A' }, { title: 'B' }] }),
    );
    expect(spans.map((s) => s.number)).toEqual([1, 2]);
  });

  it('produces the same filenames the server will (so the UI can show them before the split)', () => {
    const spans = trackSpans(
      album({ split_points: [SAMPLE_RATE * 4], tracks: [{ title: 'So What' }, { title: '' }] }),
    );
    expect(spans.map((s) => s.filename)).toEqual(['01-so-what.mp3', '02-track-2.mp3']);
  });

  it('is empty before the import job has measured the file', () => {
    expect(trackSpans(album({ total_samples: 0 }))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/splitter/spans.test.ts`
Expected: FAIL — cannot resolve `./spans`

- [ ] **Step 3: Write `spans.ts`**

Create `frontend/src/splitter/spans.ts`:

```ts
// A mirror of stemcraft_lib.album.track_spans, so the track table can label and
// time rows as the user drags a marker without a round trip per pixel. The
// server remains authoritative: this computes what the server WILL compute from
// the same album.json, and the filenames it produces are asserted against the
// Python rule in that module's tests.
import type { Album } from '../api/client';

// D-03: the one sample rate, restated here because sample indices are the unit
// every split point is stored in.
const SAMPLE_RATE = 48000;

export interface ClientSpan {
  number: number;
  title: string;
  startSample: number;
  endSample: number;
  startSeconds: number;
  durationSeconds: number;
  filename: string;
}

// Mirrors stemcraft_lib.ids.slugify: NFKD, drop non-ASCII, collapse everything
// outside [a-z0-9] to a single hyphen, trim, cap at 60.
export function slugify(text: string): string {
  const ascii = text.normalize('NFKD').replace(/[̀-ͯ]/g, '');
  const slug = ascii
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.slice(0, 60).replace(/-+$/, '') || 'untitled';
}

export function trackSpans(album: Album): ClientSpan[] {
  if (album.total_samples <= 0) return [];
  const edges = [0, ...album.split_points, album.total_samples];
  return album.tracks.map((track, index) => {
    const number = index + 1;
    const startSample = edges[index];
    const endSample = edges[index + 1];
    const slug = track.title.trim() ? slugify(track.title) : `track-${number}`;
    return {
      number,
      title: track.title,
      startSample,
      endSample,
      startSeconds: startSample / SAMPLE_RATE,
      durationSeconds: (endSample - startSample) / SAMPLE_RATE,
      filename: `${String(number).padStart(2, '0')}-${slug}.mp3`,
    };
  });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npx vitest run src/splitter/spans.test.ts`
Expected: PASS

- [ ] **Step 5: Add the album types to `client.ts`**

Append to `frontend/src/api/client.ts`:

```ts
// Mirrors packages/stemcraft_lib/src/stemcraft_lib/album.py. Q-04: an album is
// a standalone document, not a Song — these types share nothing with Song.
export interface AlbumTrack {
  title: string;
}

export interface Album {
  schema_version: number;
  id: string;
  title: string;
  artist: string;
  source_value: string;
  created_at: string;
  total_samples: number;
  // Invariant 4: sample indices at 48 kHz, never float seconds.
  split_points: number[];
  tracks: AlbumTrack[];
}

export type AlbumState = 'uploaded' | 'ready' | 'split';

export interface AlbumFiles {
  has_audio: boolean;
  has_peaks: boolean;
  has_proposals: boolean;
  has_tracks: boolean;
  has_zip: boolean;
}

export interface AlbumEntry {
  dir: string;
  album: Album | null;
  state: AlbumState | null;
  files: AlbumFiles | null;
  unreadable: string | null;
}

// Worker-owned, served separately from album.json (D8-04) so that applying a
// proposal is an explicit action and re-detecting cannot overwrite a drag.
export interface Proposals {
  total_samples: number;
  split_points: number[];
  noise_db: number;
  min_silence_seconds: number;
}

export interface CreatedAlbum {
  album: Album;
  job_id: number;
}

export interface QueuedSplit {
  job_id: number;
  tracks: number;
}

export interface AlbumTrackFile {
  name: string;
  file: string;
  bytes: number;
}

// Same-origin relative paths, like every other path in this module (D-15).
export function albumMedia(albumId: string) {
  return {
    peaks: `/api/albums/${albumId}/peaks`,
    audio: `/api/albums/${albumId}/audio.wav`,
  };
}

export function albumZipUrl(albumId: string): string {
  return `/api/albums/${albumId}/album.zip`;
}

export function albumTrackUrl(albumId: string, filename: string): string {
  return `/api/albums/${albumId}/tracks/${filename}`;
}
```

- [ ] **Step 6: Add the hooks to `queries.ts`**

Follow the existing file's idiom exactly — in particular, model `useUpdateAlbum` on
`useUpdateSong`, which already solves the stale-closure problem this needs (read its comment
about `observer.setOptions` before writing this one).

```ts
export function useAlbums() {
  return useQuery({
    queryKey: ['albums'],
    queryFn: () => api.get<{ albums: AlbumEntry[] }>('/api/albums'),
    select: (data) => data.albums,
  });
}

export function useAlbum(albumId: string | undefined) {
  return useQuery({
    queryKey: ['album', albumId],
    queryFn: () => api.get<AlbumEntry>(`/api/albums/${albumId}`),
    enabled: Boolean(albumId),
  });
}

export function useProposals(albumId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['album-proposals', albumId],
    queryFn: () => api.get<Proposals>(`/api/albums/${albumId}/proposals`),
    enabled: Boolean(albumId) && enabled,
    // A 404 here means "the import job has not finished", which is a state, not
    // a failure — retrying on it would just hammer the route.
    retry: false,
  });
}

export function useUploadAlbum() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (form: FormData) => api.upload<CreatedAlbum>('/api/albums/upload', form),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['albums'] });
      client.invalidateQueries({ queryKey: ['jobs'] });
    },
  });
}

export function useQueueSplit() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (albumId: string) => api.post<QueuedSplit>(`/api/albums/${albumId}/split`),
    onSuccess: () => client.invalidateQueries({ queryKey: ['jobs'] }),
  });
}

export function useAlbumTracks(albumId: string | undefined) {
  return useQuery({
    queryKey: ['album-tracks', albumId],
    queryFn: () => api.get<{ tracks: AlbumTrackFile[] }>(`/api/albums/${albumId}/tracks`),
    enabled: Boolean(albumId),
    select: (data) => data.tracks,
  });
}

export function useDeleteAlbum() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (albumId: string) => api.del(`/api/albums/${albumId}`),
    onSuccess: () => client.invalidateQueries({ queryKey: ['albums'] }),
  });
}
```

`useUpdateAlbum(albumId)` mirrors `useUpdateSong`'s debounced-autosave shape, sending
`PUT /api/albums/{id}` with the whole `Album` document and invalidating `['album', albumId]`
on success. Copy that function and change the path, the type and the query keys; do not
invent a different autosave mechanism.

- [ ] **Step 7: Typecheck and run the suite**

Run: `cd frontend && npx tsc --noEmit && npx vitest run`
Expected: clean; the 179 pre-existing frontend tests still pass.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/api frontend/src/splitter
git commit -m "feat(frontend): album API surface and the client-side span mirror"
```

---

## Task 8: The Album splitter screen

The screen the phase exists for: upload, waveform with draggable boundaries, the track table
with fill-down, split, download.

**Depends on:** Task 7.

**Files:**
- Modify: `frontend/src/screens/AlbumSplitter.tsx` (replaces the one-line stub)
- Create: `frontend/src/screens/AlbumSplitter.module.css`, `frontend/src/screens/AlbumSplitter.test.tsx`
- Create: `frontend/src/splitter/WaveformMarkers.tsx` + `.module.css` + `.test.tsx`
- Create: `frontend/src/splitter/TrackTable.tsx` + `.module.css` + `.test.tsx`

**Interfaces:**
- Consumes: everything Task 7 produces; `useJobStream` for live progress (read its existing
  usage in `JobQueue.tsx` and follow it).
- Produces: no exports other than the components themselves.

**One thing this task owns that is easy to miss:** `Album.total_samples` starts at 0 and the
worker cannot write it (invariant 2 — the API owns `album.json`). The measured length is
reported by the `import_album` job and also written into worker-owned `proposals.json`. **The
screen is what stamps it:** when it loads an album with `total_samples === 0` and proposals
exist, it immediately PUTs the album with `total_samples` taken from the proposals —
*without* touching `split_points`, because adopting boundaries is a separate, explicit action
(D8-04). Until that PUT lands, `trackSpans()` is empty and `POST /split` answers 409. There is
a test for it below; do not skip it, because everything else on the screen depends on it.

**Component contracts** (write these signatures exactly; the screen is built against them):

```ts
export interface WaveformMarkersProps {
  peaks: number[];            // the envelope, 0..1, as peaks.json stores it
  totalSamples: number;
  splitPoints: number[];      // sample indices, sorted
  playheadSample: number | null;
  onMove(index: number, sample: number): void;  // a marker dragged
  onAdd(sample: number): void;                  // a click on empty waveform
  onRemove(index: number): void;                // a marker's × pressed
  onScrub(sample: number): void;                // seek the <audio> element
}

export interface TrackTableProps {
  spans: ClientSpan[];
  onTitleChange(index: number, title: string): void;
}
```

> **Why there is no `onFillDown` prop.** Fill-down is for the album fields, not the track
> titles. The domain spec says "Album fields entered once — artist and album — and filled down to every track", and a per-track
> *title* fill-down would overwrite every title with one string, which is never what anyone
> wants. Album and artist are single inputs on the screen that apply to every track by
> construction (they are fields on `Album`, not on `Track`), and they reach every rendered file
> through `SplitRecipe.album_title`/`artist` — so "typed once and filled down" is satisfied by
> the data model rather than by a button.

- [ ] **Step 1: Write the failing tests for `WaveformMarkers`**

Create `frontend/src/splitter/WaveformMarkers.test.tsx`. Mock `wavesurfer.js` the way
`StemLane.test.tsx` already does — copy that `vi.mock` block verbatim; jsdom has no canvas
and no ResizeObserver, and the mock is also what lets the invariant be asserted.

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { WaveformMarkers } from './WaveformMarkers';

// (copy the wavesurfer vi.mock block from src/songview/StemLane.test.tsx here)

const props = {
  peaks: [0, 0.5, 1, 0.5, 0],
  totalSamples: 480000,          // 10 s at 48 kHz
  splitPoints: [240000],         // one boundary at 5 s
  playheadSample: null,
  onMove: vi.fn(),
  onAdd: vi.fn(),
  onRemove: vi.fn(),
  onScrub: vi.fn(),
};

describe('WaveformMarkers', () => {
  it('constructs wavesurfer from precomputed peaks, never a URL or media element (invariant 7 / D-07)', () => {
    render(<WaveformMarkers {...props} />);
    // `create` is the vi.fn() from the mock block copied above; its last call's
    // first argument is the options object the component passed.
    const options = waveSurferCreate.mock.calls.at(-1)![0];
    expect(options.peaks).toBeDefined();
    expect(options.url).toBeUndefined();
    expect(options.media).toBeUndefined();
    expect(options.interact).toBe(false);
  });

  it('renders one marker per split point', () => {
    render(<WaveformMarkers {...props} />);
    expect(screen.getAllByRole('slider', { name: /split point/i })).toHaveLength(1);
  });

  it('positions a marker by its fraction of the album, not by seconds', () => {
    render(<WaveformMarkers {...props} />);
    const marker = screen.getByRole('slider', { name: /split point/i });
    expect(marker.style.left).toBe('50%');
  });

  it('removes a marker when its remove control is pressed', () => {
    render(<WaveformMarkers {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /remove split point 1/i }));
    expect(props.onRemove).toHaveBeenCalledWith(0);
  });

  it('moves a marker with the arrow keys, so a boundary is placeable without a mouse (U-02)', () => {
    render(<WaveformMarkers {...props} />);
    const marker = screen.getByRole('slider', { name: /split point/i });
    fireEvent.keyDown(marker, { key: 'ArrowRight' });
    // One step is 0.1 s = 4800 samples at 48 kHz.
    expect(props.onMove).toHaveBeenCalledWith(0, 244800);
  });

  it('reports sample indices, never seconds, to every callback (invariant 4)', () => {
    render(<WaveformMarkers {...props} />);
    const marker = screen.getByRole('slider', { name: /split point/i });
    fireEvent.keyDown(marker, { key: 'ArrowRight' });
    const [, sample] = props.onMove.mock.calls.at(-1)!;
    expect(Number.isInteger(sample)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify they fail, then write `WaveformMarkers.tsx`**

Run: `cd frontend && npx vitest run src/splitter/WaveformMarkers.test.tsx` → FAIL.

Write the component. The shape:

- One `useEffect` constructing wavesurfer from `peaks` and a derived duration, with
  `cursorWidth: 0`, `interact: false`, `normalize: false` — **identical to `StemLane`'s
  construction, for the identical reason (D-07): it renders, it never plays.**
- An absolutely-positioned overlay `<div>` per split point, `left: ${(sample / totalSamples) * 100}%`.
- Each marker is `role="slider"` with `aria-label={`split point ${i + 1}`}`,
  `aria-valuemin={0}`, `aria-valuemax={totalSamples}`, `aria-valuenow={sample}`, `tabIndex={0}`.
  Arrow keys move it by 4800 samples (0.1 s); Shift+Arrow by 48000 (1 s).
- Pointer drag via `onPointerDown` + `setPointerCapture`, converting clientX to a sample with
  the container's `getBoundingClientRect()`. **Round to an integer sample** — invariant 4.
- A click on the waveform background (not on a marker) calls `onAdd`; a separate scrub
  affordance calls `onScrub`.
- The playhead is a second overlay element at `playheadSample / totalSamples`, drawn by this
  component from the prop — wavesurfer's own cursor stays off.

- [ ] **Step 3: Run to verify they pass**

- [ ] **Step 4: Write the failing tests for `TrackTable`, then the component**

Create `frontend/src/splitter/TrackTable.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TrackTable } from './TrackTable';

const spans = [
  { number: 1, title: 'So What', startSample: 0, endSample: 240000,
    startSeconds: 0, durationSeconds: 5, filename: '01-so-what.mp3' },
  { number: 2, title: '', startSample: 240000, endSample: 480000,
    startSeconds: 5, durationSeconds: 5, filename: '02-track-2.mp3' },
];

describe('TrackTable', () => {
  it('shows automatic track numbers', () => {
    render(<TrackTable spans={spans} onTitleChange={vi.fn()} />);
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('shows the filename each track will be written as, before the split runs', () => {
    render(<TrackTable spans={spans} onTitleChange={vi.fn()} />);
    expect(screen.getByText('02-track-2.mp3')).toBeInTheDocument();
  });

  it('shows each track duration as minutes and seconds, not raw samples', () => {
    render(<TrackTable spans={spans} onTitleChange={vi.fn()} />);
    expect(screen.getAllByText('0:05')).toHaveLength(2);
  });

  it('reports a title edit by row index', () => {
    const onTitleChange = vi.fn();
    render(<TrackTable spans={spans} onTitleChange={onTitleChange} />);
    fireEvent.change(screen.getAllByRole('textbox')[1], { target: { value: 'Blue in Green' } });
    expect(onTitleChange).toHaveBeenCalledWith(1, 'Blue in Green');
  });
});
```

- [ ] **Step 5: Write the failing tests for the screen, then `AlbumSplitter.tsx`**

Create `frontend/src/screens/AlbumSplitter.test.tsx`:

Mock `fetch` per the idiom already used in `Export.test.tsx` — read it first and reuse its
helper rather than inventing another. `renderWith(entry, extras?)` below stands for that
helper seeded with a `GET /api/albums/:id` response; `putBody()` returns the body of the last
`PUT /api/albums/:id`.

```tsx
const SR = 48000;

const readyAlbum = {
  dir: '01J0-test',
  album: {
    schema_version: 1, id: '01J0', title: 'Test Album', artist: 'Tester',
    source_value: 'original.flac', created_at: '2026-09-28T00:00:00+00:00',
    total_samples: SR * 600, split_points: [SR * 300],
    tracks: [{ title: 'One' }, { title: 'Two' }],
  },
  state: 'ready',
  files: { has_audio: true, has_peaks: true, has_proposals: true, has_tracks: false, has_zip: false },
  unreadable: null,
};

describe('AlbumSplitter', () => {
  it('stamps total_samples from the proposals when the album has not been measured', async () => {
    const unmeasured = { ...readyAlbum, album: { ...readyAlbum.album, total_samples: 0, split_points: [], tracks: [{ title: '' }] } };
    renderWith(unmeasured, { proposals: { total_samples: SR * 600, split_points: [SR * 300] } });
    // The length is adopted; the boundaries are NOT (D8-04).
    await waitFor(() => expect(putBody()).toMatchObject({ total_samples: SR * 600, split_points: [] }));
  });

  it('disables the split button until the album has decoded audio, and says why', async () => {
    renderWith({ ...readyAlbum, state: 'uploaded', files: { ...readyAlbum.files, has_audio: false } });
    const button = await screen.findByRole('button', { name: /split/i });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription(/import/i);
  });

  it('applies the proposals only when asked, and grows the track list to match', async () => {
    renderWith(readyAlbum, { proposals: { total_samples: SR * 600, split_points: [SR * 200, SR * 400] } });
    fireEvent.click(await screen.findByRole('button', { name: /use proposed/i }));
    await waitFor(() => {
      const body = putBody();
      expect(body.split_points).toEqual([SR * 200, SR * 400]);
      // N points must produce exactly N+1 tracks, or the PUT is a 422 (D8-02).
      expect(body.tracks).toHaveLength(3);
    });
  });

  it('leaves dragged boundaries alone until the user applies proposals again (D8-04)', async () => {
    renderWith(readyAlbum, { proposals: { total_samples: SR * 600, split_points: [SR * 200] } });
    const marker = await screen.findByRole('slider', { name: /split point 1/i });
    // The album's own boundary survives the proposals merely being available.
    expect(marker).toHaveAttribute('aria-valuenow', String(SR * 300));
  });

  it('keeps the track count consistent when a boundary is removed', async () => {
    renderWith(readyAlbum);
    fireEvent.click(await screen.findByRole('button', { name: /remove split point 1/i }));
    await waitFor(() => {
      const body = putBody();
      expect(body.split_points).toEqual([]);
      expect(body.tracks).toHaveLength(1);
    });
  });

  it('autosaves a track title edit', async () => {
    renderWith(readyAlbum);
    const titleInputs = await screen.findAllByRole('textbox', { name: /track title/i });
    fireEvent.change(titleInputs[0], { target: { value: 'So What' } });
    await waitFor(() => expect(putBody().tracks[0].title).toBe('So What'));
  });

  it('offers the zip only once the split has finished, from derived state', async () => {
    renderWith({ ...readyAlbum, state: 'split', files: { ...readyAlbum.files, has_zip: true } });
    // files.has_zip gates it -- never a local "I clicked split" flag.
    expect(await screen.findByRole('link', { name: /download/i })).toHaveAttribute(
      'href', '/api/albums/01J0/album.zip',
    );
  });

  it('does not offer the zip before a split has run', async () => {
    renderWith(readyAlbum);
    await screen.findByRole('slider', { name: /split point 1/i });
    expect(screen.queryByRole('link', { name: /download/i })).toBeNull();
  });

  it('shows the real error text when a split job fails (N-08)', async () => {
    renderWith(readyAlbum, {
      jobs: [{ id: 7, kind: 'split_album', state: 'failed', error: 'ffmpeg: Invalid data found' }],
    });
    expect(await screen.findByText(/Invalid data found/)).toBeInTheDocument();
  });

  it('never constructs a wavesurfer that can play (invariant 7 / D-07)', async () => {
    renderWith(readyAlbum);
    await screen.findByRole('slider', { name: /split point 1/i });
    const options = waveSurferCreate.mock.calls.at(-1)![0];
    expect(options.url).toBeUndefined();
    expect(options.media).toBeUndefined();
    expect(options.peaks).toBeDefined();
  });
});
```

Then write the screen:
- Album selection: a list from `useAlbums()` plus an upload form (follow `Import.tsx`'s form
  idiom — it already handles the FormData and the error surface).
- Album/artist inputs bound to `Album.title` / `Album.artist`, autosaved. **These are the
  "typed once and filled down" fields**: they live on the album, so every track inherits them
  by construction.
- `<audio src={albumMedia(id).audio} controls>` for preview (D8-11), its `timeupdate`
  driving `playheadSample`, and `onScrub` setting its `currentTime`.
- `WaveformMarkers` + `TrackTable`, both fed from `trackSpans(album)`.
- **Every edit goes through one `applyEdit(next: Album)` helper** that keeps
  `tracks.length === split_points.length + 1` before calling the autosave mutation. Adding a
  boundary inserts an empty `Track` at the right index; removing one deletes the track after
  it. Getting this wrong is a 422 on every keystroke.
- Split button, disabled unless `files.has_audio`, with the reason in its title when disabled.
- Download: `<a href={albumZipUrl(id)} download>` shown when `files.has_zip`.

- [ ] **Step 6: Run the whole frontend suite and typecheck**

Run: `cd frontend && npx tsc --noEmit && npx vitest run && npx vite build`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add frontend/src
git commit -m "feat(frontend): the Album splitter screen — waveform, boundaries, track table"
```

---

## Task 9: Real-hardware verification

Everything above runs against synthetic fixtures. This task runs the phase against a real
album on the practice machine and **records measured numbers, not "works"**.

**Depends on:** Tasks 1–8.

- [ ] **Step 1: Restart both services.** The running API and worker predate this phase and
      have neither new job kind. Nothing below works until they are restarted.

- [ ] **Step 2: Run the full automated suite one more time, all four packages**

```bash
uv run pytest packages/ -q && cd frontend && npx tsc --noEmit && npx vitest run && npx vite build
```

- [ ] **Step 3: Confirm Q-04's boundary held across the whole phase**

```bash
git diff --stat main@{u}..HEAD -- packages/stemcraft_lib/src/stemcraft_lib/song.py packages/stemcraft_api/src/stemcraft_api/routes/songs.py
```

Expected: **empty.** A non-empty diff means the splitter grew into the Song write path and
Q-04 was quietly reopened.

- [ ] **Step 4: Measure, and write the results into this document**

Record each as a number:

| Check | What to record |
| --- | --- |
| A real album uploads and its `import_album` job finishes | wall time, `audio.wav` size |
| Proposed boundaries vs. the actual track count | proposed N, actual N, how many were right |
| A proposal's accuracy | how far the midpoint sits from where you'd put it, in seconds |
| `split_album` on a full album | wall time, tracks rendered, zip size |
| Track durations | each track's duration vs. its boundaries, worst-case error |
| ID3 | title, artist, album and `track N/total` present in a player |
| Re-running the same split | same file count, same zip contents |
| Cancel mid-split | job → `cancelled`, no zip, no `.tmp`, how many tracks survived |
| Delete an album | the whole tree gone, blocked while a job is live |
| The zip | opens in a file manager, every track plays |
| Traversal | `../album.json`, uppercase, unpadded number — all 404 |
| Full stack in a browser | upload → drag a boundary → split → progress bar moves → zip downloads |

- [ ] **Step 5: The listening check that only a human can do**

- [ ] Does each split land **between** tracks rather than clipping a decay or an attack?
      Listen to the last 2 s of each track and the first 2 s of the next.
- [ ] On a **gapless** record (a live album, a DJ mix, anything crossfaded), what does
      silence detection do? Record what it proposed, even if the answer is "nothing useful" —
      that is a real finding about the feature's limits, not a failure to hide.
- [ ] Is a track that ends in a fade **complete**, or does the boundary cut it short?

Record measured numbers. **A number that misses its target gets recorded as a miss and opens
a question; it does not get rounded into a pass.**

- [ ] **Step 6: Commit the verification log**

```bash
git add docs/superpowers/plans/2026-09-28-phase-8-album-splitter.md
git commit -m "docs: Phase 8 verification log"
```

---

## Exit criteria (roadmap Phase 8)

- [ ] Silence detection proposes split points; the user drags, adds and removes them.
- [ ] Album fields typed once and filled down; automatic track numbers.
- [ ] Tagged MP3s, downloadable as a zip.
- [ ] **Q-04 decided and recorded:** output stays a zip; the splitter does not share the Song
      write path. The seam for changing that later is named in D8-01 and Q-04 above.

## Verification log

*(Task 9 fills this in. Until then it is empty, and the phase is not done.)*
