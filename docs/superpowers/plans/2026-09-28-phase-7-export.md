# Stemcraft Phase 7: Export — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** turn the practice recipe into a file. Pick any subset of stems, render them
server-side from the immutable WAV masters with the current tempo and pitch applied (or
deliberately not), and land a 320 kbps MP3 in `exports/` that is downloadable from the
browser — rendered at higher quality than the live preview, on purpose (D-10).

**Architecture:** one new job kind and one ffmpeg invocation. The `export` kind builds a
single filtergraph — per-stem `volume`, then `amix`, then `rubberband`, then `libmp3lame` —
and runs it as one subprocess, so there is no intermediate file and no second resample. The
job's input is a **recipe snapshot copied into the job payload at enqueue time**, not a
pointer to `song.json`: `song.json` is autosaved continuously and a job whose inputs move
under it cannot be idempotent by re-derivation (§6). The API reads `song.json` to build that
snapshot and writes nothing; the worker writes only into `exports/`. The frontend Export
screen is the modal from the UI spec: a stem picker prefilled from the current mix, an
explicit as-practiced/original choice, and the D-10 banner that says out loud that the file
will not sound identical to the preview.

**Tech Stack:** no new dependencies in any package. ffmpeg's `rubberband` filter
(librubberband, already present in the host's ffmpeg 6.1.1 build and now checked at boot)
plus `libmp3lame`; FastAPI, pydantic, React 19, TanStack Query 5, Vitest.

**Spec:** [design/tech-spec-stemcraft.md](../../../design/tech-spec-stemcraft.md) §5
(layout, invariants), §6 (HTTP/JSON, audio over HTTP, idempotency by re-derivation), §7
(ffmpeg), D-03, D-04, D-10, D-14, D-15;
[design/domain-spec.md](../../../design/domain-spec.md) "Export";
[design/ui-spec.md](../../../design/ui-spec.md) §6 screen 5, and the built mockup
[design/ui/src/pages/screens/export.html](../../../design/ui/src/pages/screens/export.html);
phase map: [2026-09-27-stemcraft-roadmap.md](2026-09-27-stemcraft-roadmap.md) Phase 7. Prior
phases: [Phase 2 audio I/O](2026-09-27-phase-2-audio-io-import.md),
[Phase 4 separation](2026-09-27-phase-4-separation.md),
[Phase 6 song view](2026-09-28-phase-6-song-view.md).

## Global Constraints

Every task inherits these. They are correctness floors copied from the spec, not
preferences.

- **The API never imports torch (§4).** This phase adds three routes that read `song.json`,
  list a directory and serve a file. Nothing in `stemcraft_api` or `stemcraft_lib` gains a
  torch-touching import; `stemcraft_lib.export` and `stemcraft_lib.ffmpeg` must stay
  importable in a torch-free environment.
- **One writer per file (§5).** The worker owns `exports/`. The API never creates, writes or
  deletes a file in it — it only lists and serves. The API owns `song.json`; **this phase
  adds no field to it** (see D7-08).
- **Stems are immutable (§5).** The export reads `stems/*.wav` and writes a new file. It
  never re-separates, never touches a stem, never rewrites `audio.wav`.
- **The original upload is never modified or deleted.** Nothing here reads it either.
- **48 kHz everywhere (D-03).** Every ffmpeg invocation in this phase passes
  `-ar 48000` explicitly, from `stemcraft_lib.config.SAMPLE_RATE`. Never 44.1.
- **All writes atomic** — `exports/<name>.mp3` is written through
  `stemcraft_lib.atomic.atomic_output`, so a cancelled or failed render leaves either the
  previous good file or nothing, never a truncated MP3.
- **Idempotent by re-derivation (§6).** Re-running an `export` job must reproduce its own
  output byte for byte and overwrite it. This is the reason for D7-02, and it is asserted in
  a test, not assumed.
- **Render from the WAV masters, never the Opus delivery copies (D-04).** `.opus` exists for
  playback only. An export that re-encoded a 128 kbps Opus into a 320 kbps MP3 would be a
  lie about its own quality.
- **The export is deliberately not identical to the preview (D-10).** Better, never worse.
  The UI states this in words, in the modal, unprompted — it is a documented property, and
  the banner is what stops it being filed as a bug later.
- **Fail loudly (N-08).** A missing stem master, a rejected filtergraph, a failed encode
  surfaces ffmpeg's own stderr verbatim in the job row and in the UI. No silent fallback to
  original tempo, no "export failed" paraphrase.
- **Not in scope:** the zip download and per-track ID3 tagging of the album splitter (Phase
  8), WAV or FLAC export (§6 names `.wav` for export but the domain spec's Export section
  and the mockup's fixed "MP3 320" control decide MP3 only; see D7-09), export presets,
  loop-only or bar-range export, and deleting an export from the UI.

## Decisions this phase makes

Recorded here because reviewers will ask and none of them is re-litigable from inside a
task.

- **D7-01 — Tempo and pitch are applied by ffmpeg's `rubberband` filter, offline, with
  `pitchq=quality:channels=together:transients=crisp`.** This is what D-10's "higher
  quality than the live preview" actually means in code: the browser runs SoundTouch under a
  real-time budget on one shared instance (D-05), and the export runs librubberband's
  high-quality phase vocoder with no deadline at all, on the stereo mix as a coherent pair
  (`channels=together`) rather than two independently-smeared channels (the filter's
  `apart` default). *Rejected:* SoundTouch server-side for bit-parity with the preview —
  D-10 rejects it explicitly, it deliberately degrades the artifact; `atempo` +
  `asetrate` — `atempo` cannot shift pitch, and `asetrate` changes tempo and pitch
  together, so the pair cannot express "82 % tempo, −2 semitones" at all. *Cost:*
  librubberband becomes a correctness dependency, which is why Task 2 adds a boot check for
  it rather than discovering its absence at the first export.
- **D7-02 — The job payload carries a full recipe snapshot; the job never reads
  `song.json`.** §6 requires idempotency by re-derivation from "inputs that never change".
  `song.json` is the opposite of that: Phase 6 autosaves it on every slider drag. A job
  that read it at run time would render a different file after a lease reclaim than before
  it, and re-running job #41 from the Job Queue three days later would silently produce
  something other than what job #41 produced. So the API resolves the recipe to concrete
  numbers at enqueue time and puts them in `payload`. Stems never change, and `payload`
  never changes, so the render is reproducible. *Cost:* the payload is fat and duplicates
  values that also live in `song.json` — deliberate, and the reason the `ExportRecipe`
  model is in `stemcraft_lib` where both sides validate it.
- **D7-03 — A muted or unticked stem is left out of the filtergraph, not mixed at zero
  gain.** The stem picker *is* the mute state, and `amix` at `normalize=0` sums its inputs,
  so an excluded input is exactly an absent one. Mixing four inputs to drop one would be
  work with no audible result.
- **D7-04 — Even "all four stems, unity gain" renders the mix from the four stems; it never
  shortcuts to `audio.wav`.** Separation is not lossless: the sum of the four stems is close
  to the original but not equal to it, and what the user practised against is the sum of the
  stems. Shortcutting would make the "all stems" export the one case that does not match
  what was practised.
- **D7-05 — A recipe at 100 % tempo and 0 semitones omits the `rubberband` filter
  entirely.** There is no reason to push audio through a phase vocoder to ask it for
  identity, and a vocoder at identity is not a no-op — it re-synthesises. The mockup's
  "Original — 100 %, 0 st" toggle therefore produces a straight mix-and-encode. This is a
  property of the recipe, not of the toggle: a user who happens to be practising at 100 %
  with no pitch shift gets the same short filtergraph from the "as practiced" side.
- **D7-06 — The MP3 carries the Song's title and artist as ID3 tags, snapshotted into the
  payload with everything else.** Two `-metadata` flags. An export that lands in a phone's
  music player as "out.mp3" by an unknown artist is a worse artifact for no saving, and the
  API already has both strings in hand when it builds the snapshot.
- **D7-07 — A cancelled export terminates ffmpeg; it does not wait for a checkpoint.** D-09
  forbids killing a *separation* because it orphans VRAM. An export is a CPU subprocess
  writing to a temp file, so there is nothing to orphan: `terminate()`, let `atomic_output`
  unlink the temp file, and the previous good export (if any) is untouched. Cancellation is
  noticed on ffmpeg's own progress cadence (~0.5 s), which is well inside any human's idea
  of responsive.
- **D7-08 — `song.json` gains no fields and stays at `schema_version` 2. The list of
  exports is derived from the directory, like every other piece of Song state.** There is no
  "last exported" field, no export history in `song.json`, and no `has_exports` in
  `derive_files` — exports are not a Song *state* (a song with no export is not less
  complete than one with three), so adding one to `SongFiles` would put a value in the state
  ladder that does not belong on it.
- **D7-09 — MP3 320 kbps CBR only, one format, no picker.** §6 mentions `.wav` for export
  download, but the domain spec's Export section says MP3, the mockup's Format control is a
  single fixed "MP3 320" button, and a WAV export of a 320 kbps-audible artifact is 10× the
  bytes for a difference nobody in a practice room will hear. The seam for adding a format
  later is one field on `ExportRecipe`; this phase does not add it, because YAGNI and
  because an unused enum in a payload contract is worse than no enum.
- **D7-10 — The finished file is offered as a link, never auto-downloaded.** The mockup's
  "downloads when the job finishes" is implemented as a download link that appears on the
  finished export's row. A page that starts a download by itself on a WebSocket event is
  hostile when the user has already navigated on, and the link is one click.

## File structure

| File | Responsibility |
| --- | --- |
| `packages/stemcraft_lib/src/stemcraft_lib/export.py` (create) | the `ExportRecipe` payload contract, the `exports/` path and name rules, the directory listing |
| `packages/stemcraft_lib/tests/test_export.py` (create) | recipe validation, name slugging, pitch scale, listing |
| `packages/stemcraft_lib/src/stemcraft_lib/ffmpeg.py` (modify) | `build_export_args` (pure argv) and `render_export` (one subprocess, streamed progress, cancellable) |
| `packages/stemcraft_lib/src/stemcraft_lib/deps.py` (modify) | boot check that this ffmpeg really has `rubberband` |
| `packages/stemcraft_lib/tests/test_ffmpeg.py` (modify) | filtergraph shape, a real render, progress, cancel |
| `packages/stemcraft_lib/tests/test_deps.py` (modify) | the rubberband check passes on this host |
| `packages/stemcraft_worker/src/stemcraft_worker/kinds/export_song.py` (create) | the `export` job kind |
| `packages/stemcraft_worker/src/stemcraft_worker/kinds/__init__.py` (modify) | register it |
| `packages/stemcraft_worker/tests/test_export_song.py` (create) | end-to-end render through `run_one`, idempotency, failure, cancel |
| `packages/stemcraft_api/src/stemcraft_api/routes/songs.py` (modify) | `POST /export`, `GET /exports`, `GET /exports/{name}.mp3` |
| `packages/stemcraft_api/tests/test_songs_export.py` (create) | snapshot correctness, validation, listing, download, traversal rejection |
| `frontend/src/api/client.ts` (modify) | `ExportEntry`, `QueuedExport`, `exportUrl` |
| `frontend/src/api/queries.ts` (modify) | `useExports`, `useQueueExport` |
| `frontend/src/screens/exportName.ts` (create) | pure default-filename proposal |
| `frontend/src/screens/exportName.test.ts` (create) | its tests |
| `frontend/src/screens/Export.tsx` (rewrite) + `Export.module.css` (create) | the modal: stem picker, as-practiced/original, D-10 banner, name, queue, download |
| `frontend/src/screens/Export.test.tsx` (create) | prefill from the mix, the two toggles, the queued payload, the finished link |
| `frontend/src/screens/SongView.tsx` (modify) | the link into the Export screen |
| `docs/superpowers/plans/2026-09-28-phase-7-export.md` (this file) | plan and the real-hardware verification log (Task 7) |

---

## Task 1: The export recipe contract

The payload shape both sides validate, and the `exports/` naming rules. Pure data and paths
— no ffmpeg, no subprocess, no I/O beyond one directory listing.

**Files:**
- Create: `packages/stemcraft_lib/src/stemcraft_lib/export.py`
- Test: `packages/stemcraft_lib/tests/test_export.py`

**Interfaces:**
- Consumes: `stemcraft_lib.song.STEM_NAMES`, `stemcraft_lib.ids.slugify`.
- Produces: `EXPORTS_DIRNAME`, `EXPORT_BITRATE`, `NAME_PATTERN`, `ExportStem(name,
  gain_db)`, `ExportRecipe(song_id, name, stems, tempo, pitch_semitones, title, artist)`
  with properties `is_identity: bool` and `pitch_scale: float`, and the functions
  `export_name(raw, *, fallback) -> str`, `exports_dir(song_dir) -> Path`,
  `export_path(song_dir, name) -> Path`, `stem_wav_paths(song_dir, recipe) -> list[Path]`,
  `list_exports(song_dir) -> list[dict]`.

- [ ] **Step 1: Write the failing tests**

Create `packages/stemcraft_lib/tests/test_export.py`:

```python
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
        _recipe(pitch_semitones=25)


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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `uv run pytest packages/stemcraft_lib/tests/test_export.py -q`
Expected: collection error — `ModuleNotFoundError: No module named 'stemcraft_lib.export'`.

- [ ] **Step 3: Write the implementation**

Create `packages/stemcraft_lib/src/stemcraft_lib/export.py`:

```python
"""The export recipe: what a rendered file is made of, resolved to numbers.

D7-02 is the reason this module exists in stemcraft_lib rather than in either
process. The API builds an ExportRecipe by reading song.json and puts it in the
job payload; the worker validates the same model back out of that payload and
renders from it, and never reads song.json itself. §6 requires every job to be
idempotent by re-derivation from inputs that never change -- song.json is
autosaved on every slider drag, so it is not one of those inputs. The stems and
this payload are.

Nothing here touches ffmpeg or torch: both processes import it (§4).
"""

from __future__ import annotations

import re
from pathlib import Path

from pydantic import BaseModel, Field, field_validator

from .ids import slugify
from .song import STEM_NAMES

EXPORTS_DIRNAME = "exports"

# D7-09: one format, one bitrate, deliberately not a field on the recipe.
EXPORT_BITRATE = "320k"

# The alphabet slugify() produces, and therefore the only shape the download
# route will accept. `name` is user-typed and lands in a filesystem path, so the
# route matches it against this instead of sanitizing -- a name that does not
# match is a name this app never wrote (see the API task's traversal test).
NAME_PATTERN = re.compile(r"^[a-z0-9][a-z0-9-]*$")


class ExportStem(BaseModel):
    name: str
    gain_db: float = 0.0

    @field_validator("name")
    @classmethod
    def _known_stem(cls, value: str) -> str:
        if value not in STEM_NAMES:
            raise ValueError(f"{value!r} is not one of {STEM_NAMES}")
        return value


class ExportRecipe(BaseModel):
    """A render, fully determined. Every value here is a number or a string --
    there is no reference to anything that can change under the job."""

    song_id: str
    name: str
    stems: list[ExportStem] = Field(min_length=1)
    # Domain spec: tempo 50-100%, pitch in semitones. Out of range is rejected,
    # never clamped (N-08) -- a recipe the Song view could not have produced
    # means the caller is wrong, and a clamp would hide that behind audio.
    tempo: float = Field(default=1.0, gt=0.0, le=1.0)
    pitch_semitones: int = Field(default=0, ge=-12, le=12)
    # D7-06: ID3, snapshotted with everything else.
    title: str = ""
    artist: str = ""

    @field_validator("stems")
    @classmethod
    def _unique_and_canonically_ordered(cls, stems: list[ExportStem]) -> list[ExportStem]:
        names = [s.name for s in stems]
        if len(set(names)) != len(names):
            raise ValueError(f"duplicate stem(s) in {names}")
        # Canonical order, so the same selection always produces the same
        # filtergraph and therefore the same bytes regardless of the order the
        # checkboxes were ticked in (the idempotency claim in §6).
        return sorted(stems, key=lambda s: STEM_NAMES.index(s.name))

    @property
    def is_identity(self) -> bool:
        """D7-05: nothing for a time-stretcher to do, so it is left out."""
        return self.tempo == 1.0 and self.pitch_semitones == 0

    @property
    def pitch_scale(self) -> float:
        """rubberband's `pitch` is a frequency ratio, not semitones."""
        return 2.0 ** (self.pitch_semitones / 12.0)


def export_name(raw: str, *, fallback: str) -> str:
    """The user's file name, reduced to NAME_PATTERN's alphabet. `fallback` is
    used when what is left is empty, so a name is never absent."""
    slug = slugify(raw) if raw.strip() else ""
    return slug if slug and slug != "untitled" else slugify(fallback)


def exports_dir(song_dir: Path) -> Path:
    return song_dir / EXPORTS_DIRNAME


def export_path(song_dir: Path, name: str) -> Path:
    return exports_dir(song_dir) / f"{name}.mp3"


def stem_wav_paths(song_dir: Path, recipe: ExportRecipe) -> list[Path]:
    """D-04/D7-03: the immutable WAV masters, in the recipe's own order -- the
    render's input order has to match the recipe's stem order, because the
    filtergraph maps input N to stems[N]'s gain."""
    return [song_dir / "stems" / f"{stem.name}.wav" for stem in recipe.stems]


def list_exports(song_dir: Path) -> list[dict]:
    """D7-08: derived from the directory, newest first. There is no stored list
    of exports anywhere for this to disagree with."""
    directory = exports_dir(song_dir)
    if not directory.is_dir():
        return []
    entries = []
    for path in directory.glob("*.mp3"):
        stat = path.stat()
        entries.append(
            {
                "name": path.stem,
                "file": f"{EXPORTS_DIRNAME}/{path.name}",
                "bytes": stat.st_size,
                "modified_at": stat.st_mtime,
            }
        )
    return sorted(entries, key=lambda e: e["modified_at"], reverse=True)
```

Note on `export_name`: `slugify` returns the literal `"untitled"` for input that reduces to
nothing, which is why that value is treated as "empty" here rather than kept.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `uv run pytest packages/stemcraft_lib/tests/test_export.py -q`
Expected: 12 passed.

- [ ] **Step 5: Lint and commit**

```bash
uv run ruff check packages/stemcraft_lib
git add packages/stemcraft_lib/src/stemcraft_lib/export.py packages/stemcraft_lib/tests/test_export.py
git commit -m "feat(lib): the export recipe contract, shared by API and worker"
```

---

## Task 2: One filtergraph, one subprocess

The render itself: a pure argv builder (so the graph is testable as text) and a runner that
streams ffmpeg's progress and can be cancelled. Plus the boot check that this ffmpeg build
actually has `rubberband`, for the same reason `_check_ffmpeg` already round-trips an MP3
instead of trusting `ffmpeg -version`.

**Files:**
- Modify: `packages/stemcraft_lib/src/stemcraft_lib/ffmpeg.py`
- Modify: `packages/stemcraft_lib/src/stemcraft_lib/deps.py`
- Test: `packages/stemcraft_lib/tests/test_ffmpeg.py` (modify)
- Test: `packages/stemcraft_lib/tests/test_deps.py` (modify)

**Interfaces:**
- Consumes: Task 1's `ExportRecipe`, `EXPORT_BITRATE`; the existing `atomic_output`,
  `FfmpegError`, `SAMPLE_RATE`, `_TIMEOUT_SECONDS`.
- Produces: `FfmpegCancelled(Exception)`; `build_export_args(stem_paths: Sequence[Path],
  recipe: ExportRecipe, dst: Path) -> list[str]`; `render_export(stem_paths: Sequence[Path],
  recipe: ExportRecipe, dst: Path, *, source_seconds: float, on_progress:
  Callable[[float], None] | None = None, should_cancel: Callable[[], bool] | None = None)
  -> float` returning the rendered duration in seconds; and a new `DepCheck` named
  `ffmpeg_rubberband` in `deps.check_all()`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/stemcraft_lib/tests/test_ffmpeg.py` (the module already has the
`skipif ffmpeg missing` `pytestmark` and the `_make_sine` helper — reuse both):

```python
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
    # normalize=0: amix's default divides by the input count, which would make a
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
```

And in `packages/stemcraft_lib/tests/test_deps.py`, add:

```python
def test_rubberband_is_present_in_this_ffmpeg_build(monkeypatch, tmp_path):
    # D7-01 made librubberband a correctness dependency. Same argument as the
    # MP3 round trip already in _check_ffmpeg: a build without it passes
    # `ffmpeg -version` and then fails at the first export.
    from stemcraft_lib.deps import check_all

    monkeypatch.setenv("STEMCRAFT_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("STEMCRAFT_SONGS_DIR", str(tmp_path / "songs"))
    check = next(c for c in check_all() if c.name == "ffmpeg_rubberband")
    assert check.ok, check.detail
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `uv run pytest packages/stemcraft_lib/tests/test_ffmpeg.py packages/stemcraft_lib/tests/test_deps.py -q`
Expected: `ImportError: cannot import name 'build_export_args'` in the new tests, and the
deps test failing with `StopIteration` because no check is named `ffmpeg_rubberband`.

- [ ] **Step 3: Add `build_export_args` and `render_export` to `ffmpeg.py`**

Add to the imports at the top of `packages/stemcraft_lib/src/stemcraft_lib/ffmpeg.py`:

```python
import tempfile
import threading
from collections.abc import Callable, Sequence

from .export import EXPORT_BITRATE, ExportRecipe
```

`tempfile` and `threading` are new to this module (`atomic_output` owns the output temp
file, but the stderr capture below needs its own; `threading` is the timeout watchdog); `shutil`, `subprocess`, `Path`, `atomic_output`, `SAMPLE_RATE`
and `_TIMEOUT_SECONDS` are all already there. There is no import cycle: `export.py` imports
only `ids` and `song`, and neither imports `ffmpeg`.

Append to the module:

```python
class FfmpegCancelled(Exception):
    """render_export saw should_cancel() go true and terminated ffmpeg (D7-07).
    A separate exception from FfmpegError because a cancel is not a failure --
    the worker turns it into JobCancelled, which is a different job state."""


# ffmpeg's own progress cadence (-stats_period defaults to 0.5 s). It bounds how
# long a cancel takes to be noticed, because that is when we look.
_PROGRESS_KEY = "out_time_us"


def build_export_args(
    stem_paths: Sequence[Path], recipe: ExportRecipe, dst: Path
) -> list[str]:
    """The whole render as one argv: per-stem gain, one amix, optionally one
    rubberband, one MP3 encode. Pure, so the graph is testable as text.

    One subprocess and no intermediate file is not an optimization: every extra
    stage would be another 16-bit round trip, and D-10 promises this file is the
    *better* one.
    """
    if len(stem_paths) != len(recipe.stems):
        raise ValueError(
            f"{len(stem_paths)} stem path(s) for {len(recipe.stems)} recipe stem(s); "
            "input N maps to recipe.stems[N] and the two must line up"
        )

    args = [
        "ffmpeg", "-hide_banner", "-nostdin", "-v", "error",
        # Progress on stdout, so the caller can stream it without parsing the
        # stderr log that N-08 wants kept verbatim for the failure message.
        "-progress", "pipe:1", "-y",
    ]
    for path in stem_paths:
        args += ["-i", str(path)]

    chain = []
    labels = []
    for index, stem in enumerate(recipe.stems):
        chain.append(f"[{index}:a]volume={stem.gain_db:.4f}dB[g{index}]")
        labels.append(f"[g{index}]")
    # normalize=0: amix normalizes by input count by default, which would make a
    # four-stem export quieter than a one-stem export of the same material. The
    # gains in the recipe are the mix; nothing else is allowed to scale them.
    chain.append(f"{''.join(labels)}amix=inputs={len(labels)}:normalize=0[mix]")
    out_label = "[mix]"
    if not recipe.is_identity:
        chain.append(
            f"[mix]rubberband=tempo={recipe.tempo:.6f}:pitch={recipe.pitch_scale:.6f}"
            # D7-01/D-10: the offline quality settings the real-time engine cannot
            # afford. channels=together keeps the stereo pair phase-coherent; the
            # filter's `apart` default smears the image on a mix.
            ":pitchq=quality:channels=together:transients=crisp[out]"
        )
        out_label = "[out]"

    args += [
        "-filter_complex", ";".join(chain),
        "-map", out_label,
        "-ac", "2",
        "-ar", str(SAMPLE_RATE),  # D-03, restated at the output, never 44.1
        "-codec:a", "libmp3lame",
        "-b:a", EXPORT_BITRATE,
    ]
    if recipe.title:
        args += ["-metadata", f"title={recipe.title}"]
    if recipe.artist:
        args += ["-metadata", f"artist={recipe.artist}"]
    # -f mp3 explicitly: dst is an atomic_output temp path whose suffix is .tmp,
    # so ffmpeg has no extension to infer the muxer from.
    args += ["-f", "mp3", str(dst)]
    return args


def render_export(
    stem_paths: Sequence[Path],
    recipe: ExportRecipe,
    dst: Path,
    *,
    source_seconds: float,
    on_progress: Callable[[float], None] | None = None,
    should_cancel: Callable[[], bool] | None = None,
) -> float:
    """Render `recipe` to `dst` atomically. Returns the output's duration in
    seconds, which is `source_seconds / tempo` and therefore not the Song's
    duration -- that is the number worth reporting back to the UI.

    Streamed rather than run through _run() because an export of a real song is
    seconds of work the Job Queue should show moving, and because a cancel has
    to be noticed while it runs.
    """
    if shutil.which("ffmpeg") is None:
        raise FfmpegError("ffmpeg is not on PATH (C-04: the only audio I/O path)")
    expected_seconds = source_seconds / recipe.tempo if recipe.tempo else source_seconds
    rendered = 0.0

    with atomic_output(dst) as tmp:
        args = build_export_args(stem_paths, recipe, tmp)
        with tempfile.TemporaryFile("w+") as stderr_file:
            # stderr to a file, not a pipe: reading only stdout while a full
            # stderr pipe blocks ffmpeg is the classic deadlock, and N-08 needs
            # all of stderr afterwards anyway.
            proc = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=stderr_file, text=True)
            stdout = proc.stdout
            assert stdout is not None  # stdout=PIPE above
            # The deadline cannot be enforced by checking it between progress
            # lines: `for line in stdout` blocks in readline(), so a hung
            # ffmpeg that stops emitting progress (stuck filter, I/O
            # starvation) would never let that check run again, and this would
            # block forever -- contradicting _TIMEOUT_SECONDS' own contract,
            # and stalling the worker's single serial queue (C-07) with it. A
            # watchdog enforces it independently of whether ffmpeg is still
            # writing anything.
            timed_out = threading.Event()

            def _on_timeout() -> None:
                timed_out.set()
                proc.kill()

            watchdog = threading.Timer(_TIMEOUT_SECONDS, _on_timeout)
            watchdog.start()
            try:
                for line in stdout:
                    key, _, value = line.strip().partition("=")
                    if key == _PROGRESS_KEY and value not in ("", "N/A"):
                        rendered = int(value) / 1_000_000
                        if on_progress is not None and expected_seconds > 0:
                            on_progress(min(1.0, rendered / expected_seconds))
                    if should_cancel is not None and should_cancel():
                        # D7-07: a CPU subprocess writing to a temp file has
                        # nothing to orphan, so terminate rather than wait for a
                        # checkpoint. atomic_output unlinks the temp file on the
                        # way out of this `with`.
                        proc.terminate()
                        proc.wait(timeout=10)
                        raise FfmpegCancelled(f"export of {dst.name} cancelled")
            finally:
                watchdog.cancel()
                stdout.close()
                # A grace wait before the kill: stdout hitting EOF means the
                # child closed the pipe, but poll() can still read None for a
                # just-exited process that has not been reaped yet, and killing
                # on that would turn a clean render into a spurious failure.
                try:
                    proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    proc.kill()
                    proc.wait(timeout=10)
            if timed_out.is_set():
                raise FfmpegError(f"ffmpeg timed out after {_TIMEOUT_SECONDS}s")
            returncode = proc.wait()
            stderr_file.seek(0)
            stderr = stderr_file.read()
        if returncode != 0:
            raise FfmpegError(f"export render of {dst.name} failed: {stderr.strip()[-500:]}")

    return rendered
```

- [ ] **Step 4: Add the rubberband boot check to `deps.py`**

Insert after `_check_ffmpeg` in `packages/stemcraft_lib/src/stemcraft_lib/deps.py`:

```python
def _check_ffmpeg_rubberband() -> DepCheck:
    """D7-01 made librubberband a correctness floor for export, so it is checked
    the same way the MP3 encoder is: by using it. `ffmpeg -filters` would list
    a filter that fails to initialise; 0.1 s of sine through it would not."""
    exe = shutil.which("ffmpeg")
    if exe is None:
        return DepCheck("ffmpeg_rubberband", False, "ffmpeg is not on PATH")
    try:
        proc = subprocess.run(
            [exe, "-hide_banner", "-nostdin", "-f", "lavfi", "-i",
             f"sine=frequency=440:duration=0.1:sample_rate={SAMPLE_RATE}",
             "-af", "rubberband=tempo=0.8:pitch=0.9:pitchq=quality", "-f", "null", "-"],
            capture_output=True, text=True, timeout=30,
        )
    except subprocess.TimeoutExpired:
        return DepCheck("ffmpeg_rubberband", False, "timed out after 30s in the rubberband filter")
    if proc.returncode != 0:
        return DepCheck(
            "ffmpeg_rubberband",
            False,
            "this ffmpeg has no working rubberband filter (D-10/D7-01: export needs "
            f"librubberband): {proc.stderr.strip()[-500:]}",
        )
    return DepCheck("ffmpeg_rubberband", True, "rubberband filter available")
```

and add it to `check_all`:

```python
def check_all() -> list[DepCheck]:
    return [
        _check_ffmpeg(),
        _check_ffmpeg_rubberband(),
        _check_dirs(),
        _check_sqlite_wal(),
        _check_yt_dlp(),
    ]
```

Both processes refuse to start without it. That is intentional and not an over-reach: the
API's own health payload is what the frontend renders the dependency banner from, and an
API that came up claiming health while every export would fail is exactly the silent
degradation N-08 exists to prevent.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `uv run pytest packages/stemcraft_lib -q`
Expected: all pass, including the 11 new ffmpeg tests and the new deps check.

Then fix the one API test this breaks: `packages/stemcraft_api/tests/test_api.py:60` asserts
the exact set of dependency names the health route reports. Add the new one:

```python
    assert {c["name"] for c in body["deps"]} == {
        "ffmpeg", "ffmpeg_rubberband", "yt-dlp", "data_dirs", "sqlite_wal"
    }
```

Run: `uv run pytest packages/stemcraft_api -q`

- [ ] **Step 6: Lint and commit**

```bash
uv run ruff check packages/stemcraft_lib
git add packages/stemcraft_lib
git commit -m "feat(lib): render an export in one ffmpeg pass, with a rubberband boot check"
```

---

## Task 3: The `export` job kind

**Files:**
- Create: `packages/stemcraft_worker/src/stemcraft_worker/kinds/export_song.py`
- Modify: `packages/stemcraft_worker/src/stemcraft_worker/kinds/__init__.py`
- Test: `packages/stemcraft_worker/tests/test_export_song.py`

**Interfaces:**
- Consumes: Task 1's `ExportRecipe`, `export_path`, `stem_wav_paths`; Task 2's
  `render_export`, `FfmpegCancelled`, `probe`; the existing `JobContext`, `JobCancelled`,
  `register`, `find_song_dir`, `settings`.
- Produces: the registered job kind `"export"`, whose result row is
  `{"file": "exports/<name>.mp3", "bytes": int, "duration_seconds": float,
  "stems": [str], "tempo": float, "pitch_semitones": int}`.

- [ ] **Step 1: Write the failing tests**

Create `packages/stemcraft_worker/tests/test_export_song.py`:

```python
import shutil
import subprocess

import pytest
import stemcraft_worker.kinds.export_song  # noqa: F401  (registers on import)
from stemcraft_lib.export import ExportRecipe, ExportStem
from stemcraft_lib.ffmpeg import probe
from stemcraft_lib.jobs import connect, enqueue, get_job
from stemcraft_lib.song import STEM_NAMES, create_song_dir, new_song
from stemcraft_worker.main import run_one

pytestmark = pytest.mark.skipif(
    shutil.which("ffmpeg") is None, reason="ffmpeg not installed on this host"
)

SAMPLE_RATE = 48000


@pytest.fixture
def conn(tmp_path):
    return connect(tmp_path / "jobs.sqlite")


@pytest.fixture
def songs_dir(tmp_path, monkeypatch):
    d = tmp_path / "songs"
    monkeypatch.setenv("STEMCRAFT_SONGS_DIR", str(d))
    return d


def _sine_wav(path, freq, *, seconds=2.0):
    subprocess.run(
        ["ffmpeg", "-hide_banner", "-nostdin", "-y", "-f", "lavfi",
         "-i", f"sine=frequency={freq}:duration={seconds}:sample_rate={SAMPLE_RATE}",
         "-ac", "2", "-c:a", "pcm_s16le", str(path)],
        check=True, capture_output=True,
    )


def _make_separated_song(songs_dir, *, seconds=2.0):
    song = new_song(title="Tightrope", artist="Walk the Moon",
                    source_kind="upload", source_value="original.mp3")
    song_dir = create_song_dir(songs_dir, song)
    stems_dir = song_dir / "stems"
    stems_dir.mkdir()
    for index, name in enumerate(STEM_NAMES):
        _sine_wav(stems_dir / f"{name}.wav", 220 * (index + 1), seconds=seconds)
        (stems_dir / f"{name}.opus").write_bytes(b"")  # presence only; never read here
    return song, song_dir


def _recipe(song, **overrides) -> ExportRecipe:
    base = dict(
        song_id=song.id,
        name="tightrope-no-bass-82",
        stems=[ExportStem(name="vocals"), ExportStem(name="drums"), ExportStem(name="other")],
        tempo=0.82,
        pitch_semitones=-2,
        title=song.title,
        artist=song.artist,
    )
    return ExportRecipe(**{**base, **overrides})


def _queue(conn, song, recipe):
    return enqueue(conn, kind="export", song_id=song.id,
                   payload=recipe.model_dump(mode="json"))


def test_export_writes_the_mp3_and_reports_its_real_duration(conn, songs_dir):
    song, song_dir = _make_separated_song(songs_dir)

    job_id = _queue(conn, song, _recipe(song))
    assert run_one(conn, device="cpu") == job_id

    done = get_job(conn, job_id)
    assert done.state == "done", done.error
    mp3 = song_dir / "exports" / "tightrope-no-bass-82.mp3"
    assert mp3.is_file()
    assert done.result["file"] == "exports/tightrope-no-bass-82.mp3"
    assert done.result["bytes"] == mp3.stat().st_size
    assert done.result["stems"] == ["vocals", "drums", "other"]
    # 2 s at 82 % is 2.44 s: the exported file is longer than the song, which is
    # the whole point of "matches what you practised to".
    assert done.result["duration_seconds"] == pytest.approx(2.44, abs=0.2)
    assert probe(mp3).title == "Tightrope"


def test_export_at_original_tempo_matches_the_source_length(conn, songs_dir):
    song, song_dir = _make_separated_song(songs_dir)

    job_id = _queue(conn, song, _recipe(song, name="full", tempo=1.0, pitch_semitones=0))
    run_one(conn, device="cpu")

    done = get_job(conn, job_id)
    assert done.state == "done", done.error
    assert done.result["duration_seconds"] == pytest.approx(2.0, abs=0.2)


def test_export_never_reads_song_json_for_the_recipe(conn, songs_dir):
    """D7-02: the payload is the input. A song.json that moved after enqueue --
    exactly what Phase 6's autosave does -- must not change the render."""
    song, song_dir = _make_separated_song(songs_dir)
    recipe = _recipe(song, tempo=0.5, pitch_semitones=0)
    job_id = _queue(conn, song, recipe)

    written = (song_dir / "song.json").read_text().replace('"tempo": 1.0', '"tempo": 0.9')
    (song_dir / "song.json").write_text(written)
    run_one(conn, device="cpu")

    done = get_job(conn, job_id)
    assert done.state == "done", done.error
    # 0.5 from the payload, not 0.9 from the file.
    assert done.result["duration_seconds"] == pytest.approx(4.0, abs=0.2)


def test_rerunning_an_export_reproduces_the_same_bytes(conn, songs_dir):
    """§6: idempotent by re-derivation. This is what makes a lease reclaim safe."""
    song, song_dir = _make_separated_song(songs_dir)
    mp3 = song_dir / "exports" / "tightrope-no-bass-82.mp3"

    _queue(conn, song, _recipe(song))
    run_one(conn, device="cpu")
    first = mp3.read_bytes()

    _queue(conn, song, _recipe(song))
    run_one(conn, device="cpu")

    assert mp3.read_bytes() == first


def test_export_of_one_stem_alone(conn, songs_dir):
    song, song_dir = _make_separated_song(songs_dir)

    job_id = _queue(conn, song, _recipe(song, name="bass-only",
                                       stems=[ExportStem(name="bass")]))
    run_one(conn, device="cpu")

    assert get_job(conn, job_id).state == "done"
    assert (song_dir / "exports" / "bass-only.mp3").stat().st_size > 0


def test_export_with_a_missing_stem_master_fails_loudly(conn, songs_dir):
    song, song_dir = _make_separated_song(songs_dir)
    (song_dir / "stems" / "drums.wav").unlink()

    job_id = _queue(conn, song, _recipe(song))
    run_one(conn, device="cpu")

    failed = get_job(conn, job_id)
    assert failed.state == "failed"
    assert "drums.wav" in failed.error
    assert not (song_dir / "exports").exists()


def test_export_for_an_unknown_song_fails_loudly(conn, songs_dir):
    songs_dir.mkdir(parents=True, exist_ok=True)
    job_id = enqueue(conn, kind="export", song_id="01NOPE", payload={
        "song_id": "01NOPE", "name": "x", "stems": [{"name": "bass", "gain_db": 0.0}],
    })
    run_one(conn, device="cpu")

    failed = get_job(conn, job_id)
    assert failed.state == "failed"
    assert "01NOPE" in failed.error


def test_a_malformed_payload_fails_loudly_rather_than_rendering_something(conn, songs_dir):
    song, _ = _make_separated_song(songs_dir)
    job_id = enqueue(conn, kind="export", song_id=song.id,
                     payload={"song_id": song.id, "name": "x", "stems": []})
    run_one(conn, device="cpu")

    failed = get_job(conn, job_id)
    assert failed.state == "failed"
    assert "stems" in failed.error


def test_a_cancelled_export_leaves_no_file(conn, songs_dir):
    """Called directly rather than through run_one: request_cancel on a *queued*
    job marks it cancelled outright, so run_one would never claim it and the
    render would never start. What needs exercising is the flag being seen
    mid-render (D7-07), which means setting it on a row that is already running."""
    from stemcraft_lib import jobs as jobs_db
    from stemcraft_worker.kinds.export_song import run
    from stemcraft_worker.registry import JobCancelled, JobContext

    song, song_dir = _make_separated_song(songs_dir)
    recipe = _recipe(song)
    job_id = _queue(conn, song, recipe)
    # The flag the kind polls, set before the render starts.
    conn.execute("UPDATE jobs SET state = 'running', cancel_requested = 1 WHERE id = ?", (job_id,))
    ctx = JobContext(conn=conn, job_id=job_id, payload=recipe.model_dump(mode="json"),
                     device="cpu")

    with pytest.raises(JobCancelled):
        run(ctx)

    assert not (song_dir / "exports" / "tightrope-no-bass-82.mp3").exists()
    assert list((song_dir / "exports").iterdir()) == []
    assert jobs_db.get_job(conn, job_id).state == "running"  # run_one owns the transition
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `uv run pytest packages/stemcraft_worker/tests/test_export_song.py -q`
Expected: collection error — `No module named 'stemcraft_worker.kinds.export_song'`.

- [ ] **Step 3: Write the job kind**

Create `packages/stemcraft_worker/src/stemcraft_worker/kinds/export_song.py`:

```python
"""The `export` job kind: any subset of stems, mixed and optionally
tempo/pitch-shifted, encoded to one 320 kbps MP3 in exports/ (D-10).

This kind deliberately **does not read song.json** (D7-02). Its input is the
recipe snapshot the API put in the payload at enqueue time, because §6 requires
idempotency by re-derivation from inputs that never change and song.json is
autosaved on every slider drag. The stems are immutable (§5) and the payload is
immutable, so re-running this job -- after a lease reclaim, or from the Job Queue
weeks later -- reproduces the same file byte for byte and overwrites it.

No torch anywhere in here; the whole render is one ffmpeg subprocess.
"""

from __future__ import annotations

from stemcraft_lib import ffmpeg
from stemcraft_lib.config import settings
from stemcraft_lib.export import ExportRecipe, export_path, stem_wav_paths
from stemcraft_lib.song import find_song_dir

from ..registry import JobCancelled, JobContext, register


def run(ctx: JobContext) -> dict:
    # Validated here rather than trusted: a payload that does not parse is a bug
    # in whoever enqueued it, and N-08 wants that visible as a failed job with
    # pydantic's own message, not as a render of something almost right.
    recipe = ExportRecipe.model_validate(ctx.payload)

    song_dir = find_song_dir(settings().songs_dir, recipe.song_id)
    if song_dir is None:
        raise RuntimeError(f"no song directory for song_id={recipe.song_id!r}")

    stem_paths = stem_wav_paths(song_dir, recipe)
    missing = [path.name for path in stem_paths if not path.is_file()]
    if missing:
        raise RuntimeError(
            f"song {recipe.song_id} is missing stem master(s) {', '.join(missing)}; "
            "exports render from stems/*.wav, never from the .opus delivery copies (D-04)"
        )

    # Every stem is the same length by construction (they come out of one
    # separation of one audio.wav), so the first one's duration is the source
    # duration -- and it is what turns ffmpeg's out_time into a fraction.
    source_seconds = ffmpeg.probe(stem_paths[0]).duration_seconds
    dst = export_path(song_dir, recipe.name)

    def on_progress(fraction: float) -> None:
        # Held below 1.0 until the encode has actually returned: the last
        # progress line arrives before ffmpeg has finished muxing and renaming.
        ctx.progress(min(0.99, fraction))

    try:
        rendered_seconds = ffmpeg.render_export(
            stem_paths,
            recipe,
            dst,
            source_seconds=source_seconds,
            on_progress=on_progress,
            should_cancel=ctx.cancelled,
        )
    except ffmpeg.FfmpegCancelled as exc:
        # D7-07: the temp file is already gone; nothing partial survives.
        raise JobCancelled from exc

    ctx.progress(1.0)
    return {
        "file": f"exports/{recipe.name}.mp3",
        "bytes": dst.stat().st_size,
        "duration_seconds": round(rendered_seconds, 3),
        "stems": [stem.name for stem in recipe.stems],
        "tempo": recipe.tempo,
        "pitch_semitones": recipe.pitch_semitones,
    }


register("export", run)
```

Then register it by editing `packages/stemcraft_worker/src/stemcraft_worker/kinds/__init__.py`:

```python
"""Importing this package registers every built-in job kind."""

from . import analyze_song, export_song, import_song, probe, separate_song  # noqa: F401
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `uv run pytest packages/stemcraft_worker/tests/test_export_song.py -q`
Expected: 9 passed.

- [ ] **Step 5: Lint and commit**

```bash
uv run ruff check packages/stemcraft_worker
git add packages/stemcraft_worker
git commit -m "feat(worker): the export job kind, rendered from a payload snapshot"
```

---

## Task 4: API — queue an export, list exports, download one

Three routes. The first is the only one that thinks: it reads `song.json` and resolves the
live recipe into the immutable snapshot D7-02 requires. The other two list a directory and
serve a file.

**Files:**
- Modify: `packages/stemcraft_api/src/stemcraft_api/routes/songs.py`
- Test: `packages/stemcraft_api/tests/test_songs_export.py`

**Interfaces:**
- Consumes: Task 1's `ExportRecipe`, `ExportStem`, `NAME_PATTERN`, `export_name`,
  `export_path`, `list_exports`; the existing `_find_dir`, `read_song`, `derive_files`,
  `jobs_db.enqueue`.
- Produces: `POST /api/songs/{song_id}/export` taking
  `{"stems": [str], "apply_recipe": bool, "name": str}` and returning
  `{"job_id": int, "name": str, "file": str}`; `GET /api/songs/{song_id}/exports` returning
  `{"exports": [{name, file, bytes, modified_at}]}`; and
  `GET /api/songs/{song_id}/exports/{name}.mp3` returning the file as an attachment.

- [ ] **Step 1: Write the failing tests**

Create `packages/stemcraft_api/tests/test_songs_export.py`, reusing the `client` fixture
style from `test_songs_analysis.py`:

```python
import pytest
from fastapi.testclient import TestClient
from stemcraft_api.app import create_app
from stemcraft_lib.jobs import connect, get_job
from stemcraft_lib.song import STEM_NAMES, StemMix, create_song_dir, new_song, write_song


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("STEMCRAFT_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("STEMCRAFT_SONGS_DIR", str(tmp_path / "songs"))
    monkeypatch.setenv("STEMCRAFT_DIST_DIR", str(tmp_path / "nodist"))
    monkeypatch.setenv("STEMCRAFT_SKIP_BOOT_CHECKS", "1")
    return TestClient(create_app())


def _separated_song(tmp_path, *, tempo=0.82, pitch=-2, gain_db=-6.0):
    """A song that looks separated to derive_files, with a practice recipe set."""
    song = new_song(title="Tightrope", artist="Walk the Moon",
                    source_kind="upload", source_value="original.mp3")
    song_dir = create_song_dir(tmp_path / "songs", song)
    stems_dir = song_dir / "stems"
    stems_dir.mkdir()
    for name in STEM_NAMES:
        for ext in ("wav", "opus"):
            (stems_dir / f"{name}.{ext}").write_bytes(b"x")
    song.playback.tempo = tempo
    song.playback.pitch_semitones = pitch
    song.mix["drums"] = StemMix(gain_db=gain_db, muted=False)
    song.mix["bass"] = StemMix(gain_db=0.0, muted=True)
    write_song(song_dir, song)
    return song, song_dir


def _payload_of(tmp_path, job_id):
    conn = connect(tmp_path / "data" / "jobs.sqlite")
    return get_job(conn, job_id).payload


def test_queue_export_snapshots_the_live_recipe_into_the_payload(client, tmp_path):
    # D7-02: the numbers travel with the job, not a pointer to song.json.
    song, _ = _separated_song(tmp_path)

    resp = client.post(f"/api/songs/{song.id}/export",
                       json={"stems": ["vocals", "drums", "other"]})

    assert resp.status_code == 201
    body = resp.json()
    assert body["name"] == "tightrope"
    assert body["file"] == "exports/tightrope.mp3"
    payload = _payload_of(tmp_path, body["job_id"])
    assert payload["tempo"] == 0.82
    assert payload["pitch_semitones"] == -2
    assert payload["title"] == "Tightrope"
    assert payload["artist"] == "Walk the Moon"
    assert payload["stems"] == [
        {"name": "vocals", "gain_db": 0.0},
        {"name": "drums", "gain_db": -6.0},
        {"name": "other", "gain_db": 0.0},
    ]


def test_the_job_row_is_an_export_job_for_this_song(client, tmp_path):
    song, _ = _separated_song(tmp_path)
    job_id = client.post(f"/api/songs/{song.id}/export",
                         json={"stems": ["bass"]}).json()["job_id"]

    conn = connect(tmp_path / "data" / "jobs.sqlite")
    job = get_job(conn, job_id)
    assert (job.kind, job.song_id, job.state) == ("export", song.id, "queued")


def test_original_toggle_neutralizes_tempo_and_pitch_but_keeps_the_mix(client, tmp_path):
    # The mockup's segmented control is labelled "tempo & pitch". Stem gains are
    # the mix, not the recipe's tempo, and stay whatever the user practised with.
    song, _ = _separated_song(tmp_path)

    job_id = client.post(
        f"/api/songs/{song.id}/export",
        json={"stems": ["vocals", "drums"], "apply_recipe": False},
    ).json()["job_id"]

    payload = _payload_of(tmp_path, job_id)
    assert payload["tempo"] == 1.0
    assert payload["pitch_semitones"] == 0
    assert payload["stems"][1] == {"name": "drums", "gain_db": -6.0}


def test_a_muted_stem_is_exported_when_explicitly_asked_for(client, tmp_path):
    # Exclusion is the picker's job (D7-03). `muted` in song.json prefills the
    # checkboxes in the UI; it is not a veto on the server.
    song, _ = _separated_song(tmp_path)
    job_id = client.post(f"/api/songs/{song.id}/export",
                         json={"stems": ["bass"]}).json()["job_id"]
    assert _payload_of(tmp_path, job_id)["stems"] == [{"name": "bass", "gain_db": 0.0}]


def test_the_name_is_slugified_and_defaults_to_the_title(client, tmp_path):
    song, _ = _separated_song(tmp_path)

    named = client.post(f"/api/songs/{song.id}/export",
                        json={"stems": ["bass"], "name": "Tightrope — no bass, 82%"})
    assert named.json()["name"] == "tightrope-no-bass-82"

    blank = client.post(f"/api/songs/{song.id}/export",
                        json={"stems": ["bass"], "name": "   "})
    assert blank.json()["name"] == "tightrope"


def test_no_stems_picked_is_422(client, tmp_path):
    song, _ = _separated_song(tmp_path)
    resp = client.post(f"/api/songs/{song.id}/export", json={"stems": []})
    assert resp.status_code == 422
    assert "stem" in resp.text


def test_an_unknown_stem_name_is_422(client, tmp_path):
    song, _ = _separated_song(tmp_path)
    resp = client.post(f"/api/songs/{song.id}/export", json={"stems": ["guitar"]})
    assert resp.status_code == 422
    assert "guitar" in resp.text


def test_exporting_an_unseparated_song_is_409_with_a_real_reason(client, tmp_path):
    song = new_song(title="T", artist="A", source_kind="upload", source_value="original.mp3")
    create_song_dir(tmp_path / "songs", song)

    resp = client.post(f"/api/songs/{song.id}/export", json={"stems": ["bass"]})
    assert resp.status_code == 409
    assert "separated" in resp.text


def test_exporting_an_unknown_song_is_404(client, tmp_path):
    resp = client.post("/api/songs/01NOPE/export", json={"stems": ["bass"]})
    assert resp.status_code == 404


def test_a_recipe_outside_the_allowed_range_is_422_not_a_500(client, tmp_path):
    # N-08: a song.json carrying a tempo the Song view could not have produced
    # surfaces as a refusal naming the field, never as a traceback or a clamp.
    song, _ = _separated_song(tmp_path, tempo=1.4)
    resp = client.post(f"/api/songs/{song.id}/export", json={"stems": ["bass"]})
    assert resp.status_code == 422
    assert "tempo" in resp.text


def test_exports_listing_is_empty_before_anything_is_rendered(client, tmp_path):
    song, _ = _separated_song(tmp_path)
    resp = client.get(f"/api/songs/{song.id}/exports")
    assert resp.status_code == 200
    assert resp.json() == {"exports": []}


def test_exports_listing_is_derived_from_the_directory(client, tmp_path):
    song, song_dir = _separated_song(tmp_path)
    (song_dir / "exports").mkdir()
    (song_dir / "exports" / "tightrope-82.mp3").write_bytes(b"ID3" + b"\x00" * 40)

    entries = client.get(f"/api/songs/{song.id}/exports").json()["exports"]
    assert len(entries) == 1
    assert entries[0]["name"] == "tightrope-82"
    assert entries[0]["file"] == "exports/tightrope-82.mp3"
    assert entries[0]["bytes"] == 43


def test_download_serves_the_bytes_as_an_attachment(client, tmp_path):
    song, song_dir = _separated_song(tmp_path)
    (song_dir / "exports").mkdir()
    (song_dir / "exports" / "tightrope-82.mp3").write_bytes(b"ID3-bytes")

    resp = client.get(f"/api/songs/{song.id}/exports/tightrope-82.mp3")
    assert resp.status_code == 200
    assert resp.content == b"ID3-bytes"
    assert resp.headers["content-type"] == "audio/mpeg"
    assert "attachment" in resp.headers["content-disposition"]
    assert "tightrope-82.mp3" in resp.headers["content-disposition"]


def test_download_of_a_name_that_is_not_a_slug_is_404_and_never_leaves_exports(client, tmp_path):
    song, song_dir = _separated_song(tmp_path)
    (song_dir / "exports").mkdir()

    for name in ("..%2F..%2Fsong.json", "../song", "Tightrope", "with.dot", "with_underscore"):
        resp = client.get(f"/api/songs/{song.id}/exports/{name}.mp3")
        assert resp.status_code == 404, name


def test_download_of_a_missing_export_is_404(client, tmp_path):
    song, _ = _separated_song(tmp_path)
    resp = client.get(f"/api/songs/{song.id}/exports/never-rendered.mp3")
    assert resp.status_code == 404
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `uv run pytest packages/stemcraft_api/tests/test_songs_export.py -q`
Expected: every test failing with 404 or 405 — the routes do not exist yet.

- [ ] **Step 3: Add the routes**

Extend the imports at the top of `packages/stemcraft_api/src/stemcraft_api/routes/songs.py`:

```python
from pydantic import BaseModel, ValidationError
from stemcraft_lib.export import (
    NAME_PATTERN,
    ExportRecipe,
    ExportStem,
    export_name,
    export_path,
    list_exports,
)
from stemcraft_lib.song import StemMix  # alongside the existing song imports
```

Add the request model next to `FromUrlRequest`:

```python
class ExportRequest(BaseModel):
    stems: list[str]
    # The mockup's "tempo & pitch" segmented control, and nothing else: stem
    # gains are the mix and are applied either way (D7-03).
    apply_recipe: bool = True
    name: str = ""
```

And append the three routes:

```python
@router.post("/api/songs/{song_id}/export", status_code=201)
def queue_export(song_id: str, body: ExportRequest, conn: Conn) -> dict:
    """Resolve the live recipe into an immutable snapshot and queue the render.

    D7-02: everything the worker needs goes into the payload here, because
    song.json is autosaved continuously and §6 requires a job's inputs never to
    change under it. This route reads song.json and writes nothing -- the worker
    owns exports/ (§5).
    """
    song_dir = _find_dir(song_id)
    song = read_song(song_dir)
    if not derive_files(song_dir).has_stems:
        raise HTTPException(
            status_code=409,
            detail=f"song {song_id} has no separated stems to export yet",
        )
    if not body.stems:
        raise HTTPException(status_code=422, detail="pick at least one stem to export")
    unknown = [name for name in body.stems if name not in STEM_NAMES]
    if unknown:
        raise HTTPException(
            status_code=422,
            detail=f"unknown stem name(s) {', '.join(unknown)}; expected {', '.join(STEM_NAMES)}",
        )

    name = export_name(body.name, fallback=song.title)
    try:
        recipe = ExportRecipe(
            song_id=song_id,
            name=name,
            stems=[
                ExportStem(name=stem, gain_db=song.mix.get(stem, StemMix()).gain_db)
                for stem in body.stems
            ],
            tempo=song.playback.tempo if body.apply_recipe else 1.0,
            pitch_semitones=song.playback.pitch_semitones if body.apply_recipe else 0,
            title=song.title,
            artist=song.artist,
        )
    except ValidationError as exc:
        # N-08: a song.json the Song view could not have produced (a tempo above
        # 1.0, a pitch past an octave) is named, not clamped and not a traceback.
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    job_id = jobs_db.enqueue(
        conn, kind="export", song_id=song_id, payload=recipe.model_dump(mode="json")
    )
    return {"job_id": job_id, "name": name, "file": f"exports/{name}.mp3"}


@router.get("/api/songs/{song_id}/exports")
def get_exports(song_id: str) -> dict:
    # D7-08: a directory listing, like every other derived fact about a Song.
    return {"exports": list_exports(_find_dir(song_id))}


@router.get("/api/songs/{song_id}/exports/{name}.mp3")
def download_export(song_id: str, name: str) -> FileResponse:
    # `name` is user-typed and lands in a path, so it is matched against the
    # alphabet slugify() produces rather than sanitized: a name outside it is a
    # name this app never wrote. Same reasoning as the stem-name whitelist
    # above, as a pattern because export names are chosen rather than fixed.
    if not NAME_PATTERN.match(name):
        raise HTTPException(status_code=404, detail=f"no export named {name!r}")
    path = export_path(_find_dir(song_id), name)
    if not path.is_file():
        raise HTTPException(status_code=404, detail=f"song {song_id} has no export {name!r}")
    return FileResponse(path, media_type="audio/mpeg", filename=path.name)
```

`FileResponse(..., filename=...)` is what sets `Content-Disposition: attachment`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `uv run pytest packages/stemcraft_api -q`
Expected: the 15 new tests pass and the existing API suite still does.

- [ ] **Step 5: Lint and commit**

```bash
uv run ruff check packages/stemcraft_api
git add packages/stemcraft_api
git commit -m "feat(api): queue, list and download exports"
```

---

## Task 5: Frontend API layer and the default file name

The typed client surface for the three routes, and the pure function that proposes a file
name. Kept separate from the screen so the naming rules are testable without rendering
anything.

**Files:**
- Modify: `frontend/src/api/client.ts`
- Modify: `frontend/src/api/queries.ts`
- Create: `frontend/src/screens/exportName.ts`
- Test: `frontend/src/screens/exportName.test.ts`

**Interfaces:**
- Consumes: the existing `api`, `Song`, `StemMix` types and `queryKeys`.
- Produces: `ExportEntry { name, file, bytes, modified_at }`;
  `QueuedExport { job_id, name, file }`; `ExportRequest { stems, apply_recipe?, name? }`;
  `exportUrl(songId, name): string`; `useExports(songId)`;
  `useQueueExport(songId)` (a mutation taking `ExportRequest`); and
  `proposeExportName(title, stems, { tempo, pitchSemitones }): string`.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/screens/exportName.test.ts`:

```ts
import { expect, test } from 'vitest';

import { proposeExportName } from './exportName';

const RECIPE = { tempo: 0.82, pitchSemitones: -2 };
const NEUTRAL = { tempo: 1, pitchSemitones: 0 };

test('all four stems at original tempo is just the title', () => {
  expect(proposeExportName('Tightrope', ['vocals', 'drums', 'bass', 'other'], NEUTRAL)).toBe(
    'tightrope',
  );
});

test('one stem excluded reads as "no-<stem>"', () => {
  // The mockup's own example name.
  expect(proposeExportName('Tightrope', ['vocals', 'drums', 'other'], RECIPE)).toBe(
    'tightrope-no-bass-82-2st',
  );
});

test('a single stem reads as "<stem>-only"', () => {
  expect(proposeExportName('Tightrope', ['bass'], NEUTRAL)).toBe('tightrope-bass-only');
});

test('two stems are listed in canonical order, whatever order they were ticked', () => {
  expect(proposeExportName('Tightrope', ['other', 'vocals'], NEUTRAL)).toBe(
    'tightrope-vocals-other',
  );
});

test('tempo appears as a percentage and only when it is not 100', () => {
  expect(proposeExportName('Tightrope', ['bass'], { tempo: 0.7, pitchSemitones: 0 })).toBe(
    'tightrope-bass-only-70',
  );
  expect(proposeExportName('Tightrope', ['bass'], { tempo: 1, pitchSemitones: 0 })).toBe(
    'tightrope-bass-only',
  );
});

test('an upward pitch shift is signed', () => {
  expect(proposeExportName('Tightrope', ['bass'], { tempo: 1, pitchSemitones: 3 })).toBe(
    'tightrope-bass-only-plus3st',
  );
});

test('a title that slugifies to nothing still yields a usable name', () => {
  expect(proposeExportName('   ///   ', ['bass'], NEUTRAL)).toBe('export-bass-only');
});

test('accents and punctuation are reduced to the slug alphabet the API accepts', () => {
  expect(proposeExportName('Dvořák — Symphony No. 9', ['other'], NEUTRAL)).toBe(
    'dvorak-symphony-no-9-other-only',
  );
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/screens/exportName.test.ts`
Expected: `Failed to resolve import "./exportName"`.

- [ ] **Step 3: Write `exportName.ts`**

Create `frontend/src/screens/exportName.ts`:

```ts
// The proposed file name, as a pure function. The server slugifies whatever it
// receives (stemcraft_lib.export.export_name), so this is a courtesy rather than
// a validator -- but it is the name the user sees in the field before they queue,
// and "tightrope-no-bass-82" says more at a glance than "export".
import { STEM_ORDER, type StemName } from '../engine/EngineController';

export interface NameRecipe {
  tempo: number;
  pitchSemitones: number;
}

/** Matches stemcraft_lib.ids.slugify closely enough for a proposal: NFKD, drop
 * non-ASCII, collapse everything outside [a-z0-9] to a single hyphen. */
function slugify(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function proposeExportName(
  title: string,
  stems: readonly StemName[],
  recipe: NameRecipe,
): string {
  const picked = STEM_ORDER.filter((name) => stems.includes(name));
  const parts = [slugify(title) || 'export'];

  if (picked.length === 1) {
    parts.push(`${picked[0]}-only`);
  } else if (picked.length === STEM_ORDER.length - 1) {
    const missing = STEM_ORDER.find((name) => !picked.includes(name));
    if (missing) parts.push(`no-${missing}`);
  } else if (picked.length < STEM_ORDER.length) {
    parts.push(...picked);
  }

  if (recipe.tempo !== 1) parts.push(String(Math.round(recipe.tempo * 100)));
  if (recipe.pitchSemitones !== 0) {
    // "plus3st" rather than "+3st": the server's slug alphabet has no "+", and a
    // bare "-3st" would be indistinguishable from the hyphen joining the parts.
    const sign = recipe.pitchSemitones > 0 ? 'plus' : '';
    parts.push(`${sign}${Math.abs(recipe.pitchSemitones)}st`);
  }

  return parts.join('-');
}
```

Note: for a downward shift the name reads `…-82-2st`, matching the mockup's example. The
direction is legible from the "as practiced" context and the API re-slugifies regardless.

- [ ] **Step 4: Add the client types and queries**

In `frontend/src/api/client.ts`, after the `songMedia` helper:

```ts
// Mirrors stemcraft_lib.export.list_exports and the three export routes in
// stemcraft_api routes/songs.py.
export interface ExportEntry {
  name: string;
  file: string;
  bytes: number;
  modified_at: number;
}

export interface QueuedExport {
  job_id: number;
  name: string;
  file: string;
}

export interface ExportRequest {
  stems: string[];
  // Tempo and pitch only (D7-03): stem gains are the mix and apply either way.
  apply_recipe?: boolean;
  name?: string;
}

export function exportUrl(songId: string, name: string): string {
  return `/api/songs/${songId}/exports/${name}.mp3`;
}
```

In `frontend/src/api/queries.ts`, add to `queryKeys` and append the two hooks:

```ts
export const queryKeys = {
  health: ['health'] as const,
  songs: ['songs'] as const,
  jobs: (active: boolean) => ['jobs', active] as const,
  exports: (songId: string | undefined) => ['exports', songId] as const,
};

export function useExports(songId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.exports(songId),
    queryFn: () => api.get<{ exports: ExportEntry[] }>(`/api/songs/${songId}/exports`),
    select: (data) => data.exports,
    enabled: Boolean(songId),
  });
}

export function useQueueExport(songId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: ExportRequest) =>
      api.post<QueuedExport>(`/api/songs/${songId}/export`, body),
    // The render itself is a job; the file appears when it finishes, which the
    // screen learns from the jobs query the WebSocket already invalidates.
    onSuccess: () => client.invalidateQueries({ queryKey: ['jobs'] }),
  });
}
```

and extend the type import at the top with `type ExportEntry, type ExportRequest,
type QueuedExport`.

- [ ] **Step 5: Run the tests and the type check**

Run: `cd frontend && npx vitest run src/screens/exportName.test.ts && npx tsc --noEmit`
Expected: 8 passed, no type errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/api frontend/src/screens/exportName.ts frontend/src/screens/exportName.test.ts
git commit -m "feat(frontend): export API surface and the proposed file name"
```

---

## Task 6: The Export screen

The modal from the UI spec's screen 5 and the built mockup: a stem picker prefilled from the
current mix, the tempo-and-pitch choice, the D-10 banner that says out loud what this file
is, a name field, and — once the job finishes — the download link.

**Files:**
- Rewrite: `frontend/src/screens/Export.tsx`
- Create: `frontend/src/screens/Export.module.css`
- Test: `frontend/src/screens/Export.test.tsx`
- Modify: `frontend/src/screens/SongView.tsx` (the link in)

**Interfaces:**
- Consumes: Task 5's `useExports`, `useQueueExport`, `exportUrl`, `proposeExportName`; the
  existing `useSong`, `useJobs`, `STEM_ORDER`, `type StemName`.
- Produces: the `/songs/:songId/export` screen (the route already exists in
  `app/routes.tsx`), and a link to it from the Song view.

Two deliberate deviations from the mockup, both recorded here so a reviewer does not read
them as omissions:

1. **No per-stem duration in the picker.** The mockup shows "3:58" on every row, which is
   the same number four times by construction — the stems are one separation of one
   `audio.wav`. Repeating it four times is noise; the number that is actually interesting
   (how long the *exported* file is, which differs at 82 %) is shown on the finished export's
   row, from the job result.
2. **The finished file is a link, not an automatic download (D7-10).**

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/screens/Export.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, expect, test, vi } from 'vitest';

import { Export } from './Export';

const SONG_ID = '01J9SONGID';

const song = {
  schema_version: 2,
  id: SONG_ID,
  title: 'Tightrope',
  artist: 'Walk the Moon',
  source: { kind: 'upload', value: 'original.mp3' },
  created_at: '2026-01-01T00:00:00Z',
  last_played_at: null,
  mix: {
    vocals: { gain_db: 0, muted: false },
    drums: { gain_db: -6, muted: false },
    bass: { gain_db: 0, muted: true },
    other: { gain_db: 0, muted: false },
  },
  playback: { tempo: 0.82, pitch_semitones: -2 },
  loops: [],
  active_loop: null,
  metronome: false,
  count_in_bars: 0,
};

const entry = {
  dir: `${SONG_ID}-tightrope`,
  song,
  state: 'analyzed',
  unreadable: null,
  files: { has_audio: true, has_peaks: true, has_stems: true, has_analysis: true },
};

interface MockOptions {
  songEntry?: unknown;
  exports?: unknown[];
  jobs?: unknown[];
  queueStatus?: number;
  queueBody?: unknown;
}

const posted: Array<{ url: string; body: unknown }> = [];

function renderExport(options: MockOptions = {}) {
  posted.length = 0;
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      posted.push({ url, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify(options.queueBody ?? { job_id: 7, name: 'x', file: 'exports/x.mp3' }), {
        status: options.queueStatus ?? 201,
      });
    }
    if (url.endsWith('/exports')) {
      return new Response(JSON.stringify({ exports: options.exports ?? [] }));
    }
    if (url.startsWith('/api/jobs')) {
      return new Response(JSON.stringify({ jobs: options.jobs ?? [] }));
    }
    return new Response(JSON.stringify(options.songEntry ?? entry));
  });
  vi.stubGlobal('fetch', fetchMock);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/songs/${SONG_ID}/export`]}>
        <Routes>
          <Route path="songs/:songId/export" element={<Export />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test('the stem picker is prefilled from the current mix', async () => {
  renderExport();
  // Muted in song.json means unticked here -- "matches your current mix".
  expect(await screen.findByRole('checkbox', { name: /vocals/ })).toBeChecked();
  expect(screen.getByRole('checkbox', { name: /drums/ })).toBeChecked();
  expect(screen.getByRole('checkbox', { name: /bass/ })).not.toBeChecked();
  expect(screen.getByRole('checkbox', { name: /other/ })).toBeChecked();
});

test('the file name is proposed from the title, the picker and the recipe', async () => {
  renderExport();
  const name = await screen.findByLabelText(/file name/i);
  expect(name).toHaveValue('tightrope-no-bass-82-2st');
});

test('the D-10 banner states that the export will not match the preview', async () => {
  renderExport();
  const banner = await screen.findByRole('status', { name: /quality/i });
  expect(banner).toHaveTextContent(/not sound identical to the preview/i);
  expect(banner).toHaveTextContent(/better/i);
});

test('the as-practiced choice names the actual numbers', async () => {
  renderExport();
  expect(await screen.findByRole('radio', { name: /as practiced — 82%, −2 st/i })).toBeChecked();
  expect(screen.getByRole('radio', { name: /original — 100%, 0 st/i })).not.toBeChecked();
});

test('queueing posts the ticked stems and apply_recipe true', async () => {
  renderExport();
  await screen.findByRole('checkbox', { name: /vocals/ });
  await userEvent.click(screen.getByRole('button', { name: /queue export/i }));

  await waitFor(() => expect(posted).toHaveLength(1));
  expect(posted[0].url).toBe(`/api/songs/${SONG_ID}/export`);
  expect(posted[0].body).toEqual({
    stems: ['vocals', 'drums', 'other'],
    apply_recipe: true,
    name: 'tightrope-no-bass-82-2st',
  });
});

test('choosing original posts apply_recipe false and renames the proposal', async () => {
  renderExport();
  await userEvent.click(await screen.findByRole('radio', { name: /original/i }));
  expect(screen.getByLabelText(/file name/i)).toHaveValue('tightrope-no-bass');

  await userEvent.click(screen.getByRole('button', { name: /queue export/i }));
  await waitFor(() => expect(posted).toHaveLength(1));
  expect(posted[0].body).toMatchObject({ apply_recipe: false });
});

test('ticking a stem updates the proposed name', async () => {
  renderExport();
  await userEvent.click(await screen.findByRole('checkbox', { name: /bass/ }));
  expect(screen.getByLabelText(/file name/i)).toHaveValue('tightrope-82-2st');
});

test('a name the user edited is not overwritten by later picker changes', async () => {
  renderExport();
  const name = await screen.findByLabelText(/file name/i);
  await userEvent.clear(name);
  await userEvent.type(name, 'my-own-name');
  await userEvent.click(screen.getByRole('checkbox', { name: /bass/ }));
  expect(name).toHaveValue('my-own-name');
});

test('no stems ticked disables the button and says why', async () => {
  renderExport();
  for (const stem of ['vocals', 'drums', 'other']) {
    await userEvent.click(await screen.findByRole('checkbox', { name: new RegExp(stem) }));
  }
  expect(screen.getByRole('button', { name: /queue export/i })).toBeDisabled();
  expect(screen.getByText(/at least one stem/i)).toBeInTheDocument();
});

test('a song without stems cannot be exported and says so', async () => {
  renderExport({
    songEntry: { ...entry, state: 'imported', files: { ...entry.files, has_stems: false } },
  });
  expect(await screen.findByText(/not been separated/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /queue export/i })).toBeDisabled();
});

test('a running export shows its progress from the job row', async () => {
  renderExport({
    jobs: [{ id: 7, kind: 'export', song_id: SONG_ID, state: 'running', progress: 0.42,
             error: null, result: null }],
    queueBody: { job_id: 7, name: 'tightrope-no-bass-82-2st', file: 'exports/x.mp3' },
  });
  await screen.findByRole('checkbox', { name: /vocals/ });
  await userEvent.click(screen.getByRole('button', { name: /queue export/i }));

  expect(await screen.findByRole('progressbar')).toHaveAttribute('aria-valuenow', '42');
});

test('a failed export shows the server error verbatim', async () => {
  renderExport({
    jobs: [{ id: 7, kind: 'export', song_id: SONG_ID, state: 'failed', progress: 0,
             error: 'FfmpegError: export render of x.mp3 failed: Invalid argument',
             result: null }],
    queueBody: { job_id: 7, name: 'x', file: 'exports/x.mp3' },
  });
  await screen.findByRole('checkbox', { name: /vocals/ });
  await userEvent.click(screen.getByRole('button', { name: /queue export/i }));

  expect(await screen.findByText(/Invalid argument/)).toBeInTheDocument();
});

test('an existing export is listed with a download link and its own duration', async () => {
  renderExport({
    exports: [
      { name: 'tightrope-no-bass-82', file: 'exports/tightrope-no-bass-82.mp3',
        bytes: 5_600_000, modified_at: 1_700_000_000 },
    ],
  });
  const link = await screen.findByRole('link', { name: /tightrope-no-bass-82/ });
  expect(link).toHaveAttribute(
    'href',
    `/api/songs/${SONG_ID}/exports/tightrope-no-bass-82.mp3`,
  );
  expect(screen.getByText(/5\.6 MB/)).toBeInTheDocument();
});

test('a rejected queue shows the API message, not a generic failure', async () => {
  renderExport({ queueStatus: 409, queueBody: { detail: 'no separated stems to export yet' } });
  await screen.findByRole('checkbox', { name: /vocals/ });
  await userEvent.click(screen.getByRole('button', { name: /queue export/i }));

  expect(await screen.findByText(/no separated stems to export yet/)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/screens/Export.test.tsx`
Expected: every test failing — the current `Export.tsx` renders only `<h1>Export</h1>`.

- [ ] **Step 3: Write the screen**

Rewrite `frontend/src/screens/Export.tsx`:

```tsx
// UI spec §6, screen 5, and design/ui/src/pages/screens/export.html. The stem
// picker is prefilled from the current mix, the tempo-and-pitch choice is
// explicit, and the D-10 banner is not optional chrome: it is the thing that
// stops "the file sounds different from the preview" being filed as a bug.
//
// The recipe is *not* edited here. This screen chooses which stems to include
// and whether to apply the practice tempo/pitch at all; the API snapshots the
// live values out of song.json when it enqueues (D7-02).
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';

import { exportUrl } from '../api/client';
import { queryKeys, useExports, useJobs, useQueueExport, useSong } from '../api/queries';
// STEM_ORDER/StemName come from `engine/types` (import-free), never from
// EngineController: that module transitively loads @soundtouchjs/audio-worklet,
// whose top level subclasses AudioWorkletNode, which does not exist in jsdom.
import { STEM_ORDER, type StemName } from '../engine/types';
import { proposeExportName } from './exportName';
import styles from './Export.module.css';

function formatBytes(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

function formatSeconds(seconds: number): string {
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

export function Export() {
  const { songId } = useParams();
  const songQuery = useSong(songId);
  const exportsQuery = useExports(songId);
  const jobsQuery = useJobs();
  const queueExport = useQueueExport(songId);
  const client = useQueryClient();

  const song = songQuery.data?.song ?? null;
  const hasStems = songQuery.data?.files?.has_stems ?? false;

  const [picked, setPicked] = useState<readonly StemName[] | null>(null);
  const [applyRecipe, setApplyRecipe] = useState(true);
  // null means "still following the proposal"; a string means the user typed.
  const [typedName, setTypedName] = useState<string | null>(null);
  const [jobId, setJobId] = useState<number | null>(null);

  // Prefilled from the mix, once, when the song arrives: a muted stem is
  // unticked, which is what "matches your current mix" means.
  useEffect(() => {
    if (song && picked === null) {
      setPicked(STEM_ORDER.filter((name) => !song.mix[name]?.muted));
    }
  }, [song, picked]);

  const tempo = song?.playback.tempo ?? 1;
  const pitch = song?.playback.pitch_semitones ?? 0;
  const stems = picked ?? [];

  const proposed = useMemo(
    () =>
      proposeExportName(song?.title ?? '', stems, {
        tempo: applyRecipe ? tempo : 1,
        pitchSemitones: applyRecipe ? pitch : 0,
      }),
    [song?.title, stems, applyRecipe, tempo, pitch],
  );
  const name = typedName ?? proposed;

  const job = jobsQuery.data?.find((candidate) => candidate.id === jobId) ?? null;

  // The exports list is a directory listing; it changes when the worker finishes.
  // The WebSocket already invalidates ['jobs'] on every job event, so the job
  // reaching `done` is the signal -- no polling of our own.
  useEffect(() => {
    if (job?.state === 'done') {
      void client.invalidateQueries({ queryKey: queryKeys.exports(songId) });
    }
  }, [job?.state, client, songId]);

  const reason = !hasStems
    ? 'This song has not been separated yet, so there are no stems to mix.'
    : stems.length === 0
      ? 'Pick at least one stem to export.'
      : null;

  return (
    <section className={styles.screen}>
      <header className={styles.head}>
        <div>
          <h1>Export</h1>
          <p className={styles.sub}>
            {song ? `${song.title}${song.artist ? ` — ${song.artist}` : ''}` : songId}
          </p>
        </div>
        <Link className={styles.link} to={`/songs/${songId}`}>
          Back to the song
        </Link>
      </header>

      {songQuery.data?.unreadable && <p className={styles.error}>{songQuery.data.unreadable}</p>}

      <fieldset className={styles.group}>
        <legend>Stems to include</legend>
        {STEM_ORDER.map((stem) => (
          <label className={styles.check} key={stem}>
            <input
              type="checkbox"
              checked={stems.includes(stem)}
              onChange={(event) =>
                setPicked(
                  event.target.checked
                    ? STEM_ORDER.filter((name) => name === stem || stems.includes(name))
                    : stems.filter((name) => name !== stem),
                )
              }
            />
            <span className={styles.stemName}>{stem}</span>
            {song?.mix[stem]?.gain_db ? (
              <span className={styles.gain}>{song.mix[stem].gain_db} dB</span>
            ) : null}
          </label>
        ))}
        <p className={styles.note}>
          Matches your current mix — a muted stem is off here too. One stem alone exports the
          same way.
        </p>
      </fieldset>

      <fieldset className={styles.group}>
        <legend>Tempo &amp; pitch</legend>
        <label className={styles.radio}>
          <input
            type="radio"
            name="recipe"
            checked={applyRecipe}
            onChange={() => setApplyRecipe(true)}
          />
          {`As practiced — ${Math.round(tempo * 100)}%, ${pitch < 0 ? '−' : ''}${Math.abs(pitch)} st`}
        </label>
        <label className={styles.radio}>
          <input
            type="radio"
            name="recipe"
            checked={!applyRecipe}
            onChange={() => setApplyRecipe(false)}
          />
          Original — 100%, 0 st
        </label>

        {/* D-10, stated in the UI on purpose. */}
        <div className={styles.banner} role="status" aria-label="Export quality">
          <strong>The export will not sound identical to the preview.</strong> Playback runs on
          a real-time budget; the export does not. The file is rendered server-side from the
          untouched WAV masters at higher quality — better than what you practised to, never
          worse.
        </div>
      </fieldset>

      <div className={styles.row}>
        <div className={styles.field}>
          <label htmlFor="export-name">File name</label>
          <input
            id="export-name"
            value={name}
            onChange={(event) => setTypedName(event.target.value)}
          />
        </div>
        <div className={styles.field}>
          <span>Format</span>
          <span className={styles.format}>MP3 320</span>
        </div>
      </div>
      <p className={styles.note}>
        Lands in <code>exports/{name}.mp3</code>. Re-exporting the same name overwrites it.
      </p>

      {reason && <p className={styles.note}>{reason}</p>}

      <button
        className={styles.submit}
        type="button"
        disabled={Boolean(reason) || queueExport.isPending}
        onClick={() =>
          queueExport.mutate(
            { stems: [...stems], apply_recipe: applyRecipe, name },
            { onSuccess: (queued) => setJobId(queued.job_id) },
          )
        }
      >
        {queueExport.isPending ? 'Queueing…' : 'Queue export'}
      </button>

      {/* N-08: the API's own message, verbatim. */}
      {queueExport.isError && <p className={styles.error}>{String(queueExport.error)}</p>}

      {job && job.state !== 'done' && (
        <p className={styles.progressRow}>
          <span>{job.state}</span>
          <progress
            className={styles.progress}
            role="progressbar"
            aria-valuenow={Math.round(job.progress * 100)}
            max={100}
            value={Math.round(job.progress * 100)}
          />
          <Link className={styles.link} to="/jobs">
            Job {job.id}
          </Link>
        </p>
      )}
      {job?.state === 'failed' && <p className={styles.error}>{job.error}</p>}

      <h2>Exports</h2>
      {exportsQuery.data?.length === 0 && <p className={styles.note}>Nothing exported yet.</p>}
      <ul className={styles.exports}>
        {(exportsQuery.data ?? []).map((item) => (
          <li className={styles.exportRow} key={item.name}>
            {/* D7-10: a link, never an automatic download. */}
            <a className={styles.link} href={exportUrl(songId ?? '', item.name)} download>
              {item.name}.mp3
            </a>
            <span className={styles.meta}>{formatBytes(item.bytes)}</span>
            {job?.state === 'done' &&
              typeof job.result?.duration_seconds === 'number' &&
              String(job.result?.file ?? '') === item.file && (
                <span className={styles.meta}>
                  {formatSeconds(job.result.duration_seconds as number)}
                </span>
              )}
          </li>
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Step 4: Write `Export.module.css`**

Create `frontend/src/screens/Export.module.css`, following `Import.module.css`'s use of the
design tokens (`--ds-*` from `styles/tokens.css`) — no new tokens:

```css
.screen {
  display: flex;
  flex-direction: column;
  gap: var(--ds-4);
  max-width: 640px;
}

.head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--ds-4);
}

.sub {
  margin: 0;
  color: var(--ds-text-2);
}

.group {
  display: flex;
  flex-direction: column;
  gap: var(--ds-2);
  padding: var(--ds-4);
  background: var(--ds-surface);
  border: 1px solid var(--ds-border);
  border-radius: var(--ds-r-panel);
}

.check,
.radio {
  display: flex;
  align-items: center;
  gap: var(--ds-2);
  min-height: var(--ds-hit-setup);
}

.stemName {
  flex: 1;
}

.gain,
.meta {
  font: 400 var(--ds-t-xs) / 1.4 var(--ds-mono);
  color: var(--ds-text-2);
}

.banner {
  padding: var(--ds-3) var(--ds-4);
  border: 1px solid var(--ds-border-strong);
  border-radius: var(--ds-r-panel);
  color: var(--ds-text-2);
}

.banner strong {
  color: var(--ds-text);
}

.row {
  display: flex;
  gap: var(--ds-4);
  align-items: flex-end;
}

.field {
  display: flex;
  flex-direction: column;
  gap: var(--ds-1);
  flex: 1;
}

.field input {
  min-height: var(--ds-hit-setup);
  padding: 0 var(--ds-2);
  background: var(--ds-ground);
  border: 1px solid var(--ds-border);
  border-radius: var(--ds-r-input);
  color: var(--ds-text);
}

.format {
  min-height: var(--ds-hit-setup);
  display: flex;
  align-items: center;
  padding: 0 var(--ds-3);
  border: 1px solid var(--ds-border-strong);
  border-radius: var(--ds-r-btn);
}

.submit {
  min-height: var(--ds-hit-setup);
  align-self: flex-start;
}

.note {
  margin: 0;
  color: var(--ds-text-2);
  font: 400 var(--ds-t-sm) / 1.5 var(--ds-font);
}

.progressRow {
  display: flex;
  align-items: center;
  gap: var(--ds-3);
  margin: 0;
}

.progress {
  flex: 1;
}

.exports,
.exportRow {
  margin: 0;
  padding: 0;
  list-style: none;
}

.exportRow {
  display: flex;
  align-items: center;
  gap: var(--ds-3);
  min-height: var(--ds-hit-setup);
  border-bottom: 1px solid var(--ds-border);
}

.link {
  color: var(--ds-accent);
}

.error {
  margin: 0;
  white-space: pre-wrap;
  font: 400 var(--ds-t-xs) / 1.4 var(--ds-mono);
  color: var(--ds-error);
}
```

Every token used here is defined in `frontend/src/styles/tokens.css`: `--ds-1`…`--ds-5`,
`--ds-surface`, `--ds-ground`, `--ds-border`, `--ds-border-strong`, `--ds-text`,
`--ds-text-2`, `--ds-accent`, `--ds-error`, `--ds-mono`, `--ds-font`, `--ds-t-xs`,
`--ds-t-sm`, `--ds-hit-setup`, `--ds-r-panel`, `--ds-r-input`, `--ds-r-btn`. Do not invent
new ones — there is no `--ds-text-dim`, which is why dim text is `--ds-text-2`.

- [ ] **Step 5: Add the link from the Song view**

In `frontend/src/screens/SongView.tsx`, next to the existing `/jobs` link in the header area
(around line 498), add:

```tsx
<Link className={styles.link} to={`/songs/${songId}/export`}>
  Export
</Link>
```

- [ ] **Step 6: Run the tests, the type check and the build**

Run:

```bash
cd frontend && npx vitest run && npx tsc --noEmit && npx vite build
```

Expected: all suites pass (the 14 new Export tests included), no type errors, a clean build.
The suite must also be **silent** — no React `act()` warnings and no unhandled rejections.
If the jobs query's `act` boundary produces a warning, wrap the offending interaction the way
`SongView.test.tsx` already does rather than ignoring it.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/screens/Export.tsx frontend/src/screens/Export.module.css frontend/src/screens/Export.test.tsx frontend/src/screens/SongView.tsx
git commit -m "feat(frontend): the Export screen — stem picker, D-10 banner, download"
```

---

## Task 7: Real-hardware verification

The automated suites prove the plumbing. The roadmap's exit criterion — "an export at 70 %
tempo matches what was practised to" — is a claim about what a file sounds like, and it is
only settled by someone playing along with it. Split the two honestly, the way Phase 6's log
does: measure what is measurable, and leave the listening as an explicit open checklist
rather than claiming it.

**Files:**
- Modify: `docs/superpowers/plans/2026-09-28-phase-7-export.md` (this file)
- Modify: `docs/superpowers/plans/2026-09-27-stemcraft-roadmap.md`

- [ ] **Step 1: Start both processes and the SPA**

```bash
uv run stemcraft-api
```

```bash
uv run stemcraft-worker
```

```bash
cd frontend && npm run dev
```

Confirm the API's health payload lists `ffmpeg_rubberband` as ok — that check is new this
phase, and a host whose ffmpeg lacks librubberband must refuse to start rather than fail at
the first export.

- [ ] **Step 2: Measure the two exports of one real song**

Use the same song Phase 6 verified against (`Fortunate Son`, `01M3KG53V18KDRT2GNW6X3S9RJ`)
so the numbers are comparable. Set the Song view to 70 % tempo, then:

1. Export "as practiced" with the bass unticked. Record: wall-clock job duration, the
   file's size, and its duration from `ffprobe`.
2. Export "original". Record the same three numbers.

Expected: the as-practiced file is `song_duration / 0.70` long — for a 138 s song, 197 s —
and the original is 138 s. Record the actual numbers, not "correct".

- [ ] **Step 3: Verify idempotency and overwriting on the real song**

Re-run the same export job from the Job Queue and confirm the file is byte-identical:

```bash
md5sum songs/01M3KG53V18KDRT2GNW6X3S9RJ-*/exports/*.mp3
```

Then export again under the same name with a different tempo and confirm the file is
replaced, not duplicated, and that no `.tmp` file is left behind in `exports/`.

- [ ] **Step 4: Verify a cancel mid-render**

Queue an export of the full mix at 50 % (the slowest case) and cancel it from the Job Queue
while it runs. Confirm: the job row goes to `cancelled` with no traceback, `exports/` gains
no file, and no `.mp3.*.tmp` remains.

- [ ] **Step 5: Listen to it**

This is the exit criterion and nothing above substitutes for it.

- Play the 70 % export against the Song view at 70 % and confirm it is the same tempo and
  the same pitch — play along with both.
- Judge the 70 % export against the live preview at 70 % on **quality**: D-10 promises the
  file is better, never worse. If it is worse, that is a finding, not a rounding error — say
  so and open the question.
- Check the pitch-shifted export (−2 st) for the same thing.
- Confirm the original-tempo export sounds like the song, at the song's pitch.
- Confirm the one-stem-alone export (bass only) is the bass and is not clipped.

- [ ] **Step 6: Record the results here**

Append a "## Real-hardware verification (Task 7)" section to this file with the date, the
song, the measured job durations, the file sizes, the `ffprobe` durations for both exports,
the md5 result, the cancel observation, and the listening verdicts. **Measured numbers, not
"works"** — a number that misses its target is recorded as a miss and opens a question.
Anything still unlistened stays as an unchecked box under a "Still open" heading, exactly as
Phase 6 did, rather than being claimed.

- [ ] **Step 7: Update the roadmap and commit**

Mark Phase 7 done in `docs/superpowers/plans/2026-09-27-stemcraft-roadmap.md` (and point its
Phase 7 section at this plan the way it points at Phase 6's), then:

```bash
git add docs/superpowers/plans/2026-09-28-phase-7-export.md docs/superpowers/plans/2026-09-27-stemcraft-roadmap.md
git commit -m "docs: Phase 7 verification log and roadmap update"
```

---

## Exit criteria (roadmap Phase 7)

- [ ] `export` job kind renders server-side at higher quality than the live preview (D-10) —
      Tasks 2, 3 (`rubberband` with the offline quality options, and the boot check that
      proves it is available).
- [ ] Any subset of stems, including one alone — Tasks 1, 3, 4, 6.
- [ ] Current tempo and pitch applied by default, with a toggle for original — Tasks 4, 6.
- [ ] MP3 into `exports/`, downloadable — Tasks 3, 4, 6.
- [ ] An export at 70 % tempo matches what was practised to; the toggle produces an
      original-tempo file — Task 7 (measured **and** listened to).
- [ ] The job is re-runnable and overwrites its own output — Task 3's idempotency test and
      Task 7's md5 check.

---

## Real-hardware verification (Task 7)

**Status: the measured half is done; the listening half is open.** Everything mechanically
checkable was run on 2026-09-28 against the real separated song and is recorded below.
Everything *audible* still needs a human with ears at a music stand — and the roadmap's
exit criterion ("an export at 70 % tempo **matches what was practised to**") is an audible
claim, so recording it as passed on the strength of a duration figure would be exactly the
silent degradation N-08 exists to prevent.

Song under test: `Fortunate Son` (CCR), `01M3KG53V18KDRT2GNW6X3S9RJ` — the same song Phase 6
verified against. Source stems 141.767 s.

### How it was run, and the one caveat

A long-running `stemcraft-api` and `stemcraft-worker` (started ~4 h before this work) were
already live on this machine, both predating Phase 7's code. They were **left running and
untouched**: enqueuing an export into the live `jobs.sqlite` would have handed the job to a
worker with no `export` kind registered, producing a misleading failure row in the user's
own queue. Instead the run used an isolated `STEMCRAFT_SONGS_DIR`/`STEMCRAFT_DATA_DIR` over
a hard-linked copy of the real song, a second API on port 8099, and `run_one` driving the
worker loop in-process.

**What that leaves unverified:** the full-stack path through the *installed* `stemcraft-worker`
binary and the WebSocket job-progress push to a real browser. The job kind, the API routes
and the render are all exercised below; the worker's own boot path (which loads torch and
proves the GPU) is not, because export needs none of it.

### Measured — 2026-09-28

| Check | Result |
| --- | --- |
| Boot check for librubberband (new this phase) | `ffmpeg_rubberband: ok` in `/api/health`, alongside the four existing checks |
| Source duration | 141.767 s |
| Export at 70 %, −2 st, bass excluded | **202.56 s** (predicted 141.767 / 0.70 = 202.52) — job reported 202.513 s |
| Export at original | **141.79 s**, matching the source |
| Bitrate, both | **320 kbps** CBR (D7-09) |
| ID3 (D7-06) | title and artist present in the file |
| Render cost, 70 % + pitch (`rubberband` path) | 6.89 s wall for a 141 s song |
| Render cost, original (identity path) | **1.23 s — 5.6× faster**, the visible proof D7-05's short filtergraph really skips the vocoder |
| Re-run of the same export | **byte-identical** (`md5 8af5193029618edbc35332b42ece191d` twice) — §6 idempotency, on real audio |
| One stem alone (`bass`) | renders, 202.56 s at the same recipe |
| Cancel mid-render | job → `cancelled`, **no traceback**, stopped ~0.08 s after the request; no `.mp3`, **no stray `.tmp`** in `exports/` |
| `POST /export`, messy name | `API — round trip, 70%` → `api-round-trip-70` |
| Payload snapshot (D7-02) | carries `tempo 0.7`, `pitch_semitones -2`, per-stem gains, title and artist — resolved at enqueue, not a pointer to `song.json` |
| `apply_recipe: false` | payload `tempo 1.0`, `pitch 0`; rendered file 141.745 s |
| Validation | no stems → **422**; unknown stem → **422**; unknown song → **404**; unseparated song → **409** naming the reason |
| Download | `200`, `content-type: audio/mpeg`, `content-disposition: attachment; filename="…"` |
| Path traversal | `../song`, `..%2F..%2Fsong.json`, `Fortunate` (uppercase), a missing name — **all 404** |
| `GET /exports` | derived from the directory, newest first, sizes matching disk |
| Automated suites | lib 97, api 61, worker 61, frontend 179 — all passing; `tsc --noEmit`, `vite build`, `ruff check packages/` clean |

One incidental confirmation: a three-stem export and a one-stem export of the same duration
produce byte counts that are *identical* (8 103 483). That is correct for 320 kbps CBR, not a
bug — the md5s differ.

### Still open — needs a human at the practice machine

Restart the API and worker first (**the instances currently running predate this phase and
have no `export` job kind**), then:

- [ ] **The exit criterion: does the 70 % export match what was practised to?** Play the
      exported file against the Song view at 70 % and play along with both. The duration
      arithmetic above proves only that it is the right *length*.
- [ ] **D-10's promise, which is the whole reason the export is rendered server-side.** Judge
      the 70 % export against the live preview at 70 % on quality. It must be **better, never
      worse**. If it is worse, that is a finding — record it and open the question rather
      than rounding it into a pass. The banner in the UI makes this promise to the user in
      writing, so it has to be true.
- [ ] **The −2 semitone shift.** Same comparison, for pitch: does the file sit where the
      slider said, and is it clean at ±2–3 st as the domain spec claims?
- [ ] **The original-tempo export.** Sounds like the song, at the song's pitch.
- [ ] **`bass-only`.** It is the bass, and it is not clipped. (`amix` runs with
      `normalize=0`, so a single loud stem is the case most likely to clip — worth a listen
      at the extreme.)
- [ ] **The full stack.** Queue an export from the Export screen in a browser, watch the
      progress bar move from the WebSocket, and download the finished file from the link.
      None of the browser path is covered above.

Record measured numbers, not "works". A number that misses its target gets recorded as a
miss and opens a question; it does not get rounded into a pass.
