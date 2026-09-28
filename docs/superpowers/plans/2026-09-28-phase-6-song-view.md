# Stemcraft Phase 6: Song view, play along — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** build the screen the product exists for — four stacked stem waveforms slaved to
Phase 3's engine clock, per-stem mute/solo/gain, live tempo and pitch, an A–B loop snapped
to bars and resolved through Phase 5's beat grid, a metronome and count-in locked to that
same grid, a chord strip aligned to bars, and a practice recipe that auto-saves to
`song.json`.

**Architecture:** the Song view is a thin React shell around the Phase 3 engine, which
grows a transport (play/pause), a metronome and count-in this phase. Everything audible
still happens in **one** `AudioWorkletProcessor` feeding **one** SoundTouch instance
(D-05): the metronome click is synthesised **in the input domain, inside `renderBlock`,
mixed with the stems**, so it goes through the same stretcher the music does and is
therefore aligned with it by construction rather than by scheduling. React never sees
audio-rate state: the playhead, the bar readout and the chord highlight are all driven by
one `requestAnimationFrame` loop reading `EngineController.getPositionSamples()` and
writing to DOM refs (U-05, D-13). wavesurfer renders waveforms from peaks computed in the
browser from the buffers the engine already decoded — it never fetches, never decodes and
never plays (D-07, and it keeps N-03 to one download per stem).

**Tech Stack:** existing (React 19, React Router 7, TanStack Query 5, CSS modules,
`@soundtouchjs/audio-worklet`, Vitest + Testing Library, FastAPI, pydantic) plus one new
frontend dependency: **`wavesurfer.js` ^7** (rendering and region UI only, D-07). No new
Python dependencies; the API gains no imports beyond `fastapi`/`stemcraft_lib`.

**Spec:** [design/tech-spec-stemcraft.md](../../../design/tech-spec-stemcraft.md) §2 (N-03,
N-05, N-06), §5 (layout, invariants, sample rate and the beat grid, consistency and
concurrency), §6 (HTTP/JSON contracts, audio over HTTP), D-03, D-05, D-06, D-07, D-10,
D-13, D-14, D-16; [design/domain-spec.md](../../../design/domain-spec.md) "Song view: play
along"; [design/ui-spec.md](../../../design/ui-spec.md) §2 U-C1, §3 U-01/U-03/U-04/U-05/
U-06/U-08/U-09/U-10, §5 (Stem strip, Timeline, Transport bar, Slider), §6 screen 3, §7
(keyboard); phase map: [2026-09-27-stemcraft-roadmap.md](2026-09-27-stemcraft-roadmap.md)
Phase 6. Prior phases: [Phase 3 engine](2026-09-27-phase-3-playback-engine.md),
[Phase 4 separation](2026-09-27-phase-4-separation.md),
[Phase 5 analysis](2026-09-28-phase-5-analysis.md).

## Global Constraints

Every task inherits these. They are correctness floors copied from the spec, not
preferences.

- **The API never imports torch (§4).** This phase adds routes that read files off disk
  and one route that writes `song.json`. Nothing else.
- **48 kHz everywhere (D-03).** Every position, loop bound, beat and chord boundary that
  crosses a module boundary is an **integer sample index at 48 kHz** (`SampleIndex`), never
  float seconds. Conversion to the `AudioContext`'s device rate happens only at
  `EngineController`'s edge, via the existing `toDeviceDomain`/`toStemDomain`.
- **One writer per file (§5).** The API owns `song.json` — the frontend mutates it only
  through `PUT /api/songs/{id}`. The worker owns `stems/`, `analysis.json`, `peaks.json`.
  Nothing in this phase writes into a worker-owned path.
- **Stems are immutable (§5).** Mix, tempo, pitch and loops are a recipe applied at
  playback. Nothing here re-separates or rewrites a stem.
- **All writes atomic** — `stemcraft_lib.atomic.atomic_write_json`, already used by
  `write_song`.
- **Never seek the time-stretcher (D-06).** Loops wrap the cursor in the input domain with
  the existing ~5 ms crossfade. `EngineController.seek()` moves the *cursor*, never the
  SoundTouch node, and remains the only position-setting path.
- **Mix to stereo before stretching (D-05).** One SoundTouch instance. The metronome is
  mixed in *before* the stretcher for the same reason.
- **wavesurfer.js never plays audio (D-07).** It is constructed with precomputed `peaks`
  and an explicit `duration`, never a URL or a media element it would fetch. Its own cursor
  is disabled (`cursorWidth: 0`); the playhead is ours.
- **The playhead is positioned by `requestAnimationFrame` from the engine clock, never by
  a CSS transition or animation (U-05).** One rAF loop for the whole screen.
- **Last write wins on `song.json` (§5, C-01).** No ETag, no locking, no merge. Two tabs
  clobbering each other is observed and accepted, not fixed.
- **Fail loudly (N-08, U-09).** A missing stem, a failed decode, a rejected `PUT` shows the
  real message verbatim, in mono, on screen. No silent fallback, no friendly paraphrase.
- **Not in scope:** the A–B tempo ramp (`domain-spec.md:198` is stale; commit 2c934e4
  removed it from the design). Per-stem EQ, per-stem pitch, practice mode, light theme (UI
  spec §8) stay deferred.

## Decisions this phase makes

Recorded here because later phases and reviewers will ask, and because none of them is
re-litigable from inside a task.

- **D6-01 — Stem waveform peaks are computed in the browser from the buffers the engine
  already decoded, not fetched from the server.** `peaks.json` covers the *mix* only; there
  is no per-stem peaks file and adding four would mean a worker change, a re-derivation
  pass over already-separated songs, and four more HTTP round trips inside N-03's 3 s
  budget. The engine decodes all four stems before it can play anything, so the sample data
  is already in memory; bucketing it costs one linear pass. *Rejected:* a `peaks` job kind
  per stem (new worker output for data we already hold); letting wavesurfer fetch and
  decode the `.opus` files itself (doubles the download and the decode, and D-07 exists
  precisely to stop wavesurfer owning audio).
- **D6-02 — Near-silence (U-10) is derived in the browser from those same decoded
  buffers**, using the worker's `NEAR_SILENT_THRESHOLD` (0.02) mirrored as a frontend
  constant. The `separate` job already records `near_silent` in its `jobs.sqlite` result
  row, but that row is job *history*: it can be pruned (§12), it is absent for a song
  separated by an older build, and reading it would make a playback screen depend on the
  queue. Deriving it from the audio is the same rule the rest of the app follows — derive
  state from what exists, never store it. *Rejected:* reading the job result (couples
  playback to job history); a new field in `song.json` (the API would be storing a fact
  about worker-owned files).
- **D6-03 — The metronome is synthesised in the input domain and mixed with the stems
  before the stretcher.** A click generated after the stretcher would arrive early by the
  stretcher's buffer — exactly N-06's 50–100 ms — and drift with tempo. Mixing it in the
  input domain makes it share the music's latency and its timebase exactly. The cost is
  that the click is time-stretched like everything else, which at 50–100 % is a slightly
  softened transient and an accepted trade. *Rejected:* a second AudioBufferSourceNode
  scheduled from the clock (needs the stretcher's latency, which SoundTouch does not
  publish); a second output bypassing the stretcher (same problem, plus two clocks).
- **D6-04 — Solo is transient; mute is persistent.** `song.json`'s `StemMix` has
  `gain_db` and `muted` and gains no `soloed` field. Solo is a momentary "let me hear just
  this" gesture, not a saved practice setting, and a session that reloaded into a
  three-stems-muted state nobody chose would read as breakage. Solo lives in React state
  and is derived into gains at the engine edge.
- **D6-05 — `song.json` goes to schema_version 2** to carry the active A–B loop, the
  metronome toggle and the count-in length: they are settings that must "survive a reload"
  (roadmap exit criteria) and there is nowhere else for them to live. The v1→v2 migration
  is additive with pydantic defaults, and `read_song` already has the migration seam.

## File structure

| File | Responsibility |
| --- | --- |
| `packages/stemcraft_lib/src/stemcraft_lib/song.py` (modify) | `Song` v2: `active_loop`, `metronome`, `count_in_bars`; v1→v2 migration |
| `packages/stemcraft_api/src/stemcraft_api/routes/songs.py` (modify) | media routes (stems, peaks, audio) and `PUT /api/songs/{id}` |
| `packages/stemcraft_api/tests/test_songs_media.py` (create) | media route tests, incl. path-traversal rejection |
| `packages/stemcraft_api/tests/test_songs_update.py` (create) | `PUT` tests: round-trip, id mismatch, last-write-wins |
| `packages/stemcraft_lib/tests/test_song.py` (modify) | v2 defaults and v1→v2 migration |
| `frontend/src/music/grid.ts` (create) | pure bar↔sample math over a `BeatGrid` |
| `frontend/src/music/grid.test.ts` (create) | grid round-trip and snapping tests |
| `frontend/src/engine/loopCursor.ts` (modify) | transport gate, end-of-stem stop, click synthesis in `renderBlock` |
| `frontend/src/engine/click.ts` (create) | pure click envelope + beat-lookup helpers used by `renderBlock` |
| `frontend/src/engine/stem-cursor-processor.ts` (modify) | `playing`/`metronomeGain` params, `set-grid`, `start-count-in` messages |
| `frontend/src/engine/EngineController.ts` (modify) | `play`/`pause`/`setMute`/`setSolo`/`setMetronome`/`countIn`/`durationSamples`/stem summaries |
| `frontend/src/engine/stemPeaks.ts` (create) | browser-side peak bucketing + near-silence (D6-01, D6-02) |
| `frontend/src/api/client.ts` (modify) | v2 `Song` fields, media URL helpers |
| `frontend/src/api/queries.ts` (modify) | `useUpdateSong` (debounced whole-document autosave) |
| `frontend/src/songview/StemLane.tsx` + `.module.css` (create) | one stem strip: wavesurfer canvas, M/S, gain, near-silent pill |
| `frontend/src/songview/Timeline.tsx` + `.module.css` (create) | bar ruler, beat/downbeat grid, A–B region, rAF playhead |
| `frontend/src/songview/ChordStrip.tsx` + `.module.css` (create) | chords aligned to bars, current chord highlighted by rAF |
| `frontend/src/songview/Transport.tsx` + `.module.css` (create) | play/pause, tempo, pitch, bar readout, metronome, keyboard |
| `frontend/src/songview/RightRail.tsx` + `.module.css` (create) | key candidates, saved loops, count-in |
| `frontend/src/songview/usePlayhead.ts` (create) | the single rAF subscription every readout hangs off |
| `frontend/src/screens/SongView.tsx` (rewrite) + `.module.css` (create) | assembly, engine lifecycle, autosave, U-06 |
| `docs/superpowers/plans/2026-09-28-phase-6-song-view.md` (this file) | plan and the real-hardware verification log (Task 14) |

---

## Task 1: API media routes

**Files:**
- Modify: `packages/stemcraft_api/src/stemcraft_api/routes/songs.py`
- Test: `packages/stemcraft_api/tests/test_songs_media.py` (create)

**Interfaces:**
- Consumes: `stemcraft_lib.song.STEM_NAMES`, `find_song_dir`, the existing `_find_dir`
  helper in `routes/songs.py`.
- Produces: `GET /api/songs/{song_id}/stems/{stem}.opus` → `audio/ogg` file;
  `GET /api/songs/{song_id}/peaks` → the mix `peaks.json` verbatim;
  `GET /api/songs/{song_id}/audio.wav` → `audio/wav` file. All 404 with a real message
  when the file is not there yet.

- [ ] **Step 1: Write the failing tests**

Create `packages/stemcraft_api/tests/test_songs_media.py`. Mirror the fixture style of the
existing `packages/stemcraft_api/tests/test_songs_analysis.py` — read that file first and
reuse its `client`/`songs_dir` fixtures rather than inventing new ones.

```python
from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient


def _make_song(songs_dir, song_id: str = "abc123"):
    """A song folder with a stems/ set and a peaks.json, no worker involved."""
    song_dir = songs_dir / f"{song_id}-test-song"
    (song_dir / "stems").mkdir(parents=True)
    (song_dir / "song.json").write_text(
        json.dumps(
            {
                "schema_version": 2,
                "id": song_id,
                "title": "Test Song",
                "artist": "",
                "source": {"kind": "upload", "value": "original.mp3"},
                "created_at": "2026-09-28T00:00:00+00:00",
            }
        )
    )
    for name in ("vocals", "drums", "bass", "other"):
        (song_dir / "stems" / f"{name}.opus").write_bytes(b"OggS-fake-" + name.encode())
    (song_dir / "peaks.json").write_text(json.dumps({"version": 1, "length": 4}))
    (song_dir / "audio.wav").write_bytes(b"RIFF-fake")
    return song_dir


def test_stem_is_served_with_its_bytes(client: TestClient, songs_dir):
    _make_song(songs_dir)
    response = client.get("/api/songs/abc123/stems/bass.opus")
    assert response.status_code == 200
    assert response.content == b"OggS-fake-bass"
    assert response.headers["content-type"].startswith("audio/ogg")


def test_unknown_stem_name_is_rejected_without_touching_the_filesystem(
    client: TestClient, songs_dir
):
    _make_song(songs_dir)
    response = client.get("/api/songs/abc123/stems/guitar.opus")
    assert response.status_code == 404
    assert "guitar" in response.text


@pytest.mark.parametrize("attack", ["..%2F..%2Fsong.json", "....//song.json"])
def test_path_traversal_in_the_stem_name_never_escapes_the_song_folder(
    client: TestClient, songs_dir, attack: str
):
    _make_song(songs_dir)
    response = client.get(f"/api/songs/abc123/stems/{attack}.opus")
    assert response.status_code == 404
    assert b"schema_version" not in response.content


def test_missing_stem_file_404s_with_a_real_message(client: TestClient, songs_dir):
    song_dir = _make_song(songs_dir)
    (song_dir / "stems" / "vocals.opus").unlink()
    response = client.get("/api/songs/abc123/stems/vocals.opus")
    assert response.status_code == 404
    assert "vocals" in response.text


def test_peaks_are_served_as_json(client: TestClient, songs_dir):
    _make_song(songs_dir)
    response = client.get("/api/songs/abc123/peaks")
    assert response.status_code == 200
    assert response.json() == {"version": 1, "length": 4}


def test_audio_wav_is_served(client: TestClient, songs_dir):
    _make_song(songs_dir)
    response = client.get("/api/songs/abc123/audio.wav")
    assert response.status_code == 200
    assert response.content == b"RIFF-fake"


def test_media_for_an_unknown_song_404s(client: TestClient, songs_dir):
    response = client.get("/api/songs/nope/stems/bass.opus")
    assert response.status_code == 404
```

If `test_songs_analysis.py` defines its fixtures locally rather than in a `conftest.py`,
copy them into this file verbatim rather than refactoring the existing test module — this
task is not a refactor.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
uv run pytest packages/stemcraft_api/tests/test_songs_media.py -v
```

Expected: every test FAILS with 404s produced by the SPA catch-all or "no API route",
because the routes do not exist yet.

- [ ] **Step 3: Implement the routes**

In `packages/stemcraft_api/src/stemcraft_api/routes/songs.py`, add the import
`from fastapi.responses import FileResponse` and `from stemcraft_lib.song import STEM_NAMES`
to the existing import block, then add these routes immediately after `get_analysis`:

```python
@router.get("/api/songs/{song_id}/stems/{stem}.opus")
def get_stem(song_id: str, stem: str) -> FileResponse:
    # §6: .opus per stem is the only thing ever served for playback (D-04).
    # `stem` is path-shaped and attacker-controlled, so it is matched against
    # the fixed four names rather than sanitized -- there is no case where a
    # fifth name is legitimate (the stem set is fixed at training time), so a
    # whitelist is both the safest and the most honest check.
    if stem not in STEM_NAMES:
        raise HTTPException(status_code=404, detail=f"no stem named {stem!r}")
    path = _find_dir(song_id) / "stems" / f"{stem}.opus"
    if not path.is_file():
        raise HTTPException(
            status_code=404, detail=f"song {song_id} has no {stem}.opus yet (not separated)"
        )
    return FileResponse(path, media_type="audio/ogg")


@router.get("/api/songs/{song_id}/peaks")
def get_peaks(song_id: str) -> FileResponse:
    path = _find_dir(song_id) / "peaks.json"
    if not path.is_file():
        raise HTTPException(status_code=404, detail=f"song {song_id} has no peaks.json yet")
    return FileResponse(path, media_type="application/json")


@router.get("/api/songs/{song_id}/audio.wav")
def get_audio(song_id: str) -> FileResponse:
    path = _find_dir(song_id) / "audio.wav"
    if not path.is_file():
        raise HTTPException(status_code=404, detail=f"song {song_id} has no audio.wav yet")
    return FileResponse(path, media_type="audio/wav")
```

`FileResponse` handles `Range` requests itself, which is what §6's "range requests
supported" asks for; nothing extra is needed.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
uv run pytest packages/stemcraft_api/tests/ -v
```

Expected: PASS, including the pre-existing API tests.

- [ ] **Step 5: Commit**

```bash
git add packages/stemcraft_api/src/stemcraft_api/routes/songs.py packages/stemcraft_api/tests/test_songs_media.py
git commit -m "feat(api): serve stem opus, peaks and audio.wav for the Song view"
```

---

## Task 2: `song.json` schema v2 — active loop, metronome, count-in

**Files:**
- Modify: `packages/stemcraft_lib/src/stemcraft_lib/song.py`
- Test: `packages/stemcraft_lib/tests/test_song.py`

**Interfaces:**
- Consumes: the existing `Song`, `Loop`, `_migrate`, `read_song`, `write_song`.
- Produces: `SCHEMA_VERSION = 2`; `Song.active_loop: Loop | None = None`,
  `Song.metronome: bool = False`, `Song.count_in_bars: int = 0`; a v1→v2 migration that
  leaves every v1 field untouched.

- [ ] **Step 1: Write the failing tests**

Append to `packages/stemcraft_lib/tests/test_song.py` (match the file's existing fixture
and import style):

```python
def test_new_song_defaults_to_no_active_loop_no_metronome_no_count_in():
    song = new_song(title="T", artist="", source_kind="upload", source_value="original.mp3")
    assert song.schema_version == 2
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
    assert song.schema_version == 2
    # Everything v1 knew is preserved verbatim; only the new fields are defaulted.
    assert song.title == "Old Song"
    assert song.mix["vocals"].muted is True
    assert song.playback.tempo == 0.8
    assert song.loops == [Loop(name="Verse", start_bar=4, end_bar=12)]
    assert song.active_loop is None
    assert song.metronome is False
    assert song.count_in_bars == 0
```

Make sure `json`, `Loop`, `new_song`, `read_song` and `write_song` are imported at the top
of the test module; add whichever are missing.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
uv run pytest packages/stemcraft_lib/tests/test_song.py -v
```

Expected: FAIL — `schema_version == 2` assertions fail against 1, `active_loop` does not
exist, and the migration test raises `SongUnreadable: no migration from schema_version 1`.

- [ ] **Step 3: Implement the schema bump and migration**

In `packages/stemcraft_lib/src/stemcraft_lib/song.py`:

```python
SCHEMA_VERSION = 2
```

Add the three fields to `Song`, after `loops`:

```python
class Song(BaseModel):
    schema_version: int = SCHEMA_VERSION
    id: str
    title: str
    artist: str = ""
    source: Source
    created_at: str
    last_played_at: str | None = None
    mix: dict[str, StemMix] = Field(default_factory=dict)
    playback: Playback = Field(default_factory=Playback)
    loops: list[Loop] = Field(default_factory=list)
    # v2 (Phase 6). The A-B loop the user is currently practising, distinct from
    # `loops` (the named ones they saved). Stored as bar numbers like every other
    # loop, because bars are user-meaningful and survive a re-analysis that moves
    # the sample indices under them (tech spec §5).
    active_loop: Loop | None = None
    metronome: bool = False
    count_in_bars: int = 0
```

Replace the `_migrate` tail (the `raise SongUnreadable(f"{path}: no migration ...")` line)
with the actual v1→v2 step:

```python
def _migrate(raw: dict, path: Path) -> dict:
    version = raw.get("schema_version")
    if version == SCHEMA_VERSION:
        return raw
    if not isinstance(version, int):
        raise SongUnreadable(f"{path}: missing or non-integer schema_version")
    if version > SCHEMA_VERSION:
        raise SongUnreadable(
            f"{path}: schema_version {version} is newer than this build understands "
            f"({SCHEMA_VERSION}); refusing to guess"
        )
    if version == 1:
        # v1 -> v2 (Phase 6) is purely additive: active_loop, metronome and
        # count_in_bars take their pydantic defaults. Nothing is renamed or
        # dropped, so the only work is stamping the version forward; the file
        # itself is rewritten on the next write_song (§5: migrated in place).
        raw = {**raw, "schema_version": 2}
        version = 2
    if version == SCHEMA_VERSION:
        return raw
    raise SongUnreadable(f"{path}: no migration from schema_version {version}")
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
uv run pytest packages/stemcraft_lib/tests/ packages/stemcraft_api/tests/ -v
```

Expected: PASS. The API tests are included because several of them write `song.json`
fixtures by hand; if any pins `schema_version: 1`, that is now a *migration* test and
should still pass — if one fails, fix the fixture to v2 rather than weakening the
migration.

- [ ] **Step 5: Commit**

```bash
git add packages/stemcraft_lib/src/stemcraft_lib/song.py packages/stemcraft_lib/tests/test_song.py
git commit -m "feat(lib): song.json v2 with active loop, metronome and count-in"
```

---

## Task 3: `PUT /api/songs/{id}` — whole-document recipe autosave

**Files:**
- Modify: `packages/stemcraft_api/src/stemcraft_api/routes/songs.py`
- Test: `packages/stemcraft_api/tests/test_songs_update.py` (create)

**Interfaces:**
- Consumes: `read_song`, `write_song`, `_find_dir`, `_entry`, `Song` (v2 from Task 2).
- Produces: `PUT /api/songs/{song_id}` taking a whole `Song` document and returning the
  same `_entry(...)` shape `GET /api/songs/{song_id}` returns. 409 when the body's `id`
  disagrees with the path. Immutable fields (`id`, `created_at`, `source`) are taken from
  disk, never from the body.

- [ ] **Step 1: Write the failing tests**

Create `packages/stemcraft_api/tests/test_songs_update.py`, reusing the `client`/`songs_dir`
fixture style of `test_songs_media.py` from Task 1:

```python
from __future__ import annotations

import json

from fastapi.testclient import TestClient


def _create(client: TestClient) -> dict:
    response = client.post(
        "/api/songs/from-url",
        json={"url": "https://example.invalid/x", "title": "Test Song"},
    )
    assert response.status_code == 201
    return response.json()["song"]


def test_put_round_trips_the_whole_recipe(client: TestClient, songs_dir):
    song = _create(client)
    song["mix"] = {"vocals": {"gain_db": -6.0, "muted": True}}
    song["playback"] = {"tempo": 0.75, "pitch_semitones": -2}
    song["active_loop"] = {"name": "A-B", "start_bar": 8, "end_bar": 16}
    song["metronome"] = True
    song["count_in_bars"] = 2
    song["last_played_at"] = "2026-09-28T12:00:00+00:00"

    response = client.put(f"/api/songs/{song['id']}", json=song)
    assert response.status_code == 200
    assert response.json()["song"]["active_loop"]["end_bar"] == 16

    # And it is on disk, not just echoed back.
    reread = client.get(f"/api/songs/{song['id']}").json()["song"]
    assert reread["playback"]["tempo"] == 0.75
    assert reread["mix"]["vocals"]["muted"] is True
    assert reread["metronome"] is True


def test_put_returns_the_same_shape_as_get(client: TestClient, songs_dir):
    song = _create(client)
    put = client.put(f"/api/songs/{song['id']}", json=song).json()
    get = client.get(f"/api/songs/{song['id']}").json()
    assert put.keys() == get.keys()
    assert put["state"] == get["state"]


def test_put_with_a_mismatched_id_is_rejected(client: TestClient, songs_dir):
    song = _create(client)
    song["id"] = "someoneelse"
    response = client.put(f"/api/songs/{song['id']}", json=song)
    # The path id no longer exists, so this is a 404 before it is anything else.
    assert response.status_code == 404

    other = _create(client)
    body = {**other, "id": song["id"]}
    response = client.put(f"/api/songs/{other['id']}", json=body)
    assert response.status_code == 409
    assert other["id"] in response.text


def test_put_cannot_rewrite_immutable_provenance(client: TestClient, songs_dir):
    song = _create(client)
    body = {
        **song,
        "created_at": "1999-01-01T00:00:00+00:00",
        "source": {"kind": "upload", "value": "hacked.mp3"},
    }
    response = client.put(f"/api/songs/{song['id']}", json=body)
    assert response.status_code == 200
    stored = response.json()["song"]
    assert stored["created_at"] == song["created_at"]
    assert stored["source"] == song["source"]


def test_last_write_wins_with_no_version_check(client: TestClient, songs_dir):
    # §5 / C-01: two tabs clobber each other and that is the accepted design.
    song = _create(client)
    first = {**song, "playback": {"tempo": 0.5, "pitch_semitones": 0}}
    second = {**song, "playback": {"tempo": 0.9, "pitch_semitones": 0}}
    assert client.put(f"/api/songs/{song['id']}", json=first).status_code == 200
    assert client.put(f"/api/songs/{song['id']}", json=second).status_code == 200
    assert client.get(f"/api/songs/{song['id']}").json()["song"]["playback"]["tempo"] == 0.9


def test_put_to_an_unknown_song_404s(client: TestClient, songs_dir):
    response = client.put("/api/songs/nope", json={"id": "nope"})
    assert response.status_code == 404
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
uv run pytest packages/stemcraft_api/tests/test_songs_update.py -v
```

Expected: FAIL — 405 Method Not Allowed (or the SPA catch-all), no `PUT` route exists.

- [ ] **Step 3: Implement the route**

Add to `packages/stemcraft_api/src/stemcraft_api/routes/songs.py`, after `get_analysis`
and before `upload_song`. Import `Song` from `stemcraft_lib.song` alongside the existing
names:

```python
@router.put("/api/songs/{song_id}")
def update_song(song_id: str, body: Song) -> dict:
    """Whole-document write of the practice recipe (§6: Song mutations are
    whole-document song.json writes). There is deliberately no ETag and no
    version check: §5/C-01 assume one active session and accept last-write-wins,
    and the seam for changing that later is an ETag on this resource.
    """
    song_dir = _find_dir(song_id)
    if body.id != song_id:
        raise HTTPException(
            status_code=409,
            detail=f"body id {body.id!r} does not match path id {song_id!r}",
        )
    current = read_song(song_dir)
    # Provenance is not part of the recipe and is not the client's to rewrite:
    # `created_at` and `source` are facts about the import, and `id` names the
    # folder. Everything else in the body wins wholesale.
    updated = body.model_copy(
        update={
            "schema_version": SCHEMA_VERSION,
            "id": current.id,
            "created_at": current.created_at,
            "source": current.source,
        }
    )
    write_song(song_dir, updated)
    return _entry(song_dir)
```

Import `SCHEMA_VERSION` from `stemcraft_lib.song` too. A `SongUnreadable` from `read_song`
propagates as a 500 with the real text — correct: a Song whose `song.json` cannot be read
must not be silently overwritten by a `PUT`, because that would destroy the file the user
needs to inspect.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
uv run pytest packages/stemcraft_api/tests/ -v
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/stemcraft_api/src/stemcraft_api/routes/songs.py packages/stemcraft_api/tests/test_songs_update.py
git commit -m "feat(api): PUT /api/songs/{id} whole-document recipe write"
```

---

## Task 4: Bar ↔ sample math over the beat grid

**Files:**
- Create: `frontend/src/music/grid.ts`
- Test: `frontend/src/music/grid.test.ts` (create)

**Interfaces:**
- Consumes: `BeatGrid` from `../api/client`; `SampleIndex`, `sampleIndex` from
  `../engine/types`.
- Produces:
  - `interface Grid { bars: SampleIndex[]; beats: SampleIndex[]; beatsPerBar: number; bpm: number; barCount: number; }`
  - `buildGrid(beatGrid: BeatGrid): Grid | null` — `null` when there are fewer than two
    downbeats (nothing bar-shaped to resolve against).
  - `barStart(grid: Grid, bar: number): SampleIndex` — clamped to `[0, barCount]`,
    extrapolating past the last downbeat by the median bar length.
  - `barAt(grid: Grid, position: SampleIndex): number` — the 0-indexed bar containing
    `position`; `-1` before the first downbeat.
  - `snapToBar(grid: Grid, position: SampleIndex): number` — nearest bar number.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/music/grid.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { sampleIndex, SAMPLE_RATE } from '../engine/types';
import { barAt, barStart, buildGrid, snapToBar } from './grid';
import type { BeatGrid } from '../api/client';

/** 120 BPM, 4/4: a beat every 0.5 s, a bar every 2 s, at 48 kHz. */
function fourFour(bars: number): BeatGrid {
  const beatSamples = SAMPLE_RATE / 2;
  const beats: number[] = [];
  const downbeats: number[] = [];
  for (let i = 0; i < bars * 4; i++) {
    const at = i * beatSamples;
    beats.push(at);
    if (i % 4 === 0) downbeats.push(at);
  }
  return { bpm: 120, beats, downbeats };
}

describe('buildGrid', () => {
  it('derives beats per bar from the downbeat spacing', () => {
    const grid = buildGrid(fourFour(8))!;
    expect(grid.beatsPerBar).toBe(4);
    expect(grid.barCount).toBe(8);
    expect(grid.bpm).toBe(120);
  });

  it('handles 3/4 without being told the time signature', () => {
    const beats: number[] = [];
    const downbeats: number[] = [];
    for (let i = 0; i < 12; i++) {
      beats.push(i * 24_000);
      if (i % 3 === 0) downbeats.push(i * 24_000);
    }
    const grid = buildGrid({ bpm: 120, beats, downbeats })!;
    expect(grid.beatsPerBar).toBe(3);
  });

  it('returns null when there are not two downbeats to measure a bar with', () => {
    expect(buildGrid({ bpm: 0, beats: [], downbeats: [] })).toBeNull();
    expect(buildGrid({ bpm: 120, beats: [0], downbeats: [0] })).toBeNull();
  });
});

describe('bar round trip', () => {
  it('maps every bar number to a sample offset and back exactly', () => {
    // Phase 5's exit criterion, asserted from the consumer side: the grid
    // round-trips bar numbers to sample offsets exactly.
    const grid = buildGrid(fourFour(16))!;
    for (let bar = 0; bar < grid.barCount; bar++) {
      expect(barAt(grid, barStart(grid, bar))).toBe(bar);
    }
  });

  it('bar starts are exactly the downbeats, with no float drift', () => {
    const grid = buildGrid(fourFour(16))!;
    expect(barStart(grid, 0)).toBe(0);
    expect(barStart(grid, 1)).toBe(SAMPLE_RATE * 2);
    expect(barStart(grid, 7)).toBe(SAMPLE_RATE * 14);
    expect(Number.isInteger(barStart(grid, 5))).toBe(true);
  });

  it('extrapolates past the last downbeat by the median bar length', () => {
    const grid = buildGrid(fourFour(4))!; // bars 0..3, last downbeat at 6 s
    expect(barStart(grid, 4)).toBe(SAMPLE_RATE * 8);
    expect(barStart(grid, 6)).toBe(SAMPLE_RATE * 12);
  });

  it('clamps a negative bar to zero', () => {
    const grid = buildGrid(fourFour(4))!;
    expect(barStart(grid, -3)).toBe(0);
  });
});

describe('barAt', () => {
  it('reports the bar containing a position, not the nearest one', () => {
    const grid = buildGrid(fourFour(8))!;
    expect(barAt(grid, sampleIndex(SAMPLE_RATE * 2 + 1))).toBe(1);
    expect(barAt(grid, sampleIndex(SAMPLE_RATE * 4 - 1))).toBe(1);
  });

  it('is -1 before the first downbeat', () => {
    const beats = [48_000, 72_000, 96_000, 120_000, 144_000];
    const grid = buildGrid({ bpm: 120, beats, downbeats: [48_000, 144_000] })!;
    expect(barAt(grid, sampleIndex(0))).toBe(-1);
  });
});

describe('snapToBar', () => {
  it('snaps to the nearest bar line, not the preceding one', () => {
    const grid = buildGrid(fourFour(8))!;
    expect(snapToBar(grid, sampleIndex(SAMPLE_RATE * 2 - 1000))).toBe(1);
    expect(snapToBar(grid, sampleIndex(SAMPLE_RATE * 2 + 1000))).toBe(1);
    expect(snapToBar(grid, sampleIndex(SAMPLE_RATE * 3 + 100))).toBe(2);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd frontend && npm test -- src/music/grid.test.ts
```

Expected: FAIL — `Cannot find module './grid'`.

- [ ] **Step 3: Implement `grid.ts`**

Create `frontend/src/music/grid.ts`:

```ts
// Bar <-> sample arithmetic over Phase 5's beat grid. Loops are stored in
// song.json as *bar numbers* (user-meaningful, and they survive a re-analysis
// that moves the sample indices underneath them, tech spec §5); the engine only
// speaks sample indices. This module is the only place that conversion happens,
// and it is pure arithmetic over integers -- no float seconds anywhere (D-03).
import type { BeatGrid } from '../api/client';
import { sampleIndex, type SampleIndex } from '../engine/types';

export interface Grid {
  /** Downbeats: the sample index each bar starts on, ascending. */
  bars: SampleIndex[];
  /** Every beat, ascending. Drawn faintly; the metronome reads these. */
  beats: SampleIndex[];
  /** Derived from downbeat spacing, never configured: 4 for 4/4, 3 for 3/4. */
  beatsPerBar: number;
  bpm: number;
  /** Number of bars the analysis actually found. Bars beyond this extrapolate. */
  barCount: number;
  /** Median bar length, used to extrapolate past the last downbeat. */
  medianBarSamples: number;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

export function buildGrid(beatGrid: BeatGrid): Grid | null {
  const bars = beatGrid.downbeats.map(sampleIndex);
  // One downbeat gives a bar start but no bar *length*, and every consumer here
  // needs a length (extrapolation, snapping, the ruler). Two is the floor.
  if (bars.length < 2) return null;

  const barLengths: number[] = [];
  for (let i = 1; i < bars.length; i++) barLengths.push(bars[i]! - bars[i - 1]!);
  const medianBarSamples = median(barLengths);

  const beats = beatGrid.beats.map(sampleIndex);
  // Count the beats inside one representative bar rather than trusting a time
  // signature nobody stored: beat_this reports beats and downbeats, not meter.
  const firstBarBeats = beats.filter((b) => b >= bars[0]! && b < bars[1]!).length;

  return {
    bars,
    beats,
    beatsPerBar: firstBarBeats > 0 ? firstBarBeats : 4,
    bpm: beatGrid.bpm,
    barCount: bars.length,
    medianBarSamples,
  };
}

export function barStart(grid: Grid, bar: number): SampleIndex {
  if (bar <= 0) return grid.bars[0]!;
  if (bar < grid.barCount) return grid.bars[bar]!;
  // Past the analysis: keep counting at the median bar length rather than
  // clamping, so a loop set near the end of a song with a short tail still has
  // an end bar to point at.
  const last = grid.bars[grid.barCount - 1]!;
  return sampleIndex(last + (bar - (grid.barCount - 1)) * grid.medianBarSamples);
}

export function barAt(grid: Grid, position: SampleIndex): number {
  if (position < grid.bars[0]!) return -1;
  // Binary search: the ruler calls this once per animation frame.
  let lo = 0;
  let hi = grid.barCount - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (grid.bars[mid]! <= position) lo = mid;
    else hi = mid - 1;
  }
  if (lo === grid.barCount - 1 && grid.medianBarSamples > 0) {
    const past = position - grid.bars[lo]!;
    return lo + Math.floor(past / grid.medianBarSamples);
  }
  return lo;
}

export function snapToBar(grid: Grid, position: SampleIndex): number {
  const bar = Math.max(0, barAt(grid, position));
  const here = barStart(grid, bar);
  const next = barStart(grid, bar + 1);
  return position - here <= next - position ? bar : bar + 1;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd frontend && npm test -- src/music/grid.test.ts && npm run typecheck
```

Expected: PASS, and `tsc --noEmit` clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/music/grid.ts frontend/src/music/grid.test.ts
git commit -m "feat(frontend): bar<->sample grid math over the beat grid"
```

---

## Task 5: Engine transport — play, pause, end of stem

**Files:**
- Modify: `frontend/src/engine/loopCursor.ts`
- Modify: `frontend/src/engine/stem-cursor-processor.ts`
- Modify: `frontend/src/engine/EngineController.ts`
- Test: `frontend/src/engine/loopCursor.test.ts`

**Interfaces:**
- Consumes: the existing `renderBlock(stems, params, cursor, outLeft, outRight)`,
  `MixParams`, `CursorState`.
- Produces: `MixParams` gains a `playing: boolean` and a `lengthFrames: number`;
  `CursorState` gains `ended: boolean`. `EngineController` gains
  `play(): Promise<void>`, `pause(): void`, `get durationSamples(): SampleIndex`, and
  `onEnded(cb: () => void): () => void`.

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/engine/loopCursor.test.ts` (reuse whatever stem-building helper
the file already defines; the snippet below assumes a helper named `makeStems` that
returns a `FourStems` of constant-valued channels — if the existing file names it
differently, use that name):

```ts
describe('transport', () => {
  it('renders silence and does not advance the cursor while paused', () => {
    const stems = makeStems(1000, 0.5);
    const cursor: CursorState = { position: 100, ended: false };
    const outL = new Float32Array(128);
    const outR = new Float32Array(128);

    renderBlock(
      stems,
      { gains: [1, 1, 1, 1], readRate: 1, loop: null, crossfadeFrames: 0, playing: false, lengthFrames: 1000 },
      cursor,
      outL,
      outR,
    );

    expect(cursor.position).toBe(100);
    expect(outL.every((s) => s === 0)).toBe(true);
    expect(outR.every((s) => s === 0)).toBe(true);
  });

  it('advances and sounds while playing', () => {
    const stems = makeStems(1000, 0.5);
    const cursor: CursorState = { position: 0, ended: false };
    const outL = new Float32Array(128);
    const outR = new Float32Array(128);

    renderBlock(
      stems,
      { gains: [1, 1, 1, 1], readRate: 1, loop: null, crossfadeFrames: 0, playing: true, lengthFrames: 1000 },
      cursor,
      outL,
      outR,
    );

    expect(cursor.position).toBe(128);
    expect(outL[0]).toBeCloseTo(2.0); // four stems at 0.5, unity gain
  });

  it('stops at the end of the stems instead of reading past them', () => {
    const stems = makeStems(200, 0.5);
    const cursor: CursorState = { position: 150, ended: false };
    const outL = new Float32Array(128);
    const outR = new Float32Array(128);

    renderBlock(
      stems,
      { gains: [1, 1, 1, 1], readRate: 1, loop: null, crossfadeFrames: 0, playing: true, lengthFrames: 200 },
      cursor,
      outL,
      outR,
    );

    expect(cursor.ended).toBe(true);
    expect(cursor.position).toBe(200);
    // Frames past the end are silent, not garbage or a repeat of the last sample.
    expect(outL[100]).toBe(0);
  });

  it('never ends while a loop is armed, however long it plays', () => {
    const stems = makeStems(1000, 0.5);
    const cursor: CursorState = { position: 900, ended: false };
    const outL = new Float32Array(128);
    const outR = new Float32Array(128);

    for (let block = 0; block < 100; block++) {
      renderBlock(
        stems,
        {
          gains: [1, 1, 1, 1],
          readRate: 1,
          loop: { startFrame: 100, endFrame: 500 },
          crossfadeFrames: 24,
          playing: true,
          lengthFrames: 1000,
        },
        cursor,
        outL,
        outR,
      );
    }

    expect(cursor.ended).toBe(false);
    expect(cursor.position).toBeGreaterThanOrEqual(100);
    expect(cursor.position).toBeLessThan(500);
  });
});
```

Update every existing `renderBlock` call in the file to pass `playing: true` and
`lengthFrames` (the stem length used by that test), and every `CursorState` literal to
include `ended: false`. The existing loop/crossfade assertions must keep passing unchanged
— that is the point of doing it this way rather than rewriting them.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd frontend && npm test -- src/engine/loopCursor.test.ts
```

Expected: FAIL — type errors on the new `MixParams` fields, and the transport assertions
fail because a paused block still advances.

- [ ] **Step 3: Implement the transport**

In `frontend/src/engine/loopCursor.ts`, extend the interfaces:

```ts
export interface MixParams {
  /** Linear gain per stem, fixed order [vocals, drums, bass, other]. */
  gains: readonly [number, number, number, number];
  /** Stem-domain samples advanced per output sample. 1.0 = original tempo. */
  readRate: number;
  loop: LoopBounds | null;
  crossfadeFrames: number;
  /**
   * Transport gate. Pausing stops the *cursor*, never the AudioContext and never
   * the stretcher: D-06 forbids seeking SoundTouch, and suspending the context
   * would tear down the worklet's own timebase. A paused engine keeps rendering
   * silence into a running graph, which is also why resuming is click-free.
   */
  playing: boolean;
  /** Frames in the stems. The cursor stops here rather than reading past them. */
  lengthFrames: number;
}

export interface CursorState {
  position: number;
  /** Set when the cursor reaches lengthFrames with no loop armed. */
  ended: boolean;
}
```

Rewrite `renderBlock`'s body to gate on `playing` and clamp at the end:

```ts
export function renderBlock(
  stems: FourStems,
  params: MixParams,
  cursor: CursorState,
  outLeft: Float32Array,
  outRight: Float32Array,
): void {
  const frameCount = outLeft.length;
  const loop = params.loop;

  if (!params.playing) {
    outLeft.fill(0);
    outRight.fill(0);
    return;
  }

  for (let i = 0; i < frameCount; i++) {
    let pos = cursor.position;

    if (!loop) {
      if (pos >= params.lengthFrames) {
        cursor.position = params.lengthFrames;
        cursor.ended = true;
        outLeft[i] = 0;
        outRight[i] = 0;
        continue;
      }
      const [l, r] = readStereoMix(stems, params.gains, pos);
      outLeft[i] = l;
      outRight[i] = r;
      cursor.position = pos + params.readRate;
      continue;
    }

    const { startFrame, endFrame } = loop;
    const tailStart = endFrame - params.crossfadeFrames;

    if (pos < tailStart || params.crossfadeFrames <= 0) {
      const [l, r] = readStereoMix(stems, params.gains, pos);
      outLeft[i] = l;
      outRight[i] = r;
    } else {
      const t = (pos - tailStart) / params.crossfadeFrames; // 0 -> 1 across the window
      const [tailL, tailR] = readStereoMix(stems, params.gains, pos);
      const [headL, headR] = readStereoMix(stems, params.gains, startFrame + (pos - tailStart));
      outLeft[i] = tailL * (1 - t) + headL * t;
      outRight[i] = tailR * (1 - t) + headR * t;
    }

    pos += params.readRate;
    if (pos >= endFrame) {
      pos = startFrame + params.crossfadeFrames + (pos - endFrame);
    }
    cursor.position = pos;
  }
}
```

In `frontend/src/engine/stem-cursor-processor.ts`:

- Add `{ name: 'playing', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' }`
  to `parameterDescriptors`.
- Track `private lengthFrames = 0;` and set it in the `load-stems` handler:
  `this.lengthFrames = this.stems[0]!.left.length;`
- Initialise the cursor as `{ position: 0, ended: false }`.
- Pass `playing: parameters.playing![0]! >= 0.5` and `lengthFrames: this.lengthFrames`
  into `renderBlock`.
- In the `seek` handler, clear both the end flag and the reported-once guard:
  `this.cursor.ended = false; this.endedReported = false;` — clearing only the first
  drops the `ended` message when a seek lands at or past `lengthFrames`, because
  `renderBlock` re-sets `ended` before the post-render check runs.
- After `renderBlock`, post an `ended` message exactly once per end:

```ts
    if (this.cursor.ended && !this.endedReported) {
      this.endedReported = true;
      this.port.postMessage({ type: 'ended', position: this.cursor.position, contextTime: currentTime });
    }
    if (!this.cursor.ended) this.endedReported = false;
```

with `private endedReported = false;` alongside the other fields.

In `frontend/src/engine/EngineController.ts`:

- Add `private endedListeners = new Set<() => void>();` and a `durationFrames` field
  captured in `create()` from `buffers[0]!.length` (device domain), exposed in the stem
  domain:

```ts
  /** Length of the stems, 48 kHz domain. The transport's right-hand edge. */
  get durationSamples(): SampleIndex {
    return toStemDomain(this.durationFrames, this.context.sampleRate);
  }
```

- Extend the `port.onmessage` handler in `create()` to route `ended` messages to a shared
  mutable box the instance also holds, in the same pattern `tempoState` already uses:

```ts
    const endedBox: { fire: () => void } = { fire: () => {} };
    cursorNode.port.onmessage = (event: MessageEvent) => {
      if (event.data.type === 'position') {
        /* ...existing resync, unchanged... */
      } else if (event.data.type === 'ended') {
        endedBox.fire();
      }
    };
```

Pass `endedBox` into the constructor, and in the constructor body set
`endedBox.fire = () => { this.pause(); this.endedListeners.forEach((cb) => cb()); };`

- Add the transport methods:

```ts
  /**
   * Starts the cursor. The AudioContext is resumed here rather than in
   * create(): browsers require a user gesture, and create() runs before the
   * user has pressed anything.
   */
  async play(): Promise<void> {
    if (this.context.state === 'suspended') await this.context.resume();
    this.cursorNode.parameters.get('playing')!.setValueAtTime(1, this.context.currentTime);
  }

  pause(): void {
    this.cursorNode.parameters.get('playing')!.setValueAtTime(0, this.context.currentTime);
  }

  /** Returns an unsubscribe function, so a React effect can clean up. */
  onEnded(cb: () => void): () => void {
    this.endedListeners.add(cb);
    return () => this.endedListeners.delete(cb);
  }
```

Finally, update `frontend/src/dev/EngineHarness.tsx`: its Play button must now call
`await controller.play()` after `create()`, and its Pause path calls `controller.pause()`.
Read the file and make the minimal change — the harness is Phase 3's verification surface
and must keep working.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd frontend && npm test && npm run typecheck
```

Expected: PASS — the whole frontend suite, including Phase 3's untouched loop and
crossfade assertions.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/engine frontend/src/dev/EngineHarness.tsx
git commit -m "feat(engine): transport gate, end-of-stem stop and duration"
```

---

## Task 6: Metronome and count-in, synthesised in the input domain

**Files:**
- Create: `frontend/src/engine/click.ts`
- Create: `frontend/src/engine/click.test.ts`
- Modify: `frontend/src/engine/loopCursor.ts`
- Modify: `frontend/src/engine/loopCursor.test.ts`
- Modify: `frontend/src/engine/stem-cursor-processor.ts`
- Modify: `frontend/src/engine/EngineController.ts`

**Interfaces:**
- Consumes: `renderBlock` and `MixParams` from Task 5; `Grid` from Task 4 (the controller
  converts it to device-domain frames before sending).
- Produces:
  - `click.ts`: `CLICK_LENGTH_FRAMES(sampleRate: number): number`,
    `clickSample(framesSinceOnset: number, accented: boolean, sampleRate: number): number`,
    `findBeatIndexAt(beats: Float64Array, position: number): number`.
  - `MixParams` gains `metronome: { beats: Float64Array; downbeatFlags: Uint8Array; gain: number } | null`.
  - `EngineController` gains `setGrid(bars: SampleIndex[], beats: SampleIndex[]): void`,
    `setMetronome(on: boolean): void`, `setCountInBars(bars: number): void`.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/engine/click.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { CLICK_LENGTH_FRAMES, clickSample, findBeatIndexAt } from './click';

const SR = 48_000;

describe('clickSample', () => {
  it('is silent before the onset and after the click decays', () => {
    expect(clickSample(-1, false, SR)).toBe(0);
    expect(clickSample(CLICK_LENGTH_FRAMES(SR), false, SR)).toBe(0);
    expect(clickSample(CLICK_LENGTH_FRAMES(SR) + 500, false, SR)).toBe(0);
  });

  it('decays monotonically in envelope from the onset', () => {
    const length = CLICK_LENGTH_FRAMES(SR);
    // Sample the envelope at quarter-cycle boundaries of the tone so the
    // comparison is of amplitude, not of where we happen to land on the sine.
    const early = Math.abs(clickSample(1, false, SR));
    const late = Math.abs(clickSample(length - 2, false, SR));
    expect(early).toBeGreaterThan(late);
  });

  it('accents a downbeat louder and higher than an offbeat', () => {
    const plain = clickSample(4, false, SR);
    const accented = clickSample(4, true, SR);
    expect(Math.abs(accented)).toBeGreaterThan(Math.abs(plain));
  });

  it('never exceeds unity, so it cannot clip the pre-stretcher mix', () => {
    for (let i = 0; i < CLICK_LENGTH_FRAMES(SR); i++) {
      expect(Math.abs(clickSample(i, true, SR))).toBeLessThanOrEqual(1);
    }
  });
});

describe('findBeatIndexAt', () => {
  const beats = Float64Array.from([0, 1000, 2000, 3000]);

  it('finds the index of the latest beat at or before a position', () => {
    expect(findBeatIndexAt(beats, 0)).toBe(0);
    expect(findBeatIndexAt(beats, 999)).toBe(0);
    expect(findBeatIndexAt(beats, 1000)).toBe(1);
    expect(findBeatIndexAt(beats, 5000)).toBe(3);
  });

  it('is -1 before the first beat', () => {
    expect(findBeatIndexAt(Float64Array.from([500, 1500]), 100)).toBe(-1);
  });

  it('is -1 for an empty grid', () => {
    expect(findBeatIndexAt(new Float64Array(0), 100)).toBe(-1);
  });
});
```

Append to `frontend/src/engine/loopCursor.test.ts`:

```ts
describe('metronome', () => {
  const metronome = (gain: number) => ({
    beats: Float64Array.from([0, 480, 960, 1440]),
    downbeatFlags: Uint8Array.from([1, 0, 0, 0]),
    gain,
    sampleRate: 48_000,
  });

  it('adds a click at a beat and nothing between beats', () => {
    const stems = makeStems(4000, 0); // silent stems: whatever we hear is the click
    const cursor: CursorState = { position: 0, ended: false };
    const outL = new Float32Array(128);
    const outR = new Float32Array(128);

    renderBlock(
      stems,
      {
        gains: [1, 1, 1, 1],
        readRate: 1,
        loop: null,
        crossfadeFrames: 0,
        playing: true,
        lengthFrames: 4000,
        metronome: metronome(1),
      },
      cursor,
      outL,
      outR,
    );

    expect(Math.max(...outL)).toBeGreaterThan(0); // the downbeat at 0 sounded
    // ...and 200 frames later (past the click length at this fake rate is not
    // guaranteed, so assert the shape instead): the click decays.
    expect(Math.abs(outL[127]!)).toBeLessThan(Math.abs(outL[2]!));
  });

  it('is silent when the metronome is off', () => {
    const stems = makeStems(4000, 0);
    const cursor: CursorState = { position: 0, ended: false };
    const outL = new Float32Array(128);
    const outR = new Float32Array(128);

    renderBlock(
      stems,
      {
        gains: [1, 1, 1, 1],
        readRate: 1,
        loop: null,
        crossfadeFrames: 0,
        playing: true,
        lengthFrames: 4000,
        metronome: null,
      },
      cursor,
      outL,
      outR,
    );

    expect(outL.every((s) => s === 0)).toBe(true);
  });

  it('clicks in both channels equally, so it sits centred in the mix', () => {
    const stems = makeStems(4000, 0);
    const cursor: CursorState = { position: 0, ended: false };
    const outL = new Float32Array(128);
    const outR = new Float32Array(128);

    renderBlock(
      stems,
      {
        gains: [1, 1, 1, 1],
        readRate: 1,
        loop: null,
        crossfadeFrames: 0,
        playing: true,
        lengthFrames: 4000,
        metronome: metronome(1),
      },
      cursor,
      outL,
      outR,
    );

    expect(Array.from(outL)).toEqual(Array.from(outR));
  });

  it('still clicks after a loop wrap, because the beat is found from the cursor', () => {
    const stems = makeStems(4000, 0);
    // Cursor lands just before the loop start's beat after wrapping.
    const cursor: CursorState = { position: 1430, ended: false };
    const outL = new Float32Array(128);
    const outR = new Float32Array(128);

    renderBlock(
      stems,
      {
        gains: [1, 1, 1, 1],
        readRate: 1,
        loop: { startFrame: 0, endFrame: 1440 },
        crossfadeFrames: 0,
        playing: true,
        lengthFrames: 4000,
        metronome: metronome(1),
      },
      cursor,
      outL,
      outR,
    );

    // The wrap puts the cursor back at 0, which is a downbeat: it must sound.
    expect(Math.max(...outL.slice(20))).toBeGreaterThan(0);
  });
});
```

Also add `metronome: null` to every pre-existing `renderBlock` call in the file.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd frontend && npm test -- src/engine/click.test.ts src/engine/loopCursor.test.ts
```

Expected: FAIL — `Cannot find module './click'` and type errors on `MixParams.metronome`.

- [ ] **Step 3: Implement the click and wire it in**

Create `frontend/src/engine/click.ts`:

```ts
// Metronome click synthesis. D6-03: the click is generated in the *input*
// domain and mixed with the stems before the stretcher, so it shares the
// music's timebase and the music's latency exactly. A click generated after
// the stretcher would arrive early by the stretcher's buffer -- N-06's
// 50-100 ms -- and the error would change with tempo.
//
// Pure functions over numbers: no AudioContext, no worklet, fully testable.

const CLICK_MS = 25;
const TONE_HZ = 1000;
const ACCENT_TONE_HZ = 1600;
const ACCENT_GAIN = 1.0;
const PLAIN_GAIN = 0.6;

export function CLICK_LENGTH_FRAMES(sampleRate: number): number {
  return Math.round((CLICK_MS / 1000) * sampleRate);
}

/**
 * One sample of a short exponentially-decaying sine burst, `framesSinceOnset`
 * frames into the click. 0 outside the burst. Amplitude never exceeds 1.
 */
export function clickSample(
  framesSinceOnset: number,
  accented: boolean,
  sampleRate: number,
): number {
  const length = CLICK_LENGTH_FRAMES(sampleRate);
  if (framesSinceOnset < 0 || framesSinceOnset >= length) return 0;
  const t = framesSinceOnset / sampleRate;
  const envelope = Math.exp(-framesSinceOnset / (length / 5));
  const hz = accented ? ACCENT_TONE_HZ : TONE_HZ;
  const gain = accented ? ACCENT_GAIN : PLAIN_GAIN;
  return Math.sin(2 * Math.PI * hz * t) * envelope * gain;
}

/**
 * Index of the latest beat at or before `position`, or -1 if `position` is
 * before the first beat. Binary search rather than a carried index: the cursor
 * jumps at every loop wrap and every seek, and a carried index would have to be
 * invalidated at both -- cheaper and less error-prone to just search, once per
 * block rather than once per frame.
 */
export function findBeatIndexAt(beats: Float64Array, position: number): number {
  if (beats.length === 0 || position < beats[0]!) return -1;
  let lo = 0;
  let hi = beats.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (beats[mid]! <= position) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
```

In `frontend/src/engine/loopCursor.ts`, add the import and the param, and mix the click in:

```ts
import { clickSample, findBeatIndexAt } from './click';

export interface MetronomeParams {
  /** Beat onsets in device-domain frames, ascending. */
  beats: Float64Array;
  /** 1 where the beat at the same index is a downbeat. */
  downbeatFlags: Uint8Array;
  /** 0 when off. Mixed in pre-stretcher (D6-03), so it is part of the same sum. */
  gain: number;
  /** The AudioContext's real rate, for click length and tone frequency. */
  sampleRate: number;
}
```

Add `metronome: MetronomeParams | null;` to `MixParams`, then inside `renderBlock`'s frame
loop, after the stem mix is written and before the cursor advances, add the click
contribution. The cleanest shape is a small helper called from both the looping and
non-looping branches:

```ts
function clickAt(metronome: MetronomeParams | null, position: number): number {
  if (!metronome || metronome.gain === 0) return 0;
  const index = findBeatIndexAt(metronome.beats, position);
  if (index < 0) return 0;
  const since = position - metronome.beats[index]!;
  return clickSample(since, metronome.downbeatFlags[index] === 1, metronome.sampleRate) * metronome.gain;
}
```

and in each branch, after computing `outLeft[i]`/`outRight[i]`:

```ts
      const click = clickAt(params.metronome, pos);
      outLeft[i] = outLeft[i]! + click;
      outRight[i] = outRight[i]! + click;
```

Note `clickAt` is called per frame and binary-searches each time; at 128 frames and a few
hundred beats that is a few thousand comparisons per block, which is well inside the
worklet's budget. Do not optimise it into a carried index without a measurement — a stale
index after a loop wrap is exactly the class of bug N-05 exists to catch.

In `frontend/src/engine/stem-cursor-processor.ts`:

- Add a `set-grid` message: `{ type: 'set-grid'; beats: number[]; downbeatFlags: number[] }`,
  stored as `this.beats = Float64Array.from(msg.beats)` and
  `this.downbeatFlags = Uint8Array.from(msg.downbeatFlags)`.
- Add a `metronomeGain` AudioParam
  (`{ name: 'metronomeGain', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' }`).
- Build `metronome` per block:

```ts
    const metronomeGain = parameters.metronomeGain![0]!;
    const metronome =
      metronomeGain > 0 && this.beats.length > 0
        ? { beats: this.beats, downbeatFlags: this.downbeatFlags, gain: metronomeGain, sampleRate }
        : null;
```

(`sampleRate` is a global in `AudioWorkletGlobalScope`.)

In `frontend/src/engine/EngineController.ts`:

```ts
  /**
   * Hands the worklet the beat grid, converted to device-domain frames. Called
   * once when analysis.json arrives; the grid does not change during playback.
   */
  setGrid(bars: SampleIndex[], beats: SampleIndex[]): void {
    const barSet = new Set(bars.map((b) => b as number));
    this.cursorNode.port.postMessage({
      type: 'set-grid',
      beats: beats.map((b) => toDeviceDomain(b, this.context.sampleRate)),
      downbeatFlags: beats.map((b) => (barSet.has(b as number) ? 1 : 0)),
    });
  }

  setMetronome(on: boolean): void {
    this.cursorNode.parameters
      .get('metronomeGain')!
      .setValueAtTime(on ? 1 : 0, this.context.currentTime);
  }
```

**Count-in** (`countInBars`) is implemented entirely in the controller as a *rewind*, not
as a new engine mode. The snippet below is incomplete in one way that matters, corrected
during review: the poll **must be cancellable**. `pause()` stops the clock, so an
uncancelled poll never reaches `from`, never resolves, and leaves every stem at gain 0 —
press play afterwards and you get a metronome over silence. The shipped version carries a
`countInGeneration` counter and a `pendingCountIn` record, with a `cancelCountIn()`
invoked from `pause()`, `seek()` and the top of `countInAndPlay` itself; the property it
guarantees is that `restoreGains` runs exactly once on every path. See
`EngineController.ts` and `EngineController.test.ts` as built. playing `n` bars of count-in means starting the cursor `n` bars
earlier with every stem gain at zero, then restoring the gains when the cursor reaches the
intended start. That reuses the metronome that is already running and needs no new state in
the worklet. Add:

```ts
  /**
   * Plays `bars` bars of metronome before the music, by starting the cursor
   * that far back with the stems silenced. Resolves once the music has started.
   * `barStarts` is the grid's downbeats (48 kHz domain); `from` is where
   * playback should actually begin.
   */
  async countInAndPlay(
    from: SampleIndex,
    bars: number,
    barStarts: SampleIndex[],
    restoreGains: () => void,
  ): Promise<void> {
    if (bars <= 0) {
      this.seek(from);
      await this.play();
      return;
    }
    const startBar = barStarts.findIndex((b) => b >= from);
    const countFrom = startBar > 0 ? barStarts[Math.max(0, startBar - bars)]! : from;
    for (const stem of STEM_ORDER) this.setStemGain(stem, 0);
    this.setMetronome(true);
    this.seek(countFrom);
    await this.play();
    // Polling the clock rather than setTimeout: the clock is the only thing
    // that knows the real rate after a tempo change (U-05's rule, applied to
    // an engine-internal decision rather than to the playhead).
    await new Promise<void>((resolve) => {
      const tick = () => {
        if (this.getPositionSamples() >= from) {
          restoreGains();
          resolve();
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd frontend && npm test && npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/engine
git commit -m "feat(engine): pre-stretcher metronome click and count-in"
```

---

## Task 7: Stem peaks and near-silence in the browser

**Files:**
- Create: `frontend/src/engine/stemPeaks.ts`
- Create: `frontend/src/engine/stemPeaks.test.ts`
- Modify: `frontend/src/engine/EngineController.ts`

**Interfaces:**
- Consumes: decoded `AudioBuffer`s inside `EngineController.create`.
- Produces:
  - `NEAR_SILENT_THRESHOLD = 0.02`
  - `interface StemSummary { name: StemName; envelope: Float32Array; peak: number; nearSilent: boolean; }`
  - `summariseStem(buffer: { getChannelData(ch: number): Float32Array; numberOfChannels: number; length: number; sampleRate: number }, name: StemName, bucketsPerSecond?: number): StemSummary`
  - `EngineController.stemSummaries: readonly StemSummary[]` (fixed `STEM_ORDER`) and
    `EngineController.durationSeconds: number`.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/engine/stemPeaks.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { NEAR_SILENT_THRESHOLD, summariseStem } from './stemPeaks';

/** A stand-in for AudioBuffer: jsdom has no Web Audio, and we only need these. */
function fakeBuffer(samples: Float32Array, sampleRate = 48_000) {
  return {
    length: samples.length,
    sampleRate,
    numberOfChannels: 1,
    getChannelData: () => samples,
  };
}

describe('summariseStem', () => {
  it('buckets the envelope at the requested rate', () => {
    const samples = new Float32Array(48_000).fill(0.5);
    const summary = summariseStem(fakeBuffer(samples), 'bass', 100);
    expect(summary.envelope.length).toBe(100);
    expect(summary.envelope[0]).toBeCloseTo(0.5);
  });

  it('takes the absolute peak in each bucket, not the mean', () => {
    const samples = new Float32Array(48_000);
    samples[10] = -0.9; // one loud negative sample in bucket 0
    const summary = summariseStem(fakeBuffer(samples), 'drums', 100);
    expect(summary.envelope[0]).toBeCloseTo(0.9);
    expect(summary.envelope[1]).toBe(0);
  });

  it('marks a near-silent stem (U-10)', () => {
    const samples = new Float32Array(48_000).fill(0.005);
    const summary = summariseStem(fakeBuffer(samples), 'vocals', 100);
    expect(summary.nearSilent).toBe(true);
    expect(summary.peak).toBeLessThan(NEAR_SILENT_THRESHOLD);
  });

  it('does not mark a stem that is merely quiet', () => {
    const samples = new Float32Array(48_000).fill(0.05);
    expect(summariseStem(fakeBuffer(samples), 'other', 100).nearSilent).toBe(false);
  });

  it('uses the worker’s own threshold, so the UI and the job agree', () => {
    // packages/stemcraft_worker/.../separate_song.py NEAR_SILENT_THRESHOLD
    expect(NEAR_SILENT_THRESHOLD).toBe(0.02);
  });

  it('mixes both channels rather than reading only the left', () => {
    const left = new Float32Array(48_000);
    const right = new Float32Array(48_000).fill(0.8);
    const buffer = {
      length: 48_000,
      sampleRate: 48_000,
      numberOfChannels: 2,
      getChannelData: (ch: number) => (ch === 0 ? left : right),
    };
    const summary = summariseStem(buffer, 'bass', 100);
    expect(summary.nearSilent).toBe(false);
    expect(summary.envelope[0]).toBeCloseTo(0.8);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd frontend && npm test -- src/engine/stemPeaks.test.ts
```

Expected: FAIL — `Cannot find module './stemPeaks'`.

- [ ] **Step 3: Implement it**

Create `frontend/src/engine/stemPeaks.ts`:

```ts
// D6-01/D6-02: the Song view's stem waveforms and its near-silent marks are
// derived in the browser from the buffers the engine already decoded. peaks.json
// covers the mix only, and four more HTTP round trips inside N-03's 3 s budget
// buy nothing the decoded PCM does not already hold.
import type { StemName } from './EngineController';

/**
 * Mirrors NEAR_SILENT_THRESHOLD in
 * packages/stemcraft_worker/src/stemcraft_worker/kinds/separate_song.py (~-34 dBFS).
 * If one moves, move the other: a lane marked empty here and not there (or the
 * reverse) is exactly the kind of quiet disagreement N-08 forbids.
 */
export const NEAR_SILENT_THRESHOLD = 0.02;

export interface StemSummary {
  name: StemName;
  /** Absolute peak per bucket, 0..1. wavesurfer renders this directly. */
  envelope: Float32Array;
  /** Absolute peak over the whole stem. */
  peak: number;
  /** U-10: an empty lane is marked, never left as an unexplained flat line. */
  nearSilent: boolean;
}

interface ChannelSource {
  length: number;
  sampleRate: number;
  numberOfChannels: number;
  getChannelData(channel: number): Float32Array;
}

export function summariseStem(
  buffer: ChannelSource,
  name: StemName,
  bucketsPerSecond = 100,
): StemSummary {
  const channels: Float32Array[] = [];
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) channels.push(buffer.getChannelData(ch));

  const framesPerBucket = Math.max(1, Math.round(buffer.sampleRate / bucketsPerSecond));
  const bucketCount = Math.ceil(buffer.length / framesPerBucket);
  const envelope = new Float32Array(bucketCount);
  let peak = 0;

  for (let bucket = 0; bucket < bucketCount; bucket++) {
    const start = bucket * framesPerBucket;
    const end = Math.min(start + framesPerBucket, buffer.length);
    let localPeak = 0;
    for (const channel of channels) {
      for (let i = start; i < end; i++) {
        const magnitude = Math.abs(channel[i]!);
        if (magnitude > localPeak) localPeak = magnitude;
      }
    }
    envelope[bucket] = localPeak;
    if (localPeak > peak) peak = localPeak;
  }

  return { name, envelope, peak, nearSilent: peak < NEAR_SILENT_THRESHOLD };
}
```

In `EngineController.create`, after decoding the buffers, build the summaries in
`STEM_ORDER` and store them on the instance:

```ts
    const summaries = STEM_ORDER.map((name, i) => summariseStem(buffers[i]!, name));
```

pass them into the constructor, and expose:

```ts
  /** One per stem in STEM_ORDER. Waveform data and U-10's near-silent flag. */
  get stemSummaries(): readonly StemSummary[] {
    return this.summaries;
  }

  get durationSeconds(): number {
    return this.durationFrames / this.context.sampleRate;
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd frontend && npm test && npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/engine
git commit -m "feat(engine): browser-side stem peaks and near-silence detection"
```

---

## Task 8: Client types, media URLs and the debounced autosave hook

**Files:**
- Modify: `frontend/src/api/client.ts`
- Modify: `frontend/src/api/queries.ts`
- Test: `frontend/src/api/queries.test.ts` (create)

**Interfaces:**
- Consumes: the `PUT` route from Task 3, the v2 `Song` from Task 2.
- Produces: `Song` gains `active_loop: Loop | null`, `metronome: boolean`,
  `count_in_bars: number`; `api.put`; `songMedia(songId)` returning
  `{ stem(name): string; peaks: string; audio: string }`; `useSong(songId)`;
  `useUpdateSong(songId)` returning `{ save(song: Song): void; flush(): void; error: Error | null }`
  with a 600 ms trailing debounce.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/api/queries.test.ts`:

```ts
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { songMedia } from './client';
import type { Song } from './client';
import { useUpdateSong } from './queries';

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const song = (tempo: number): Song =>
  ({
    schema_version: 2,
    id: 'abc123',
    title: 'T',
    artist: '',
    source: { kind: 'upload', value: 'original.mp3' },
    created_at: '2026-09-28T00:00:00+00:00',
    last_played_at: null,
    mix: {},
    playback: { tempo, pitch_semitones: 0 },
    loops: [],
    active_loop: null,
    metronome: false,
    count_in_bars: 0,
  }) as Song;

describe('songMedia', () => {
  it('builds same-origin relative media paths', () => {
    const media = songMedia('abc123');
    expect(media.stem('bass')).toBe('/api/songs/abc123/stems/bass.opus');
    expect(media.peaks).toBe('/api/songs/abc123/peaks');
  });
});

describe('useUpdateSong', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ song: song(1) }), { status: 200 })),
    );
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('coalesces a burst of edits into one PUT', async () => {
    const { result } = renderHook(() => useUpdateSong('abc123'), { wrapper });

    act(() => {
      result.current.save(song(0.9));
      result.current.save(song(0.8));
      result.current.save(song(0.7));
    });
    expect(fetch).not.toHaveBeenCalled(); // still inside the debounce window

    await act(async () => {
      vi.advanceTimersByTime(700);
    });

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    // The last edit wins -- a dragged slider must not send its whole trail.
    expect(JSON.parse(init.body).playback.tempo).toBe(0.7);
    expect(init.method).toBe('PUT');
  });

  it('flush() sends immediately, for unmount and for navigation away', async () => {
    const { result } = renderHook(() => useUpdateSong('abc123'), { wrapper });
    act(() => {
      result.current.save(song(0.5));
      result.current.flush();
    });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  });
});
```

Rename the file to `queries.test.tsx` if the JSX in `wrapper` needs it — match whatever
the existing `frontend/src/screens/*.test.tsx` files do.

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd frontend && npm test -- src/api/queries.test
```

Expected: FAIL — `songMedia` and `useUpdateSong` do not exist.

- [ ] **Step 3: Implement**

In `frontend/src/api/client.ts`, add `put` to the `api` object:

```ts
  put: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
```

Extend the `Song` interface with the v2 fields (mirroring `song.py`):

```ts
export interface Song {
  schema_version: number;
  id: string;
  title: string;
  artist: string;
  source: Source;
  created_at: string;
  last_played_at: string | null;
  mix: Record<string, StemMix>;
  playback: Playback;
  loops: Loop[];
  // v2 (Phase 6): the loop currently being practised, the metronome toggle and
  // the count-in length. See stemcraft_lib/song.py.
  active_loop: Loop | null;
  metronome: boolean;
  count_in_bars: number;
}
```

and add the media helper:

```ts
// Same-origin relative paths, like every other path in this module (D-15).
export function songMedia(songId: string) {
  return {
    stem: (name: string) => `/api/songs/${songId}/stems/${name}.opus`,
    peaks: `/api/songs/${songId}/peaks`,
    audio: `/api/songs/${songId}/audio.wav`,
  };
}
```

In `frontend/src/api/queries.ts`:

```ts
export function useSong(songId: string | undefined) {
  return useQuery({
    queryKey: ['song', songId],
    queryFn: () => api.get<SongEntry>(`/api/songs/${songId}`),
    enabled: Boolean(songId),
  });
}

const AUTOSAVE_DEBOUNCE_MS = 600;

/**
 * Whole-document autosave for the practice recipe (§6). Trailing debounce: a
 * dragged tempo slider fires dozens of changes a second and every one of them
 * is a complete song.json -- sending the trail would be pointless writes, and
 * §5's last-write-wins means only the final one could ever matter anyway.
 */
export function useUpdateSong(songId: string | undefined) {
  const client = useQueryClient();
  const timer = useRef<number | null>(null);
  const pending = useRef<Song | null>(null);

  const mutation = useMutation({
    mutationFn: (song: Song) => api.put<SongEntry>(`/api/songs/${song.id}`, song),
    onSuccess: (entry) => {
      client.setQueryData(['song', songId], entry);
      client.invalidateQueries({ queryKey: queryKeys.songs });
    },
  });

  const flush = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    const song = pending.current;
    pending.current = null;
    if (song) mutation.mutate(song);
  }, [mutation]);

  const save = useCallback(
    (song: Song) => {
      pending.current = song;
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(flush, AUTOSAVE_DEBOUNCE_MS);
    },
    [flush],
  );

  useEffect(() => () => flush(), [flush]);

  return { save, flush, error: mutation.error };
}
```

Add `useCallback`, `useEffect`, `useRef` to the React import and `Song` to the type import.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd frontend && npm test && npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api
git commit -m "feat(frontend): song v2 client types, media URLs and debounced autosave"
```

---

## Task 9: `StemLane` — the stem strip

**Files:**
- Create: `frontend/src/songview/StemLane.tsx`
- Create: `frontend/src/songview/StemLane.module.css`
- Create: `frontend/src/songview/StemLane.test.tsx`
- Modify: `frontend/package.json` (add `wavesurfer.js`)

**Interfaces:**
- Consumes: `StemSummary` (Task 7), design tokens, `StemName`.
- Produces:

```ts
export interface StemLaneProps {
  summary: StemSummary;
  durationSeconds: number;
  muted: boolean;
  soloed: boolean;
  gainDb: number;              // -60..+6
  anySoloed: boolean;
  onMuteToggle(): void;
  onSoloToggle(): void;
  onGainChange(db: number): void;
}
export function StemLane(props: StemLaneProps): JSX.Element;
```

- [ ] **Step 1: Add the dependency and write the failing test**

```bash
cd frontend && npm install wavesurfer.js@^7
```

Create `frontend/src/songview/StemLane.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { StemSummary } from '../engine/stemPeaks';
import { StemLane } from './StemLane';

// wavesurfer needs a real canvas and ResizeObserver; jsdom has neither, and the
// waveform pixels are not what these tests are about. The lane's controls,
// labels and states are.
vi.mock('wavesurfer.js', () => ({
  default: { create: () => ({ destroy: vi.fn(), setOptions: vi.fn(), on: () => () => {} }) },
}));

const summary = (over: Partial<StemSummary> = {}): StemSummary => ({
  name: 'bass',
  envelope: Float32Array.from([0.4, 0.6, 0.2]),
  peak: 0.6,
  nearSilent: false,
  ...over,
});

function renderLane(over: Partial<Parameters<typeof StemLane>[0]> = {}) {
  const props = {
    summary: summary(),
    durationSeconds: 120,
    muted: false,
    soloed: false,
    gainDb: 0,
    anySoloed: false,
    onMuteToggle: vi.fn(),
    onSoloToggle: vi.fn(),
    onGainChange: vi.fn(),
    ...over,
  };
  render(<StemLane {...props} />);
  return props;
}

describe('StemLane', () => {
  it('always names the stem in text, never by colour alone', () => {
    renderLane();
    expect(screen.getByText('bass')).toBeInTheDocument();
  });

  it('reports mute state through aria-pressed, not just styling', async () => {
    const props = renderLane({ muted: true });
    const mute = screen.getByRole('button', { name: /mute bass/i });
    expect(mute).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(mute);
    expect(props.onMuteToggle).toHaveBeenCalledOnce();
  });

  it('marks a near-silent lane and makes M/S inert (U-10)', () => {
    renderLane({ summary: summary({ nearSilent: true }) });
    expect(screen.getByText(/near-silent/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /mute bass/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /solo bass/i })).toBeDisabled();
  });

  it('mirrors the gain slider as a mono readout (UI spec §5)', () => {
    renderLane({ gainDb: -6 });
    expect(screen.getByText('-6.0 dB')).toBeInTheDocument();
  });

  it('reports itself as silenced-by-solo when another lane is soloed', () => {
    renderLane({ anySoloed: true, soloed: false });
    expect(screen.getByRole('group', { name: /bass/i })).toHaveAttribute('data-silenced', 'true');
  });

  it('emits gain changes in dB', async () => {
    const props = renderLane();
    const slider = screen.getByRole('slider', { name: /bass gain/i });
    await userEvent.clear(slider);
    // fireEvent-style change on a range input:
    (slider as HTMLInputElement).value = '-12';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    expect(props.onGainChange).toHaveBeenCalledWith(-12);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd frontend && npm test -- src/songview/StemLane.test.tsx
```

Expected: FAIL — `Cannot find module './StemLane'`.

- [ ] **Step 3: Implement the component**

Create `frontend/src/songview/StemLane.tsx`:

```tsx
// UI spec §5, "Stem strip" -- the signature component. Identity is carried by
// fixed order, a permanent text label and a fixed lane position (U-01); hue is
// an accelerator, never the only signal.
//
// D-07: wavesurfer renders and never plays. It is constructed with precomputed
// peaks and an explicit duration, so it has no URL to fetch and no media element
// to start, and its own cursor is switched off -- the playhead belongs to
// Timeline, driven by the engine clock (U-05).
import { useEffect, useRef } from 'react';
import WaveSurfer from 'wavesurfer.js';

import type { StemSummary } from '../engine/stemPeaks';
import styles from './StemLane.module.css';

const STEM_COLOR: Record<string, string> = {
  vocals: 'var(--ds-vocals)',
  drums: 'var(--ds-drums)',
  bass: 'var(--ds-bass)',
  other: 'var(--ds-other)',
};

export interface StemLaneProps {
  summary: StemSummary;
  durationSeconds: number;
  muted: boolean;
  soloed: boolean;
  gainDb: number;
  anySoloed: boolean;
  onMuteToggle(): void;
  onSoloToggle(): void;
  onGainChange(db: number): void;
}

export function StemLane({
  summary,
  durationSeconds,
  muted,
  soloed,
  gainDb,
  anySoloed,
  onMuteToggle,
  onSoloToggle,
  onGainChange,
}: StemLaneProps) {
  const container = useRef<HTMLDivElement | null>(null);
  const { name, envelope, nearSilent } = summary;
  const silenced = muted || (anySoloed && !soloed);

  useEffect(() => {
    if (!container.current) return;
    const ws = WaveSurfer.create({
      container: container.current,
      height: 64,
      cursorWidth: 0, // U-05: the playhead is ours, drawn from the engine clock
      interact: false, // scrubbing is Timeline's job, and U-06 governs it
      normalize: false,
      waveColor: STEM_COLOR[name] ?? 'var(--ds-text-2)',
      progressColor: STEM_COLOR[name] ?? 'var(--ds-text-2)',
      peaks: [envelope],
      duration: durationSeconds,
    });
    return () => ws.destroy();
  }, [name, envelope, durationSeconds]);

  return (
    <div
      role="group"
      aria-label={`${name} stem`}
      className={styles.lane}
      data-silenced={silenced ? 'true' : 'false'}
      data-near-silent={nearSilent ? 'true' : 'false'}
    >
      <div className={styles.controls}>
        <span className={styles.name}>{name}</span>
        <div className={styles.buttons}>
          <button
            type="button"
            aria-label={`Mute ${name}`}
            aria-pressed={muted}
            disabled={nearSilent}
            onClick={onMuteToggle}
          >
            M
          </button>
          <button
            type="button"
            aria-label={`Solo ${name}`}
            aria-pressed={soloed}
            disabled={nearSilent}
            onClick={onSoloToggle}
          >
            S
          </button>
        </div>
        <label className={styles.gain}>
          <span className={styles.srOnly}>{name} gain</span>
          <input
            type="range"
            aria-label={`${name} gain`}
            min={-60}
            max={6}
            step={0.5}
            value={gainDb}
            disabled={nearSilent}
            onChange={(event) => onGainChange(Number(event.target.value))}
          />
          {/* UI spec §5: every slider mirrors its value as a mono readout --
              a knob position is unreadable at 1.5 m (U-C1). */}
          <output className={styles.readout}>{gainDb.toFixed(1)} dB</output>
        </label>
      </div>

      <div className={styles.waveWrap}>
        <div ref={container} className={styles.wave} />
        {nearSilent && (
          <span className={styles.pill}>
            near-silent &mdash; this song has no {name} the model could find
          </span>
        )}
      </div>
    </div>
  );
}
```

Create `frontend/src/songview/StemLane.module.css` using only `--ds-*` tokens. The rules
that carry meaning rather than taste:

```css
.lane {
  display: grid;
  grid-template-columns: 200px 1fr;
  gap: var(--ds-3);
  align-items: center;
  padding: var(--ds-2);
  border: 1px solid var(--ds-border);
  border-radius: var(--ds-r-panel);
  background: var(--ds-surface);
}

/* U-01/U-03: a muted lane drops to 28% so the mute is visible across a room. */
.lane[data-silenced='true'] .waveWrap {
  opacity: 0.28;
}

/* U-10: a near-silent lane dims further and explains itself. */
.lane[data-near-silent='true'] .waveWrap {
  opacity: 0.16;
}

.buttons button {
  min-width: 56px;
  min-height: 44px;
  font: 600 var(--ds-t-sm) / 1 var(--ds-mono);
}

.buttons button[aria-pressed='true'] {
  background: var(--ds-accent); /* a lit control is chrome, never a stem hue */
  color: var(--ds-ground);
}

.readout {
  font: 400 var(--ds-t-sm) / 1 var(--ds-mono);
  font-variant-numeric: tabular-nums; /* U-04 */
  color: var(--ds-text-2);
}

.pill {
  position: absolute;
  left: var(--ds-3);
  top: 50%;
  transform: translateY(-50%);
  padding: var(--ds-1) var(--ds-3);
  border-radius: var(--ds-r-pill);
  background: var(--ds-overlay);
  color: var(--ds-text-2);
  font: 400 var(--ds-t-sm) / 1 var(--ds-font);
}

.waveWrap { position: relative; }

.srOnly {
  position: absolute;
  width: 1px; height: 1px;
  overflow: hidden; clip-path: inset(50%);
}
```

Fill in `.controls`, `.name`, `.gain` and `.wave` in the same style.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd frontend && npm test && npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/songview frontend/package.json frontend/package-lock.json
git commit -m "feat(frontend): StemLane with wavesurfer rendering and U-10 marking"
```

---

## Task 10: `Timeline` and the rAF playhead

**Files:**
- Create: `frontend/src/songview/usePlayhead.ts`
- Create: `frontend/src/songview/Timeline.tsx`
- Create: `frontend/src/songview/Timeline.module.css`
- Create: `frontend/src/songview/Timeline.test.tsx`

**Interfaces:**
- Consumes: `Grid`, `barStart`, `barAt`, `snapToBar` (Task 4); `SampleIndex`.
- Produces:
  - `usePlayhead(getPosition: () => SampleIndex, onFrame: (position: SampleIndex) => void, active: boolean): void`
    — one rAF loop, started/stopped by `active`.
  - `Timeline` props:

```ts
export interface TimelineProps {
  grid: Grid | null;
  durationSamples: SampleIndex;
  loop: { startBar: number; endBar: number } | null;
  loopArmed: boolean;
  getPosition(): SampleIndex;
  playing: boolean;
  onScrub(position: SampleIndex): void;
}
```

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/songview/Timeline.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { buildGrid } from '../music/grid';
import { sampleIndex, SAMPLE_RATE } from '../engine/types';
import { Timeline } from './Timeline';

function grid8() {
  const beats: number[] = [];
  const downbeats: number[] = [];
  for (let i = 0; i < 32; i++) {
    beats.push(i * 24_000);
    if (i % 4 === 0) downbeats.push(i * 24_000);
  }
  return buildGrid({ bpm: 120, beats, downbeats })!;
}

describe('Timeline', () => {
  it('labels every bar on the ruler', () => {
    render(
      <Timeline
        grid={grid8()}
        durationSamples={sampleIndex(SAMPLE_RATE * 16)}
        loop={null}
        loopArmed={false}
        getPosition={() => sampleIndex(0)}
        playing={false}
        onScrub={vi.fn()}
      />,
    );
    // Bars are 1-indexed on screen and 0-indexed in the data (UI spec §5).
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('renders the A-B region with its bar labels when a loop is set', () => {
    render(
      <Timeline
        grid={grid8()}
        durationSamples={sampleIndex(SAMPLE_RATE * 16)}
        loop={{ startBar: 2, endBar: 5 }}
        loopArmed
        getPosition={() => sampleIndex(0)}
        playing={false}
        onScrub={vi.fn()}
      />,
    );
    const region = screen.getByRole('region', { name: /loop/i });
    expect(region).toHaveAttribute('data-armed', 'true');
    expect(region).toHaveTextContent('3');
    expect(region).toHaveTextContent('6');
  });

  it('greys the region when the loop is disarmed (U-06)', () => {
    render(
      <Timeline
        grid={grid8()}
        durationSamples={sampleIndex(SAMPLE_RATE * 16)}
        loop={{ startBar: 2, endBar: 5 }}
        loopArmed={false}
        getPosition={() => sampleIndex(0)}
        playing={false}
        onScrub={vi.fn()}
      />,
    );
    expect(screen.getByRole('region', { name: /loop/i })).toHaveAttribute('data-armed', 'false');
  });

  it('scrubs to the sample offset of the clicked point', async () => {
    const onScrub = vi.fn();
    render(
      <Timeline
        grid={grid8()}
        durationSamples={sampleIndex(SAMPLE_RATE * 16)}
        loop={null}
        loopArmed={false}
        getPosition={() => sampleIndex(0)}
        playing={false}
        onScrub={onScrub}
      />,
    );
    const track = screen.getByTestId('timeline-track');
    // jsdom reports zero-size rects, so the component must read the rect once
    // and divide -- the test pins the contract, not the pixel maths.
    vi.spyOn(track, 'getBoundingClientRect').mockReturnValue({
      left: 0, width: 1000, top: 0, height: 40, right: 1000, bottom: 40, x: 0, y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    track.dispatchEvent(new MouseEvent('click', { clientX: 250, bubbles: true }));
    expect(onScrub).toHaveBeenCalledWith(sampleIndex(SAMPLE_RATE * 4));
  });

  it('renders no ruler and says why when there is no grid', () => {
    render(
      <Timeline
        grid={null}
        durationSamples={sampleIndex(SAMPLE_RATE * 16)}
        loop={null}
        loopArmed={false}
        getPosition={() => sampleIndex(0)}
        playing={false}
        onScrub={vi.fn()}
      />,
    );
    expect(screen.getByText(/no beat grid/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd frontend && npm test -- src/songview/Timeline.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `frontend/src/songview/usePlayhead.ts`:

```ts
// U-05: the playhead is positioned by requestAnimationFrame from the engine
// clock, never by a CSS transition. A CSS-animated playhead is a second clock
// that interpolates smoothly through moments the engine did not have --
// including the loop wrap, which is exactly the seam R-01 exists to expose.
//
// One loop for the whole screen. Every readout (playhead, bar number, chord
// highlight) subscribes through this, and none of them goes through React
// state: at 60 fps that would be 60 renders a second of a tree containing four
// canvases (D-13's "no global store for anything the engine owns").
import { useEffect } from 'react';

import type { SampleIndex } from '../engine/types';

export function usePlayhead(
  getPosition: () => SampleIndex,
  onFrame: (position: SampleIndex) => void,
  active: boolean,
): void {
  useEffect(() => {
    // Paint once even when stopped, so a seek or a reload lands the playhead in
    // the right place instead of leaving it wherever the last frame put it.
    onFrame(getPosition());
    if (!active) return;
    let handle = 0;
    const tick = () => {
      onFrame(getPosition());
      handle = requestAnimationFrame(tick);
    };
    handle = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(handle);
  }, [getPosition, onFrame, active]);
}
```

Create `frontend/src/songview/Timeline.tsx`:

```tsx
// UI spec §5, "Timeline": bar ruler, beat grid (faint), downbeat grid (bright),
// A-B region with bar labels, playhead. Everything is positioned as a percentage
// of the song's sample length, so the whole thing scales with its container and
// stays in the 48 kHz domain until the last moment (D-03).
import { useCallback, useRef } from 'react';

import { barStart, type Grid } from '../music/grid';
import { sampleIndex, type SampleIndex } from '../engine/types';
import { usePlayhead } from './usePlayhead';
import styles from './Timeline.module.css';

export interface TimelineProps {
  grid: Grid | null;
  durationSamples: SampleIndex;
  loop: { startBar: number; endBar: number } | null;
  loopArmed: boolean;
  getPosition(): SampleIndex;
  playing: boolean;
  onScrub(position: SampleIndex): void;
}

export function Timeline({
  grid,
  durationSamples,
  loop,
  loopArmed,
  getPosition,
  playing,
  onScrub,
}: TimelineProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const playheadRef = useRef<HTMLDivElement | null>(null);

  const pct = useCallback(
    (position: number) => (durationSamples > 0 ? (position / durationSamples) * 100 : 0),
    [durationSamples],
  );

  // Writes to a ref, never to state: this runs 60 times a second.
  const paint = useCallback(
    (position: SampleIndex) => {
      if (playheadRef.current) playheadRef.current.style.left = `${pct(position)}%`;
    },
    [pct],
  );
  usePlayhead(getPosition, paint, playing);

  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const rect = (trackRef.current ?? event.currentTarget).getBoundingClientRect();
      if (rect.width === 0) return;
      const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
      onScrub(sampleIndex(ratio * durationSamples));
    },
    [durationSamples, onScrub],
  );

  return (
    <div className={styles.timeline}>
      {!grid && (
        <p className={styles.note}>
          No beat grid for this song yet &mdash; bars, snapping and the metronome need
          analysis to have run.
        </p>
      )}

      <div
        ref={trackRef}
        data-testid="timeline-track"
        className={styles.track}
        onClick={handleClick}
      >
        {grid?.beats.map((beat, i) => (
          <span key={`beat-${i}`} className={styles.beat} style={{ left: `${pct(beat)}%` }} />
        ))}
        {grid?.bars.map((bar, i) => (
          <span key={`bar-${i}`} className={styles.bar} style={{ left: `${pct(bar)}%` }}>
            {/* Bars are 1-indexed on screen, 0-indexed in the data. */}
            <b className={styles.barLabel}>{i + 1}</b>
          </span>
        ))}

        {grid && loop && (
          <div
            role="region"
            aria-label={`Loop bars ${loop.startBar + 1} to ${loop.endBar + 1}`}
            data-armed={loopArmed ? 'true' : 'false'}
            className={styles.region}
            style={{
              left: `${pct(barStart(grid, loop.startBar))}%`,
              width: `${pct(barStart(grid, loop.endBar)) - pct(barStart(grid, loop.startBar))}%`,
            }}
          >
            <b>{loop.startBar + 1}</b>
            <b>{loop.endBar + 1}</b>
          </div>
        )}

        <div ref={playheadRef} className={styles.playhead} />
      </div>
    </div>
  );
}
```

`Timeline.module.css`: `.track` is `position: relative; height: var(--ds-hit-perform);
background: var(--ds-surface); border: 1px solid var(--ds-border);`. `.beat` is a 1 px
`--ds-border` line, `.bar` a 1 px `--ds-border-strong` line, `.barLabel` mono +
`tabular-nums` + `--ds-t-xs`. `.region` is `background: color-mix(in srgb, var(--ds-accent) 18%, transparent)` with
`border-left`/`border-right` in `--ds-accent`; `.region[data-armed='false']` swaps all
three to `--ds-text-3` — that is U-06's visible disarm. Derive the fills with `color-mix`
from the tokens rather than hand-typing their RGB, or a repaint of `--ds-accent` silently
leaves the region behind. `.playhead` is `position: absolute; top: 0; bottom: 0; width: 2px; background:
var(--ds-text); will-change: left;` with **no `transition` and no `animation`** (U-05).

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd frontend && npm test && npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/songview
git commit -m "feat(frontend): Timeline with bar ruler, A-B region and rAF playhead"
```

---

## Task 11: `Transport` bar and keyboard shortcuts

**Files:**
- Create: `frontend/src/songview/Transport.tsx`
- Create: `frontend/src/songview/Transport.module.css`
- Create: `frontend/src/songview/Transport.test.tsx`

**Interfaces:**
- Consumes: `usePlayhead` (Task 10), `Grid`/`barAt` (Task 4).
- Produces:

```ts
export interface TransportProps {
  playing: boolean;
  grid: Grid | null;
  getPosition(): SampleIndex;
  tempo: number;              // 0.5..1.0
  pitchSemitones: number;     // -12..12
  metronome: boolean;
  loopArmed: boolean;
  hasLoop: boolean;
  onPlayPause(): void;
  onTempoChange(tempo: number): void;
  onPitchChange(semitones: number): void;
  onMetronomeToggle(): void;
  onLoopArmToggle(): void;
  onSetLoopStart(): void;
  onSetLoopEnd(): void;
  onNudgeBars(delta: number): void;
  onMuteLane(index: number): void;
}
export function Transport(props: TransportProps): JSX.Element;
```

- [ ] **Step 1: Write the failing test**

Create `frontend/src/songview/Transport.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { buildGrid } from '../music/grid';
import { sampleIndex } from '../engine/types';
import { Transport } from './Transport';

function grid8() {
  const beats: number[] = [];
  const downbeats: number[] = [];
  for (let i = 0; i < 32; i++) {
    beats.push(i * 24_000);
    if (i % 4 === 0) downbeats.push(i * 24_000);
  }
  return buildGrid({ bpm: 120, beats, downbeats })!;
}

function renderTransport(over: Partial<Parameters<typeof Transport>[0]> = {}) {
  const props = {
    playing: false,
    grid: grid8(),
    getPosition: () => sampleIndex(0),
    tempo: 1,
    pitchSemitones: 0,
    metronome: false,
    loopArmed: false,
    hasLoop: false,
    onPlayPause: vi.fn(),
    onTempoChange: vi.fn(),
    onPitchChange: vi.fn(),
    onMetronomeToggle: vi.fn(),
    onLoopArmToggle: vi.fn(),
    onSetLoopStart: vi.fn(),
    onSetLoopEnd: vi.fn(),
    onNudgeBars: vi.fn(),
    onMuteLane: vi.fn(),
    ...over,
  };
  render(<Transport {...props} />);
  return props;
}

describe('Transport', () => {
  it('shows tempo as a percentage and pitch in semitones, both mono', () => {
    renderTransport({ tempo: 0.75, pitchSemitones: -2 });
    expect(screen.getByText('75%')).toBeInTheDocument();
    expect(screen.getByText('-2 st')).toBeInTheDocument();
  });

  it('clamps tempo to N-04’s 50-100% range', () => {
    renderTransport();
    const slider = screen.getByRole('slider', { name: /tempo/i }) as HTMLInputElement;
    expect(slider.min).toBe('50');
    expect(slider.max).toBe('100');
  });

  it('shows the bar number, 1-indexed', () => {
    renderTransport({ getPosition: () => sampleIndex(24_000 * 4) });
    expect(screen.getByTestId('bar-readout')).toHaveTextContent('2');
  });

  it('maps every performance key from UI spec §7', async () => {
    const props = renderTransport();
    await userEvent.keyboard(' ');
    expect(props.onPlayPause).toHaveBeenCalledOnce();
    await userEvent.keyboard('l');
    expect(props.onLoopArmToggle).toHaveBeenCalledOnce();
    await userEvent.keyboard('a');
    expect(props.onSetLoopStart).toHaveBeenCalledOnce();
    await userEvent.keyboard('b');
    expect(props.onSetLoopEnd).toHaveBeenCalledOnce();
    await userEvent.keyboard('m');
    expect(props.onMetronomeToggle).toHaveBeenCalledOnce();
    await userEvent.keyboard('3');
    expect(props.onMuteLane).toHaveBeenCalledWith(2);
    await userEvent.keyboard('{ArrowRight}');
    expect(props.onNudgeBars).toHaveBeenCalledWith(1);
    await userEvent.keyboard('{ArrowLeft}');
    expect(props.onNudgeBars).toHaveBeenCalledWith(-1);
  });

  it('steps tempo by 5% with the arrow keys', async () => {
    const props = renderTransport({ tempo: 0.8 });
    await userEvent.keyboard('{ArrowUp}');
    expect(props.onTempoChange).toHaveBeenCalledWith(0.85);
    await userEvent.keyboard('{ArrowDown}');
    expect(props.onTempoChange).toHaveBeenCalledWith(0.75);
  });

  it('does not steal keys while the user is typing in a field', async () => {
    const props = renderTransport();
    render(<input aria-label="somewhere else" />);
    await userEvent.click(screen.getByLabelText('somewhere else'));
    await userEvent.keyboard('a');
    expect(props.onSetLoopStart).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd frontend && npm test -- src/songview/Transport.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `frontend/src/songview/Transport.tsx`. The parts that carry rules:

```tsx
// UI spec §5 "Transport bar" and §7 (keyboard). Performance tier throughout:
// 56 px targets, mono tabular numerals (U-04), and an untouched tempo or pitch
// renders muted so the eye finds the one that is not at its default.
import { useCallback, useEffect, useRef } from 'react';

import { barAt, type Grid } from '../music/grid';
import type { SampleIndex } from '../engine/types';
import { usePlayhead } from './usePlayhead';
import styles from './Transport.module.css';

const TEMPO_STEP = 0.05; // UI spec §7: up/down arrows move 5%

export function Transport({ /* ...props... */ }: TransportProps) {
  const barRef = useRef<HTMLSpanElement | null>(null);

  const paint = useCallback(
    (position: SampleIndex) => {
      if (!barRef.current) return;
      // 1-indexed on screen; barAt returns -1 before the first downbeat.
      const bar = grid ? barAt(grid, position) : -1;
      barRef.current.textContent = bar >= 0 ? String(bar + 1) : '--';
    },
    [grid],
  );
  usePlayhead(getPosition, paint, playing);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      // Never steal a key from a text field: the right rail renames loops.
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) {
        return;
      }
      // Nor from the OS: without this, Ctrl/Cmd+A sets a loop point and
      // preventDefault()s select-all. shiftKey is deliberately not excluded --
      // the uppercase entries below exist so a shift-held letter still works.
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const key = event.key;
      const actions: Record<string, () => void> = {
        ' ': onPlayPause,
        l: onLoopArmToggle,
        L: onLoopArmToggle,
        a: onSetLoopStart,
        A: onSetLoopStart,
        b: onSetLoopEnd,
        B: onSetLoopEnd,
        m: onMetronomeToggle,
        M: onMetronomeToggle,
        ArrowUp: () => onTempoChange(Math.min(1, Number((tempo + TEMPO_STEP).toFixed(2)))),
        ArrowDown: () => onTempoChange(Math.max(0.5, Number((tempo - TEMPO_STEP).toFixed(2)))),
        ArrowRight: () => onNudgeBars(1),
        ArrowLeft: () => onNudgeBars(-1),
      };
      if (key >= '1' && key <= '4') {
        event.preventDefault();
        onMuteLane(Number(key) - 1);
        return;
      }
      const action = actions[key];
      if (action) {
        event.preventDefault();
        action();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [tempo, onPlayPause, onLoopArmToggle, onSetLoopStart, onSetLoopEnd, onMetronomeToggle, onTempoChange, onNudgeBars, onMuteLane]);

  return (
    <div className={styles.bar}>
      <button
        type="button"
        className={styles.play}
        aria-label={playing ? 'Pause' : 'Play'}
        onClick={onPlayPause}
      >
        {playing ? '⏸' : '▶'}
      </button>

      <span className={styles.barNumber} data-testid="bar-readout" ref={barRef}>
        --
      </span>

      <label className={styles.slider}>
        Tempo
        <input
          type="range"
          aria-label="Tempo"
          min={50}
          max={100}
          step={1}
          value={Math.round(tempo * 100)}
          onChange={(e) => onTempoChange(Number(e.target.value) / 100)}
        />
        {/* Untouched values render muted (UI spec §5). */}
        <output data-default={tempo === 1 ? 'true' : 'false'}>{Math.round(tempo * 100)}%</output>
      </label>

      <label className={styles.slider}>
        Pitch
        <input
          type="range"
          aria-label="Pitch"
          min={-12}
          max={12}
          step={1}
          value={pitchSemitones}
          onChange={(e) => onPitchChange(Number(e.target.value))}
        />
        <output data-default={pitchSemitones === 0 ? 'true' : 'false'}>{pitchSemitones} st</output>
      </label>

      <button type="button" aria-label="Metronome" aria-pressed={metronome} onClick={onMetronomeToggle}>
        Metronome
      </button>
      <button
        type="button"
        aria-label="Arm loop"
        aria-pressed={loopArmed}
        disabled={!hasLoop}
        onClick={onLoopArmToggle}
      >
        Loop
      </button>
      <button type="button" onClick={onSetLoopStart}>Set A</button>
      <button type="button" onClick={onSetLoopEnd}>Set B</button>
    </div>
  );
}
```

Destructure the props in the signature as usual; the ellipsis above is shorthand for the
full `TransportProps` destructuring, not something to leave in the code.

`Transport.module.css`: `.play` is `width: var(--ds-hit-perform); height:
var(--ds-hit-perform)`; `.barNumber` is `font: 700 var(--ds-t-display)/1 var(--ds-mono);
font-variant-numeric: tabular-nums`; `output[data-default='true'] { color:
var(--ds-text-3); }`; sliders get a padded hit area meeting `--ds-hit-perform` with the
visual track at 14 px (UI spec §5's implementation note).

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd frontend && npm test && npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/songview
git commit -m "feat(frontend): Transport bar with performance-tier controls and keyboard"
```

---

## Task 12: `ChordStrip` and the right rail

**Files:**
- Create: `frontend/src/songview/ChordStrip.tsx`, `.module.css`, `.test.tsx`
- Create: `frontend/src/songview/RightRail.tsx`, `.module.css`, `.test.tsx`

**Interfaces:**
- Consumes: `ChordSegment`, `KeyCandidate`, `Loop` from `../api/client`; `Grid`,
  `barStart`, `barAt`; `usePlayhead`; `noteName`/`pitchClassOf` from `../music/theory`.
- Produces:

```ts
export interface ChordStripProps {
  chords: ChordSegment[];
  grid: Grid | null;
  durationSamples: SampleIndex;
  getPosition(): SampleIndex;
  playing: boolean;
}

export interface RightRailProps {
  songId: string;
  candidates: KeyCandidate[];
  savedLoops: Loop[];
  activeLoop: Loop | null;
  countInBars: number;
  onRecallLoop(loop: Loop): void;
  onSaveActiveLoop(name: string): void;
  onDeleteLoop(name: string): void;
  onCountInChange(bars: number): void;
}
```

- [ ] **Step 1: Write the failing tests**

`frontend/src/songview/ChordStrip.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { buildGrid } from '../music/grid';
import { sampleIndex } from '../engine/types';
import { ChordStrip } from './ChordStrip';

const grid = buildGrid({
  bpm: 120,
  beats: Array.from({ length: 16 }, (_, i) => i * 24_000),
  downbeats: [0, 96_000, 192_000, 288_000],
})!;

const chords = [
  { bar: 0, start_sample: 0, end_sample: 96_000, chord: 'G:maj' },
  { bar: 1, start_sample: 96_000, end_sample: 192_000, chord: 'E:min' },
  { bar: 2, start_sample: 192_000, end_sample: 288_000, chord: 'N' },
  { bar: 3, start_sample: 288_000, end_sample: 384_000, chord: 'X' },
];

describe('ChordStrip', () => {
  it('renders chords in a readable spelling, not the wire format', () => {
    render(
      <ChordStrip chords={chords} grid={grid} durationSamples={sampleIndex(384_000)} getPosition={() => sampleIndex(0)} playing={false} />,
    );
    expect(screen.getByText('G')).toBeInTheDocument();
    expect(screen.getByText('Em')).toBeInTheDocument();
  });

  it('shows no-chord and unclassifiable segments honestly rather than blank', () => {
    render(
      <ChordStrip chords={chords} grid={grid} durationSamples={sampleIndex(384_000)} getPosition={() => sampleIndex(0)} playing={false} />,
    );
    expect(screen.getByLabelText(/no chord/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/unclassified/i)).toBeInTheDocument();
  });

  it('says so when there are no chords rather than rendering an empty strip', () => {
    render(
      <ChordStrip chords={[]} grid={grid} durationSamples={sampleIndex(384_000)} getPosition={() => sampleIndex(0)} playing={false} />,
    );
    expect(screen.getByText(/no chord chart/i)).toBeInTheDocument();
  });

  it('marks the chord under the playhead as current', () => {
    render(
      <ChordStrip chords={chords} grid={grid} durationSamples={sampleIndex(384_000)} getPosition={() => sampleIndex(100_000)} playing={false} />,
    );
    expect(screen.getByText('Em').closest('[data-current]')).toHaveAttribute('data-current', 'true');
  });
});
```

`frontend/src/songview/RightRail.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { RightRail } from './RightRail';

function renderRail(over = {}) {
  const props = {
    songId: 'abc123',
    candidates: [
      { tonic: 'G', mode: 'major' as const, confidence: 0.62 },
      { tonic: 'E', mode: 'minor' as const, confidence: 0.38 },
    ],
    savedLoops: [{ name: 'Chorus', start_bar: 16, end_bar: 24 }],
    activeLoop: { name: 'A-B', start_bar: 4, end_bar: 8 },
    countInBars: 1,
    onRecallLoop: vi.fn(),
    onSaveActiveLoop: vi.fn(),
    onDeleteLoop: vi.fn(),
    onCountInChange: vi.fn(),
    ...over,
  };
  render(<RightRail {...props} />);
  return props;
}

describe('RightRail', () => {
  it('shows every key candidate with its confidence, never one answer as fact (R-05)', () => {
    renderRail();
    expect(screen.getByText(/62%/)).toBeInTheDocument();
    expect(screen.getByText(/38%/)).toBeInTheDocument();
  });

  it('links to the scale sheet for the song', () => {
    renderRail();
    expect(screen.getByRole('link', { name: /scale/i })).toHaveAttribute(
      'href',
      '/songs/abc123/scale',
    );
  });

  it('recalls a saved loop', async () => {
    const props = renderRail();
    await userEvent.click(screen.getByRole('button', { name: /Chorus/ }));
    expect(props.onRecallLoop).toHaveBeenCalledWith({ name: 'Chorus', start_bar: 16, end_bar: 24 });
  });

  it('saves the active loop under a typed name', async () => {
    const props = renderRail();
    await userEvent.type(screen.getByLabelText(/loop name/i), 'Bridge');
    await userEvent.click(screen.getByRole('button', { name: /save loop/i }));
    expect(props.onSaveActiveLoop).toHaveBeenCalledWith('Bridge');
  });

  it('cannot save a loop when there is no active loop', () => {
    renderRail({ activeLoop: null });
    expect(screen.getByRole('button', { name: /save loop/i })).toBeDisabled();
  });

  it('changes the count-in length', async () => {
    const props = renderRail();
    await userEvent.click(screen.getByRole('button', { name: /2 bars/i }));
    expect(props.onCountInChange).toHaveBeenCalledWith(2);
  });
});
```

Wrap `RightRail` renders in a `MemoryRouter` — it contains a `Link`. Copy the wrapper
pattern from `frontend/src/screens/ScaleSheet.test.tsx`.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd frontend && npm test -- src/songview/ChordStrip.test.tsx src/songview/RightRail.test.tsx
```

Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`ChordStrip.tsx` — positions each segment by its own `start_sample`/`end_sample`
(analysis already aligned them to bars; re-deriving from `bar` would throw away that work),
and formats the wire chord for a music stand:

```tsx
/**
 * "G:maj" -> "G", "E:min" -> "Em", "C:maj7" -> "Cmaj7", "N" -> no chord,
 * "X" -> unclassifiable. The wire format is BTC's; this is the reading of it.
 * Both N and X are rendered as marks with labels rather than as blanks -- a gap
 * in the strip would read as a rendering bug instead of as "the model had
 * nothing to say here" (N-08's spirit applied to a display).
 */
export function formatChord(chord: string): { text: string; label: string } {
  if (chord === 'N') return { text: '–', label: 'no chord' };
  if (chord === 'X') return { text: '?', label: 'unclassified' };
  const [root, quality] = chord.split(':');
  if (!quality) return { text: chord, label: chord };
  if (quality === 'maj') return { text: root!, label: `${root} major` };
  if (quality === 'min') return { text: `${root}m`, label: `${root} minor` };
  return { text: `${root}${quality}`, label: `${root} ${quality}` };
}
```

The current-chord highlight uses `usePlayhead` with a ref-based data attribute flip, the
same pattern `Timeline` uses — never React state.

`RightRail.tsx` — setup tier throughout (40 px targets), key candidate chips always plural
and always with confidence (UI spec §5), a `Link` to `/songs/{songId}/scale`, the saved
loop list with recall and delete, a name field plus Save, and a count-in segmented control
offering 0 / 1 / 2 bars.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd frontend && npm test && npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/songview
git commit -m "feat(frontend): chord strip and Song view right rail"
```

---

## Task 13: `SongView` assembly — engine lifecycle, recipe, U-06

**Files:**
- Rewrite: `frontend/src/screens/SongView.tsx`
- Create: `frontend/src/screens/SongView.module.css`
- Create: `frontend/src/screens/SongView.test.tsx`

**Interfaces:**
- Consumes: everything from Tasks 4–12.
- Produces: the screen at `/songs/:songId`. No new exported API.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/screens/SongView.test.tsx`. `EngineController` is mocked wholesale:
jsdom has no Web Audio, and what this test pins is the *screen's* behaviour — states,
autosave, U-06 — not the engine's, which Tasks 5–7 already cover.

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SongView } from './SongView';

const engine = {
  play: vi.fn(async () => {}),
  pause: vi.fn(),
  seek: vi.fn(),
  setLoop: vi.fn(),
  setTempo: vi.fn(),
  setPitchSemitones: vi.fn(),
  setStemGain: vi.fn(),
  setMetronome: vi.fn(),
  setGrid: vi.fn(),
  countInAndPlay: vi.fn(async () => {}),
  onEnded: vi.fn(() => () => {}),
  getPositionSamples: vi.fn(() => 0),
  dispose: vi.fn(async () => {}),
  durationSamples: 48_000 * 32,
  durationSeconds: 32,
  stemSummaries: ['vocals', 'drums', 'bass', 'other'].map((name) => ({
    name,
    envelope: Float32Array.from([0.3, 0.5]),
    peak: 0.5,
    nearSilent: false,
  })),
};

vi.mock('../engine/EngineController', () => ({
  STEM_ORDER: ['vocals', 'drums', 'bass', 'other'],
  EngineController: { create: vi.fn(async () => engine) },
}));
vi.mock('wavesurfer.js', () => ({
  default: { create: () => ({ destroy: vi.fn(), setOptions: vi.fn(), on: () => () => {} }) },
}));

const songEntry = {
  dir: 'abc123-test',
  state: 'analyzed',
  unreadable: null,
  files: { has_audio: true, has_peaks: true, has_stems: true, has_analysis: true },
  song: {
    schema_version: 2,
    id: 'abc123',
    title: 'Test Song',
    artist: 'Someone',
    source: { kind: 'upload', value: 'original.mp3' },
    created_at: '2026-09-28T00:00:00+00:00',
    last_played_at: null,
    mix: {
      vocals: { gain_db: 0, muted: false },
      drums: { gain_db: 0, muted: false },
      bass: { gain_db: 0, muted: true },
      other: { gain_db: 0, muted: false },
    },
    playback: { tempo: 0.8, pitch_semitones: -1 },
    loops: [],
    active_loop: null,
    metronome: false,
    count_in_bars: 0,
  },
};

const analysis = {
  schema_version: 1,
  key_candidates: [{ tonic: 'G', mode: 'major', confidence: 1 }],
  beat_grid: {
    bpm: 120,
    beats: Array.from({ length: 64 }, (_, i) => i * 24_000),
    downbeats: Array.from({ length: 16 }, (_, i) => i * 96_000),
  },
  chords: [{ bar: 0, start_sample: 0, end_sample: 96_000, chord: 'G:maj' }],
};

function mockFetch(overrides: Record<string, unknown> = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const body =
        overrides[url] ??
        (url.endsWith('/analysis') ? analysis : url.includes('/api/songs/abc123') ? songEntry : {});
      if (body === 404) return new Response('not found', { status: 404 });
      return new Response(JSON.stringify(body), { status: init?.method === 'PUT' ? 200 : 200 });
    }),
  );
}

function renderSongView() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/songs/abc123']}>
        <Routes>
          <Route path="/songs/:songId" element={<SongView />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => mockFetch());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('SongView', () => {
  it('shows the song title and four stem lanes once loaded', async () => {
    renderSongView();
    expect(await screen.findByRole('heading', { name: /Test Song/ })).toBeInTheDocument();
    for (const name of ['vocals', 'drums', 'bass', 'other']) {
      expect(await screen.findByRole('group', { name: `${name} stem` })).toBeInTheDocument();
    }
  });

  it('restores the saved recipe into the engine on load', async () => {
    renderSongView();
    await waitFor(() => expect(engine.setTempo).toHaveBeenCalledWith(0.8));
    expect(engine.setPitchSemitones).toHaveBeenCalledWith(-1);
    // bass was muted in song.json: it must come back muted, not at unity.
    expect(engine.setStemGain).toHaveBeenCalledWith('bass', 0);
  });

  it('autosaves a mix change back to song.json', async () => {
    renderSongView();
    const mute = await screen.findByRole('button', { name: /mute vocals/i });
    await userEvent.click(mute);
    await waitFor(() => {
      const put = (fetch as ReturnType<typeof vi.fn>).mock.calls.find(
        ([, init]) => init?.method === 'PUT',
      );
      expect(put).toBeDefined();
      expect(JSON.parse(put![1].body).mix.vocals.muted).toBe(true);
    });
  });

  it('disarms the loop when the user scrubs, visibly (U-06)', async () => {
    renderSongView();
    await screen.findByRole('heading', { name: /Test Song/ });
    await userEvent.click(await screen.findByRole('button', { name: /set a/i }));
    await userEvent.click(await screen.findByRole('button', { name: /set b/i }));
    await userEvent.click(await screen.findByRole('button', { name: /arm loop/i }));
    expect(screen.getByRole('button', { name: /arm loop/i })).toHaveAttribute('aria-pressed', 'true');

    const track = screen.getByTestId('timeline-track');
    vi.spyOn(track, 'getBoundingClientRect').mockReturnValue({
      left: 0, width: 1000, top: 0, height: 40, right: 1000, bottom: 40, x: 0, y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    track.dispatchEvent(new MouseEvent('click', { clientX: 500, bubbles: true }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /arm loop/i })).toHaveAttribute(
        'aria-pressed',
        'false',
      ),
    );
    // D-06: the loop is released at the engine before the cursor is moved.
    expect(engine.setLoop).toHaveBeenLastCalledWith(null);
    expect(engine.seek).toHaveBeenCalled();
  });

  it('refuses to build an engine for a song with no stems, and says why', async () => {
    mockFetch({
      '/api/songs/abc123': { ...songEntry, state: 'imported', files: { ...songEntry.files, has_stems: false } },
    });
    renderSongView();
    expect(await screen.findByText(/not been separated/i)).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: /bass stem/ })).not.toBeInTheDocument();
  });

  it('plays without a beat grid, but says bars are unavailable', async () => {
    mockFetch({ '/api/songs/abc123/analysis': 404 });
    renderSongView();
    expect(await screen.findByRole('button', { name: /^play$/i })).toBeInTheDocument();
    expect(screen.getByText(/no beat grid/i)).toBeInTheDocument();
  });

  it('surfaces an engine construction failure verbatim (N-08)', async () => {
    const { EngineController } = await import('../engine/EngineController');
    vi.mocked(EngineController.create).mockRejectedValueOnce(
      new Error('DOMException: Unable to decode audio data'),
    );
    renderSongView();
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to decode audio data');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd frontend && npm test -- src/screens/SongView.test.tsx
```

Expected: FAIL — the stub `SongView` renders only `<h1>Song abc123</h1>`.

- [ ] **Step 3: Implement the screen**

Rewrite `frontend/src/screens/SongView.tsx`. Its responsibilities, in order:

1. **Fetch** `useSong(songId)` and `useAnalysis(songId)`. A 404 from analysis is the normal
   "not analyzed yet" state (copy the `ApiError.status === 404` handling from
   `ScaleSheet.tsx`), not an error — the screen still plays, with no bars.
2. **Gate on stems.** If `entry.files?.has_stems` is false, render a calm explanation
   ("This song has not been separated yet — the Song view needs its four stems") with a
   link to `/jobs`, and build no engine. A song whose `song.json` is `unreadable` renders
   that message verbatim in an `alert` (§9, U-09).
3. **Build the engine once** in an effect keyed on `songId`, from
   `songMedia(songId).stem(name)` for the four names, inside `try/catch`; on failure set an
   error string and render it verbatim in `role="alert"` (N-08). Dispose on unmount. Guard
   against the React 18/19 double-invoke by tracking a `cancelled` flag and disposing a
   controller that arrives after unmount.
4. **Apply the saved recipe** to the engine as soon as both engine and song are ready:
   `setTempo`, `setPitchSemitones`, `setGrid(grid.bars, grid.beats)`, `setMetronome`, each
   stem's gain, and `setLoop` if `active_loop` is set *and* armed.
5. **Own the recipe in one `song` state object** seeded from the fetched `Song`. Every
   control edits that object through a single `applyRecipe(next: Song)` helper which (a)
   sets state, (b) pushes the delta to the engine, (c) calls `save(next)` from
   `useUpdateSong`. One funnel means no control can change the engine without also
   persisting, which is the whole of "all settings auto-save".
6. **Gain maths in one place:**

```ts
/**
 * Mute, solo and gain collapse into the one number the engine takes. D6-04:
 * solo is transient React state and mute is persisted in song.json, so they are
 * combined here rather than stored combined.
 */
function effectiveGain(mix: StemMix | undefined, name: StemName, soloed: Set<StemName>): number {
  if (mix?.muted) return 0;
  if (soloed.size > 0 && !soloed.has(name)) return 0;
  const db = mix?.gain_db ?? 0;
  return Math.pow(10, db / 20);
}
```

7. **Loop handling.** `Set A` snaps the current position to a bar via `snapToBar` and
   writes `active_loop.start_bar`; `Set B` the same for `end_bar`, rejecting an end at or
   before the start. Arming calls
   `engine.setLoop({ startFrame: barStart(grid, startBar), endFrame: barStart(grid, endBar) })`;
   disarming calls `engine.setLoop(null)`. With no grid, `Set A`/`Set B` and the arm button
   are disabled with a title explaining that bars need analysis.
8. **U-06:** `onScrub` first — if the loop is armed — sets `loopArmed` false and calls
   `engine.setLoop(null)`, *then* `engine.seek(position)`. In that order: D-06 says the
   stretcher is never seeked, and releasing the loop before moving the cursor is what keeps
   the wrap logic from firing against a cursor that has left the region.
9. **Play/pause.** Play with `count_in_bars > 0` and a grid goes through
   `engine.countInAndPlay(position, bars, grid.bars, restoreGains)`; otherwise
   `engine.play()`. `onEnded` sets `playing` false. On the first successful play, stamp
   `last_played_at` into the recipe so the library's sort order is real.
10. **Layout** per UI spec §6 screen 3: timeline, four `StemLane`s, chord strip, transport
    bar, and a 320 px right rail. Grid in CSS, `--ds-*` tokens only.

- [ ] **Step 4: Run everything**

```bash
cd frontend && npm test && npm run typecheck && npm run build
```

Expected: PASS, `tsc --noEmit` clean, and a production build that succeeds. Then confirm
the dev-only harness is still excluded:

```bash
cd frontend && grep -rl "EngineHarness" dist/ || echo "harness correctly absent from the bundle"
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/screens/SongView.tsx frontend/src/screens/SongView.module.css frontend/src/screens/SongView.test.tsx
git commit -m "feat(frontend): Song view assembled on the engine, with autosave and U-06"
```

---

## Task 14: Real-hardware verification

Nothing above proves the screen *sounds* right; jsdom has no audio. This task is the
listening pass, run on the real machine against a real separated and analyzed song, and it
is where N-03, N-05 and N-06 are actually discharged. Mirrors Phase 5's Task 12.

**Files:**
- Modify: this file (append the verification log below)
- Modify: `docs/superpowers/plans/2026-09-27-stemcraft-roadmap.md` (mark Phase 6 done)

- [ ] **Step 1: Bring the system up**

```bash
uv run stemcraft-api
```

```bash
uv run stemcraft-worker
```

```bash
cd frontend && npm run dev
```

Import `Fortunate-Son.mp3` (already in the repo root) if no separated+analyzed song exists
yet, and wait for `separate` and `analyze` to finish in the Job queue.

- [ ] **Step 2: Measure N-03 — under ~3 s to first playback**

Open the Song view from the Library with the browser devtools Network panel open and
throttling off, over the LAN rather than on localhost. Record the time from navigation to
the moment the first `play()` produces sound. Note the four `.opus` transfer sizes and the
decode time.

- [ ] **Step 3: Verify N-05 — the loop wrap, on real music and on the click track**

Set an A–B loop over a four-bar phrase and let it run for at least 10 minutes. Listen
specifically at the wrap. Then repeat on the dev harness click track
(`/dev/engine-harness`) where a seam is unmissable, since Phase 3's guarantee must survive
the metronome and transport changes Tasks 5 and 6 made to `renderBlock`.

- [ ] **Step 4: Verify N-06 — mute/solo latency**

Toggle mute on the drums during playback and judge the lag against N-06's 50–100 ms
window. Do the same for solo and for a gain drag.

- [ ] **Step 5: Verify the metronome and count-in against the grid**

Turn the metronome on over real music at 100 % tempo and confirm the click lands on the
drums, not beside them. Drop to 60 % and confirm it still does — that is the D6-03 claim
being tested. Set count-in to 2 bars and confirm two bars of click precede the music at the
current tempo.

- [ ] **Step 6: Verify persistence and the accepted two-tab clobber**

Change mute, tempo, pitch, metronome, count-in and the A–B loop; reload; confirm every
setting came back. Then open the same song in two tabs, change tempo in each, reload both,
and confirm the last write won and nothing else broke — §5 says this is observed and
accepted, not fixed, and the log should record that it was actually observed.

- [ ] **Step 7: Record the results here**

Append a "## Real-hardware verification" section to this file with: the date, the song
used, the measured N-03 time with the transfer sizes, the loop-duration and the verdict on
N-05, the N-06 judgement, the metronome-alignment result at both tempos, the persistence
result, and the two-tab observation. Record **measured numbers, not "works"** — and if a
number misses its target, record the miss and open the question rather than rounding it
into a pass.

- [ ] **Step 8: Mark the phase complete and commit**

```bash
git add docs/superpowers/plans/2026-09-28-phase-6-song-view.md docs/superpowers/plans/2026-09-27-stemcraft-roadmap.md
git commit -m "docs: Phase 6 real-hardware verification and roadmap update"
```

---

## Exit criteria (roadmap Phase 6)

- [ ] Stacked waveforms via wavesurfer, slaved to the engine clock; playhead positioned by
      `requestAnimationFrame` from that clock, never by CSS (U-05) — Tasks 9, 10.
- [ ] Per-stem mute, solo, volume; live tempo 50–100 % and live pitch shift — Tasks 9, 11, 13.
- [ ] A–B loop snapped to bars, stored as bar numbers and resolved through the grid —
      Tasks 2, 4, 13.
- [ ] Count-in and metronome locked to the grid — Task 6.
- [ ] Scrubbing during an active loop disarms the loop first, visibly (U-06) — Tasks 10, 13.
- [ ] Recipe auto-saves to `song.json` as whole-document writes under last-write-wins —
      Tasks 3, 8, 13.
- [ ] N-03 under ~3 s to first playback over LAN; N-05 on real music; N-06 on mix changes;
      settings survive a reload; two tabs clobbering each other is observed and accepted —
      Task 14.
