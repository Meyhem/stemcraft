# Practice, Phase A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A song-free **Practice** tab where a bass or guitar player picks an exercise (groove over chords, scale, arpeggio, technique drill), a key, a BPM and a pattern, and instantly gets a looping tab, a neck, a metronome with count-in, an optional tempo ramp and a reference sound they can mute.

**Architecture:**
- Pure TypeScript generators (`frontend/src/music/practice/`) turn the settings into a `PracticeLoop`: timed, fretted notes in beats.
- A pure TypeScript renderer (`frontend/src/practice/audio/`) synthesizes the loop into the engine's four stem slots at 48 kHz. It writes 2 bars of silent lead-in, so the count-in works from the top.
- The existing `EngineController` plays the stems, loops them seamlessly and clicks the metronome from the generated grid. One engine lives per Practice visit, and its stems are swapped in place when the loop changes.
- Settings and presets live in `practice.json`, owned by the API, the same pattern as `theory.json`.

**Tech Stack:** React 19 + TypeScript, Vitest + Testing Library (jsdom), tonal 6.4.3 (behind `music/spell.ts` and `music/progressions.ts`), canvas painters, AudioWorklet engine; Python 3.12, FastAPI, pydantic, pytest, ruff.

**Spec:** `docs/superpowers/specs/2026-10-02-practice-design.md`
**Mockup:** canvas "Stemcraft Practice", https://claude.ai/artifact/WZRW3xFbrQUiktmMQ3H4GE (artboards *Main*, *States*; *PhaseB* is the next plan)
**Next plan:** `docs/superpowers/plans/2026-10-02-practice-phase-b.md` (chord pad, drums)

## Deviations from the spec (decided while planning; each keeps behaviour, and Task 19 records them in D-22)

- **The synths are pure TypeScript writing into `Float32Array`s, not an `OfflineAudioContext`.**
  jsdom has no Web Audio, so an offline context could only be tested by hand. The voices
  are a few lines of DSP each, deterministic, and unit-testable. Same 48 kHz, same slots.
- **One engine per visit, with its stems replaced in place.** The worklet already accepts a
  fresh `load-begin … load-end` sequence (`StemAssembler`), so `EngineController` gains
  `replaceStems()`. This avoids opening a new `AudioContext` on every picker change.
  `create()` becomes fetch + decode + `createFromStems()`.
- **The click level is a real level.** The worklet's `metronomeGain` was only ever set to 0
  or 1. `setMetronomeLevel()` stores a level that `setMetronome(true)` and the count-in use.
- **The staff follows the clock directly instead of easing.** The loop is drawn end to end
  (tiled), so there is never a jump to ease over. The window is
  `[beat − 32/3, beat + 64/3]`, the same "playhead at a third" as the Tab view.
- **Guitar groove reuses D-20 whole.** `guitarSource`'s per-label core is extracted as
  `guitarBars()` (a pure refactor), and the screen reuses `GuitarNeck` and `StrumLane`
  unchanged. Its Viterbi stays linear over the loop, not circular: a 2–16-bar loop of
  common chords gains nothing from closing the circle.
- **Arpeggios fill the bar.** Each chord gets `bars_per_chord` bars, and the path cycles to
  fill them at the rhythm's step. A path that does not divide the bar would otherwise
  leave ragged loops.
- **Notes are not quantised to a "tick"; beats are numbers.** Triplets are `1/3`, and every
  onset is rounded to an integer sample once, in the renderer (invariant 4).

## Global Constraints

- The API never imports torch. `practice.json` is written only by the API (invariant 2), atomically (invariant 8), via `atomic_write_json`.
- Nothing derived is stored: notes, audio and grids are recomputed from the settings and the seed on every change (D-18's rule).
- 48 kHz everywhere: every onset and grid line is an integer sample index at 48 000 Hz (invariant 4).
- Loops wrap the engine's read cursor; the stretcher is never seeked (invariant 5). Stems are mixed to stereo before the stretcher (invariant 6, already true of the engine).
- No painter plays audio (invariant 7). Canvases paint from the engine clock via `usePlayhead`, never from React state at audio rate (U-05).
- Fail loudly (N-08): an exercise that does not fit the neck is an error with fix buttons and nothing plays. Render, engine and `practice.json` errors are banners quoting the real message. Unknown enum values are rejected by pydantic `Literal`s, never coerced.
- Frets 0–12. Bass EADG = MIDI `[28, 33, 38, 43]`; guitar EADGBE = MIDI `[40, 45, 50, 55, 59, 64]`. String index 0 is the lowest string in `music/practice/` (as in `fingering.ts`). `guitarShapes.ts` counts rows from the high e, so convert with `string = 5 − row`.
- Note spelling: keyed exercises spell for the key (`spell()` from `patterns.ts` for groove and arpeggio, `scaleNotes()` from `spell.ts` for scales). Drills use sharps. The key picker shows `C♯/D♭`-style double names on the black keys. Key roots use `rootName(pc, mode)`.
- Engine tempo ratio range is 0.5–1.5 (`TEMPO_MIN`/`TEMPO_MAX`). A ramp's target must lie in `[ceil(start × 0.5), floor(start × 1.5)]`.
- Lead-in: exactly 2 bars of silence before bar 1 (`LEAD_IN_BARS = 2`). The loop region is bar 1 to the end of the buffers.
- Colours: selected chrome is accent (U-01). Bass notes use `--ds-bass`, guitar `--ds-other`, approach notes the bass hue outlined, the sounding note `--ds-accent`.
- Work on `main`. Commit after each task. Push only at the end of Task 19, after README upkeep (CLAUDE.md).
- Test commands, from the repo root:
  - `uv run pytest -q -p no:warnings`
  - `uv run ruff check packages ops`
  - `npm --prefix frontend test -- --run`
  - `npm --prefix frontend run typecheck`

## File map

| File | Change |
|---|---|
| `packages/stemcraft_lib/src/stemcraft_lib/practice.py` | **new**: pydantic model, `read_practice`, `write_practice` |
| `packages/stemcraft_lib/tests/test_practice.py` | **new** |
| `packages/stemcraft_api/src/stemcraft_api/routes/practice.py` | **new**: `GET`/`PUT /api/practice` |
| `packages/stemcraft_api/src/stemcraft_api/app.py` | include the router |
| `packages/stemcraft_api/tests/test_practice_routes.py` | **new** |
| `frontend/src/api/client.ts` | `PracticeDoc` types, `DEFAULT_PRACTICE` |
| `frontend/src/practice/PracticeDoc.tsx` (+ test) | **new**: GET, debounced PUT, errors |
| `frontend/src/music/practice/types.ts` | **new**: `PracticeNote`, `PracticeLoop`, `GenerateResult`, `Fix` |
| `frontend/src/music/practice/neck.ts` (+ test) | **new**: tunings, `positionsOf`, `placeLine`, names |
| `frontend/src/music/practice/random.ts` (+ test) | **new**: seeded PRNG |
| `frontend/src/music/practice/chords.ts` (+ test) | **new**: progression → BTC labels, bars, labels |
| `frontend/src/music/guitarSource.ts` | extract `guitarBars()`; `guitarSource` calls it |
| `frontend/src/music/practice/groove.ts` (+ test) | **new**: bass and guitar groove, backing bass |
| `frontend/src/music/practice/scale.ts` (+ test) | **new** |
| `frontend/src/music/practice/arpeggio.ts` (+ test) | **new** |
| `frontend/src/music/practice/drill.ts` (+ test) | **new** |
| `frontend/src/music/practice/generate.ts` (+ test) | **new**: dispatcher |
| `frontend/src/practice/audio/voices.ts` (+ test) | **new**: bass voice, plucked string |
| `frontend/src/practice/audio/render.ts` (+ test) | **new**: timing, lead-in, grids, stems |
| `frontend/src/engine/EngineController.ts` (+ test) | `createFromStems`, `replaceStems`, `setMetronomeLevel` |
| `frontend/src/practice/tempo.ts` (+ test) | **new**: ramp schedule, tap tempo |
| `frontend/src/practice/usePracticeSession.ts` (+ test) | **new**: engine lifecycle |
| `frontend/src/practice/practiceStaffPainter.ts`, `PracticeStaff.tsx` (+ tests) | **new** |
| `frontend/src/playalong/neckPainter.ts` | optional string layout (default unchanged) |
| `frontend/src/practice/PracticeNeck.tsx` (+ test) | **new** |
| `frontend/src/practice/{PracticeRail,SettingsPanel,SoundPanel,PracticeTransport,RampStrip}.tsx` (+ tests) | **new** |
| `frontend/src/practice/Practice.module.css` | **new** |
| `frontend/src/screens/Practice.tsx` (+ test) | **new**: the screen |
| `frontend/src/app/routes.tsx`, `AppShell.tsx` | route and nav |
| `design/tech-spec-stemcraft.md`, `design/domain-spec.md`, `design/ui-spec.md` | D-22, feature, U-entry |
| `design/ui/src/pages/screens/practice.html` | **new** design card |
| `README.md`, `docs/screenshots/practice.png` | feature bullet, screenshot |

---

### Task 1: `practice.json` model and API

**Files:**
- Create: `packages/stemcraft_lib/src/stemcraft_lib/practice.py`
- Create: `packages/stemcraft_lib/tests/test_practice.py`
- Create: `packages/stemcraft_api/src/stemcraft_api/routes/practice.py`
- Modify: `packages/stemcraft_api/src/stemcraft_api/app.py` (import list at line 19, `include_router` near line 39)
- Create: `packages/stemcraft_api/tests/test_practice_routes.py`

**Interfaces:**
- Produces: `GET /api/practice` → the document (defaults on first run, nothing written); `PUT /api/practice` (full document) → what was written; 422 naming the field on a bad body; 500 with `detail` when the file is unreadable or the write fails. Python: `Practice`, `PracticeUnreadable`, `read_practice(data_dir)`, `write_practice(data_dir, practice)`, `practice_path(data_dir)`.

- [ ] **Step 1: Write the failing lib tests**

`packages/stemcraft_lib/tests/test_practice.py`:

```python
import json

import pytest
from pydantic import ValidationError
from stemcraft_lib.practice import (
    Practice,
    PracticeUnreadable,
    Ramp,
    practice_path,
    read_practice,
    write_practice,
)


def test_missing_file_reads_as_defaults(tmp_path):
    doc = read_practice(tmp_path)
    assert doc.version == 1
    assert doc.instrument == "bass"
    assert doc.bass.exercise == "groove"
    assert doc.bass.key == 7
    assert doc.bass.bpm == 100
    assert doc.bass.groove.progression == "pop"
    assert doc.guitar.groove.strum == "folk"
    assert doc.presets == []
    assert not practice_path(tmp_path).exists()


def test_write_then_read_round_trips(tmp_path):
    doc = Practice()
    doc.bass.bpm = 132
    doc.bass.scale.scale = "blues"
    write_practice(tmp_path, doc)
    assert read_practice(tmp_path) == doc
    # Atomic: no temp file left beside it.
    assert [p.name for p in tmp_path.iterdir()] == ["practice.json"]


def test_invalid_json_is_unreadable_with_the_reason(tmp_path):
    practice_path(tmp_path).write_text("{nope")
    with pytest.raises(PracticeUnreadable, match="invalid JSON at line 1"):
        read_practice(tmp_path)


def test_invalid_field_is_unreadable_not_reset(tmp_path):
    practice_path(tmp_path).write_text(json.dumps({"version": 1, "bass": {"bpm": 999}}))
    with pytest.raises(PracticeUnreadable, match="invalid field"):
        read_practice(tmp_path)
    assert "999" in practice_path(tmp_path).read_text()


def test_ramp_target_must_stay_in_the_engine_tempo_range():
    with pytest.raises(ValidationError, match=r"outside 40-120"):
        Ramp(on=True, start=80, target=130)
    assert Ramp(on=True, start=80, target=120).target == 120
    assert Ramp(on=True, start=120, target=60).target == 60


def test_preset_names_are_unique_ignoring_case():
    preset = {"name": "Blues", "instrument": "bass", "settings": {}}
    with pytest.raises(ValidationError, match="preset names must be unique"):
        Practice.model_validate({"presets": [preset, {**preset, "name": "blues"}]})


def test_unknown_values_are_rejected_not_coerced():
    with pytest.raises(ValidationError):
        Practice.model_validate({"bass": {"exercise": "solo"}})
    with pytest.raises(ValidationError):
        Practice.model_validate({"bass": {"groove": {"bars_per_chord": 3}}})
    with pytest.raises(ValidationError):
        Practice.model_validate({"bass": {"key": 12}})
    with pytest.raises(ValidationError):
        Practice.model_validate({"bass": {"drill": {"from_fret": 10}}})
```

- [ ] **Step 2: Run them to see them fail**

Run: `uv run pytest packages/stemcraft_lib/tests/test_practice.py -q`
Expected: FAIL, `ModuleNotFoundError: No module named 'stemcraft_lib.practice'`

- [ ] **Step 3: Write `practice.py`**

```python
"""practice.json: the Practice tab's settings per instrument and its named
presets (D-22). The API is its only writer (§2); the worker never reads it.
It lives in the data dir beside theory.json: it belongs to the player, not to
any song.

Nothing derived is stored. Notes, audio and grids are regenerated in the
browser from these settings and the seed, like Play along's patterns (D-18).
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator

from .atomic import atomic_write_json

SCHEMA_VERSION = 1
PRESET_CAP = 100

# music/progressions.ts PROGRESSIONS ids, in its order.
ProgressionId = Literal[
    "pop",
    "fifties",
    "two-five-one",
    "one-four-five",
    "twelve-bar",
    "minor-blues",
    "sensitive",
    "andalusian",
    "minor-one-four-five",
    "mixolydian",
    "minor-two-five-one",
    "canon",
    "one-four-six-five",
    "epic-minor",
    "one-three-four-five",
]
# music/spell.ts SCALES ids, in its order.
ScaleId = Literal[
    "major",
    "minor",
    "major-pentatonic",
    "minor-pentatonic",
    "blues",
    "dorian",
    "phrygian",
    "lydian",
    "mixolydian",
    "locrian",
    "harmonic-minor",
    "melodic-minor",
    "whole-tone",
    "diminished",
]
LineRhythm = Literal["quarter", "eighth", "triplet", "sixteenth"]
BarsPerChord = Literal[1, 2, 4]


class PracticeUnreadable(Exception):
    """practice.json exists but cannot be used. Surfaced verbatim (U-09); the
    file is never replaced with defaults behind the player's back (N-08)."""


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Ramp(_Strict):
    on: bool = False
    start: int = Field(80, ge=40, le=220)
    target: int = Field(120, ge=40, le=220)
    step: int = Field(5, ge=1, le=20)
    every_loops: int = Field(2, ge=1, le=8)

    @model_validator(mode="after")
    def _engine_range(self) -> Ramp:
        # The ramp is the engine's tempo ratio over the rendered start BPM, and
        # the engine's ratio range is 0.5-1.5 (N-04, engine/types.ts TEMPO_*).
        lo, hi = math.ceil(self.start * 0.5), math.floor(self.start * 1.5)
        if not lo <= self.target <= hi:
            raise ValueError(
                f"target {self.target} bpm is outside {lo}-{hi}: the engine's tempo range "
                f"is 0.5-1.5x of the start ({self.start} bpm)"
            )
        return self


class Levels(_Strict):
    click: float = Field(0.7, ge=0, le=1)
    ref: float = Field(0.8, ge=0, le=1)
    ref_muted: bool = False
    backing: float = Field(0.6, ge=0, le=1)
    backing_muted: bool = False


class Groove(_Strict):
    progression: ProgressionId = "pop"
    bars_per_chord: BarsPerChord = 1
    # Bass (D-18's PatternNotes / PatternRhythm / PatternApproach).
    notes: Literal[
        "root",
        "root_fifth",
        "root_fifth_octave",
        "octave_pump",
        "triad_chord",
        "triad_diatonic",
        "seventh",
    ] = "root_fifth_octave"
    rhythm: Literal["whole", "half", "quarter", "eighth"] = "quarter"
    approach: Literal["none", "chromatic", "scale", "fifth"] = "chromatic"
    # Guitar (D-20's style / strum / position).
    style: Literal["open", "barre", "power", "triad"] = "open"
    strum: Literal["whole", "half", "quarters", "eighths", "folk", "push"] = "folk"
    position: Literal["auto", "low", "mid"] = "auto"


class Scale(_Strict):
    scale: ScaleId = "minor-pentatonic"
    shape: Literal["position", "two_octaves"] = "position"
    from_fret: int = Field(5, ge=0, le=12)
    path: Literal["up", "down", "up_down", "thirds", "groups3", "groups4"] = "up_down"
    rhythm: LineRhythm = "eighth"


class Arpeggio(_Strict):
    over: Literal["chord", "progression"] = "progression"
    # The one chord's root is the key; this is its quality.
    quality: Literal["maj", "min", "7", "maj7", "min7", "dim", "hdim7"] = "maj7"
    progression: ProgressionId = "two-five-one"
    bars_per_chord: BarsPerChord = 1
    tones: Literal["triad", "seventh"] = "seventh"
    path: Literal["up", "down", "up_down", "inversions"] = "up"
    rhythm: LineRhythm = "quarter"


class Drill(_Strict):
    drill: Literal["chromatic", "permutations", "spider", "crossing", "octaves"] = "chromatic"
    # Index finger's fret; the pinky lands three higher, so 9 keeps it on the neck.
    from_fret: int = Field(5, ge=1, le=9)
    direction: Literal["up", "up_back"] = "up_back"
    rhythm: LineRhythm = "eighth"


class InstrumentSettings(_Strict):
    exercise: Literal["groove", "scale", "arpeggio", "drill"] = "groove"
    key: int = Field(7, ge=0, le=11)  # pitch class of the tonic; 7 = G
    bpm: int = Field(100, ge=40, le=220)
    count_in_bars: Literal[0, 1, 2] = 1
    seed: int = Field(1, ge=0, le=2**31 - 1)
    ramp: Ramp = Field(default_factory=Ramp)
    levels: Levels = Field(default_factory=Levels)
    groove: Groove = Field(default_factory=Groove)
    scale: Scale = Field(default_factory=Scale)
    arpeggio: Arpeggio = Field(default_factory=Arpeggio)
    drill: Drill = Field(default_factory=Drill)


class Preset(_Strict):
    name: str = Field(min_length=1, max_length=60)
    instrument: Literal["bass", "guitar"]
    settings: InstrumentSettings = Field(default_factory=InstrumentSettings)

    @field_validator("name")
    @classmethod
    def _trimmed(cls, name: str) -> str:
        name = name.strip()
        if not name:
            raise ValueError("a preset needs a name")
        return name


class Practice(_Strict):
    version: Literal[1] = SCHEMA_VERSION
    instrument: Literal["bass", "guitar"] = "bass"
    bass: InstrumentSettings = Field(default_factory=InstrumentSettings)
    guitar: InstrumentSettings = Field(default_factory=InstrumentSettings)
    presets: list[Preset] = Field(default_factory=list, max_length=PRESET_CAP)

    @model_validator(mode="after")
    def _unique_names(self) -> Practice:
        seen: set[str] = set()
        for preset in self.presets:
            key = preset.name.casefold()
            if key in seen:
                raise ValueError(f"preset names must be unique: {preset.name!r} appears twice")
            seen.add(key)
        return self


def practice_path(data_dir: Path) -> Path:
    return data_dir / "practice.json"


def read_practice(data_dir: Path) -> Practice:
    """The stored document, or the defaults when there is none yet (a normal
    first run). Anything else wrong raises PracticeUnreadable with the reason."""
    path = practice_path(data_dir)
    try:
        raw = json.loads(path.read_text())
    except FileNotFoundError:
        return Practice()
    except json.JSONDecodeError as exc:
        raise PracticeUnreadable(f"{path}: invalid JSON at line {exc.lineno}: {exc.msg}") from exc
    except (OSError, UnicodeDecodeError) as exc:
        raise PracticeUnreadable(f"{path}: {exc}") from exc
    try:
        return Practice.model_validate(raw)
    except ValidationError as exc:
        raise PracticeUnreadable(f"{path}: {exc.error_count()} invalid field(s): {exc}") from exc


def write_practice(data_dir: Path, practice: Practice) -> Practice:
    """Writes atomically (invariant 8). Returns what was written."""
    data_dir.mkdir(parents=True, exist_ok=True)
    atomic_write_json(practice_path(data_dir), practice.model_dump(mode="json"))
    return practice
```

- [ ] **Step 4: Run the lib tests**

Run: `uv run pytest packages/stemcraft_lib/tests/test_practice.py -q`
Expected: 7 passed

- [ ] **Step 5: Write the failing route tests**

`packages/stemcraft_api/tests/test_practice_routes.py`:

```python
import pytest
from fastapi.testclient import TestClient
from stemcraft_api.app import create_app
from stemcraft_lib.practice import practice_path


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("STEMCRAFT_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("STEMCRAFT_SONGS_DIR", str(tmp_path / "songs"))
    monkeypatch.setenv("STEMCRAFT_DIST_DIR", str(tmp_path / "nodist"))
    monkeypatch.setenv("STEMCRAFT_SKIP_BOOT_CHECKS", "1")
    return TestClient(create_app())


def test_first_run_gets_defaults_without_writing(client, tmp_path):
    resp = client.get("/api/practice")
    assert resp.status_code == 200
    body = resp.json()
    assert body["version"] == 1
    assert body["bass"]["groove"]["notes"] == "root_fifth_octave"
    assert body["guitar"]["levels"]["backing"] == 0.6
    assert not practice_path(tmp_path / "data").exists()


def test_put_round_trips_and_lands_on_disk(client, tmp_path):
    doc = client.get("/api/practice").json()
    doc["instrument"] = "guitar"
    doc["guitar"]["exercise"] = "scale"
    doc["presets"] = [{"name": "Box 1", "instrument": "guitar", "settings": doc["guitar"]}]
    resp = client.put("/api/practice", json=doc)
    assert resp.status_code == 200
    assert resp.json() == doc
    assert client.get("/api/practice").json() == doc
    assert practice_path(tmp_path / "data").is_file()


def test_bad_field_is_a_422_naming_it(client):
    doc = client.get("/api/practice").json()
    doc["bass"]["bpm"] = 400
    resp = client.put("/api/practice", json=doc)
    assert resp.status_code == 422
    assert "bpm" in resp.text


def test_ramp_out_of_engine_range_is_a_422_saying_why(client):
    doc = client.get("/api/practice").json()
    doc["bass"]["ramp"] = {"on": True, "start": 80, "target": 200, "step": 5, "every_loops": 2}
    resp = client.put("/api/practice", json=doc)
    assert resp.status_code == 422
    assert "tempo range is 0.5-1.5x" in resp.text


def test_unreadable_file_is_a_500_with_the_reason_and_left_alone(client, tmp_path):
    path = practice_path(tmp_path / "data")
    path.parent.mkdir(parents=True)
    path.write_text("{nope")
    resp = client.get("/api/practice")
    assert resp.status_code == 500
    assert "invalid JSON" in resp.json()["detail"]
    assert path.read_text() == "{nope"
```

- [ ] **Step 6: Run them to see them fail**

Run: `uv run pytest packages/stemcraft_api/tests/test_practice_routes.py -q`
Expected: FAIL with 404s (no route).

- [ ] **Step 7: Write the routes and register them**

`packages/stemcraft_api/src/stemcraft_api/routes/practice.py`:

```python
"""GET/PUT /api/practice (D-22). The API is practice.json's only writer (§2).

A missing file is a normal first run and reads as the defaults. An unreadable
one is a 500 carrying the real reason (U-09), and is left on disk untouched.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from stemcraft_lib.config import settings
from stemcraft_lib.practice import (
    Practice,
    PracticeUnreadable,
    practice_path,
    read_practice,
    write_practice,
)

router = APIRouter()


@router.get("/api/practice")
def get_practice() -> dict:
    try:
        return read_practice(settings().data_dir).model_dump(mode="json")
    except PracticeUnreadable as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.put("/api/practice")
def put_practice(body: Practice) -> dict:
    # A full replacement, like PUT /api/theory. FastAPI has already refused an
    # invalid body with a 422 naming the field.
    data_dir = settings().data_dir
    try:
        return write_practice(data_dir, body).model_dump(mode="json")
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"{practice_path(data_dir)}: {exc}") from exc
```

In `packages/stemcraft_api/src/stemcraft_api/app.py`, change the import on line 19 to

```python
from .routes import albums, health, jobs, practice, songs, theory
```

and add, directly after `app.include_router(theory.router)`:

```python
    app.include_router(practice.router)
```

- [ ] **Step 8: Run all Python tests and the linter**

Run: `uv run pytest -q -p no:warnings && uv run ruff check packages ops`
Expected: all pass, ruff clean.

- [ ] **Step 9: Commit**

```bash
git add packages/stemcraft_lib/src/stemcraft_lib/practice.py packages/stemcraft_lib/tests/test_practice.py \
  packages/stemcraft_api/src/stemcraft_api/routes/practice.py packages/stemcraft_api/src/stemcraft_api/app.py \
  packages/stemcraft_api/tests/test_practice_routes.py
git commit -m "feat(api): practice.json and GET/PUT /api/practice (D-22)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Client types and the `PracticeDoc` provider

**Files:**
- Modify: `frontend/src/api/client.ts` (append after `DEFAULT_THEORY`)
- Create: `frontend/src/practice/PracticeDoc.tsx`
- Test: `frontend/src/practice/PracticeDoc.test.tsx`

**Interfaces:**
- Consumes: Task 1's endpoints.
- Produces (`client.ts`): `PracticeInstrument`, `ExerciseKind`, `LineRhythm`, `BarsPerChord`, `ProgressionId`, `PracticeRamp`, `PracticeLevels`, `PracticeGroove`, `PracticeScale`, `PracticeArpeggio`, `PracticeDrill`, `InstrumentSettings`, `PracticePreset`, `PracticeDoc`, `DEFAULT_INSTRUMENT_SETTINGS`, `DEFAULT_PRACTICE`.
- Produces (`PracticeDoc.tsx`): `PracticeDocProvider`, `usePracticeDoc(): PracticeDocState`, where

```ts
interface PracticeDocState {
  doc: PracticeDoc | null;            // null until the first GET succeeds
  loadError: string | null;           // GET failed: the message, verbatim
  reload(): void;
  saveError: string | null;           // last PUT failed
  update(change: (doc: PracticeDoc) => PracticeDoc): boolean; // false while doc is null
  retry(): void;
  resetToDefaults(): Promise<void>;
}
```

- [ ] **Step 1: Add the types to `client.ts`**

Append after `DEFAULT_THEORY`:

```ts
// Mirrors packages/stemcraft_lib/src/stemcraft_lib/practice.py (D-22). The API is
// practice.json's only writer; the browser GETs it and PUTs the whole document.
export type PracticeInstrument = 'bass' | 'guitar';
export type ExerciseKind = 'groove' | 'scale' | 'arpeggio' | 'drill';
export type LineRhythm = 'quarter' | 'eighth' | 'triplet' | 'sixteenth';
export type BarsPerChord = 1 | 2 | 4;
export type ProgressionId =
  | 'pop' | 'fifties' | 'two-five-one' | 'one-four-five' | 'twelve-bar' | 'minor-blues' | 'sensitive'
  | 'andalusian' | 'minor-one-four-five' | 'mixolydian' | 'minor-two-five-one' | 'canon'
  | 'one-four-six-five' | 'epic-minor' | 'one-three-four-five';

export interface PracticeRamp { on: boolean; start: number; target: number; step: number; every_loops: number }
export interface PracticeLevels { click: number; ref: number; ref_muted: boolean; backing: number; backing_muted: boolean }
export interface PracticeGroove {
  progression: ProgressionId;
  bars_per_chord: BarsPerChord;
  notes: PatternNotes;
  rhythm: PatternRhythm;
  approach: PatternApproach;
  style: GuitarStyle;
  strum: GuitarStrum;
  position: GuitarPosition;
}
export interface PracticeScale {
  scale: import('../music/spell').ScaleId;
  shape: 'position' | 'two_octaves';
  from_fret: number;
  path: 'up' | 'down' | 'up_down' | 'thirds' | 'groups3' | 'groups4';
  rhythm: LineRhythm;
}
export interface PracticeArpeggio {
  over: 'chord' | 'progression';
  quality: 'maj' | 'min' | '7' | 'maj7' | 'min7' | 'dim' | 'hdim7';
  progression: ProgressionId;
  bars_per_chord: BarsPerChord;
  tones: 'triad' | 'seventh';
  path: 'up' | 'down' | 'up_down' | 'inversions';
  rhythm: LineRhythm;
}
export interface PracticeDrill {
  drill: 'chromatic' | 'permutations' | 'spider' | 'crossing' | 'octaves';
  from_fret: number;
  direction: 'up' | 'up_back';
  rhythm: LineRhythm;
}
export interface InstrumentSettings {
  exercise: ExerciseKind;
  /** Pitch class of the tonic, 0-11. */
  key: number;
  bpm: number;
  count_in_bars: 0 | 1 | 2;
  seed: number;
  ramp: PracticeRamp;
  levels: PracticeLevels;
  groove: PracticeGroove;
  scale: PracticeScale;
  arpeggio: PracticeArpeggio;
  drill: PracticeDrill;
}
export interface PracticePreset { name: string; instrument: PracticeInstrument; settings: InstrumentSettings }
export interface PracticeDoc {
  version: 1;
  instrument: PracticeInstrument;
  bass: InstrumentSettings;
  guitar: InstrumentSettings;
  presets: PracticePreset[];
}

/** The server's defaults (practice.py), for tests and "Reset to defaults". */
export const DEFAULT_INSTRUMENT_SETTINGS: InstrumentSettings = {
  exercise: 'groove',
  key: 7,
  bpm: 100,
  count_in_bars: 1,
  seed: 1,
  ramp: { on: false, start: 80, target: 120, step: 5, every_loops: 2 },
  levels: { click: 0.7, ref: 0.8, ref_muted: false, backing: 0.6, backing_muted: false },
  groove: {
    progression: 'pop', bars_per_chord: 1, notes: 'root_fifth_octave', rhythm: 'quarter', approach: 'chromatic',
    style: 'open', strum: 'folk', position: 'auto',
  },
  scale: { scale: 'minor-pentatonic', shape: 'position', from_fret: 5, path: 'up_down', rhythm: 'eighth' },
  arpeggio: {
    over: 'progression', quality: 'maj7', progression: 'two-five-one', bars_per_chord: 1, tones: 'seventh',
    path: 'up', rhythm: 'quarter',
  },
  drill: { drill: 'chromatic', from_fret: 5, direction: 'up_back', rhythm: 'eighth' },
};

export const DEFAULT_PRACTICE: PracticeDoc = {
  version: 1,
  instrument: 'bass',
  bass: DEFAULT_INSTRUMENT_SETTINGS,
  guitar: DEFAULT_INSTRUMENT_SETTINGS,
  presets: [],
};
```

(`client.ts` imports nothing at runtime from `music/`. The inline `import('../music/spell').ScaleId` is type-only and erased at build time.)

- [ ] **Step 2: Write the failing provider tests**

`frontend/src/practice/PracticeDoc.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

import { DEFAULT_PRACTICE, type PracticeDoc } from '../api/client';
import { PracticeDocProvider, usePracticeDoc } from './PracticeDoc';

function serve(options: { get?: () => Response; put?: (body: PracticeDoc) => Response } = {}) {
  const puts: PracticeDoc[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url !== '/api/practice') throw new Error(`unexpected fetch: ${url}`);
      if (init?.method === 'PUT') {
        const body = JSON.parse(String(init.body)) as PracticeDoc;
        puts.push(body);
        return options.put ? options.put(body) : new Response(JSON.stringify(body));
      }
      return options.get ? options.get() : new Response(JSON.stringify(DEFAULT_PRACTICE));
    }),
  );
  return puts;
}

let state: ReturnType<typeof usePracticeDoc>;
function Probe() {
  state = usePracticeDoc();
  return <p>{state.doc ? `bpm ${state.doc.bass.bpm}` : (state.loadError ?? 'loading')}</p>;
}

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PracticeDocProvider>
        <Probe />
      </PracticeDocProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test('a change shows at once and is PUT once after the debounce', async () => {
  const puts = serve();
  mount();
  await screen.findByText('bpm 100');
  act(() => {
    state.update((d) => ({ ...d, bass: { ...d.bass, bpm: 110 } }));
    state.update((d) => ({ ...d, bass: { ...d.bass, bpm: 120 } }));
  });
  expect(screen.getByText('bpm 120')).toBeInTheDocument();
  await waitFor(() => expect(puts).toHaveLength(1), { timeout: 2000 });
  expect(puts[0]!.bass.bpm).toBe(120);
});

test('a failed save says so, keeps the change, and Retry sends it', async () => {
  let fail = true;
  const puts = serve({
    put: (body) => (fail ? new Response(JSON.stringify({ detail: 'disk full' }), { status: 500 }) : new Response(JSON.stringify(body))),
  });
  mount();
  await screen.findByText('bpm 100');
  act(() => void state.update((d) => ({ ...d, bass: { ...d.bass, bpm: 90 } })));
  await waitFor(() => expect(state.saveError).toContain('disk full'), { timeout: 2000 });
  expect(screen.getByText('bpm 90')).toBeInTheDocument();
  fail = false;
  act(() => state.retry());
  await waitFor(() => expect(state.saveError).toBeNull());
  expect(puts.at(-1)!.bass.bpm).toBe(90);
});

test('an unreadable file is shown verbatim and nothing is written over it', async () => {
  const puts = serve({ get: () => new Response(JSON.stringify({ detail: 'practice.json: invalid JSON at line 1' }), { status: 500 }) });
  mount();
  await screen.findByText(/invalid JSON at line 1/);
  let applied = true;
  act(() => void (applied = state.update((d) => d)));
  expect(applied).toBe(false);
  expect(puts).toHaveLength(0);
});

test('leaving with a pending change saves it at once', async () => {
  const puts = serve();
  const view = mount();
  await screen.findByText('bpm 100');
  act(() => void state.update((d) => ({ ...d, instrument: 'guitar' })));
  view.unmount();
  await waitFor(() => expect(puts).toHaveLength(1));
  expect(puts[0]!.instrument).toBe('guitar');
});
```

- [ ] **Step 3: Run them to see them fail**

Run: `npm --prefix frontend test -- --run src/practice/PracticeDoc.test.tsx`
Expected: FAIL, cannot resolve `./PracticeDoc`.

- [ ] **Step 4: Write the provider**

`frontend/src/practice/PracticeDoc.tsx`:

```tsx
// practice.json in the browser (D-22): one GET, then every change is applied
// locally at once and PUT as the whole document after 500 ms of quiet. A failed
// save keeps the change in memory and says so with a Retry; an unreadable file
// is shown verbatim and never written over (N-08, U-09). Leaving the tab with a
// change pending sends it at once.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

import { api, DEFAULT_PRACTICE, type PracticeDoc } from '../api/client';

const KEY = ['practice'] as const;
const DEBOUNCE_MS = 500;

export interface PracticeDocState {
  doc: PracticeDoc | null;
  loadError: string | null;
  reload(): void;
  saveError: string | null;
  update(change: (doc: PracticeDoc) => PracticeDoc): boolean;
  retry(): void;
  resetToDefaults(): Promise<void>;
}

const Ctx = createContext<PracticeDocState | null>(null);

export function PracticeDocProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const query = useQuery({ queryKey: KEY, queryFn: () => api.get<PracticeDoc>('/api/practice'), retry: false });
  const [local, setLocal] = useState<PracticeDoc | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const latest = useRef<PracticeDoc | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const doc = local ?? query.data ?? null;
  latest.current = doc;

  const save = useCallback(async () => {
    timer.current = null;
    const body = latest.current;
    if (!body) return;
    try {
      client.setQueryData(KEY, await api.put<PracticeDoc>('/api/practice', body));
      setSaveError(null);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    }
  }, [client]);

  const update = useCallback(
    (change: (d: PracticeDoc) => PracticeDoc) => {
      const current = latest.current;
      if (!current) return false;
      const next = change(current);
      latest.current = next;
      setLocal(next);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void save(), DEBOUNCE_MS);
      return true;
    },
    [save],
  );

  // Leaving with a change pending: send it now rather than drop it.
  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
        void save();
      }
    },
    [save],
  );

  const resetToDefaults = useCallback(async () => {
    latest.current = DEFAULT_PRACTICE;
    setLocal(DEFAULT_PRACTICE);
    await save();
    await query.refetch();
  }, [save, query]);

  const value: PracticeDocState = {
    doc,
    loadError: query.error ? query.error.message : null,
    reload: () => void query.refetch(),
    saveError,
    update,
    retry: () => void save(),
    resetToDefaults,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePracticeDoc(): PracticeDocState {
  const state = useContext(Ctx);
  if (!state) throw new Error('usePracticeDoc outside PracticeDocProvider');
  return state;
}
```

`ApiError.message` (`api/client.ts` `request()`) is `"PUT /api/practice → 500: <body>"`, so the server's `detail` reaches `loadError`/`saveError` verbatim (U-09).

- [ ] **Step 5: Run the tests and typecheck**

Run: `npm --prefix frontend test -- --run src/practice/PracticeDoc.test.tsx && npm --prefix frontend run typecheck`
Expected: 4 passed, no type errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/api/client.ts frontend/src/practice/PracticeDoc.tsx frontend/src/practice/PracticeDoc.test.tsx
git commit -m "feat(practice): PracticeDoc types and provider, debounced saves (D-22)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 3: Practice building blocks: types, neck, seeded random, chord bars

**Files:**
- Create: `frontend/src/music/practice/types.ts`
- Create: `frontend/src/music/practice/neck.ts`, test `neck.test.ts`
- Create: `frontend/src/music/practice/random.ts`, test `random.test.ts`
- Create: `frontend/src/music/practice/chords.ts`, test `chords.test.ts`

**Interfaces:**
- Consumes: `PROGRESSIONS`, `progressionChords` (`music/progressions.ts`); `rootName`, `pretty`, `pcOf`, `KeyMode` (`music/spell.ts`); `mod12` (`music/chordTones.ts`); `InstrumentSettings`, `PracticeInstrument`, `LineRhythm`, `ProgressionId`, `BarsPerChord` (`api/client.ts`); `GuitarBar` (`music/guitarSource.ts`, type only).
- Produces:
  - `types.ts`: `PracticeNote`, `SynthNote`, `PracticeBar`, `PracticeLoop`, `Fix`, `GenerateResult`, `BEATS_PER_BAR = 4`, `RHYTHM_STEP`, `loopOf()`.
  - `neck.ts`: `TUNINGS`, `STRING_NAMES`, `HAND_SPAN`, `PRACTICE_MAX_FRET = 12`, `Fretted`, `positionsOn(midi, inst)`, `placeLine(midis, inst, startAnchor)` → `{ ok: true; frets: Fretted[]; anchor: number } | { ok: false; midi: number }`, `sharpName(pc)`, `lowestMidiOf(pc, inst)`.
  - `random.ts`: `rng(seed): () => number`, `newSeed(): number`.
  - `chords.ts`: `toBtcLabel(symbol)`, `ChordBar`, `progressionBars(id, keyPc, barsPerChord)` → `{ bars: ChordBar[]; mode: KeyMode; tonic: string }`.

- [ ] **Step 1: Write `types.ts`** (types only, nothing to test on its own)

```ts
// The Practice tab's generated exercise (D-22): timed, fretted notes in beats
// from the loop start, plus what each bar is called. Generators in this folder
// return one; the renderer turns it into audio and the painters draw it. Pure
// data: nothing here touches Web Audio or the DOM.
import type { InstrumentSettings, LineRhythm, PracticeInstrument } from '../../api/client';
import type { GuitarBar } from '../guitarSource';

export const BEATS_PER_BAR = 4;

/** Beats per note for the single-note lines (scales, arpeggios, drills). */
export const RHYTHM_STEP: Record<LineRhythm, number> = {
  quarter: 1,
  eighth: 0.5,
  triplet: 1 / 3,
  sixteenth: 0.25,
};

export interface PracticeNote {
  /** Onset in beats from the loop start. Rounded to a sample only by the renderer. */
  start: number;
  /** How long it rings, in beats. */
  dur: number;
  /** 0 = the lowest string. */
  string: number;
  fret: number;
  midi: number;
  /** Spelled for display: "F♯", "B♭". */
  name: string;
  kind: 'tone' | 'approach';
  /** Notes struck together share a group (a guitar strum); otherwise 0, 1, 2… in order. */
  group: number;
  /** A drill's finger, 1 (index) to 4 (pinky); null elsewhere. */
  finger: number | null;
  /** Guitar groove: the strum's direction; null elsewhere. */
  stroke: 'down' | 'up' | null;
}

/** A note the backing bass plays under a guitar groove. */
export interface SynthNote {
  start: number;
  dur: number;
  midi: number;
}

export interface PracticeBar {
  /** The chord row: "F♯m7", "A minor pentatonic", "E → A". */
  label: string;
  /** Same chord as the bar before: drawn as "%". */
  repeat: boolean;
  /** A substitution the generator made in this bar, shown, never hidden (N-08); null if none. */
  note: string | null;
}

export interface PracticeLoop {
  instrument: PracticeInstrument;
  /** 4 for bass, 6 for guitar. */
  strings: number;
  bars: PracticeBar[];
  /** Sorted by start, then string. */
  notes: PracticeNote[];
  /** Guitar groove only: D-20's bars, for GuitarNeck and StrumLane. */
  guitarBars: GuitarBar[] | null;
  /** Guitar groove only: the backing bass line. Empty otherwise. */
  backing: SynthNote[];
}

/** A change the screen offers as a button when an exercise does not fit (N-08: offered, never applied for you). */
export interface Fix {
  label: string;
  apply(settings: InstrumentSettings): InstrumentSettings;
}

export type GenerateResult = { ok: true; loop: PracticeLoop } | { ok: false; error: string; fixes: Fix[] };

export function loopOf(
  instrument: PracticeInstrument,
  bars: PracticeBar[],
  notes: PracticeNote[],
  extra: Partial<Pick<PracticeLoop, 'guitarBars' | 'backing'>> = {},
): PracticeLoop {
  const sorted = [...notes].sort((a, b) => a.start - b.start || a.string - b.string);
  return {
    instrument,
    strings: instrument === 'bass' ? 4 : 6,
    bars,
    notes: sorted,
    guitarBars: extra.guitarBars ?? null,
    backing: extra.backing ?? [],
  };
}
```

- [ ] **Step 2: Write the failing tests for `neck.ts`, `random.ts`, `chords.ts`**

`frontend/src/music/practice/neck.test.ts`:

```ts
import { describe, expect, test } from 'vitest';

import { lowestMidiOf, placeLine, positionsOn, sharpName, TUNINGS } from './neck';

describe('positionsOn', () => {
  test('lists every string a pitch can be played on, low string first', () => {
    expect(positionsOn(33, 'bass')).toEqual([
      { string: 0, fret: 5 },
      { string: 1, fret: 0 },
    ]);
    expect(positionsOn(27, 'bass')).toEqual([]);
    expect(positionsOn(64, 'guitar').map((p) => p.string)).toEqual([2, 3, 4, 5]);
  });
});

describe('placeLine', () => {
  test('keeps a fifth-fret A minor pentatonic box in place', () => {
    const placed = placeLine([33, 36, 38, 40, 43, 45, 48, 50], 'bass', 5);
    expect(placed.ok && placed.frets).toEqual([
      { string: 0, fret: 5 }, { string: 0, fret: 8 },
      { string: 1, fret: 5 }, { string: 1, fret: 7 },
      { string: 2, fret: 5 }, { string: 2, fret: 7 },
      { string: 3, fret: 5 }, { string: 3, fret: 7 },
    ]);
  });

  test('moves the hand when a note leaves the window, and says where it ended', () => {
    const placed = placeLine([28, 52], 'bass', 0);
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;
    expect(placed.frets[1]).toEqual({ string: 3, fret: 9 });
    expect(placed.anchor).toBe(6);
  });

  test('names the first pitch that is off the neck', () => {
    expect(placeLine([33, 57], 'bass', 5)).toEqual({ ok: false, midi: 57 });
  });
});

test('sharpName and lowestMidiOf', () => {
  expect(sharpName(1)).toBe('C♯');
  expect(sharpName(10)).toBe('A♯');
  expect(lowestMidiOf(9, 'bass')).toBe(33);
  expect(lowestMidiOf(4, 'bass')).toBe(28);
  expect(lowestMidiOf(4, 'guitar')).toBe(40);
  expect(TUNINGS.guitar).toEqual([40, 45, 50, 55, 59, 64]);
});
```

`frontend/src/music/practice/random.test.ts`:

```ts
import { expect, test } from 'vitest';

import { rng } from './random';

test('the same seed gives the same sequence, in [0, 1)', () => {
  const a = rng(42);
  const b = rng(42);
  const xs = Array.from({ length: 50 }, () => a());
  expect(Array.from({ length: 50 }, () => b())).toEqual(xs);
  expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
  expect(rng(43)()).not.toBe(xs[0]);
});
```

`frontend/src/music/practice/chords.test.ts`:

```ts
import { describe, expect, test } from 'vitest';

import { parseChord } from '../chordTones';
import { progressionBars, toBtcLabel } from './chords';

describe('toBtcLabel', () => {
  test('writes chord symbols the way parseChord reads them', () => {
    expect(toBtcLabel('G')).toBe('G');
    expect(toBtcLabel('Em')).toBe('E:min');
    expect(toBtcLabel('F#m7')).toBe('Gb:min7');
    expect(toBtcLabel('Bbmaj7')).toBe('Bb:maj7');
    expect(toBtcLabel('Bm7b5')).toBe('B:hdim7');
    expect(toBtcLabel('Cb')).toBe('B');
    for (const s of ['G', 'Em', 'F#m7', 'Bbmaj7', 'Bm7b5', 'D7', 'Cdim']) {
      expect(parseChord(toBtcLabel(s), 0).kind).toBe('chord');
    }
  });

  test('refuses a quality it has no BTC name for', () => {
    expect(() => toBtcLabel('Csus4add9')).toThrow('no chord quality for "Csus4add9"');
  });
});

describe('progressionBars', () => {
  test('I–V–vi–IV in G, one bar each, every bar a change', () => {
    const { bars, mode, tonic } = progressionBars('pop', 7, 1);
    expect(mode).toBe('major');
    expect(tonic).toBe('G');
    expect(bars.map((b) => b.symbol)).toEqual(['G', 'D', 'Em', 'C']);
    expect(bars.every((b) => b.changes && !b.repeat)).toBe(true);
  });

  test('two bars per chord: the repeat is marked and only the last bar changes', () => {
    const { bars } = progressionBars('pop', 7, 2);
    expect(bars.map((b) => [b.symbol, b.repeat, b.changes])).toEqual([
      ['G', false, false], ['G', true, true],
      ['D', false, false], ['D', true, true],
      ['Em', false, false], ['Em', true, true],
      ['C', false, false], ['C', true, true],
    ]);
  });

  test('the 12-bar blues repeats its own chords, and the loop wraps into bar 1', () => {
    const { bars } = progressionBars('twelve-bar', 9, 1);
    expect(bars).toHaveLength(12);
    expect(bars[1]!.repeat).toBe(true);
    expect(bars[0]!.changes).toBe(false);
    expect(bars[3]!.changes).toBe(true);
    expect(bars[11]!.changes).toBe(true); // E7 -> A7 at the wrap
  });

  test('keys use the conventional root spelling', () => {
    expect(progressionBars('pop', 1, 1).tonic).toBe('Db');
    expect(progressionBars('minor-blues', 1, 1).tonic).toBe('C#');
  });
});
```

- [ ] **Step 3: Run them to see them fail**

Run: `npm --prefix frontend test -- --run src/music/practice`
Expected: FAIL, modules not found.

- [ ] **Step 4: Write `neck.ts`, `random.ts`, `chords.ts`**

`frontend/src/music/practice/neck.ts`:

```ts
// Where a practice line's notes sit on the neck (D-22). Standard tuning only,
// frets 0-12, string 0 = the lowest string, as in fingering.ts. A line keeps a
// hand window (one finger per fret plus a stretch, as positions.ts) and moves it
// only when a note is outside it, so scales stay in their box and arpeggios
// follow the hand from chord to chord. Deterministic.
import type { PracticeInstrument } from '../../api/client';
import { mod12 } from '../chordTones';
import { pretty } from '../spell';

export const TUNINGS: Record<PracticeInstrument, readonly number[]> = {
  bass: [28, 33, 38, 43],
  guitar: [40, 45, 50, 55, 59, 64],
};
export const STRING_NAMES: Record<PracticeInstrument, readonly string[]> = {
  bass: ['E', 'A', 'D', 'G'],
  guitar: ['E', 'A', 'D', 'G', 'B', 'e'],
};
/** Frets above the index finger the hand reaches: 4 frets on bass, 5 on guitar (positions.ts). */
export const HAND_SPAN: Record<PracticeInstrument, number> = { bass: 3, guitar: 4 };
export const PRACTICE_MAX_FRET = 12;

export interface Fretted {
  string: number;
  fret: number;
}

export function positionsOn(midi: number, inst: PracticeInstrument): Fretted[] {
  const out: Fretted[] = [];
  TUNINGS[inst].forEach((open, string) => {
    const fret = midi - open;
    if (fret >= 0 && fret <= PRACTICE_MAX_FRET) out.push({ string, fret });
  });
  return out;
}

export type PlacedLine = { ok: true; frets: Fretted[]; anchor: number } | { ok: false; midi: number };

/**
 * Frets for a line of pitches. `startAnchor` is the index finger's fret. An open
 * string always counts as in reach. Among notes in reach the lowest string wins;
 * with none in reach the nearest fret wins and the hand moves to it.
 */
export function placeLine(midis: readonly number[], inst: PracticeInstrument, startAnchor: number): PlacedLine {
  const span = HAND_SPAN[inst];
  const clampAnchor = (a: number) => Math.max(0, Math.min(PRACTICE_MAX_FRET - span, a));
  let anchor = clampAnchor(startAnchor);
  const frets: Fretted[] = [];
  for (const midi of midis) {
    const candidates = positionsOn(midi, inst);
    if (candidates.length === 0) return { ok: false, midi };
    const inReach = candidates.find((c) => c.fret === 0 || (c.fret >= anchor && c.fret <= anchor + span));
    if (inReach) {
      frets.push(inReach);
      continue;
    }
    const nearest = candidates.reduce((best, c) => (Math.abs(c.fret - anchor) < Math.abs(best.fret - anchor) ? c : best));
    frets.push(nearest);
    anchor = clampAnchor(nearest.fret > anchor + span ? nearest.fret - span : nearest.fret);
  }
  return { ok: true, frets, anchor };
}

const SHARPS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** Drills have no key, so they are named with sharps (the spelling rule, D-22). */
export function sharpName(pc: number): string {
  return pretty(SHARPS[mod12(pc)]!);
}

/** The lowest pitch of this pitch class on the instrument's lowest string. */
export function lowestMidiOf(pc: number, inst: PracticeInstrument): number {
  const low = TUNINGS[inst][0]!;
  return low + mod12(pc - low);
}
```

Check the test's second case by hand: `[28, 52]` from anchor 0. 28 is E0 (open, in reach). 52 is G9 (string 3), D14 (off) or A19 (off), so G9 is the only candidate. It is out of reach (0–3), so the hand moves to 9 − 3 = 6.

`frontend/src/music/practice/random.ts`:

```ts
// Seeded randomness for Regenerate (D-22): mulberry32. The seed is saved with the
// settings, so reopening the tab reproduces the loop you left.
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A fresh seed for Regenerate, within practice.py's 0..2^31-1. */
export function newSeed(): number {
  return Math.floor(Math.random() * 2 ** 31);
}
```

`frontend/src/music/practice/chords.ts`:

```ts
// A chosen progression as bars (D-22). progressions.ts spells chords as symbols
// ("F#m7"); parseChord reads BTC labels ("Gb:min7"), the format the bass and
// guitar sources were built on, so they are converted here once. The root goes
// through its pitch class, so an exotic spelling ("Cb") still parses; display
// keeps the symbol.
import type { BarsPerChord, ProgressionId } from '../../api/client';
import { PROGRESSIONS, progressionChords } from '../progressions';
import { pcOf, rootName, type KeyMode } from '../spell';

const QUALITY: Record<string, string> = {
  '': 'maj',
  m: 'min',
  dim: 'dim',
  aug: 'aug',
  '7': '7',
  m7: 'min7',
  maj7: 'maj7',
  m7b5: 'hdim7',
  dim7: 'dim7',
  mMaj7: 'minmaj7',
  '6': 'maj6',
  m6: 'min6',
  sus2: 'sus2',
  sus4: 'sus4',
};
const BTC_ROOT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

export function toBtcLabel(symbol: string): string {
  const m = /^([A-G](?:##|bb|#|b)?)(.*)$/.exec(symbol);
  const quality = m ? QUALITY[m[2]!] : undefined;
  const pc = m ? pcOf(m[1]!) : null;
  if (!m || quality === undefined || pc === null) throw new Error(`no chord quality for "${symbol}"`);
  const root = BTC_ROOT[pc]!;
  return quality === 'maj' ? root : `${root}:${quality}`;
}

export interface ChordBar {
  /** As progressions.ts spells it: "F#m7". */
  symbol: string;
  /** For parseChord, planBar and guitarBars: "Gb:min7". */
  label: string;
  /** The same chord as the bar before (drawn "%"). */
  repeat: boolean;
  /** The next bar (the first, at the end) is a different chord: only then is there an approach into it. */
  changes: boolean;
}

export function progressionBars(
  id: ProgressionId,
  keyPc: number,
  barsPerChord: BarsPerChord,
): { bars: ChordBar[]; mode: KeyMode; tonic: string } {
  const def = PROGRESSIONS.find((p) => p.id === id)!;
  const tonic = rootName(keyPc, def.mode);
  const symbols = progressionChords(def, tonic).flatMap((s) => new Array<string>(barsPerChord).fill(s));
  const n = symbols.length;
  const bars = symbols.map((symbol, i) => ({
    symbol,
    label: toBtcLabel(symbol),
    repeat: i > 0 && symbols[i - 1] === symbol,
    changes: symbols[(i + 1) % n] !== symbol,
  }));
  return { bars, mode: def.mode, tonic };
}
```

- [ ] **Step 5: Run the tests**

Run: `npm --prefix frontend test -- --run src/music/practice`
Expected: all pass. If `toBtcLabel('Cb')` gives a different root, check `pcOf` (tonal `Note.chroma('Cb')` is 11, so `'B'`).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/music/practice
git commit -m "feat(practice): loop types, neck placement, seeded random, progression bars (D-22)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Extract `guitarBars()` from `guitarSource`

A pure refactor: the guitar groove needs D-20's per-label pipeline without a `Song` or an `Analysis`.

**Files:**
- Modify: `frontend/src/music/guitarSource.ts` (the `guitarSource` object near line 158)
- Test: `frontend/src/music/guitarSource.test.ts` (add one test; existing tests must pass unchanged)

**Interfaces:**
- Produces: `guitarBars(labels: readonly string[], key: ResolvedKey, settings: PlayAlongGuitar, beatsPerBar: number, transpose: number, nextOf: (bar: number) => number | null): GuitarBar[]`

- [ ] **Step 1: Write the failing test** (append to `guitarSource.test.ts`)

```ts
import { guitarBars } from './guitarSource';

test('guitarBars runs the D-20 pipeline over bare labels', () => {
  const key = { tonicPc: 7, mode: 'major' as const };
  const bars = guitarBars(
    ['G', 'D', 'E:min', 'C'],
    key,
    { style: 'open', strum: 'folk', position: 'auto', simplify: false },
    4,
    0,
    (bar) => (bar + 1) % 4,
  );
  expect(bars.map((b) => b.chord)).toEqual(['G', 'D', 'Em', 'C']);
  expect(bars.every((b) => b.shape !== null && b.strokes.length === 6)).toBe(true);
});
```

(Merge the import into the file's existing import from `./guitarSource`. `tonesText` writes `min` as `m`, so `E:min` reads `Em`.)

- [ ] **Step 2: Run it to see it fail**

Run: `npm --prefix frontend test -- --run src/music/guitarSource.test.ts`
Expected: FAIL, `guitarBars` is not exported.

- [ ] **Step 3: Extract the function**

Replace the body of `guitarSource.barsFor` from `const drafts = …` to the end of the "pushed into" loop with a call to this new exported function, placed just above `export const guitarSource`:

```ts
/** D-20's pipeline over bare chord labels: draft each bar, choose shapes, add strums and pushes. */
export function guitarBars(
  labels: readonly string[],
  key: ResolvedKey,
  settings: PlayAlongGuitar,
  beatsPerBar: number,
  transpose: number,
  nextOf: (bar: number) => number | null,
): GuitarBar[] {
  const drafts = labels.map((label, bar) => draftBar(bar, label, key, settings, transpose));
  const chosen = chooseShapes(drafts);

  const bars: GuitarBar[] = drafts.map((d, index) => {
    const shape = chosen[index] ?? null;
    const substitutions = [...d.substitutions];
    if (shape && d.missedWindow) substitutions.push(`no ${d.missedWindow}-position ${d.chord}, fret ${shape.anchor}`);
    let strokes = shape ? strumStrokes(settings.strum, beatsPerBar) : [];
    let pushChord: string | null = null;
    const early = strokes.findIndex((s) => s.early);
    if (early >= 0) {
      const target = nextOf(index);
      if (target !== null && chosen[target]) {
        pushChord = drafts[target]!.chord;
      } else {
        strokes = strokes.map((s) => ({ ...s, early: false }));
        substitutions.push(target === null ? 'no push past the last bar' : 'no push into an empty bar');
      }
    }
    return {
      bar: d.bar,
      label: d.label,
      empty: d.empty,
      reason: d.reason,
      heard: d.heard,
      chord: d.chord,
      shape,
      degrees: shape && d.tones ? degreesOf(shape, d.tones) : [],
      strokes,
      pushChord,
      substitutions,
    };
  });

  // A bar pushed into has its downbeat tied over from the push.
  bars.forEach((b, index) => {
    if (b.pushChord === null) return;
    const target = nextOf(index)!;
    bars[target] = { ...bars[target]!, strokes: withoutDownbeat(bars[target]!.strokes) };
  });
  return bars;
}

export const guitarSource: TabSource<GuitarBar> = {
  barsFor({ song, analysis, grid, loop }) {
    const transpose = song.playback.pitch_semitones;
    const key = resolveKey(song.play_along.key, analysis.key_candidates, transpose);
    if (!key) {
      return { ok: false, error: 'The analysis found no key candidates, so there is no key to spell the chords in.' };
    }
    const labels = chordLabels(analysis);
    const nextOf = nextBarOf(labels.length, loop);
    return { ok: true, key, bars: guitarBars(labels, key, song.play_along.guitar, grid.beatsPerBar, transpose, nextOf), nextOf };
  },
};
```

- [ ] **Step 4: Run all guitar tests**

Run: `npm --prefix frontend test -- --run src/music/guitarSource.test.ts src/screens/PlayAlong.test.tsx`
Expected: all pass, including every existing test unchanged.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/music/guitarSource.ts frontend/src/music/guitarSource.test.ts
git commit -m "refactor(tabs): guitarBars, D-20's pipeline over bare labels

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Groove generator (bass pattern, guitar strum, backing bass)

**Files:**
- Create: `frontend/src/music/practice/groove.ts`
- Test: `frontend/src/music/practice/groove.test.ts`

**Interfaces:**
- Consumes: `planBar`, `spell`, `ResolvedKey` (`patterns.ts`); `placeBars`, `positionsOf`, `PlacedBar` (`fingering.ts`); `guitarBars`, `guitarEmptyText`, `GuitarBar` (`guitarSource.ts`); `GUITAR_OPEN` (`guitarShapes.ts`); `parseChord`, `mod12` (`chordTones.ts`); `scaleSemitones` (`theory.ts`); `pretty` (`spell.ts`); Task 3's `progressionBars`, `rng`, `lowestMidiOf`, `loopOf`, types.
- Produces: `bassGroove(settings: InstrumentSettings): GenerateResult`, `guitarGroove(settings: InstrumentSettings): GenerateResult`.

- [ ] **Step 1: Write the failing tests**

`frontend/src/music/practice/groove.test.ts`:

```ts
import { describe, expect, test } from 'vitest';

import { DEFAULT_INSTRUMENT_SETTINGS, type InstrumentSettings } from '../../api/client';
import { bassGroove, guitarGroove } from './groove';

const withGroove = (patch: Partial<InstrumentSettings['groove']>, rest: Partial<InstrumentSettings> = {}): InstrumentSettings => ({
  ...DEFAULT_INSTRUMENT_SETTINGS,
  ...rest,
  groove: { ...DEFAULT_INSTRUMENT_SETTINGS.groove, ...patch },
});

function loopOrThrow(r: ReturnType<typeof bassGroove>) {
  if (!r.ok) throw new Error(r.error);
  return r.loop;
}

describe('bassGroove', () => {
  test('I–V–vi–IV in G, 1–5–8 in quarters with a chromatic approach before every change', () => {
    const loop = loopOrThrow(bassGroove(withGroove({})));
    expect(loop.bars.map((b) => b.label)).toEqual(['G', 'D', 'Em', 'C']);
    expect(loop.notes).toHaveLength(16);
    const approaches = loop.notes.filter((n) => n.kind === 'approach');
    expect(approaches.map((n) => n.start)).toEqual([3, 7, 11, 15]);
    expect(loop.notes[0]).toMatchObject({ start: 0, dur: 1, midi: 31, name: 'G', string: 0, fret: 3 });
  });

  test('with two bars per chord the approach comes only before a chord change', () => {
    const loop = loopOrThrow(bassGroove(withGroove({ bars_per_chord: 2 })));
    expect(loop.bars).toHaveLength(8);
    expect(loop.bars.map((b) => b.repeat)).toEqual([false, true, false, true, false, true, false, true]);
    expect(loop.notes.filter((n) => n.kind === 'approach').map((n) => n.start)).toEqual([7, 15, 23, 31]);
  });

  test('the same seed gives the same loop; seeds only ever change approach notes', () => {
    const a = loopOrThrow(bassGroove(withGroove({}, { seed: 7 })));
    expect(loopOrThrow(bassGroove(withGroove({}, { seed: 7 })))).toEqual(a);
    const outcomes = new Set<string>();
    for (let seed = 1; seed <= 12; seed++) {
      const loop = loopOrThrow(bassGroove(withGroove({}, { seed })));
      expect(loop.notes.filter((n) => n.kind === 'tone')).toEqual(a.notes.filter((n) => n.kind === 'tone'));
      outcomes.add(loop.notes.filter((n) => n.kind === 'approach').map((n) => n.midi).join(','));
    }
    expect(outcomes.size).toBeGreaterThan(1);
  });

  test('no approach: every note is a chord tone', () => {
    const loop = loopOrThrow(bassGroove(withGroove({ approach: 'none' })));
    expect(loop.notes.every((n) => n.kind === 'tone')).toBe(true);
  });

  test('every note is on the neck', () => {
    for (const progression of ['pop', 'twelve-bar', 'minor-two-five-one', 'canon'] as const) {
      for (let key = 0; key < 12; key++) {
        const loop = loopOrThrow(bassGroove(withGroove({ progression, rhythm: 'eighth' }, { key })));
        expect(loop.notes.every((n) => n.fret >= 0 && n.fret <= 12 && n.string >= 0 && n.string < 4)).toBe(true);
      }
    }
  });
});

describe('guitarGroove', () => {
  test('folk strum over open shapes: each strum is one group of strings, with a direction', () => {
    const loop = loopOrThrow(guitarGroove(withGroove({})));
    expect(loop.strings).toBe(6);
    expect(loop.guitarBars).toHaveLength(4);
    const firstStrum = loop.notes.filter((n) => n.group === 0);
    expect(firstStrum.map((n) => n.string)).toEqual([0, 1, 2, 3, 4, 5]); // G: 320003
    expect(firstStrum.every((n) => n.stroke === 'down' && n.start === 0)).toBe(true);
    const groups = new Set(loop.notes.map((n) => n.group));
    expect(groups.size).toBe(24); // 6 strokes × 4 bars
  });

  test('a backing bass plays root and fifth in quarters under every bar', () => {
    const loop = loopOrThrow(guitarGroove(withGroove({})));
    expect(loop.backing).toHaveLength(16);
    expect(loop.backing.slice(0, 4).map((n) => n.midi)).toEqual([31, 38, 31, 38]); // G1 D2
  });

  test('a strum rings until the next one', () => {
    const loop = loopOrThrow(guitarGroove(withGroove({ strum: 'quarters' })));
    expect(loop.notes.filter((n) => n.group === 0).every((n) => n.dur === 1)).toBe(true);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npm --prefix frontend test -- --run src/music/practice/groove.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write `groove.ts`**

```ts
// Groove over chords (D-22): a chosen progression in a key, played with Play
// along's own generators. Bass: planBar + placeBars (D-18), with the approach
// only before a real chord change. planBar alone puts one before every bar
// followed by a chord, which is right for a song's chart but not for 2 or 4 bars
// of one chord, so nextLabel is null where the next bar is the same chord.
// Guitar: D-20's guitarBars, plus a backing bass on the roots.
import type { InstrumentSettings } from '../../api/client';
import { mod12, parseChord } from '../chordTones';
import { positionsOf, placeBars, type PlacedBar } from '../fingering';
import { guitarBars, guitarEmptyText } from '../guitarSource';
import { GUITAR_OPEN } from '../guitarShapes';
import { planBar, spell, type ResolvedKey } from '../patterns';
import { pretty } from '../spell';
import { scaleSemitones } from '../theory';
import { progressionBars, type ChordBar } from './chords';
import { lowestMidiOf } from './neck';
import { rng } from './random';
import { BEATS_PER_BAR, loopOf, type GenerateResult, type PracticeBar, type PracticeNote, type SynthNote } from './types';

function chordRow(bars: readonly ChordBar[], notes: (string | null)[] = []): PracticeBar[] {
  return bars.map((b, i) => ({ label: pretty(b.symbol), repeat: b.repeat, note: notes[i] ?? null }));
}

/**
 * Regenerate's choice in a groove: each approach note comes from below (as
 * placeBars wrote it) or from above, a coin per approach from the seed. The
 * coin is drawn for every approach, so one choice never shifts the others.
 */
function varyApproaches(
  bars: PlacedBar[],
  key: ResolvedKey,
  kind: 'chromatic' | 'scale' | 'fifth',
  random: () => number,
  nextOf: (bar: number) => number,
): PlacedBar[] {
  const inScale = new Set(scaleSemitones(key.mode, false).map((s) => mod12(key.tonicPc + s)));
  return bars.map((bar, i) => ({
    ...bar,
    notes: bar.notes.map((note) => {
      if (!note.approach) return note;
      const fromAbove = random() < 0.5;
      const target = bars[nextOf(i)]!.bassMidi;
      if (!fromAbove || target === null) return note;
      let midi = kind === 'chromatic' ? target + 1 : kind === 'fifth' ? target + 7 : target + 1;
      if (kind === 'scale') while (!inScale.has(mod12(midi))) midi++;
      const candidates = positionsOf(midi);
      if (candidates.length === 0) return note;
      const anchor = bar.anchor ?? note.position.fret;
      const position = candidates.reduce((a, b) => (Math.abs(b.fret - anchor) < Math.abs(a.fret - anchor) ? b : a));
      return { ...note, midi, name: spell(mod12(midi), key), position };
    }),
  }));
}

export function bassGroove(settings: InstrumentSettings): GenerateResult {
  const g = settings.groove;
  const { bars, mode } = progressionBars(g.progression, settings.key, g.bars_per_chord);
  const key: ResolvedKey = { tonicPc: settings.key, mode };
  const n = bars.length;
  const nextOf = (bar: number) => (bar + 1) % n;
  const pattern = { notes: g.notes, rhythm: g.rhythm, approach: g.approach };
  const plans = bars.map((b, i) =>
    planBar({
      bar: i,
      label: b.label,
      nextLabel: b.changes ? bars[nextOf(i)]!.label : null,
      key,
      pattern,
      beatsPerBar: BEATS_PER_BAR,
      transpose: 0,
    }),
  );
  let placed: PlacedBar[];
  try {
    placed = placeBars(plans, { approach: g.approach, key, nextOf });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error), fixes: [] };
  }
  if (g.approach !== 'none') placed = varyApproaches(placed, key, g.approach, rng(settings.seed), nextOf);

  let group = 0;
  const notes: PracticeNote[] = placed.flatMap((bar, i) =>
    bar.notes.map((note) => ({
      start: i * BEATS_PER_BAR + note.beat,
      dur: note.beats,
      string: note.position.string,
      fret: note.position.fret,
      midi: note.midi,
      name: note.name,
      kind: note.approach ? ('approach' as const) : ('tone' as const),
      group: group++,
      finger: null,
      stroke: null,
    })),
  );
  return { ok: true, loop: loopOf('bass', chordRow(bars, plans.map((p) => p.substitution)), notes) };
}

export function guitarGroove(settings: InstrumentSettings): GenerateResult {
  const g = settings.groove;
  const { bars, mode } = progressionBars(g.progression, settings.key, g.bars_per_chord);
  const key: ResolvedKey = { tonicPc: settings.key, mode };
  const n = bars.length;
  const nextOf = (bar: number) => (bar + 1) % n;
  const shaped = guitarBars(
    bars.map((b) => b.label),
    key,
    { style: g.style, strum: g.strum, position: g.position, simplify: false },
    BEATS_PER_BAR,
    0,
    nextOf,
  );
  const empty = shaped.find((b) => b.shape === null);
  if (empty) {
    return {
      ok: false,
      error: `Bar ${empty.bar + 1}: ${guitarEmptyText(empty)}.`,
      fixes:
        g.style === 'barre'
          ? []
          : [{ label: 'Use barre shapes', apply: (s) => ({ ...s, groove: { ...s.groove, style: 'barre' } }) }],
    };
  }

  let group = 0;
  const notes: PracticeNote[] = [];
  shaped.forEach((bar, i) => {
    bar.strokes.forEach((stroke, k) => {
      const end = bar.strokes[k + 1]?.beat ?? BEATS_PER_BAR;
      const source = stroke.early ? shaped[nextOf(i)]! : bar;
      source.shape!.frets.forEach((fret, row) => {
        if (fret === null) return;
        const midi = GUITAR_OPEN[row]! + fret;
        notes.push({
          start: i * BEATS_PER_BAR + stroke.beat,
          dur: end - stroke.beat,
          string: 5 - row,
          fret,
          midi,
          name: spell(mod12(midi), key),
          kind: 'tone',
          group,
          finger: null,
          stroke: stroke.dir,
        });
      });
      group++;
    });
  });

  const backing: SynthNote[] = bars.flatMap((b, i) => {
    const parsed = parseChord(b.label, 0);
    if (parsed.kind !== 'chord') return [];
    const root = lowestMidiOf(parsed.tones.bassPc, 'bass');
    return [root, root + 7, root, root + 7].map((midi, beat) => ({ start: i * BEATS_PER_BAR + beat, dur: 1, midi }));
  });

  const row = chordRow(bars, shaped.map((b) => (b.substitutions.length > 0 ? b.substitutions.join('; ') : null)));
  return { ok: true, loop: loopOf('guitar', row, notes, { guitarBars: shaped, backing }) };
}
```

Check the backing test by hand: G's `bassPc` is 7, so `lowestMidiOf(7, 'bass')` = 28 + mod12(7 − 28) = 28 + 3 = 31 (G1), and the fifth is 38 (D2).

- [ ] **Step 4: Run the tests**

Run: `npm --prefix frontend test -- --run src/music/practice/groove.test.ts`
Expected: all pass. (MIDI 31 can only be E-string fret 3: the A string starts at 33, so the first-note assertion does not depend on the Viterbi's choice.)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/music/practice/groove.ts frontend/src/music/practice/groove.test.ts
git commit -m "feat(practice): groove over chords, bass pattern and guitar strum (D-22)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Scale generator

**Files:**
- Create: `frontend/src/music/practice/scale.ts`
- Test: `frontend/src/music/practice/scale.test.ts`

**Interfaces:**
- Consumes: `scaleDef`, `scaleNotes`, `rootName`, `pretty` (`spell.ts`); `mod12`; Task 3's `TUNINGS`, `HAND_SPAN`, `STRING_NAMES`, `PRACTICE_MAX_FRET`, `placeLine`, `loopOf`, `RHYTHM_STEP`, types.
- Produces: `scaleLine(settings, instrument): GenerateResult`, `pathOrder(n, path): number[]`, and `timed(count, step)` → `{ starts: number[]; durs: number[]; barCount: number }` (Task 8 reuses `timed`).

- [ ] **Step 1: Write the failing tests**

`frontend/src/music/practice/scale.test.ts`:

```ts
import { describe, expect, test } from 'vitest';

import { DEFAULT_INSTRUMENT_SETTINGS, type InstrumentSettings } from '../../api/client';
import { pathOrder, scaleLine, timed } from './scale';

const withScale = (patch: Partial<InstrumentSettings['scale']>, rest: Partial<InstrumentSettings> = {}): InstrumentSettings => ({
  ...DEFAULT_INSTRUMENT_SETTINGS,
  key: 9,
  ...rest,
  scale: { ...DEFAULT_INSTRUMENT_SETTINGS.scale, ...patch },
});

describe('pathOrder', () => {
  test('up and down plays the top once and leaves the root to the wrap', () => {
    expect(pathOrder(4, 'up_down')).toEqual([0, 1, 2, 3, 2, 1]);
    expect(pathOrder(4, 'down')).toEqual([3, 2, 1, 0]);
  });
  test('sequences climb then descend', () => {
    expect(pathOrder(4, 'thirds')).toEqual([0, 2, 1, 3, 3, 1, 2, 0]);
    expect(pathOrder(4, 'groups3')).toEqual([0, 1, 2, 1, 2, 3, 3, 2, 1, 2, 1, 0]);
  });
});

test('timed rounds up to whole bars and holds the last note to the bar line', () => {
  expect(timed(14, 0.5)).toEqual({
    starts: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5],
    durs: [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 1.5],
    barCount: 2,
  });
});

describe('scaleLine', () => {
  test('A minor pentatonic, fifth-fret box, up and down in eighths', () => {
    const r = scaleLine(withScale({}), 'bass');
    if (!r.ok) throw new Error(r.error);
    expect(r.loop.notes.map((n) => n.name)).toEqual(['A', 'C', 'D', 'E', 'G', 'A', 'C', 'D', 'C', 'A', 'G', 'E', 'D', 'C']);
    expect(r.loop.notes.slice(0, 2).map((n) => [n.string, n.fret])).toEqual([[0, 5], [0, 8]]);
    expect(r.loop.bars.map((b) => b.label)).toEqual(['A Minor pentatonic', '']);
  });

  test('flat keys spell with flats', () => {
    const r = scaleLine(withScale({ scale: 'major', from_fret: 1 }, { key: 5 }), 'bass');
    if (!r.ok) throw new Error(r.error);
    expect(r.loop.notes.map((n) => n.name)).toContain('B♭');
  });

  test('six strings on guitar', () => {
    const r = scaleLine(withScale({}), 'guitar');
    if (!r.ok) throw new Error(r.error);
    expect(new Set(r.loop.notes.map((n) => n.string)).size).toBe(6);
  });

  test('two octaves that run off the neck fail with the note, the fret and the fixes', () => {
    const r = scaleLine(withScale({ scale: 'blues', shape: 'two_octaves', from_fret: 9 }, { key: 2 }), 'bass');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('Two octaves of D Blues do not fit from fret 9: the top D needs fret 19 on the G string; the neck stops at 12.');
    expect(r.fixes.map((f) => f.label)).toEqual(['Start from fret 0', 'One position']);
    expect(r.fixes[1]!.apply(withScale({ shape: 'two_octaves' })).scale.shape).toBe('position');
  });

  test('a box past the 12th fret is refused with a fix', () => {
    const r = scaleLine(withScale({ from_fret: 11 }), 'bass');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('Frets 11–14 run past the 12th fret.');
    expect(r.fixes[0]!.apply(withScale({ from_fret: 11 })).scale.from_fret).toBe(9);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npm --prefix frontend test -- --run src/music/practice/scale.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write `scale.ts`**

```ts
// Scales & modes (D-22): one position (every scale note in a hand window from a
// fret) or two octaves from the root across the neck, walked by a path, in a
// rhythm. Spelled for the key by tonal (spell.ts scaleNotes). A shape that runs
// off the neck is an error with fixes, never squeezed into another (N-08).
import type { InstrumentSettings, PracticeInstrument, PracticeScale } from '../../api/client';
import { mod12 } from '../chordTones';
import { pretty, rootName, scaleDef, scaleNotes } from '../spell';
import { HAND_SPAN, placeLine, PRACTICE_MAX_FRET, STRING_NAMES, TUNINGS, type Fretted } from './neck';
import { BEATS_PER_BAR, loopOf, RHYTHM_STEP, type Fix, type GenerateResult, type PracticeNote } from './types';

/** `line` walked in overlapping groups: [0,2] gives thirds, [0,1,2] groups of three. */
function sequence(line: readonly number[], offsets: readonly number[]): number[] {
  const reach = Math.max(...offsets);
  const out: number[] = [];
  for (let i = 0; i + reach < line.length; i++) out.push(...offsets.map((o) => line[i + o]!));
  return out;
}

export function pathOrder(n: number, path: PracticeScale['path']): number[] {
  const up = [...Array(n).keys()];
  const down = [...up].reverse();
  switch (path) {
    case 'up':
      return up;
    case 'down':
      return down;
    case 'up_down':
      // The top once, and not the root again: the loop's wrap plays it.
      return [...up, ...down.slice(1, -1)];
    case 'thirds':
      return [...sequence(up, [0, 2]), ...sequence(down, [0, 2])];
    case 'groups3':
      return [...sequence(up, [0, 1, 2]), ...sequence(down, [0, 1, 2])];
    case 'groups4':
      return [...sequence(up, [0, 1, 2, 3]), ...sequence(down, [0, 1, 2, 3])];
  }
}

/** Onsets for `count` notes `step` beats apart, in whole bars; the last note rings to the bar line. */
export function timed(count: number, step: number): { starts: number[]; durs: number[]; barCount: number } {
  const starts = Array.from({ length: count }, (_, i) => i * step);
  const barCount = Math.max(1, Math.ceil((count * step) / BEATS_PER_BAR - 1e-9));
  const durs = starts.map((s, i) => (i === count - 1 ? barCount * BEATS_PER_BAR - s : step));
  return { starts, durs, barCount };
}

export function scaleLine(settings: InstrumentSettings, inst: PracticeInstrument): GenerateResult {
  const sc = settings.scale;
  const def = scaleDef(sc.scale);
  const tonic = rootName(settings.key, def.mode);
  const spelled = scaleNotes(tonic, sc.scale);
  const pcs = new Set(spelled.map((n) => n.pc));
  const nameOf = (midi: number) => pretty(spelled.find((n) => n.pc === mod12(midi))?.name ?? '?');
  const tuning = TUNINGS[inst];
  const span = HAND_SPAN[inst];
  const title = `${pretty(tonic)} ${def.label}`;

  let line: (Fretted & { midi: number })[];
  if (sc.shape === 'position') {
    const lo = sc.from_fret;
    const hi = lo + span;
    if (hi > PRACTICE_MAX_FRET) {
      const fix: Fix = {
        label: `Start from fret ${PRACTICE_MAX_FRET - span}`,
        apply: (s) => ({ ...s, scale: { ...s.scale, from_fret: PRACTICE_MAX_FRET - span } }),
      };
      return { ok: false, error: `Frets ${lo}–${hi} run past the 12th fret.`, fixes: [fix] };
    }
    const cells: (Fretted & { midi: number })[] = [];
    tuning.forEach((open, string) => {
      for (let fret = lo; fret <= hi; fret++) if (pcs.has(mod12(open + fret))) cells.push({ string, fret, midi: open + fret });
    });
    cells.sort((a, b) => a.midi - b.midi);
    line = cells.filter((c, i) => i === 0 || c.midi !== cells[i - 1]!.midi);
  } else {
    const rootFret = sc.from_fret + mod12(settings.key - (tuning[0]! + sc.from_fret));
    const rootMidi = tuning[0]! + rootFret;
    const midis: number[] = [];
    for (let m = rootMidi; m <= rootMidi + 24; m++) if (pcs.has(mod12(m))) midis.push(m);
    const placed = rootFret <= PRACTICE_MAX_FRET ? placeLine(midis, inst, sc.from_fret) : { ok: false as const, midi: rootMidi };
    if (!placed.ok) {
      // Name the top note, not the first one off the neck: "the top D needs fret 19" says
      // how far over the shape is (the States mockup).
      const top = tuning.length - 1;
      const topMidi = midis.at(-1)!;
      const fixes: Fix[] = [];
      if (sc.from_fret > 0) fixes.push({ label: 'Start from fret 0', apply: (s) => ({ ...s, scale: { ...s.scale, from_fret: 0 } }) });
      fixes.push({ label: 'One position', apply: (s) => ({ ...s, scale: { ...s.scale, shape: 'position' } }) });
      return {
        ok: false,
        error:
          `Two octaves of ${title} do not fit from fret ${sc.from_fret}: the top ${nameOf(topMidi)} needs fret ` +
          `${topMidi - tuning[top]!} on the ${STRING_NAMES[inst][top]} string; the neck stops at 12.`,
        fixes,
      };
    }
    line = placed.frets.map((f, i) => ({ ...f, midi: midis[i]! }));
  }
  if (line.length < 2) {
    return { ok: false, error: `${title} has fewer than two notes in frets ${sc.from_fret}–${sc.from_fret + span}.`, fixes: [] };
  }

  const order = pathOrder(line.length, sc.path);
  const { starts, durs, barCount } = timed(order.length, RHYTHM_STEP[sc.rhythm]);
  const notes: PracticeNote[] = order.map((index, i) => {
    const cell = line[index]!;
    return {
      start: starts[i]!,
      dur: durs[i]!,
      string: cell.string,
      fret: cell.fret,
      midi: cell.midi,
      name: nameOf(cell.midi),
      kind: 'tone',
      group: i,
      finger: null,
      stroke: null,
    };
  });
  const bars = Array.from({ length: barCount }, (_, i) => ({ label: i === 0 ? title : '', repeat: false, note: null }));
  return { ok: true, loop: loopOf(inst, bars, notes) };
}
```

Check the two-octave error by hand: D blues from fret 9. `rootFret` = 9 + mod12(2 − 37) = 10, so the root is D on E10, MIDI 38, and the top is D at 62. G♯ (56) is the first pitch off the neck, so `placeLine` fails. The message names the top note: 62 − 43 = fret 19 on the G string.

- [ ] **Step 4: Run the tests**

Run: `npm --prefix frontend test -- --run src/music/practice/scale.test.ts`
Expected: all pass. The "A Minor pentatonic" label uses `def.label` as `spell.ts` writes it ("Minor pentatonic").

- [ ] **Step 5: Commit**

```bash
git add frontend/src/music/practice/scale.ts frontend/src/music/practice/scale.test.ts
git commit -m "feat(practice): scales in one position or two octaves, with paths (D-22)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Arpeggio generator

**Files:**
- Create: `frontend/src/music/practice/arpeggio.ts`
- Test: `frontend/src/music/practice/arpeggio.test.ts`

**Interfaces:**
- Consumes: `parseChord`, `mod12`; `spell`, `ResolvedKey` (`patterns.ts`); `rootName`, `pretty`, `KeyMode`; Task 3's `progressionBars`, `toBtcLabel`, `lowestMidiOf`, `placeLine`, `TUNINGS`, `RHYTHM_STEP`, `loopOf`, types.
- Produces: `arpeggioLine(settings, instrument): GenerateResult`, `arpeggioPath(tones: number[], path): number[]`.

- [ ] **Step 1: Write the failing tests**

`frontend/src/music/practice/arpeggio.test.ts`:

```ts
import { describe, expect, test } from 'vitest';

import { DEFAULT_INSTRUMENT_SETTINGS, type InstrumentSettings } from '../../api/client';
import { arpeggioLine, arpeggioPath } from './arpeggio';

const withArp = (patch: Partial<InstrumentSettings['arpeggio']>, rest: Partial<InstrumentSettings> = {}): InstrumentSettings => ({
  ...DEFAULT_INSTRUMENT_SETTINGS,
  key: 0,
  ...rest,
  arpeggio: { ...DEFAULT_INSTRUMENT_SETTINGS.arpeggio, ...patch },
});

test('arpeggioPath', () => {
  expect(arpeggioPath([0, 4, 7, 11], 'up')).toEqual([0, 4, 7, 11]);
  expect(arpeggioPath([0, 4, 7, 11], 'up_down')).toEqual([0, 4, 7, 11, 7, 4]);
  expect(arpeggioPath([0, 4, 7], 'inversions')).toEqual([0, 4, 7, 4, 7, 12, 7, 12, 16]);
});

describe('arpeggioLine', () => {
  test('ii–V–I in C as 7ths, root up, one bar each', () => {
    const r = arpeggioLine(withArp({}), 'bass');
    if (!r.ok) throw new Error(r.error);
    expect(r.loop.bars.map((b) => b.label)).toEqual(['Dm7', 'G7', 'Cmaj7']);
    expect(r.loop.notes.map((n) => n.name)).toEqual(['D', 'F', 'A', 'C', 'G', 'B', 'D', 'F', 'C', 'E', 'G', 'B']);
  });

  test('the path cycles to fill each chord’s bars', () => {
    const r = arpeggioLine(withArp({ bars_per_chord: 2, rhythm: 'eighth', path: 'up_down' }), 'bass');
    if (!r.ok) throw new Error(r.error);
    expect(r.loop.bars).toHaveLength(6);
    expect(r.loop.notes).toHaveLength(6 * 8);
    expect(r.loop.notes.slice(0, 8).map((n) => n.name)).toEqual(['D', 'F', 'A', 'C', 'A', 'F', 'D', 'F']);
  });

  test('one chord: the key’s root with the chosen quality', () => {
    const r = arpeggioLine(withArp({ over: 'chord', quality: 'min7', tones: 'seventh' }, { key: 9 }), 'guitar');
    if (!r.ok) throw new Error(r.error);
    expect(r.loop.bars.map((b) => b.label)).toEqual(['Am7']);
    expect(r.loop.notes.slice(0, 4).map((n) => n.name)).toEqual(['A', 'C', 'E', 'G']);
  });

  test('a 7th asked of a triad plays the octave instead, and says so', () => {
    const r = arpeggioLine(withArp({ progression: 'pop' }, { key: 7 }), 'bass');
    if (!r.ok) throw new Error(r.error);
    expect(r.loop.bars[0]!.note).toBe('G has no 7th: root, 3rd, 5th, octave');
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npm --prefix frontend test -- --run src/music/practice/arpeggio.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write `arpeggio.ts`**

```ts
// Arpeggios (D-22): each chord's tones (triad or 7th) walked by a path from its
// lowest root, cycling to fill the chord's bars at the rhythm's step. The hand
// is carried from chord to chord (placeLine's anchor), so a progression moves
// the hand as little as it can.
import type { InstrumentSettings, PracticeArpeggio, PracticeInstrument } from '../../api/client';
import { mod12, parseChord } from '../chordTones';
import { spell, type ResolvedKey } from '../patterns';
import { pretty, rootName, type KeyMode } from '../spell';
import { progressionBars, toBtcLabel, type ChordBar } from './chords';
import { lowestMidiOf, placeLine, TUNINGS } from './neck';
import { BEATS_PER_BAR, loopOf, RHYTHM_STEP, type GenerateResult, type PracticeNote } from './types';

const SUFFIX: Record<PracticeArpeggio['quality'], string> = {
  maj: '',
  min: 'm',
  '7': '7',
  maj7: 'maj7',
  min7: 'm7',
  dim: 'dim',
  hdim7: 'm7b5',
};
const MINOR_QUALITIES = new Set<PracticeArpeggio['quality']>(['min', 'min7', 'dim', 'hdim7']);

/** Semitones above the root, in playing order. `tones` excludes the octave. */
export function arpeggioPath(tones: readonly number[], path: PracticeArpeggio['path']): number[] {
  const up = [...tones];
  switch (path) {
    case 'up':
      return up;
    case 'down':
      return [...up].reverse();
    case 'up_down':
      return [...up, ...[...up].reverse().slice(1, -1)];
    case 'inversions':
      // Each inversion of the chord, ascending: R35, 358, 5 8 10 for a triad.
      return tones.flatMap((_, r) => tones.map((_, i) => tones[(r + i) % tones.length]! + (r + i >= tones.length ? 12 : 0)));
  }
}

export function arpeggioLine(settings: InstrumentSettings, inst: PracticeInstrument): GenerateResult {
  const a = settings.arpeggio;
  let chordBars: ChordBar[];
  let mode: KeyMode;
  if (a.over === 'progression') {
    ({ bars: chordBars, mode } = progressionBars(a.progression, settings.key, a.bars_per_chord));
  } else {
    mode = MINOR_QUALITIES.has(a.quality) ? 'minor' : 'major';
    const symbol = `${rootName(settings.key, mode)}${SUFFIX[a.quality]}`;
    chordBars = Array.from({ length: a.bars_per_chord }, (_, i) => ({
      symbol,
      label: toBtcLabel(symbol),
      repeat: i > 0,
      changes: false,
    }));
  }
  const key: ResolvedKey = { tonicPc: settings.key, mode };
  const step = RHYTHM_STEP[a.rhythm];
  const perBar = Math.round(BEATS_PER_BAR / step);

  const notes: PracticeNote[] = [];
  const barNotes: (string | null)[] = chordBars.map(() => null);
  let anchor: number | null = null;
  let group = 0;
  let start = 0;
  while (start < chordBars.length) {
    let end = start + 1;
    while (end < chordBars.length && chordBars[end]!.repeat) end++;
    const bar = chordBars[start]!;
    const parsed = parseChord(bar.label, 0);
    if (parsed.kind !== 'chord') return { ok: false, error: `Can't read chord ${bar.symbol}.`, fixes: [] };
    const t = parsed.tones;
    let tones = [0, t.third, t.fifth];
    if (a.tones === 'seventh') {
      if (t.seventh === null) {
        tones = [0, t.third, t.fifth, 12];
        barNotes[start] = `${pretty(bar.symbol)} has no 7th: root, 3rd, 5th, octave`;
      } else {
        tones = [0, t.third, t.fifth, t.seventh];
      }
    } else if (a.path !== 'inversions') {
      tones = [0, t.third, t.fifth, 12];
    }
    const path = arpeggioPath(tones, a.path);
    const root = lowestMidiOf(t.rootPc, inst);
    const count = (end - start) * perBar;
    const midis = Array.from({ length: count }, (_, i) => root + path[i % path.length]!);
    const placed = placeLine(midis, inst, anchor ?? root - TUNINGS[inst][0]!);
    if (!placed.ok) {
      return { ok: false, error: `The ${pretty(bar.symbol)} arpeggio runs off the neck at MIDI ${placed.midi}.`, fixes: [] };
    }
    anchor = placed.anchor;
    midis.forEach((midi, i) => {
      notes.push({
        start: start * BEATS_PER_BAR + i * step,
        dur: step,
        string: placed.frets[i]!.string,
        fret: placed.frets[i]!.fret,
        midi,
        name: spell(mod12(midi), key),
        kind: 'tone',
        group: group++,
        finger: null,
        stroke: null,
      });
    });
    start = end;
  }
  const bars = chordBars.map((b, i) => ({ label: pretty(b.symbol), repeat: b.repeat, note: barNotes[i] ?? null }));
  return { ok: true, loop: loopOf(inst, bars, notes) };
}
```

Two details the tests pin down:
- A triad with `tones: 'triad'` and a non-inversion path plays R 3 5 8. Four notes fill a bar of quarters evenly.
- The 'seventh'-over-a-triad message uses `pretty(bar.symbol)` (`G`). The test expects `'G has no 7th: root, 3rd, 5th, octave'`.

- [ ] **Step 4: Run the tests**

Run: `npm --prefix frontend test -- --run src/music/practice/arpeggio.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/music/practice/arpeggio.ts frontend/src/music/practice/arpeggio.test.ts
git commit -m "feat(practice): arpeggios over a chord or a progression (D-22)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Technique drill generator

**Files:**
- Create: `frontend/src/music/practice/drill.ts`
- Test: `frontend/src/music/practice/drill.test.ts`

**Interfaces:**
- Consumes: Task 3's `TUNINGS`, `STRING_NAMES`, `sharpName`, `rng`; Task 6's `timed`; `RHYTHM_STEP`, `loopOf`, types.
- Produces: `drillLine(settings, instrument): GenerateResult`, `PERMUTATIONS: readonly (readonly number[])[]` (all 24 finger orders).

- [ ] **Step 1: Write the failing tests**

`frontend/src/music/practice/drill.test.ts`:

```ts
import { describe, expect, test } from 'vitest';

import { DEFAULT_INSTRUMENT_SETTINGS, type InstrumentSettings } from '../../api/client';
import { drillLine, PERMUTATIONS } from './drill';

const withDrill = (patch: Partial<InstrumentSettings['drill']>, rest: Partial<InstrumentSettings> = {}): InstrumentSettings => ({
  ...DEFAULT_INSTRUMENT_SETTINGS,
  ...rest,
  drill: { ...DEFAULT_INSTRUMENT_SETTINGS.drill, ...patch },
});

test('24 distinct finger orders', () => {
  expect(PERMUTATIONS).toHaveLength(24);
  expect(new Set(PERMUTATIONS.map((p) => p.join(''))).size).toBe(24);
});

describe('drillLine', () => {
  test('chromatic 1-2-3-4 from fret 5, up and back, eighths: 4 bars on bass, 6 on guitar', () => {
    const bass = drillLine(withDrill({}), 'bass');
    if (!bass.ok) throw new Error(bass.error);
    expect(bass.loop.notes).toHaveLength(32);
    expect(bass.loop.bars).toHaveLength(4);
    expect(bass.loop.notes.slice(0, 5).map((n) => [n.string, n.fret, n.finger])).toEqual([
      [0, 5, 1], [0, 6, 2], [0, 7, 3], [0, 8, 4], [1, 5, 1],
    ]);
    expect(bass.loop.bars.map((b) => b.label)).toEqual(['E → A', 'D → G', 'G → D', 'A → E']);
    const guitar = drillLine(withDrill({}), 'guitar');
    if (!guitar.ok) throw new Error(guitar.error);
    expect(guitar.loop.bars).toHaveLength(6);
  });

  test('drills are named with sharps', () => {
    const r = drillLine(withDrill({ from_fret: 1 }), 'bass');
    if (!r.ok) throw new Error(r.error);
    expect(r.loop.notes[1]!.name).toBe('F♯');
  });

  test('permutations: one seeded finger order on every string', () => {
    const a = drillLine(withDrill({ drill: 'permutations' }, { seed: 3 }), 'bass');
    const b = drillLine(withDrill({ drill: 'permutations' }, { seed: 3 }), 'bass');
    expect(a).toEqual(b);
    if (!a.ok) throw new Error(a.error);
    const order = a.loop.notes.slice(0, 4).map((n) => n.finger);
    expect(a.loop.notes.slice(4, 8).map((n) => n.finger)).toEqual(order);
  });

  test('spider alternates two strings', () => {
    const r = drillLine(withDrill({ drill: 'spider', direction: 'up' }), 'bass');
    if (!r.ok) throw new Error(r.error);
    expect(r.loop.notes.slice(0, 4).map((n) => [n.string, n.finger])).toEqual([[0, 1], [1, 2], [0, 3], [1, 4]]);
  });

  test('octaves past fret 7 run off the neck, with a fix', () => {
    const r = drillLine(withDrill({ drill: 'octaves', from_fret: 8 }), 'bass');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('Octaves from fret 8 reach fret 13; the neck stops at 12.');
    expect(r.fixes[0]!.apply(withDrill({ drill: 'octaves', from_fret: 8 })).drill.from_fret).toBe(7);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npm --prefix frontend test -- --run src/music/practice/drill.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write `drill.ts`**

```ts
// Technique drills (D-22): fret-based, no key, one finger per fret from the
// index finger's fret. Named with sharps. Only "permutations" is random (a
// seeded finger order), so only it is regenerable.
import type { InstrumentSettings, PracticeInstrument } from '../../api/client';
import { sharpName, STRING_NAMES, TUNINGS } from './neck';
import { rng } from './random';
import { timed } from './scale';
import { BEATS_PER_BAR, loopOf, RHYTHM_STEP, type GenerateResult, type PracticeNote } from './types';

interface Cell {
  string: number;
  fret: number;
  finger: number;
}

function permutations(items: readonly number[]): number[][] {
  if (items.length <= 1) return [[...items]];
  return items.flatMap((x, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [x, ...rest]));
}
export const PERMUTATIONS: readonly (readonly number[])[] = permutations([1, 2, 3, 4]);

export function drillLine(settings: InstrumentSettings, inst: PracticeInstrument): GenerateResult {
  const d = settings.drill;
  const tuning = TUNINGS[inst];
  const strings = tuning.length;
  const at = (string: number, finger: number): Cell => ({ string, fret: d.from_fret + finger - 1, finger });

  let up: Cell[];
  switch (d.drill) {
    case 'chromatic':
    case 'permutations': {
      const order = d.drill === 'chromatic' ? [1, 2, 3, 4] : PERMUTATIONS[Math.floor(rng(settings.seed)() * 24)]!;
      up = [...Array(strings).keys()].flatMap((s) => order.map((f) => at(s, f)));
      break;
    }
    case 'spider':
      up = [...Array(strings - 1).keys()].flatMap((s) => [at(s, 1), at(s + 1, 2), at(s, 3), at(s + 1, 4)]);
      break;
    case 'crossing':
      up = [...Array(strings).keys()].map((s) => at(s, 1));
      break;
    case 'octaves': {
      const top = d.from_fret + 3 + 2;
      if (top > 12) {
        return {
          ok: false,
          error: `Octaves from fret ${d.from_fret} reach fret ${top}; the neck stops at 12.`,
          fixes: [{ label: 'Start from fret 7', apply: (s) => ({ ...s, drill: { ...s.drill, from_fret: 7 } }) }],
        };
      }
      up = [...Array(strings - 2).keys()].flatMap((s) =>
        [0, 1, 2, 3].flatMap((k) => [
          { string: s, fret: d.from_fret + k, finger: 1 },
          { string: s + 2, fret: d.from_fret + k + 2, finger: 4 },
        ]),
      );
      break;
    }
  }
  const cells = d.direction === 'up_back' ? [...up, ...[...up].reverse()] : up;

  const { starts, durs, barCount } = timed(cells.length, RHYTHM_STEP[d.rhythm]);
  const notes: PracticeNote[] = cells.map((c, i) => {
    const midi = tuning[c.string]! + c.fret;
    return {
      start: starts[i]!,
      dur: durs[i]!,
      string: c.string,
      fret: c.fret,
      midi,
      name: sharpName(midi),
      kind: 'tone',
      group: i,
      finger: c.finger,
      stroke: null,
    };
  });
  const names = STRING_NAMES[inst];
  const bars = Array.from({ length: barCount }, (_, b) => {
    const inBar = notes.filter((n) => n.start >= b * BEATS_PER_BAR && n.start < (b + 1) * BEATS_PER_BAR);
    const first = names[inBar[0]?.string ?? 0]!;
    const last = names[inBar.at(-1)?.string ?? 0]!;
    return { label: first === last ? first : `${first} → ${last}`, repeat: false, note: null };
  });
  return { ok: true, loop: loopOf(inst, bars, notes) };
}
```

- [ ] **Step 4: Run the tests**

Run: `npm --prefix frontend test -- --run src/music/practice/drill.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/music/practice/drill.ts frontend/src/music/practice/drill.test.ts
git commit -m "feat(practice): technique drills, chromatic, permutations, spider, crossing, octaves (D-22)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: `generate()` dispatcher

**Files:**
- Create: `frontend/src/music/practice/generate.ts`
- Test: `frontend/src/music/practice/generate.test.ts`

**Interfaces:**
- Produces: `generate(instrument: PracticeInstrument, settings: InstrumentSettings): GenerateResult`; `regenerable(instrument, settings): boolean`.

- [ ] **Step 1: Write the failing test**

`frontend/src/music/practice/generate.test.ts`:

```ts
import { describe, expect, test } from 'vitest';

import { DEFAULT_INSTRUMENT_SETTINGS, type ExerciseKind, type InstrumentSettings } from '../../api/client';
import { PROGRESSIONS } from '../progressions';
import { SCALES } from '../spell';
import { generate, regenerable } from './generate';
import { BEATS_PER_BAR } from './types';

const base = (exercise: ExerciseKind, patch: Partial<InstrumentSettings> = {}): InstrumentSettings => ({
  ...DEFAULT_INSTRUMENT_SETTINGS,
  exercise,
  ...patch,
});

function assertValid(r: ReturnType<typeof generate>, strings: number) {
  if (!r.ok) throw new Error(r.error);
  const end = r.loop.bars.length * BEATS_PER_BAR;
  for (const n of r.loop.notes) {
    expect(n.fret).toBeGreaterThanOrEqual(0);
    expect(n.fret).toBeLessThanOrEqual(12);
    expect(n.string).toBeLessThan(strings);
    expect(n.start + n.dur).toBeLessThanOrEqual(end + 1e-9);
  }
}

describe('every exercise fits the neck and whole bars', () => {
  for (const instrument of ['bass', 'guitar'] as const) {
    const strings = instrument === 'bass' ? 4 : 6;
    test(`${instrument}: grooves over every progression`, () => {
      for (const p of PROGRESSIONS) {
        assertValid(generate(instrument, base('groove', { groove: { ...DEFAULT_INSTRUMENT_SETTINGS.groove, progression: p.id as never } })), strings);
      }
    });
    test(`${instrument}: every scale in one position`, () => {
      for (const s of SCALES) {
        assertValid(generate(instrument, base('scale', { key: 9, scale: { ...DEFAULT_INSTRUMENT_SETTINGS.scale, scale: s.id } })), strings);
      }
    });
    test(`${instrument}: arpeggios and drills`, () => {
      assertValid(generate(instrument, base('arpeggio')), strings);
      for (const drill of ['chromatic', 'permutations', 'spider', 'crossing', 'octaves'] as const) {
        assertValid(generate(instrument, base('drill', { drill: { ...DEFAULT_INSTRUMENT_SETTINGS.drill, drill } })), strings);
      }
    });
  }
});

test('regenerable only where a seed changes something', () => {
  expect(regenerable('bass', base('groove'))).toBe(true);
  expect(regenerable('bass', base('groove', { groove: { ...DEFAULT_INSTRUMENT_SETTINGS.groove, approach: 'none' } }))).toBe(false);
  expect(regenerable('guitar', base('groove'))).toBe(false);
  expect(regenerable('bass', base('scale'))).toBe(false);
  expect(regenerable('bass', base('drill', { drill: { ...DEFAULT_INSTRUMENT_SETTINGS.drill, drill: 'permutations' } }))).toBe(true);
  expect(regenerable('bass', base('drill'))).toBe(false);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm --prefix frontend test -- --run src/music/practice/generate.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write `generate.ts`**

```ts
// One entry point for the Practice screen (D-22): settings in, a loop or a
// reason it cannot be played (with fixes) out.
import type { InstrumentSettings, PracticeInstrument } from '../../api/client';
import { arpeggioLine } from './arpeggio';
import { drillLine } from './drill';
import { bassGroove, guitarGroove } from './groove';
import { scaleLine } from './scale';
import type { GenerateResult } from './types';

export function generate(instrument: PracticeInstrument, settings: InstrumentSettings): GenerateResult {
  switch (settings.exercise) {
    case 'groove':
      return instrument === 'bass' ? bassGroove(settings) : guitarGroove(settings);
    case 'scale':
      return scaleLine(settings, instrument);
    case 'arpeggio':
      return arpeggioLine(settings, instrument);
    case 'drill':
      return drillLine(settings, instrument);
  }
}

/** Whether Regenerate (a new seed) changes anything: only bass approaches and drill permutations are random. */
export function regenerable(instrument: PracticeInstrument, settings: InstrumentSettings): boolean {
  if (settings.exercise === 'groove') return instrument === 'bass' && settings.groove.approach !== 'none';
  return settings.exercise === 'drill' && settings.drill.drill === 'permutations';
}
```

- [ ] **Step 4: Run all practice music tests**

Run: `npm --prefix frontend test -- --run src/music/practice`
Expected: all pass. If a scale fails in one position (for example whole tone on guitar), the error names it. Either the scale has under two notes in the window, or a test default is wrong. Fix the test input (`from_fret`), not the generator's refusal.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/music/practice/generate.ts frontend/src/music/practice/generate.test.ts
git commit -m "feat(practice): generate() over the four exercises (D-22)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 10: Synth voices: reference bass and plucked string

**Files:**
- Create: `frontend/src/practice/audio/voices.ts`
- Test: `frontend/src/practice/audio/voices.test.ts`

**Interfaces:**
- Consumes: `SAMPLE_RATE` (`engine/types.ts`); `rng` (Task 3).
- Produces: `midiHz(midi)`, `RELEASE_FRAMES`, `bassNote(midi: number, frames: number): Float32Array`, `pluckNote(midi: number, frames: number, seed: number): Float32Array`. Each returns `frames + RELEASE_FRAMES` samples, mono, peak below 1.

- [ ] **Step 1: Write the failing tests**

`frontend/src/practice/audio/voices.test.ts`:

```ts
import { describe, expect, test } from 'vitest';

import { SAMPLE_RATE } from '../../engine/types';
import { bassNote, midiHz, pluckNote, RELEASE_FRAMES } from './voices';

const peak = (xs: Float32Array) => xs.reduce((m, x) => Math.max(m, Math.abs(x)), 0);

/** Upward zero crossings per second over [from, to) seconds: the fundamental, once harmonics have died. */
function crossingsHz(xs: Float32Array, from: number, to: number) {
  let n = 0;
  for (let i = Math.round(from * SAMPLE_RATE) + 1; i < to * SAMPLE_RATE; i++) if (xs[i - 1]! < 0 && xs[i]! >= 0) n++;
  return n / (to - from);
}

test('midiHz', () => {
  expect(midiHz(69)).toBe(440);
  expect(midiHz(33)).toBeCloseTo(55, 6);
});

describe('bassNote', () => {
  test('is the note’s length plus the release, never clips, and fades to silence', () => {
    const xs = bassNote(33, SAMPLE_RATE);
    expect(xs).toHaveLength(SAMPLE_RATE + RELEASE_FRAMES);
    expect(peak(xs)).toBeLessThan(1);
    expect(peak(xs)).toBeGreaterThan(0.2);
    expect(Math.abs(xs[0]!)).toBeLessThan(1e-3);
    expect(Math.abs(xs.at(-1)!)).toBeLessThan(1e-3);
  });

  test('sounds at its pitch', () => {
    const xs = bassNote(45, SAMPLE_RATE); // A2, 110 Hz
    expect(crossingsHz(xs, 0.5, 0.9)).toBeGreaterThan(107);
    expect(crossingsHz(xs, 0.5, 0.9)).toBeLessThan(113);
  });
});

describe('pluckNote', () => {
  test('is deterministic for a seed and sounds at its pitch', () => {
    const a = pluckNote(57, SAMPLE_RATE / 2, 9); // A3, 220 Hz
    expect(pluckNote(57, SAMPLE_RATE / 2, 9)).toEqual(a);
    expect(peak(a)).toBeLessThan(1);
    // Karplus-Strong repeats itself every period: compare one period with the next.
    const period = Math.round(SAMPLE_RATE / midiHz(57));
    let diff = 0;
    let energy = 0;
    for (let i = 2000; i < 2000 + period; i++) {
      diff += Math.abs(a[i]! - a[i + period]!);
      energy += Math.abs(a[i]!);
    }
    expect(diff / energy).toBeLessThan(0.1);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npm --prefix frontend test -- --run src/practice/audio/voices.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write `voices.ts`**

```ts
// The Practice tab's reference sounds (D-22), as plain DSP into Float32Arrays at
// 48 kHz: deterministic, and testable without Web Audio. A note is its length
// plus a 30 ms release, so it never ends on a click. Mono; the renderer puts
// the same samples on both channels.
import { SAMPLE_RATE } from '../../engine/types';
import { rng } from '../../music/practice/random';

export const RELEASE_FRAMES = Math.round(0.03 * SAMPLE_RATE);
const ATTACK_FRAMES = Math.round(0.004 * SAMPLE_RATE);

export function midiHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

/** 1 for the note's length, then a linear fade over the release. */
function release(i: number, frames: number): number {
  return i < frames ? 1 : Math.max(0, 1 - (i - frames) / RELEASE_FRAMES);
}

/** A round electric-bass tone: the fundamental, with a 2nd and 3rd harmonic that fade fast like a pick's attack. */
export function bassNote(midi: number, frames: number): Float32Array {
  const out = new Float32Array(frames + RELEASE_FRAMES);
  const w = (2 * Math.PI * midiHz(midi)) / SAMPLE_RATE;
  for (let i = 0; i < out.length; i++) {
    const t = i / SAMPLE_RATE;
    const env = Math.min(1, i / ATTACK_FRAMES) * Math.exp(-t / 0.9) * release(i, frames);
    const s = Math.sin(w * i) + 0.35 * Math.exp(-t / 0.12) * Math.sin(2 * w * i) + 0.15 * Math.exp(-t / 0.05) * Math.sin(3 * w * i);
    out[i] = 0.45 * env * s;
  }
  return out;
}

/** A plucked string (Karplus-Strong): a burst of seeded noise round a delay line one period long, averaged as it decays. */
export function pluckNote(midi: number, frames: number, seed: number): Float32Array {
  const out = new Float32Array(frames + RELEASE_FRAMES);
  const period = Math.max(2, Math.round(SAMPLE_RATE / midiHz(midi)));
  const random = rng(seed);
  const line = Float32Array.from({ length: period }, () => random() * 2 - 1);
  let at = 0;
  for (let i = 0; i < out.length; i++) {
    const current = line[at]!;
    const next = line[(at + 1) % period]!;
    line[at] = 0.996 * 0.5 * (current + next);
    out[i] = 0.3 * current * release(i, frames);
    at = (at + 1) % period;
  }
  return out;
}
```

- [ ] **Step 4: Run the tests**

Run: `npm --prefix frontend test -- --run src/practice/audio/voices.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/practice/audio
git commit -m "feat(practice): reference bass and plucked-string voices (D-22)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Renderer: timing, lead-in, grids and stems

**Files:**
- Create: `frontend/src/practice/audio/render.ts`
- Test: `frontend/src/practice/audio/render.test.ts`

**Interfaces:**
- Consumes: Task 10's voices; `PracticeLoop` (Task 3); `Grid` (`music/grid.ts`); `SAMPLE_RATE`, `sampleIndex`, `SampleIndex`, `STEM_ORDER`, `StemName` (`engine/types.ts`); `StemChannels` (`engine/loopCursor.ts`).
- Produces:

```ts
export const LEAD_IN_BARS = 2;
export const STRUM_STAGGER_FRAMES: number; // 8 ms
export function beatFrames(beat: number, bpm: number): number; // integer samples from the loop start
export interface RenderedPractice {
  stems: StemChannels[];   // STEM_ORDER: vocals, drums, bass, other
  grid: Grid;              // every bar and beat, lead-in included: for setGrid and the count-in
  display: Grid;           // the loop's bars only: for the painters
  loopStart: SampleIndex;  // bar 1, after the lead-in
  loopEnd: SampleIndex;    // the buffers' length
  bpm: number;
}
export function renderPractice(loop: PracticeLoop, bpm: number): RenderedPractice;
```

- [ ] **Step 1: Write the failing tests**

`frontend/src/practice/audio/render.test.ts`:

```ts
import { describe, expect, test } from 'vitest';

import { DEFAULT_INSTRUMENT_SETTINGS } from '../../api/client';
import { STEM_ORDER } from '../../engine/types';
import { generate } from '../../music/practice/generate';
import type { PracticeLoop } from '../../music/practice/types';
import { beatFrames, LEAD_IN_BARS, renderPractice, STRUM_STAGGER_FRAMES } from './render';

function loopFor(instrument: 'bass' | 'guitar'): PracticeLoop {
  const r = generate(instrument, DEFAULT_INSTRUMENT_SETTINGS);
  if (!r.ok) throw new Error(r.error);
  return r.loop;
}
const energy = (xs: Float32Array, from: number, to: number) => {
  let e = 0;
  for (let i = from; i < to; i++) e += Math.abs(xs[i]!);
  return e;
};
const slot = (name: (typeof STEM_ORDER)[number]) => STEM_ORDER.indexOf(name);

test('beatFrames rounds once, to integer samples at 48 kHz', () => {
  expect(beatFrames(1, 120)).toBe(24_000);
  expect(beatFrames(1 / 3, 100)).toBe(9600);
  expect(beatFrames(1, 7 * 13)).toBe(Math.round(48_000 * 60 / 91));
});

describe('renderPractice', () => {
  const bpm = 120;
  const r = renderPractice(loopFor('bass'), bpm);

  test('two silent bars of lead-in, then four bars of loop; every stem the same length', () => {
    expect(r.loopStart).toBe(LEAD_IN_BARS * 4 * 24_000);
    expect(r.loopEnd).toBe(r.loopStart + 4 * 4 * 24_000);
    for (const s of r.stems) {
      expect(s.left).toHaveLength(r.loopEnd);
      expect(s.right).toHaveLength(r.loopEnd);
    }
    expect(energy(r.stems[slot('bass')]!.left, 0, r.loopStart)).toBe(0);
  });

  test('the grids are integer samples; the display grid starts at bar 1', () => {
    expect(r.grid.bars).toHaveLength(LEAD_IN_BARS + 4);
    expect(r.grid.beats).toHaveLength((LEAD_IN_BARS + 4) * 4);
    expect(r.grid.bars.every((b) => Number.isInteger(b))).toBe(true);
    expect(r.display.bars[0]).toBe(r.loopStart);
    expect(r.display.barCount).toBe(4);
    expect(r.display.beatsPerBar).toBe(4);
  });

  test('the reference bass sounds at every note onset in the bass slot; vocals and drums are silent', () => {
    const bass = r.stems[slot('bass')]!.left;
    for (const beat of [0, 1, 2, 3, 4, 8, 12]) {
      const at = r.loopStart + beatFrames(beat, bpm);
      expect(energy(bass, at, at + 480)).toBeGreaterThan(1);
    }
    expect(energy(r.stems[slot('vocals')]!.left, 0, r.loopEnd)).toBe(0);
    expect(energy(r.stems[slot('drums')]!.left, 0, r.loopEnd)).toBe(0);
  });

  test('a release that runs past the loop end is folded onto the loop start, so the wrap is continuous', () => {
    const bass = r.stems[slot('bass')]!.left;
    // The last note ends exactly at loopEnd; its 30 ms release lands in the first 1440 samples of bar 1.
    const lastNoteOnly = renderPractice({ ...loopFor('bass'), notes: [loopFor('bass').notes.at(-1)!] }, bpm);
    const folded = lastNoteOnly.stems[slot('bass')]!.left;
    expect(energy(folded, r.loopStart, r.loopStart + 1000)).toBeGreaterThan(0);
    expect(bass.some((x) => Math.abs(x) > 0.99)).toBe(false);
  });

  test('guitar: strums go to the other slot, strings staggered; the backing bass to the bass slot', () => {
    const g = renderPractice(loopFor('guitar'), bpm);
    const other = g.stems[slot('other')]!.left;
    expect(energy(other, g.loopStart, g.loopStart + STRUM_STAGGER_FRAMES)).toBeGreaterThan(0);
    expect(energy(g.stems[slot('bass')]!.left, g.loopStart, g.loopStart + 480)).toBeGreaterThan(1);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npm --prefix frontend test -- --run src/practice/audio/render.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write `render.ts`**

```ts
// The Practice loop as audio for the engine (D-22). Every onset is rounded to an
// integer sample at 48 kHz once, here (invariant 4), and the grid comes from the
// same arithmetic, so the click, the notes and the painters agree to the
// sample. Two silent bars lead in, because the engine's count-in cannot start
// before sample 0 (EngineController.countInAndPlay); the loop is bar 1 to the
// end. Anything that rings past the loop end is folded onto the loop start,
// so the buffer is truly circular and the wrap has no seam (R-01).
import { STEM_ORDER, SAMPLE_RATE, sampleIndex, type SampleIndex, type StemName } from '../../engine/types';
import type { StemChannels } from '../../engine/loopCursor';
import type { Grid } from '../../music/grid';
import { BEATS_PER_BAR, type PracticeLoop } from '../../music/practice/types';
import { bassNote, pluckNote } from './voices';

export const LEAD_IN_BARS = 2;
export const STRUM_STAGGER_FRAMES = Math.round(0.008 * SAMPLE_RATE);
const HEADROOM = 0.98;

export interface RenderedPractice {
  stems: StemChannels[];
  grid: Grid;
  display: Grid;
  loopStart: SampleIndex;
  loopEnd: SampleIndex;
  bpm: number;
}

export function beatFrames(beat: number, bpm: number): number {
  return Math.round((beat * 60 * SAMPLE_RATE) / bpm);
}

function gridOf(barCount: number, firstBar: number, bpm: number): Grid {
  const bars = Array.from({ length: barCount }, (_, b) => sampleIndex(beatFrames((firstBar + b) * BEATS_PER_BAR, bpm)));
  const beats = Array.from({ length: barCount * BEATS_PER_BAR }, (_, k) => sampleIndex(beatFrames(firstBar * BEATS_PER_BAR + k, bpm)));
  return { bars, beats, beatsPerBar: BEATS_PER_BAR, bpm, barCount, medianBarSamples: beatFrames(BEATS_PER_BAR, bpm) };
}

export function renderPractice(loop: PracticeLoop, bpm: number): RenderedPractice {
  const loopBars = loop.bars.length;
  const loopStart = beatFrames(LEAD_IN_BARS * BEATS_PER_BAR, bpm);
  const loopEnd = loopStart + beatFrames(loopBars * BEATS_PER_BAR, bpm);
  const loopLength = loopEnd - loopStart;
  const mono: Record<StemName, Float32Array> = {
    vocals: new Float32Array(loopEnd),
    drums: new Float32Array(loopEnd),
    bass: new Float32Array(loopEnd),
    other: new Float32Array(loopEnd),
  };

  const mix = (into: Float32Array, samples: Float32Array, at: number) => {
    for (let i = 0; i < samples.length; i++) {
      let index = at + i;
      if (index >= loopEnd) index = loopStart + ((index - loopEnd) % loopLength);
      into[index]! += samples[i]!;
    }
  };
  const span = (start: number, dur: number) => {
    const from = beatFrames(start, bpm);
    return { at: loopStart + from, frames: Math.max(1, beatFrames(start + dur, bpm) - from) };
  };

  if (loop.instrument === 'bass') {
    for (const note of loop.notes) {
      const { at, frames } = span(note.start, note.dur);
      mix(mono.bass, bassNote(note.midi, frames), at);
    }
  } else {
    const groups = new Map<number, typeof loop.notes>();
    for (const note of loop.notes) groups.set(note.group, [...(groups.get(note.group) ?? []), note]);
    for (const strum of groups.values()) {
      // A downstroke reaches the low string first, an upstroke the high one.
      const order = [...strum].sort((a, b) => (strum[0]!.stroke === 'up' ? b.string - a.string : a.string - b.string));
      order.forEach((note, k) => {
        const { at, frames } = span(note.start, note.dur);
        const offset = k * STRUM_STAGGER_FRAMES;
        mix(mono.other, pluckNote(note.midi, Math.max(1, frames - offset), note.group * 16 + note.string), at + offset);
      });
    }
    for (const note of loop.backing) {
      const { at, frames } = span(note.start, note.dur);
      mix(mono.bass, bassNote(note.midi, frames), at);
    }
  }

  for (const samples of Object.values(mono)) {
    const peak = samples.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
    if (peak > HEADROOM) for (let i = 0; i < samples.length; i++) samples[i]! *= HEADROOM / peak;
  }

  return {
    stems: STEM_ORDER.map((name) => ({ left: mono[name], right: mono[name] })),
    grid: gridOf(LEAD_IN_BARS + loopBars, 0, bpm),
    display: gridOf(loopBars, LEAD_IN_BARS, bpm),
    loopStart: sampleIndex(loopStart),
    loopEnd: sampleIndex(loopEnd),
    bpm,
  };
}
```

`left` and `right` share one array. `stemLoadMessages` copies each channel into its own chunks, so sharing costs nothing and the worklet still gets two channels.

- [ ] **Step 4: Run the tests**

Run: `npm --prefix frontend test -- --run src/practice/audio`
Expected: all pass.

- [ ] **Step 5: Measure render time (record it in the commit message)**

Run: `npm --prefix frontend test -- --run src/practice/audio/render.test.ts --reporter=verbose`
Add this temporary test, run it once, and delete it again:

```ts
test('render time', () => {
  const s = { ...DEFAULT_INSTRUMENT_SETTINGS, groove: { ...DEFAULT_INSTRUMENT_SETTINGS.groove, bars_per_chord: 4 as const } };
  const r = generate('guitar', s);
  if (!r.ok) throw new Error(r.error);
  const t0 = performance.now();
  renderPractice(r.loop, 60);
  console.log('16-bar guitar loop at 60 bpm rendered in', Math.round(performance.now() - t0), 'ms');
});
```

Expected: under 300 ms (the spec's target). If it is over, the hot path is `pluckNote`. Profile it before changing anything, and say so in the task report.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/practice/audio/render.ts frontend/src/practice/audio/render.test.ts
git commit -m "feat(practice): render the loop to stems, two-bar lead-in, folded wrap (D-22)

16-bar guitar loop at 60 bpm renders in <N> ms in jsdom.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(Replace `<N>` with the measured number.)

---

### Task 12: Engine: `createFromStems`, `replaceStems`, `setMetronomeLevel`

**Files:**
- Modify: `frontend/src/engine/EngineController.ts`
- Test: `frontend/src/engine/EngineController.test.ts` (append)

**Interfaces:**
- Produces:
  - `static createFromStems(stems: readonly StemChannels[]): Promise<EngineController>`, which throws if the AudioContext does not run at 48 kHz (raw stems cannot be resampled by the browser the way decoded files are);
  - `replaceStems(stems: readonly StemChannels[]): void`, which pauses, loads the new stems, updates `durationSamples` and the summaries, and seeks to 0;
  - `setMetronomeLevel(level: number): void`, a level in 0..1 that `setMetronome(true)` and the count-in now use.
- `create(stemUrls)` keeps its signature and behaviour.

- [ ] **Step 1: Write the failing tests** (append to `EngineController.test.ts`)

```ts
describe('EngineController stems replaced in place', () => {
  it('pauses, loads the new stems in order, takes their length, and goes back to the top', () => {
    const { controller, cursorNode } = makeController();
    const stem = (n: number) => ({ left: new Float32Array(n), right: new Float32Array(n) });
    controller.replaceStems([stem(4800), stem(4800), stem(4800), stem(4800)]);
    const types = cursorNode.port.postMessage.mock.calls.map(([m]) => (m as { type: string }).type);
    expect(types[0]).toBe('load-begin');
    expect(types).toContain('load-end');
    expect(types.indexOf('seek')).toBeGreaterThan(types.indexOf('load-end'));
    expect(controller.durationSamples).toBe(4800);
    expect(controller.getPositionSamples()).toBe(0);
    expect(cursorNode.parameters.get('playing')!.value).toBe(0);
  });
});

describe('EngineController metronome level', () => {
  it('uses the level when the click is on, and 0 when off', () => {
    const { controller, cursorNode } = makeController();
    controller.setMetronomeLevel(0.4);
    controller.setMetronome(true);
    expect(cursorNode.parameters.get('metronomeGain')!.value).toBe(0.4);
    controller.setMetronomeLevel(0.9);
    expect(cursorNode.parameters.get('metronomeGain')!.value).toBe(0.9);
    controller.setMetronome(false);
    expect(cursorNode.parameters.get('metronomeGain')!.value).toBe(0);
    controller.setMetronomeLevel(0.5);
    expect(cursorNode.parameters.get('metronomeGain')!.value).toBe(0);
  });

  it('defaults to full level, as before', () => {
    const { controller, cursorNode } = makeController();
    controller.setMetronome(true);
    expect(cursorNode.parameters.get('metronomeGain')!.value).toBe(1);
  });
});
```

`makeController()` passes 8 constructor arguments, so the summaries argument is `undefined`. `replaceStems` sets summaries itself, so this is fine.

- [ ] **Step 2: Run them to see them fail**

Run: `npm --prefix frontend test -- --run src/engine/EngineController.test.ts`
Expected: FAIL, `replaceStems` / `setMetronomeLevel` are not functions.

- [ ] **Step 3: Change `EngineController.ts`**

1. Import the stem type: `import type { StemChannels } from './loopCursor';`.
2. In the constructor, make the last two parameters mutable: `private durationFrames: number,` and `private summaries: readonly StemSummary[],` (drop `readonly`).
3. Add two fields beside `stemGains`:

```ts
  // The click's level (0..1) and whether it is on. The worklet's metronomeGain
  // is one number; these are what it is set from.
  private metronomeLevel = 1;
  private metronomeOn = false;
```

4. Replace `static async create(...)` with these three static methods. The body of the old `create()` from `const cursorNode = …` to `return new EngineController(…)` moves into `build()` unchanged, except that `durationFrames` and `summaries` now come from `stems`:

```ts
  static async create(stemUrls: Record<StemName, string>): Promise<EngineController> {
    const context = await EngineController.openContext();
    const buffers = await Promise.all(
      STEM_ORDER.map(async (name) => {
        const response = await fetch(stemUrls[name]);
        return context.decodeAudioData(await response.arrayBuffer());
      }),
    );
    const stems = buffers.map((buffer) => {
      const left = buffer.getChannelData(0);
      return { left, right: buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left };
    });
    return EngineController.build(context, stems);
  }

  /**
   * An engine over stems already in memory, at 48 kHz (the Practice tab, D-22). They
   * cannot be resampled the way decodeAudioData resamples a file, so a context that
   * refuses 48 kHz is an error, not a warning (N-08).
   */
  static async createFromStems(stems: readonly StemChannels[]): Promise<EngineController> {
    const context = await EngineController.openContext();
    if (context.sampleRate !== SAMPLE_RATE) {
      await context.close();
      throw new Error(
        `The browser's audio runs at ${context.sampleRate} Hz and would not switch to ${SAMPLE_RATE} Hz; ` +
          'Practice renders at 48 kHz and cannot play at another rate.',
      );
    }
    return EngineController.build(context, stems);
  }

  private static async openContext(): Promise<AudioContext> {
    const context = new AudioContext({ sampleRate: SAMPLE_RATE });
    if (context.sampleRate !== SAMPLE_RATE) {
      console.warn(
        `AudioContext ignored the requested ${SAMPLE_RATE} Hz and runs at ${context.sampleRate} Hz; ` +
          'loop bounds will be scaled at the domain boundary (types.ts:toDeviceDomain).',
      );
    }
    await context.audioWorklet.addModule(stemCursorProcessorUrl);
    await SoundTouchNode.register(context, processorUrl);
    return context;
  }

  private static build(context: AudioContext, stems: readonly StemChannels[]): EngineController {
    const cursorNode = new AudioWorkletNode(context, 'stem-cursor-processor', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });
    // In chunks, never one message: Firefox aborts the tab on a worklet message over 4 GB (stemLoad.ts).
    for (const { message, transfer } of stemLoadMessages(stems)) cursorNode.port.postMessage(message, transfer);
    // … unchanged: stNode, tempoState, endedBox, playingState, clock, port.onmessage …
    const durationFrames = stems[0]!.left.length;
    return new EngineController(
      context, cursorNode, stNode, clock, tempoState, endedBox, playingState,
      durationFrames, summariesOf(stems, context.sampleRate),
    );
  }
```

5. Add a module-level helper near the top of the file (after the imports):

```ts
/** Waveform summaries from raw channels: summariseStem only needs an AudioBuffer's shape. */
function summariesOf(stems: readonly StemChannels[], sampleRate: number): StemSummary[] {
  return STEM_ORDER.map((name, i) => {
    const stem = stems[i]!;
    return summariseStem(
      { length: stem.left.length, sampleRate, numberOfChannels: 2, getChannelData: (c) => (c === 0 ? stem.left : stem.right) },
      name,
    );
  });
}
```

(`summariseStem` previously took the `AudioBuffer`. It reads only `length`, `sampleRate`, `numberOfChannels` and `getChannelData`, so the summaries for a song are identical.)

6. Add the instance methods next to `setMetronome`, and change `setMetronome` itself:

```ts
  setMetronome(on: boolean): void {
    this.metronomeOn = on;
    this.cursorNode.parameters
      .get('metronomeGain')!
      .setValueAtTime(on ? this.metronomeLevel : 0, this.context.currentTime);
  }

  /** The click's level, 0..1. Takes effect at once if the click is on. */
  setMetronomeLevel(level: number): void {
    this.metronomeLevel = Math.min(1, Math.max(0, level));
    if (this.metronomeOn) this.setMetronome(true);
  }

  /**
   * New stems in the same engine (D-22: the Practice loop re-rendered). The worklet
   * takes a fresh load sequence in place of the old stems; nothing else is rebuilt.
   * Leaves the transport paused at the top; the caller sets grid and loop again.
   */
  replaceStems(stems: readonly StemChannels[]): void {
    this.pause();
    for (const { message, transfer } of stemLoadMessages(stems)) this.cursorNode.port.postMessage(message, transfer);
    this.durationFrames = stems[0]!.left.length;
    this.summaries = summariesOf(stems, this.context.sampleRate);
    this.seek(sampleIndex(0));
  }
```

`countInAndPlay` calls `this.setMetronome(true)`, so the count-in now clicks at the chosen level. Song view never calls `setMetronomeLevel`, so its click stays at 1 as before.

- [ ] **Step 4: Run all engine tests and typecheck**

Run: `npm --prefix frontend test -- --run src/engine && npm --prefix frontend run typecheck`
Expected: all pass, no type errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/engine/EngineController.ts frontend/src/engine/EngineController.test.ts
git commit -m "feat(engine): createFromStems, replaceStems and a metronome level (D-22)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Tempo: ramp schedule and tap tempo

**Files:**
- Create: `frontend/src/practice/tempo.ts`
- Test: `frontend/src/practice/tempo.test.ts`

**Interfaces:**
- Consumes: `PracticeRamp` (`api/client.ts`).
- Produces:

```ts
export const BPM_MIN = 40, BPM_MAX = 220;
export function rampLimits(start: number): { lo: number; hi: number };  // ceil(0.5×), floor(1.5×), within 40..220
export interface RampState { bpm: number; step: number; steps: number; loopInStep: number | null }
export function rampState(ramp: PracticeRamp, loopsDone: number): RampState;
export function tapTempo(taps: readonly number[]): number | null;      // ms timestamps, newest last
```

- [ ] **Step 1: Write the failing tests**

`frontend/src/practice/tempo.test.ts`:

```ts
import { describe, expect, test } from 'vitest';

import { rampLimits, rampState, tapTempo } from './tempo';

const ramp = { on: true, start: 80, target: 120, step: 5, every_loops: 2 };

describe('rampState', () => {
  test('steps up every two loops, and holds at the target', () => {
    expect(rampState(ramp, 0)).toEqual({ bpm: 80, step: 0, steps: 8, loopInStep: 1 });
    expect(rampState(ramp, 1)).toEqual({ bpm: 80, step: 0, steps: 8, loopInStep: 2 });
    expect(rampState(ramp, 2)).toEqual({ bpm: 85, step: 1, steps: 8, loopInStep: 1 });
    expect(rampState(ramp, 16)).toEqual({ bpm: 120, step: 8, steps: 8, loopInStep: null });
    expect(rampState(ramp, 99).bpm).toBe(120);
  });

  test('a last step shorter than the others lands exactly on the target', () => {
    expect(rampState({ ...ramp, target: 102 }, 10).bpm).toBe(102);
    expect(rampState({ ...ramp, target: 102 }, 8).bpm).toBe(100);
  });

  test('ramps down too', () => {
    expect(rampState({ ...ramp, start: 120, target: 100 }, 2).bpm).toBe(115);
  });
});

test('rampLimits is the engine’s 0.5–1.5× range, inside 40–220', () => {
  expect(rampLimits(80)).toEqual({ lo: 40, hi: 120 });
  expect(rampLimits(75)).toEqual({ lo: 40, hi: 112 });
  expect(rampLimits(200)).toEqual({ lo: 100, hi: 220 });
});

describe('tapTempo', () => {
  test('averages the last taps', () => {
    expect(tapTempo([0, 500, 1000, 1500])).toBe(120);
    expect(tapTempo([0, 600])).toBe(100);
  });
  test('needs two taps, and a pause over two seconds starts again', () => {
    expect(tapTempo([0])).toBeNull();
    expect(tapTempo([0, 500, 4000])).toBeNull();
    expect(tapTempo([0, 500, 4000, 4500])).toBe(120);
  });
  test('stays in 40–220', () => {
    expect(tapTempo([0, 100])).toBe(220);
    expect(tapTempo([0, 1900])).toBe(40);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npm --prefix frontend test -- --run src/practice/tempo.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write `tempo.ts`**

```ts
// Tempo for the Practice tab (D-22): the ramp's schedule and tap tempo. The ramp
// is applied as the engine's tempo ratio over the rendered start BPM, so its
// reach is the engine's 0.5-1.5x (N-04); practice.py enforces the same range.
import type { PracticeRamp } from '../api/client';

export const BPM_MIN = 40;
export const BPM_MAX = 220;
const TAP_RESET_MS = 2000;
const TAPS_KEPT = 5;

export function rampLimits(start: number): { lo: number; hi: number } {
  return { lo: Math.max(BPM_MIN, Math.ceil(start * 0.5)), hi: Math.min(BPM_MAX, Math.floor(start * 1.5)) };
}

export interface RampState {
  bpm: number;
  /** Steps taken so far, 0 at the start. */
  step: number;
  /** Steps to the target. */
  steps: number;
  /** Which loop of the current step is playing, 1-based; null once the target holds. */
  loopInStep: number | null;
}

export function rampState(ramp: PracticeRamp, loopsDone: number): RampState {
  const distance = ramp.target - ramp.start;
  const steps = Math.ceil(Math.abs(distance) / ramp.step);
  const step = Math.min(steps, Math.floor(loopsDone / ramp.every_loops));
  const moved = Math.min(Math.abs(distance), step * ramp.step);
  return {
    bpm: ramp.start + Math.sign(distance) * moved,
    step,
    steps,
    loopInStep: step >= steps ? null : (loopsDone % ramp.every_loops) + 1,
  };
}

/** BPM from tap times (ms, newest last): the mean of the last few gaps, or null with fewer than two taps since a pause. */
export function tapTempo(taps: readonly number[]): number | null {
  let from = 0;
  for (let i = 1; i < taps.length; i++) if (taps[i]! - taps[i - 1]! > TAP_RESET_MS) from = i;
  const run = taps.slice(from).slice(-TAPS_KEPT);
  if (run.length < 2) return null;
  const mean = (run.at(-1)! - run[0]!) / (run.length - 1);
  return Math.min(BPM_MAX, Math.max(BPM_MIN, Math.round(60_000 / mean)));
}
```

- [ ] **Step 4: Run the tests**

Run: `npm --prefix frontend test -- --run src/practice/tempo.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/practice/tempo.ts frontend/src/practice/tempo.test.ts
git commit -m "feat(practice): tempo ramp schedule and tap tempo (D-22)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: `usePracticeSession`: one engine, re-rendered loops, count-in, levels, ramp

**Files:**
- Create: `frontend/src/practice/usePracticeSession.ts`
- Test: `frontend/src/practice/usePracticeSession.test.tsx`

**Interfaces:**
- Consumes: `renderPractice`, `RenderedPractice` (Task 11); `EngineController.createFromStems` and its methods (Task 12); `rampState` (Task 13); `PracticeLoop` (Task 3); `InstrumentSettings`, `PracticeInstrument`, `PracticeLevels` (`api/client.ts`).
- Produces:

```ts
export interface PracticeEngine {
  replaceStems(stems: readonly StemChannels[]): void;
  setGrid(bars: SampleIndex[], beats: SampleIndex[]): void;
  setLoop(loop: { startFrame: SampleIndex; endFrame: SampleIndex } | null): void;
  seek(position: SampleIndex): void;
  play(): Promise<void>;
  pause(): void;
  countInAndPlay(from: SampleIndex, bars: number, barStarts: SampleIndex[], restoreGains: () => void): Promise<void>;
  setStemGain(stem: StemName, gain: number): void;
  setMetronome(on: boolean): void;
  setMetronomeLevel(level: number): void;
  setTempo(ratio: number): void;
  getPositionSamples(): SampleIndex;
  dispose(): Promise<void>;
}
export function gainsFor(instrument: PracticeInstrument, levels: PracticeLevels): Record<StemName, number>;
export interface PracticeSession {
  rendered: RenderedPractice | null;
  playing: boolean;
  togglePlay(): void;
  getPosition(): SampleIndex;
  /** Bumped whenever the cursor jumps (a new render): painters repaint (usePlayhead's nonce). */
  seekNonce: number;
  /** Loops completed since the last start; drives the ramp. */
  loopsDone: number;
  error: string | null;
}
export function usePracticeSession(args: {
  instrument: PracticeInstrument;
  settings: InstrumentSettings;
  loop: PracticeLoop | null;
  createEngine?: (stems: readonly StemChannels[]) => Promise<PracticeEngine>;
}): PracticeSession;
```

Behaviour:
- **Render** whenever `loop` or the render BPM changes. The render BPM is `ramp.start` when the ramp is on, else `bpm`. Render with `renderPractice`, then create the engine the first time (or `replaceStems` on it), then `setGrid(grid.bars, grid.beats)`, `setLoop({ startFrame: loopStart, endFrame: loopEnd })`, `seek(loopStart)`, `setTempo(1)`. Reset `loopsDone` to 0, mark the loop as **fresh**, and bump `seekNonce`. If it was playing, start again.
- **Start:** a fresh loop with `count_in_bars > 0` goes through `countInAndPlay(loopStart, count_in_bars, grid.bars, applyGains)`; otherwise `play()`. Pause then Play resumes in place, without a count-in.
- **Levels:** apply `gainsFor(...)` with `setStemGain` for all four stems, `setMetronomeLevel(levels.click)` and `setMetronome(true)` whenever the levels or instrument change.
- **Ramp:** while playing with the ramp on, a rAF loop watches the position. A drop of more than one bar is a loop wrap, so `loopsDone++` and `setTempo(rampState(ramp, loopsDone).bpm / ramp.start)`. The step lands at the wrap, never mid-bar.
- **Errors:** any throw from render or engine sets `error` to its message (N-08). Play does nothing while there is an error.
- **Dispose** the engine on unmount.

- [ ] **Step 1: Write the failing tests**

`frontend/src/practice/usePracticeSession.test.tsx`:

```tsx
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { DEFAULT_INSTRUMENT_SETTINGS, type InstrumentSettings } from '../api/client';
import { sampleIndex, type SampleIndex } from '../engine/types';
import { generate } from '../music/practice/generate';
import { gainsFor, usePracticeSession, type PracticeEngine } from './usePracticeSession';

function fakeEngine() {
  let position = 0;
  const engine = {
    replaceStems: vi.fn(),
    setGrid: vi.fn(),
    setLoop: vi.fn(),
    seek: vi.fn((p: SampleIndex) => void (position = p)),
    play: vi.fn(async () => {}),
    pause: vi.fn(),
    countInAndPlay: vi.fn(async () => {}),
    setStemGain: vi.fn(),
    setMetronome: vi.fn(),
    setMetronomeLevel: vi.fn(),
    setTempo: vi.fn(),
    getPositionSamples: vi.fn(() => sampleIndex(position)),
    dispose: vi.fn(async () => {}),
    moveTo(p: number) {
      position = p;
    },
  };
  return engine;
}

let frames: FrameRequestCallback[] = [];
beforeEach(() => {
  frames = [];
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
  vi.stubGlobal('cancelAnimationFrame', () => {});
});
const tick = () => {
  const queue = frames;
  frames = [];
  queue.forEach((cb) => cb(0));
};

function setup(settings: InstrumentSettings = DEFAULT_INSTRUMENT_SETTINGS) {
  const engine = fakeEngine();
  const r = generate('bass', settings);
  if (!r.ok) throw new Error(r.error);
  const createEngine = vi.fn(async () => engine as unknown as PracticeEngine);
  const hook = renderHook((props: { settings: InstrumentSettings; loop: typeof r.loop }) =>
    usePracticeSession({ instrument: 'bass', settings: props.settings, loop: props.loop, createEngine }),
    { initialProps: { settings, loop: r.loop } },
  );
  return { engine, hook, createEngine, loop: r.loop };
}

test('gainsFor: the reference in its slot, mutes as zero, the rest silent', () => {
  const levels = { click: 0.7, ref: 0.8, ref_muted: false, backing: 0.6, backing_muted: true };
  expect(gainsFor('bass', levels)).toEqual({ vocals: 0, drums: 0, bass: 0.8, other: 0 });
  expect(gainsFor('guitar', levels)).toEqual({ vocals: 0, drums: 0, bass: 0, other: 0.8 });
  expect(gainsFor('guitar', { ...levels, backing_muted: false, ref_muted: true })).toEqual({ vocals: 0, drums: 0, bass: 0.6, other: 0 });
});

describe('usePracticeSession', () => {
  test('creates one engine, hands it the grid and the loop, and parks at bar 1', async () => {
    const { engine, hook, createEngine } = setup();
    await waitFor(() => expect(hook.result.current.rendered).not.toBeNull());
    const r = hook.result.current.rendered!;
    expect(createEngine).toHaveBeenCalledTimes(1);
    expect(engine.setGrid).toHaveBeenCalledWith(r.grid.bars, r.grid.beats);
    expect(engine.setLoop).toHaveBeenCalledWith({ startFrame: r.loopStart, endFrame: r.loopEnd });
    expect(engine.seek).toHaveBeenLastCalledWith(r.loopStart);
    expect(engine.setStemGain).toHaveBeenCalledWith('bass', 0.8);
    expect(engine.setMetronomeLevel).toHaveBeenCalledWith(0.7);
  });

  test('the first play counts in; pause then play resumes without one', async () => {
    const { engine, hook } = setup();
    await waitFor(() => expect(hook.result.current.rendered).not.toBeNull());
    const r = hook.result.current.rendered!;
    act(() => hook.result.current.togglePlay());
    expect(engine.countInAndPlay).toHaveBeenCalledWith(r.loopStart, 1, r.grid.bars, expect.any(Function));
    act(() => hook.result.current.togglePlay());
    expect(engine.pause).toHaveBeenCalled();
    act(() => hook.result.current.togglePlay());
    expect(engine.play).toHaveBeenCalledTimes(1);
    expect(engine.countInAndPlay).toHaveBeenCalledTimes(1);
  });

  test('a new loop replaces the stems in the same engine', async () => {
    const { engine, hook, createEngine, loop } = setup();
    await waitFor(() => expect(hook.result.current.rendered).not.toBeNull());
    const other = generate('bass', { ...DEFAULT_INSTRUMENT_SETTINGS, exercise: 'drill' });
    if (!other.ok) throw new Error(other.error);
    hook.rerender({ settings: DEFAULT_INSTRUMENT_SETTINGS, loop: other.loop });
    await waitFor(() => expect(engine.replaceStems).toHaveBeenCalledTimes(1));
    expect(createEngine).toHaveBeenCalledTimes(1);
    expect(loop).not.toBe(other.loop);
  });

  test('the ramp steps at the loop wrap, as a tempo ratio over the start', async () => {
    const settings = { ...DEFAULT_INSTRUMENT_SETTINGS, count_in_bars: 0 as const, ramp: { on: true, start: 80, target: 120, step: 5, every_loops: 1 } };
    const { engine, hook } = setup(settings);
    await waitFor(() => expect(hook.result.current.rendered).not.toBeNull());
    const r = hook.result.current.rendered!;
    expect(r.bpm).toBe(80);
    act(() => hook.result.current.togglePlay());
    engine.moveTo(r.loopEnd - 100);
    act(() => tick());
    engine.moveTo(r.loopStart + 100);
    act(() => tick());
    expect(hook.result.current.loopsDone).toBe(1);
    expect(engine.setTempo).toHaveBeenLastCalledWith(85 / 80);
  });

  test('an engine that cannot start is an error, quoted', async () => {
    const r = generate('bass', DEFAULT_INSTRUMENT_SETTINGS);
    if (!r.ok) throw new Error(r.error);
    const hook = renderHook(() =>
      usePracticeSession({
        instrument: 'bass',
        settings: DEFAULT_INSTRUMENT_SETTINGS,
        loop: r.loop,
        createEngine: async () => {
          throw new Error('The browser’s audio runs at 44100 Hz');
        },
      }),
    );
    await waitFor(() => expect(hook.result.current.error).toBe('The browser’s audio runs at 44100 Hz'));
  });

  test('disposes the engine on unmount', async () => {
    const { engine, hook } = setup();
    await waitFor(() => expect(hook.result.current.rendered).not.toBeNull());
    hook.unmount();
    expect(engine.dispose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npm --prefix frontend test -- --run src/practice/usePracticeSession.test.tsx`
Expected: FAIL, module not found.

- [ ] **Step 3: Write `usePracticeSession.ts`**

```ts
// The Practice tab's playback (D-22): one engine for the visit, fed the rendered
// loop. A changed loop is rendered again and swapped into the same engine
// (replaceStems); playback restarts from bar 1 with the count-in. A ramp step is
// the engine's tempo ratio, applied when the cursor wraps, so a bar never
// changes speed halfway (R-01's seamless wrap is untouched).
import { useCallback, useEffect, useRef, useState } from 'react';

import type { InstrumentSettings, PracticeInstrument, PracticeLevels } from '../api/client';
import type { StemChannels } from '../engine/loopCursor';
import { sampleIndex, STEM_ORDER, type SampleIndex, type StemName } from '../engine/types';
import type { PracticeLoop } from '../music/practice/types';
import { renderPractice, type RenderedPractice } from './audio/render';
import { rampState } from './tempo';

export interface PracticeEngine {
  replaceStems(stems: readonly StemChannels[]): void;
  setGrid(bars: SampleIndex[], beats: SampleIndex[]): void;
  setLoop(loop: { startFrame: SampleIndex; endFrame: SampleIndex } | null): void;
  seek(position: SampleIndex): void;
  play(): Promise<void>;
  pause(): void;
  countInAndPlay(from: SampleIndex, bars: number, barStarts: SampleIndex[], restoreGains: () => void): Promise<void>;
  setStemGain(stem: StemName, gain: number): void;
  setMetronome(on: boolean): void;
  setMetronomeLevel(level: number): void;
  setTempo(ratio: number): void;
  getPositionSamples(): SampleIndex;
  dispose(): Promise<void>;
}

export function gainsFor(instrument: PracticeInstrument, levels: PracticeLevels): Record<StemName, number> {
  const ref = levels.ref_muted ? 0 : levels.ref;
  const backing = levels.backing_muted ? 0 : levels.backing;
  return instrument === 'bass'
    ? { vocals: 0, drums: 0, bass: ref, other: 0 }
    : { vocals: 0, drums: 0, bass: backing, other: ref };
}

export interface PracticeSession {
  rendered: RenderedPractice | null;
  playing: boolean;
  togglePlay(): void;
  getPosition(): SampleIndex;
  seekNonce: number;
  loopsDone: number;
  error: string | null;
}

// Imported on first use, not at module load: the engine's SoundTouch node extends
// AudioWorkletNode at import time, which jsdom (and so every screen test) lacks.
const defaultCreate = async (stems: readonly StemChannels[]): Promise<PracticeEngine> => {
  const { EngineController } = await import('../engine/EngineController');
  return EngineController.createFromStems(stems);
};

export function usePracticeSession({
  instrument,
  settings,
  loop,
  createEngine = defaultCreate,
}: {
  instrument: PracticeInstrument;
  settings: InstrumentSettings;
  loop: PracticeLoop | null;
  createEngine?: (stems: readonly StemChannels[]) => Promise<PracticeEngine>;
}): PracticeSession {
  const engine = useRef<PracticeEngine | null>(null);
  const creating = useRef<Promise<PracticeEngine> | null>(null);
  const fresh = useRef(true);
  const playingRef = useRef(false);
  // Loops completed since this loop was rendered: a pause does not restart the ramp, a new render does.
  const loops = useRef(0);
  const [rendered, setRendered] = useState<RenderedPractice | null>(null);
  const [playing, setPlaying] = useState(false);
  const [seekNonce, setSeekNonce] = useState(0);
  const [loopsDone, setLoopsDone] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const renderBpm = settings.ramp.on ? settings.ramp.start : settings.bpm;
  const latest = useRef({ settings, instrument, rendered });
  latest.current = { settings, instrument, rendered };

  const applyGains = useCallback(() => {
    const e = engine.current;
    if (!e) return;
    const { instrument: inst, settings: s } = latest.current;
    const gains = gainsFor(inst, s.levels);
    for (const stem of STEM_ORDER) e.setStemGain(stem, gains[stem]);
    e.setMetronomeLevel(s.levels.click);
    e.setMetronome(true);
  }, []);

  const start = useCallback(() => {
    const e = engine.current;
    const r = latest.current.rendered;
    if (!e || !r) return;
    const bars = latest.current.settings.count_in_bars;
    playingRef.current = true;
    setPlaying(true);
    if (fresh.current && bars > 0) {
      fresh.current = false;
      void e.countInAndPlay(r.loopStart, bars, r.grid.bars, applyGains);
    } else {
      fresh.current = false;
      void e.play();
    }
  }, [applyGains]);

  // Render, then hand the result to the (one) engine.
  useEffect(() => {
    if (!loop) return;
    let cancelled = false;
    (async () => {
      try {
        const r = renderPractice(loop, renderBpm);
        let e = engine.current;
        if (!e) {
          creating.current ??= createEngine(r.stems);
          e = await creating.current;
          if (cancelled) return;
          engine.current = e;
        } else {
          e.replaceStems(r.stems);
        }
        e.setGrid(r.grid.bars, r.grid.beats);
        e.setLoop({ startFrame: r.loopStart, endFrame: r.loopEnd });
        e.seek(r.loopStart);
        e.setTempo(1);
        latest.current.rendered = r;
        setRendered(r);
        setError(null);
        loops.current = 0;
        setLoopsDone(0);
        setSeekNonce((n) => n + 1);
        fresh.current = true;
        applyGains();
        if (playingRef.current) start();
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loop, renderBpm, createEngine, applyGains, start]);

  useEffect(() => {
    applyGains();
  }, [settings.levels, instrument, applyGains]);

  // Ramp: watch for the wrap while playing.
  const ramp = settings.ramp;
  useEffect(() => {
    if (!playing || !ramp.on || !rendered) return;
    const barFrames = rendered.grid.medianBarSamples;
    let last = engine.current?.getPositionSamples() ?? 0;
    let handle = 0;
    // A ramp edited mid-play takes effect at once at the current step.
    engine.current?.setTempo(rampState(ramp, loops.current).bpm / ramp.start);
    const watch = () => {
      const now = engine.current?.getPositionSamples() ?? 0;
      if (now < last - barFrames) {
        loops.current += 1;
        setLoopsDone(loops.current);
        engine.current?.setTempo(rampState(ramp, loops.current).bpm / ramp.start);
      }
      last = now;
      handle = requestAnimationFrame(watch);
    };
    handle = requestAnimationFrame(watch);
    return () => cancelAnimationFrame(handle);
  }, [playing, ramp, rendered]);

  useEffect(
    () => () => {
      void engine.current?.dispose();
      engine.current = null;
    },
    [],
  );

  const togglePlay = useCallback(() => {
    if (error || !engine.current) return;
    if (playingRef.current) {
      playingRef.current = false;
      setPlaying(false);
      engine.current.pause();
    } else {
      start();
    }
  }, [error, start]);

  const getPosition = useCallback(() => engine.current?.getPositionSamples() ?? sampleIndex(0), []);

  return { rendered, playing, togglePlay, getPosition, seekNonce, loopsDone, error };
}
```

The ramp count lives in a ref that only a new render resets, so a pause and resume continue the ramp where it was. A changed ramp start re-renders (it is the render BPM). A changed target, step or every-loops applies at once at the current step, through the effect's first `setTempo`.

- [ ] **Step 4: Run the tests and typecheck**

Run: `npm --prefix frontend test -- --run src/practice/usePracticeSession.test.tsx && npm --prefix frontend run typecheck`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/practice/usePracticeSession.ts frontend/src/practice/usePracticeSession.test.tsx
git commit -m "feat(practice): one engine per visit, count-in, levels and the tempo ramp (D-22)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 15: The practice tab staff: whole loop, or gliding past 8 bars

**Files:**
- Create: `frontend/src/practice/practiceStaffPainter.ts`, test `practiceStaffPainter.test.ts`
- Create: `frontend/src/practice/PracticeStaff.tsx`

**Interfaces:**
- Consumes: `PracticeLoop` (Task 3); `STRING_NAMES` (Task 3); `Grid` (`music/grid.ts`); `PlayAlongColors`, `playAlongColors` (`playalong/colors.ts`); `useParentWidth` (`playalong/Neck.tsx`); `usePlayhead` (`songview/usePlayhead.ts`); `SampleIndex`.
- Produces:

```ts
export const VIEW_BEATS = 32;                       // 8 bars of 4/4
export function practiceStaffHeight(strings: number): number;
export function staffWindow(totalBeats: number, beat: number | null): { from: number; to: number; tiled: boolean };
export function beatAt(display: Grid, position: SampleIndex): number | null; // beats into the loop; null in the lead-in
export function chordNameAt(loop: PracticeLoop, bar: number): string;         // a repeat bar's chord, looked back
export function paintPracticeStaff(ctx: CanvasRenderingContext2D, view: {
  width: number; loop: PracticeLoop; beat: number | null; colors: PlayAlongColors;
}): void;
export function PracticeStaff(props: { loop: PracticeLoop; display: Grid; getPosition(): SampleIndex; playing: boolean; seekNonce: number }): JSX.Element;
```

- [ ] **Step 1: Write the failing painter tests**

`frontend/src/practice/practiceStaffPainter.test.ts`:

```ts
import { describe, expect, test, vi } from 'vitest';

import { DEFAULT_INSTRUMENT_SETTINGS } from '../api/client';
import { sampleIndex } from '../engine/types';
import { generate } from '../music/practice/generate';
import type { PlayAlongColors } from '../playalong/colors';
import { renderPractice } from './audio/render';
import { beatAt, chordNameAt, paintPracticeStaff, staffWindow } from './practiceStaffPainter';

const colors: PlayAlongColors = {
  note: 'teal', other: 'violet', hot: 'blue', approach: 'orange', next: 'grey', string: 's', fret: 'f', nut: 'n',
  label: 'l', board: 'b', onNote: 'black', raised: 'r', ground: 'g', text: 't', textDim: 'td',
};

function recording() {
  const texts: string[] = [];
  const fills: string[] = [];
  let fillStyle = '';
  const ctx = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'fillText') return (s: string) => texts.push(s);
        if (prop === 'fillRect') return () => fills.push(fillStyle);
        if (prop === 'fillStyle') return fillStyle;
        if (typeof prop === 'string') return vi.fn();
        return undefined;
      },
      set(_t, prop, value) {
        if (prop === 'fillStyle') fillStyle = value as string;
        return true;
      },
    },
  ) as unknown as CanvasRenderingContext2D;
  return { ctx, texts, fills };
}

const loopWith = (bars_per_chord: 1 | 4) => {
  const r = generate('bass', { ...DEFAULT_INSTRUMENT_SETTINGS, groove: { ...DEFAULT_INSTRUMENT_SETTINGS.groove, bars_per_chord } });
  if (!r.ok) throw new Error(r.error);
  return r.loop;
};

test('staffWindow: whole loop up to 8 bars; past that, 8 bars with the playhead a third in', () => {
  expect(staffWindow(16, 3)).toEqual({ from: 0, to: 16, tiled: false });
  expect(staffWindow(32, null)).toEqual({ from: 0, to: 32, tiled: false });
  expect(staffWindow(64, 20)).toEqual({ from: 20 - 32 / 3, to: 20 + 64 / 3, tiled: true });
});

test('beatAt: null in the lead-in, beats into the loop after', () => {
  const r = renderPractice(loopWith(1), 120);
  expect(beatAt(r.display, sampleIndex(0))).toBeNull();
  expect(beatAt(r.display, r.loopStart)).toBe(0);
  expect(beatAt(r.display, sampleIndex(r.loopStart + 36_000))).toBe(1.5);
});

test('chordNameAt looks back past repeats', () => {
  const loop = loopWith(4);
  expect(chordNameAt(loop, 6)).toBe('D');
  expect(chordNameAt(loop, -1)).toBe('C');
});

describe('paintPracticeStaff', () => {
  test('a 4-bar loop: every chord and every fret, nothing lit before the first bar', () => {
    const { ctx, texts, fills } = recording();
    paintPracticeStaff(ctx, { width: 1000, loop: loopWith(1), beat: null, colors });
    expect(texts.filter((t) => /^[A-G]/.test(t))).toEqual(['G', 'D', 'Em', 'C']);
    expect(texts.filter((t) => /^\d+$/.test(t))).toHaveLength(16);
    expect(fills).not.toContain('blue');
  });

  test('the sounding note is lit', () => {
    const { ctx, fills } = recording();
    paintPracticeStaff(ctx, { width: 1000, loop: loopWith(1), beat: 4.5, colors });
    // One for the current bar's tint in the chord row, one for the sounding chip.
    expect(fills.filter((f) => f === 'blue')).toHaveLength(2);
  });

  test('a 16-bar loop glides: repeats drawn %, but the first visible bar names its chord', () => {
    const { ctx, texts } = recording();
    paintPracticeStaff(ctx, { width: 1000, loop: loopWith(4), beat: 4 * 6 + 1, colors });
    const labels = texts.filter((t) => t === '%' || /^[A-G]/.test(t));
    expect(labels[0]).toBe('G');
    expect(labels).toContain('%');
    expect(labels).toContain('D');
    expect(labels).toContain('Em');
  });

  test('at the wrap the next pass is already drawn on the right', () => {
    const { ctx, texts } = recording();
    const loop = loopWith(4);
    paintPracticeStaff(ctx, { width: 1000, loop, beat: 63, colors });
    const labels = texts.filter((t) => t === '%' || /^[A-G]/.test(t));
    expect(labels).toContain('G'); // bar 1 of the next pass
  });
});
```

`chordNameAt(loop, 6)`: bars are G G G G D D D D …, and bar 6 (0-based) is the third D. `chordNameAt(loop, -1)` wraps to bar 15, a C repeat, so it looks back to C.

- [ ] **Step 2: Run them to see them fail**

Run: `npm --prefix frontend test -- --run src/practice/practiceStaffPainter.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the painter**

`frontend/src/practice/practiceStaffPainter.ts`:

```ts
// Drawing the Practice tab staff (D-22), apart from the component so it is
// testable against a recording context. A loop of up to 8 bars is drawn whole,
// fitted to the width. A longer one shows 8 bars with the playhead a third of
// the way in, the loop drawn end to end (tiled), so the view slides straight
// through the wrap instead of jumping back. Highest string on top (U-13); a
// chip's left edge is its onset. It never plays (invariant 7).
import type { SampleIndex } from '../engine/types';
import type { Grid } from '../music/grid';
import type { PracticeLoop } from '../music/practice/types';
import type { PlayAlongColors } from '../playalong/colors';

export const VIEW_BEATS = 32;
const CHORD_ROW_H = 44;
const PAD = 16;
const ROW = 40;
const CHIP_H = 28;

const mod = (n: number, m: number) => ((n % m) + m) % m;

export function practiceStaffHeight(strings: number): number {
  return CHORD_ROW_H + PAD + strings * ROW;
}

function stringY(strings: number, string: number): number {
  return CHORD_ROW_H + PAD / 2 + ROW / 2 + (strings - 1 - string) * ROW;
}

export function staffWindow(totalBeats: number, beat: number | null): { from: number; to: number; tiled: boolean } {
  if (totalBeats <= VIEW_BEATS) return { from: 0, to: totalBeats, tiled: false };
  const from = (beat ?? 0) - VIEW_BEATS / 3;
  return { from, to: from + VIEW_BEATS, tiled: true };
}

export function beatAt(display: Grid, position: SampleIndex): number | null {
  const first = display.bars[0]!;
  if (position < first) return null;
  return (position - first) / (display.medianBarSamples / display.beatsPerBar);
}

export function chordNameAt(loop: PracticeLoop, bar: number): string {
  const n = loop.bars.length;
  let i = mod(bar, n);
  for (let k = 0; k < n && loop.bars[i]!.repeat; k++) i = mod(i - 1, n);
  return loop.bars[i]!.label;
}

function line(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

export function paintPracticeStaff(
  ctx: CanvasRenderingContext2D,
  view: { width: number; loop: PracticeLoop; beat: number | null; colors: PlayAlongColors },
): void {
  const { width, loop, beat, colors } = view;
  const strings = loop.strings;
  const height = practiceStaffHeight(strings);
  const total = loop.bars.length * 4;
  const w = staffWindow(total, beat);
  const pxPerBeat = width / (w.to - w.from);
  const x = (b: number) => (b - w.from) * pxPerBeat;
  const nowBar = beat === null ? null : Math.floor(beat / 4);
  const fill = loop.instrument === 'guitar' ? colors.other : colors.note;
  ctx.clearRect(0, 0, width, height);

  // Chord row: the bar under the playhead tinted, repeats as "%", but the first bar in view always named.
  const firstBar = Math.floor(w.from / 4);
  const lastBar = Math.ceil(w.to / 4) - 1;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = '600 17px system-ui, sans-serif';
  for (let i = firstBar; i <= lastBar; i++) {
    const bar = loop.bars[mod(i, loop.bars.length)]!;
    if (i === nowBar) {
      ctx.globalAlpha = 0.12;
      ctx.fillStyle = colors.hot;
      ctx.fillRect(x(i * 4), 0, 4 * pxPerBeat, CHORD_ROW_H);
      ctx.globalAlpha = 1;
    }
    const text = bar.repeat && i !== firstBar ? '%' : chordNameAt(loop, i);
    if (!text) continue;
    ctx.fillStyle = i === nowBar ? colors.text : bar.repeat ? colors.label : colors.next;
    ctx.fillText(text, Math.max(x(i * 4), 0) + 10, CHORD_ROW_H / 2);
  }

  // Beat lines faint, bar lines bright (as on every time axis).
  for (let b = Math.ceil(w.from); b <= Math.floor(w.to); b++) {
    const isBar = mod(b, 4) === 0;
    ctx.globalAlpha = isBar ? 0.9 : 0.3;
    ctx.strokeStyle = colors.fret;
    ctx.lineWidth = isBar ? 2 : 1;
    line(ctx, x(b), isBar ? 0 : CHORD_ROW_H, x(b), height);
  }
  ctx.globalAlpha = 1;

  ctx.strokeStyle = colors.string;
  ctx.lineWidth = 2;
  for (let s = 0; s < strings; s++) line(ctx, 0, stringY(strings, s), width, stringY(strings, s));

  ctx.textAlign = 'center';
  for (const copy of w.tiled ? [-1, 0, 1] : [0]) {
    for (const note of loop.notes) {
      const start = note.start + copy * total;
      if (start + note.dur < w.from || start > w.to) continue;
      const hot = beat !== null && beat >= start && beat < start + note.dur;
      const cx = x(start) + 2;
      const cw = Math.max(10, note.dur * pxPerBeat - 4);
      const cy = stringY(strings, note.string) - CHIP_H / 2;
      if (hot) {
        ctx.fillStyle = colors.hot;
        ctx.fillRect(cx, cy, cw, CHIP_H);
      } else if (note.kind === 'approach') {
        ctx.fillStyle = colors.raised;
        ctx.fillRect(cx, cy, cw, CHIP_H);
        ctx.strokeStyle = fill;
        ctx.lineWidth = 2;
        ctx.strokeRect(cx, cy, cw, CHIP_H);
      } else {
        ctx.fillStyle = fill;
        ctx.fillRect(cx, cy, cw, CHIP_H);
      }
      ctx.fillStyle = note.kind === 'approach' && !hot ? fill : colors.onNote;
      ctx.font = `700 ${cw >= 26 ? 15 : cw >= 16 ? 12 : 10}px ui-monospace, monospace`;
      ctx.fillText(String(note.fret), cx + cw / 2, cy + CHIP_H / 2);
    }
  }

  if (beat !== null) {
    ctx.strokeStyle = colors.hot;
    ctx.lineWidth = 2;
    line(ctx, x(beat), 0, x(beat), height);
  }
}
```

The chord row's current-bar tint is a `colors.hot` `fillRect` too. That is why the lit test counts two, and why nothing is blue while `beat` is null.

- [ ] **Step 4: Run the tests**

Run: `npm --prefix frontend test -- --run src/practice/practiceStaffPainter.test.ts`
Expected: all pass.

- [ ] **Step 5: Write the stylesheet and the component**

`frontend/src/practice/Practice.module.css` (Task 17 appends the screen's layout to it):

```css
/* The Practice tab (D-22). Reference: the canvas mockup's Main artboard. Tokens only (U-02). */
.staff,
.neck {
  background: var(--ds-ground);
  border: 1px solid var(--ds-border);
  border-radius: var(--ds-r-panel);
  overflow: hidden;
}

.canvas {
  display: block;
  width: 100%;
}
```

`frontend/src/practice/PracticeStaff.tsx`:

```tsx
// The Practice tab staff (D-22): a canvas painted from the engine clock through
// usePlayhead, every frame while playing (the view glides), never from React
// state at audio rate (U-05). It draws; it never plays (invariant 7).
import { useCallback, useRef } from 'react';

import type { SampleIndex } from '../engine/types';
import type { Grid } from '../music/grid';
import type { PracticeLoop } from '../music/practice/types';
import { playAlongColors, type PlayAlongColors } from '../playalong/colors';
import { useParentWidth } from '../playalong/Neck';
import { usePlayhead } from '../songview/usePlayhead';
import styles from './Practice.module.css';
import { beatAt, paintPracticeStaff, practiceStaffHeight } from './practiceStaffPainter';

export interface PracticeStaffProps {
  loop: PracticeLoop;
  display: Grid;
  getPosition(): SampleIndex;
  playing: boolean;
  seekNonce: number;
}

export function PracticeStaff({ loop, display, getPosition, playing, seekNonce }: PracticeStaffProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const width = useParentWidth(canvasRef);
  const colors = useRef<PlayAlongColors | null>(null);
  const height = practiceStaffHeight(loop.strings);

  const paint = useCallback(
    (position: SampleIndex) => {
      const canvas = canvasRef.current;
      if (!canvas || width === 0) return;
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
        canvas.style.height = `${height}px`;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      colors.current ??= playAlongColors();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      paintPracticeStaff(ctx, { width, loop, beat: beatAt(display, position), colors: colors.current });
    },
    [width, height, loop, display],
  );
  usePlayhead(getPosition, paint, playing, seekNonce);

  return (
    <div className={styles.staff}>
      <canvas ref={canvasRef} className={styles.canvas} role="img" aria-label={`Tab, ${loop.bars.length} bars, looping`} />
    </div>
  );
}
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/practice/practiceStaffPainter.ts frontend/src/practice/practiceStaffPainter.test.ts frontend/src/practice/PracticeStaff.tsx frontend/src/practice/Practice.module.css
git commit -m "feat(practice): tab staff, whole loop or gliding past 8 bars (D-22)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```


---

### Task 16: A neck for single-note lines on 4 or 6 strings

**Files:**
- Modify: `frontend/src/playalong/neckPainter.ts`
- Test: `frontend/src/playalong/neckPainter.test.ts` (append)
- Create: `frontend/src/practice/PracticeNeck.tsx`, test `PracticeNeck.test.ts` (for the pure helper)

**Interfaces:**
- Produces (`neckPainter.ts`): `NeckLayout { names: readonly string[]; top: number; gap: number; height: number }`, `BASS_LAYOUT`, `GUITAR_LINE_LAYOUT`, and `paintNeck(ctx, width, colors, current, next, hot, layout = BASS_LAYOUT)`. The bass default draws exactly as before.
- Produces (`PracticeNeck.tsx`): `neckBarsOf(loop: PracticeLoop): NeckBar[]`, `hotIndex(loop, bar, beatInLoop): number`, `PracticeNeck` component with props `{ loop; display: Grid; getPosition(): SampleIndex; playing: boolean; seekNonce: number }`.

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/playalong/neckPainter.test.ts`:

```ts
import { GUITAR_LINE_LAYOUT } from './neckPainter';

describe('a six-string layout', () => {
  it('names six strings and keeps dots inside the narrower gap', () => {
    const { ctx, calls } = recordingContext();
    const bar = { notes: [{ name: 'A', position: { string: 5, fret: 5 } }] };
    paintNeck(ctx, 1200, colors, bar, null, -1, GUITAR_LINE_LAYOUT);
    // The string names are painted before the notes, so they are the first six single letters.
    const names = calls.fillText.map(([t]) => t).filter((t) => /^[EADGBe]$/.test(t)).slice(0, 6);
    expect(names).toEqual(['E', 'A', 'D', 'G', 'B', 'e']);
    expect(Math.max(...calls.arc)).toBeLessThanOrEqual(GUITAR_LINE_LAYOUT.gap * 0.48 + 1e-9);
  });
});
```


`frontend/src/practice/PracticeNeck.test.ts`:

```ts
import { expect, test } from 'vitest';

import { DEFAULT_INSTRUMENT_SETTINGS } from '../api/client';
import { generate } from '../music/practice/generate';
import { hotIndex, neckBarsOf } from './PracticeNeck';

test('one neck bar per loop bar, notes in order; drills show the finger', () => {
  const groove = generate('bass', DEFAULT_INSTRUMENT_SETTINGS);
  if (!groove.ok) throw new Error(groove.error);
  const bars = neckBarsOf(groove.loop);
  expect(bars).toHaveLength(4);
  // The fourth note is the approach into D: from below or above, as the seed's coin fell.
  expect(bars[0]!.notes.slice(0, 3).map((n) => n.name)).toEqual(['G', 'D', 'G']);
  expect(bars[0]!.notes[3]!.approach).toBe(true);
  expect(hotIndex(groove.loop, 0, 2.5)).toBe(2);
  expect(hotIndex(groove.loop, 1, 4.0)).toBe(0);

  const drill = generate('bass', { ...DEFAULT_INSTRUMENT_SETTINGS, exercise: 'drill' });
  if (!drill.ok) throw new Error(drill.error);
  expect(neckBarsOf(drill.loop)[0]!.notes.map((n) => n.name)).toEqual(['1', '2', '3', '4', '1', '2', '3', '4']);
});
```


- [ ] **Step 2: Run them to see them fail**

Run: `npm --prefix frontend test -- --run src/playalong/neckPainter.test.ts src/practice/PracticeNeck.test.ts`
Expected: FAIL (no `GUITAR_LINE_LAYOUT`; no `PracticeNeck`).

- [ ] **Step 3: Give `paintNeck` a layout**

In `frontend/src/playalong/neckPainter.ts`:

```ts
/** Strings and spacing. The bass default is exactly the Play along neck (D-18); Practice adds six strings (D-22). */
export interface NeckLayout {
  /** Low string first. */
  names: readonly string[];
  top: number;
  gap: number;
  height: number;
}
export const BASS_LAYOUT: NeckLayout = { names: ['E', 'A', 'D', 'G'], top: TOP, gap: STRING_GAP, height: NECK_H };
export const GUITAR_LINE_LAYOUT: NeckLayout = { names: ['E', 'A', 'D', 'G', 'B', 'e'], top: 40, gap: 30, height: 250 };

function yOf(layout: NeckLayout, string: number): number {
  return layout.top + layout.gap * (layout.names.length - 1 - string);
}
```

(Place these after the `TOP`/`STRING_GAP` constants. `STRINGS` is then unused, so delete it. `stringY` stays exported and unchanged.)

Change `paintNeck`'s signature to take `layout: NeckLayout = BASS_LAYOUT` as a seventh parameter. In its body:
- `top` becomes `yOf(layout, layout.names.length - 1) - 22`; `bottom` becomes `yOf(layout, 0) + 22`.
- `r` becomes `Math.min(21, layout.gap * 0.48, g.fretW * 0.48)`.
- `ctx.clearRect(0, 0, width, layout.height)`.
- The string loop becomes `for (let s = 0; s < layout.names.length; s++)`. Its `lineWidth` is `3.2 - s * (layout.names.length === 4 ? 0.6 : 0.45)`, it uses `yOf(layout, s)`, and its label is `layout.names[s]!`.
- Every other `stringY(…)` inside `paintNeck` becomes `yOf(layout, …)`.

For the bass default: `44 × 0.48 = 21.12`, so `r` is still `min(21, fretW × 0.48)`, and every coordinate is identical. The existing tests prove it.

- [ ] **Step 4: Write `PracticeNeck.tsx`**

```tsx
// The Practice neck for single-note lines (D-22): the current bar's notes
// numbered in order, the sounding one lit, the next bar as dashed rings; on 4
// or 6 strings (neckPainter's layouts). Drills show the finger on each dot.
// Painted from the engine clock (U-05); it never plays (invariant 7).
import { useCallback, useRef } from 'react';

import type { SampleIndex } from '../engine/types';
import type { Grid } from '../music/grid';
import type { PracticeLoop } from '../music/practice/types';
import { playAlongColors, type PlayAlongColors } from '../playalong/colors';
import { useParentWidth } from '../playalong/Neck';
import { BASS_LAYOUT, GUITAR_LINE_LAYOUT, paintNeck, type NeckBar } from '../playalong/neckPainter';
import { usePlayhead } from '../songview/usePlayhead';
import styles from './Practice.module.css';
import { beatAt } from './practiceStaffPainter';

export function neckBarsOf(loop: PracticeLoop): NeckBar[] {
  return loop.bars.map((_, b) => ({
    notes: loop.notes
      .filter((n) => n.start >= b * 4 && n.start < (b + 1) * 4)
      .map((n) => ({
        name: n.finger !== null ? String(n.finger) : n.name,
        position: { string: n.string, fret: n.fret },
        approach: n.kind === 'approach',
      })),
  }));
}

/** Index, within bar `bar`'s notes, of the one sounding at `beat` (beats into the loop), or -1. */
export function hotIndex(loop: PracticeLoop, bar: number, beat: number): number {
  const inBar = loop.notes.filter((n) => n.start >= bar * 4 && n.start < (bar + 1) * 4);
  return inBar.findIndex((n) => beat >= n.start && beat < n.start + n.dur);
}

export interface PracticeNeckProps {
  loop: PracticeLoop;
  display: Grid;
  getPosition(): SampleIndex;
  playing: boolean;
  seekNonce: number;
}

export function PracticeNeck({ loop, display, getPosition, playing, seekNonce }: PracticeNeckProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const width = useParentWidth(canvasRef);
  const colors = useRef<PlayAlongColors | null>(null);
  const bars = useRef<{ loop: PracticeLoop; bars: NeckBar[] } | null>(null);
  const last = useRef<string>('');
  const layout = loop.strings === 4 ? BASS_LAYOUT : GUITAR_LINE_LAYOUT;

  const paint = useCallback(
    (position: SampleIndex) => {
      const canvas = canvasRef.current;
      if (!canvas || width === 0) return;
      if (bars.current?.loop !== loop) bars.current = { loop, bars: neckBarsOf(loop) };
      const beat = beatAt(display, position);
      const bar = beat === null ? 0 : Math.floor(beat / 4) % loop.bars.length;
      const hot = beat === null ? -1 : hotIndex(loop, bar, beat % (loop.bars.length * 4));
      const key = `${width}:${bar}:${hot}:${beat === null}`;
      if (key === last.current && bars.current.loop === loop) return;
      last.current = key;
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(layout.height * dpr)) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(layout.height * dpr);
        canvas.style.height = `${layout.height}px`;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      colors.current ??= playAlongColors();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const current = bars.current.bars[bar] ?? null;
      const next = bars.current.bars[(bar + 1) % loop.bars.length] ?? null;
      canvas.setAttribute(
        'aria-label',
        `Bar ${bar + 1}: ${current?.notes.map((n) => n.name).join(' ') ?? ''}. Next: ${next?.notes.map((n) => n.name).join(' ') ?? ''}`,
      );
      paintNeck(ctx, width, colors.current, current, next, hot, layout);
    },
    [width, loop, display, layout],
  );
  usePlayhead(getPosition, paint, playing, seekNonce);

  return (
    <div className={styles.neck}>
      <canvas ref={canvasRef} className={styles.canvas} />
    </div>
  );
}
```

`hotIndex` takes the beat modulo the loop length. In the lead-in (`beat === null`) the neck shows bar 1 unlit, which tells the player where to put their hand during the count-in.

- [ ] **Step 5: Run the tests**

Run: `npm --prefix frontend test -- --run src/playalong src/practice/PracticeNeck.test.ts`
Expected: all pass, including every existing `neckPainter`, `Neck` and Tab view test.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/playalong/neckPainter.ts frontend/src/playalong/neckPainter.test.ts frontend/src/practice/PracticeNeck.tsx frontend/src/practice/PracticeNeck.test.ts
git commit -m "feat(practice): neck for single-note lines on four or six strings (D-22)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 17: Settings panel, rail, sound panel and help text

**Files:**
- Create: `frontend/src/practice/help.ts`
- Create: `frontend/src/practice/SettingsPanel.tsx`, test `SettingsPanel.test.tsx`
- Create: `frontend/src/practice/PracticeRail.tsx`, test `PracticeRail.test.tsx`
- Create: `frontend/src/practice/SoundPanel.tsx`, test `SoundPanel.test.tsx`
- Modify: `frontend/src/practice/Practice.module.css` (append)

**Interfaces:**
- Consumes: `Segmented`, `Stepper`, `Button`, `TextField` (`ui`); `PROGRESSIONS` (`music/progressions.ts`); `SCALES` (`music/spell.ts`); `HAND_SPAN` (Task 3); client types.
- Produces:
  - `KEY_NAMES: readonly string[]`, the 12 picker labels: `'C', 'C♯/D♭', 'D', 'D♯/E♭', 'E', 'F', 'F♯/G♭', 'G', 'G♯/A♭', 'A', 'A♯/B♭', 'B'`;
  - `helpFor(instrument, settings): string`;
  - `SettingsPanel({ instrument, settings, onChange(next: InstrumentSettings) })`;
  - `PracticeRail({ doc, onInstrument(i), onExercise(k), onLoadPreset(p), onSavePreset(name) })`;
  - `SoundPanel({ instrument, levels, onChange(next: PracticeLevels) })`.

- [ ] **Step 1: Write the failing tests**

`frontend/src/practice/SettingsPanel.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';

import { DEFAULT_INSTRUMENT_SETTINGS, type InstrumentSettings } from '../api/client';
import { SettingsPanel } from './SettingsPanel';

const show = (instrument: 'bass' | 'guitar', patch: Partial<InstrumentSettings> = {}) => {
  const onChange = vi.fn();
  render(<SettingsPanel instrument={instrument} settings={{ ...DEFAULT_INSTRUMENT_SETTINGS, ...patch }} onChange={onChange} />);
  return onChange;
};

test('the key picker shows both names on the black keys, and picks a pitch class', async () => {
  const onChange = show('bass');
  expect(screen.getByRole('button', { name: 'G', pressed: true })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'A♯/B♭' }));
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ key: 10 }));
});

test('bass groove: notes, rhythm, approach and bars per chord', async () => {
  const onChange = show('bass');
  expect(screen.getByRole('group', { name: 'Notes' })).toBeInTheDocument();
  expect(screen.getByRole('group', { name: 'Approach' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '4' }));
  expect(onChange.mock.calls[0]![0].groove.bars_per_chord).toBe(4);
});

test('guitar groove: shapes, strum, position instead', () => {
  show('guitar');
  expect(screen.getByRole('group', { name: 'Shapes' })).toBeInTheDocument();
  expect(screen.getByRole('group', { name: 'Strum' })).toBeInTheDocument();
  expect(screen.queryByRole('group', { name: 'Approach' })).toBeNull();
});

test('drills have no key, and say so', () => {
  show('bass', { exercise: 'drill' });
  expect(screen.queryByRole('group', { name: 'Key' })).toBeNull();
  expect(screen.getByText('Drills are fret-based: no key.')).toBeInTheDocument();
});

test('scales: a scale menu and a fret stepper', async () => {
  const onChange = show('bass', { exercise: 'scale' });
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Scale' }), 'blues');
  expect(onChange.mock.calls[0]![0].scale.scale).toBe('blues');
  await userEvent.click(screen.getByRole('button', { name: 'From fret up' }));
  expect(onChange.mock.calls[1]![0].scale.from_fret).toBe(6);
});
```

`frontend/src/practice/PracticeRail.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';

import { DEFAULT_INSTRUMENT_SETTINGS, DEFAULT_PRACTICE, type PracticeDoc } from '../api/client';
import { PracticeRail } from './PracticeRail';

const doc: PracticeDoc = {
  ...DEFAULT_PRACTICE,
  presets: [{ name: 'Blues warm-up', instrument: 'bass', settings: DEFAULT_INSTRUMENT_SETTINGS }],
};
afterEach(() => vi.restoreAllMocks());

function mount() {
  const handlers = { onInstrument: vi.fn(), onExercise: vi.fn(), onLoadPreset: vi.fn(), onSavePreset: vi.fn() };
  render(<PracticeRail doc={doc} {...handlers} />);
  return handlers;
}

test('instrument and exercise', async () => {
  const h = mount();
  await userEvent.click(screen.getByRole('button', { name: 'Guitar' }));
  expect(h.onInstrument).toHaveBeenCalledWith('guitar');
  expect(screen.getByRole('button', { name: /Groove over chords/ })).toHaveAttribute('aria-current', 'page');
  await userEvent.click(screen.getByRole('button', { name: /Technique drills/ }));
  expect(h.onExercise).toHaveBeenCalledWith('drill');
});

test('this instrument’s presets load; saving under an existing name asks first', async () => {
  const h = mount();
  await userEvent.click(screen.getByRole('button', { name: /Blues warm-up/ }));
  expect(h.onLoadPreset).toHaveBeenCalledWith(doc.presets[0]);
  await userEvent.click(screen.getByRole('button', { name: 'Save as preset…' }));
  await userEvent.type(screen.getByLabelText('Preset name'), 'blues WARM-UP');
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  await userEvent.click(screen.getByRole('button', { name: 'Save preset' }));
  expect(confirm).toHaveBeenCalledWith('Replace the preset "Blues warm-up"?');
  expect(h.onSavePreset).not.toHaveBeenCalled();
});
```

`frontend/src/practice/SoundPanel.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';

import { DEFAULT_INSTRUMENT_SETTINGS } from '../api/client';
import { SoundPanel } from './SoundPanel';

const levels = DEFAULT_INSTRUMENT_SETTINGS.levels;

test('bass: click and reference bass; chords and drums wait for Phase B', async () => {
  const onChange = vi.fn();
  render(<SoundPanel instrument="bass" levels={levels} onChange={onChange} />);
  await userEvent.click(screen.getByRole('button', { name: 'Mute Ref. bass' }));
  expect(onChange).toHaveBeenCalledWith({ ...levels, ref_muted: true });
  fireEvent.change(screen.getByRole('slider', { name: 'Click level' }), { target: { value: '0.3' } });
  expect(onChange).toHaveBeenLastCalledWith({ ...levels, click: 0.3 });
  expect(screen.getAllByText('Phase B')).toHaveLength(2);
  expect(screen.queryByRole('slider', { name: 'Backing bass level' })).toBeNull();
});

test('guitar: reference guitar and a backing bass', () => {
  render(<SoundPanel instrument="guitar" levels={levels} onChange={vi.fn()} />);
  expect(screen.getByRole('slider', { name: 'Ref. guitar level' })).toBeInTheDocument();
  expect(screen.getByRole('slider', { name: 'Backing bass level' })).toBeInTheDocument();
  expect(screen.getAllByText('Phase B')).toHaveLength(1);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npm --prefix frontend test -- --run src/practice/SettingsPanel.test.tsx src/practice/PracticeRail.test.tsx src/practice/SoundPanel.test.tsx`
Expected: FAIL, modules not found.

- [ ] **Step 3: Write `help.ts`**

```ts
// One plain sentence under the Practice screen saying what the exercise is and how to use it (the Theory tab's help box).
import type { InstrumentSettings, PracticeInstrument } from '../api/client';

export function helpFor(instrument: PracticeInstrument, s: InstrumentSettings): string {
  const ref = instrument === 'bass' ? 'reference bass' : 'reference guitar';
  const listen = `Listen to the ${ref} for a pass, press M to mute it, then play it yourself.`;
  switch (s.exercise) {
    case 'groove':
      return instrument === 'bass'
        ? `A bass line over the progression, from Play along's patterns. The approach note falls on the last beat before each chord change. ${listen}`
        : `Chord shapes and a strum over the progression, with a backing bass on the roots. ${listen}`;
    case 'scale':
      return `The scale in one hand position, or two octaves across the neck, walked by the path you choose. ${listen}`;
    case 'arpeggio':
      return `Each chord's tones from its root, cycling to fill the chord's bars. The hand stays as still as it can between chords. ${listen}`;
    case 'drill':
      return 'One finger per fret from the fret you choose, the index finger on the first. Keep every note even before you raise the tempo.';
  }
}
```

- [ ] **Step 4: Write `SettingsPanel.tsx`**

```tsx
// The Practice settings panel (D-22): the key, then the chosen exercise's own
// pickers. Every change is a whole new InstrumentSettings, saved through the
// screen's one funnel. Drills have no key; the panel says so instead.
import type { ReactNode } from 'react';

import type { BarsPerChord, InstrumentSettings, LineRhythm, PracticeInstrument } from '../api/client';
import { HAND_SPAN } from '../music/practice/neck';
import { PROGRESSIONS } from '../music/progressions';
import { SCALES } from '../music/spell';
import { Segmented, Stepper } from '../ui';
import styles from './Practice.module.css';

export const KEY_NAMES = ['C', 'C♯/D♭', 'D', 'D♯/E♭', 'E', 'F', 'F♯/G♭', 'G', 'G♯/A♭', 'A', 'A♯/B♭', 'B'] as const;

const opts = <T extends string>(pairs: readonly (readonly [T, string])[]) => pairs.map(([value, label]) => ({ value, label }));
const LINE_RHYTHM = opts<LineRhythm>([['quarter', 'Quarter'], ['eighth', 'Eighth'], ['triplet', 'Triplet'], ['sixteenth', '16th']]);
const BARS = opts<'1' | '2' | '4'>([['1', '1'], ['2', '2'], ['4', '4']]);

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.field}>
      <span className={styles.cap}>{label}</span>
      {children}
    </div>
  );
}

function ProgressionSelect({ value, onChange }: { value: string; onChange(id: string): void }) {
  return (
    <Field label="Progression">
      <select className={styles.select} aria-label="Progression" value={value} onChange={(e) => onChange(e.target.value)}>
        {PROGRESSIONS.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function SettingsPanel({
  instrument,
  settings: s,
  onChange,
}: {
  instrument: PracticeInstrument;
  settings: InstrumentSettings;
  onChange(next: InstrumentSettings): void;
}) {
  const groove = (patch: Partial<InstrumentSettings['groove']>) => onChange({ ...s, groove: { ...s.groove, ...patch } });
  const scale = (patch: Partial<InstrumentSettings['scale']>) => onChange({ ...s, scale: { ...s.scale, ...patch } });
  const arp = (patch: Partial<InstrumentSettings['arpeggio']>) => onChange({ ...s, arpeggio: { ...s.arpeggio, ...patch } });
  const drill = (patch: Partial<InstrumentSettings['drill']>) => onChange({ ...s, drill: { ...s.drill, ...patch } });

  return (
    <div className={styles.settings}>
      {s.exercise === 'drill' ? (
        <p className={styles.dim}>Drills are fret-based: no key.</p>
      ) : (
        <Field label="Key">
          <div className={styles.keys} role="group" aria-label="Key">
            {KEY_NAMES.map((name, pc) => (
              <button key={name} type="button" aria-pressed={s.key === pc} onClick={() => onChange({ ...s, key: pc })}>
                {name}
              </button>
            ))}
          </div>
        </Field>
      )}

      {s.exercise === 'groove' && (
        <>
          <ProgressionSelect value={s.groove.progression} onChange={(id) => groove({ progression: id as never })} />
          <Field label="Bars per chord">
            <Segmented label="Bars per chord" value={String(s.groove.bars_per_chord) as '1'} options={BARS} onChange={(v) => groove({ bars_per_chord: Number(v) as BarsPerChord })} />
          </Field>
          {instrument === 'bass' ? (
            <>
              <Field label="Notes">
                <Segmented label="Notes" value={s.groove.notes} onChange={(notes) => groove({ notes })}
                  options={opts([['root', 'Root'], ['root_fifth', '1–5'], ['root_fifth_octave', '1–5–8'], ['octave_pump', 'Octave'], ['triad_chord', 'Triad'], ['triad_diatonic', 'Diatonic triad'], ['seventh', '7th']] as const)} />
              </Field>
              <Field label="Rhythm">
                <Segmented label="Rhythm" value={s.groove.rhythm} onChange={(rhythm) => groove({ rhythm })}
                  options={opts([['whole', 'Whole'], ['half', 'Half'], ['quarter', 'Quarter'], ['eighth', 'Eighth']] as const)} />
              </Field>
              <Field label="Approach">
                <Segmented label="Approach" value={s.groove.approach} onChange={(approach) => groove({ approach })}
                  options={opts([['none', 'None'], ['chromatic', 'Chromatic'], ['scale', 'Scale'], ['fifth', 'Fifth']] as const)} />
              </Field>
            </>
          ) : (
            <>
              <Field label="Shapes">
                <Segmented label="Shapes" value={s.groove.style} onChange={(style) => groove({ style })}
                  options={opts([['open', 'Open'], ['barre', 'Barre'], ['power', 'Power'], ['triad', 'Triad']] as const)} />
              </Field>
              <Field label="Strum">
                <Segmented label="Strum" value={s.groove.strum} onChange={(strum) => groove({ strum })}
                  options={opts([['whole', 'Whole'], ['half', 'Half'], ['quarters', 'Quarters'], ['eighths', 'Eighths'], ['folk', 'Folk'], ['push', 'Push']] as const)} />
              </Field>
              <Field label="Position">
                <Segmented label="Position" value={s.groove.position} onChange={(position) => groove({ position })}
                  options={opts([['auto', 'Auto'], ['low', 'Low'], ['mid', 'Mid']] as const)} />
              </Field>
            </>
          )}
        </>
      )}

      {s.exercise === 'scale' && (
        <>
          <Field label="Scale">
            <select className={styles.select} aria-label="Scale" value={s.scale.scale} onChange={(e) => scale({ scale: e.target.value as never })}>
              {SCALES.map((sc) => (
                <option key={sc.id} value={sc.id}>
                  {sc.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Shape">
            <Segmented label="Shape" value={s.scale.shape} onChange={(shape) => scale({ shape })}
              options={opts([['position', 'One position'], ['two_octaves', 'Two octaves']] as const)} />
          </Field>
          <Field label="From fret">
            <Stepper label="From fret" value={s.scale.from_fret} min={0} max={12 - HAND_SPAN[instrument]} step={1} format={String} onChange={(from_fret) => scale({ from_fret })} />
          </Field>
          <Field label="Path">
            <Segmented label="Path" value={s.scale.path} onChange={(path) => scale({ path })}
              options={opts([['up', 'Up'], ['down', 'Down'], ['up_down', 'Up + down'], ['thirds', 'In 3rds'], ['groups3', 'Groups of 3'], ['groups4', 'Groups of 4']] as const)} />
          </Field>
          <Field label="Rhythm">
            <Segmented label="Rhythm" value={s.scale.rhythm} options={LINE_RHYTHM} onChange={(rhythm) => scale({ rhythm })} />
          </Field>
        </>
      )}

      {s.exercise === 'arpeggio' && (
        <>
          <Field label="Over">
            <Segmented label="Over" value={s.arpeggio.over} onChange={(over) => arp({ over })}
              options={opts([['chord', 'One chord'], ['progression', 'Progression']] as const)} />
          </Field>
          {s.arpeggio.over === 'progression' ? (
            <ProgressionSelect value={s.arpeggio.progression} onChange={(id) => arp({ progression: id as never })} />
          ) : (
            <Field label="Chord">
              <Segmented label="Chord" value={s.arpeggio.quality} onChange={(quality) => arp({ quality })}
                options={opts([['maj', 'maj'], ['min', 'm'], ['7', '7'], ['maj7', 'maj7'], ['min7', 'm7'], ['dim', 'dim'], ['hdim7', 'm7♭5']] as const)} />
            </Field>
          )}
          <Field label="Bars per chord">
            <Segmented label="Bars per chord" value={String(s.arpeggio.bars_per_chord) as '1'} options={BARS} onChange={(v) => arp({ bars_per_chord: Number(v) as BarsPerChord })} />
          </Field>
          <Field label="Tones">
            <Segmented label="Tones" value={s.arpeggio.tones} onChange={(tones) => arp({ tones })}
              options={opts([['triad', 'Triad'], ['seventh', '7th chord']] as const)} />
          </Field>
          <Field label="Path">
            <Segmented label="Path" value={s.arpeggio.path} onChange={(path) => arp({ path })}
              options={opts([['up', 'Up'], ['down', 'Down'], ['up_down', 'Up + down'], ['inversions', 'Inversions']] as const)} />
          </Field>
          <Field label="Rhythm">
            <Segmented label="Rhythm" value={s.arpeggio.rhythm} options={LINE_RHYTHM} onChange={(rhythm) => arp({ rhythm })} />
          </Field>
        </>
      )}

      {s.exercise === 'drill' && (
        <>
          <Field label="Drill">
            <Segmented label="Drill" value={s.drill.drill} onChange={(d) => drill({ drill: d })}
              options={opts([['chromatic', '1-2-3-4'], ['permutations', 'Permutations'], ['spider', 'Spider'], ['crossing', 'String crossing'], ['octaves', 'Octaves']] as const)} />
          </Field>
          <Field label="From fret">
            <Stepper label="From fret" value={s.drill.from_fret} min={1} max={9} step={1} format={String} onChange={(from_fret) => drill({ from_fret })} />
          </Field>
          <Field label="Direction">
            <Segmented label="Direction" value={s.drill.direction} onChange={(direction) => drill({ direction })}
              options={opts([['up', 'Across, up'], ['up_back', 'Up + back']] as const)} />
          </Field>
          <Field label="Rhythm">
            <Segmented label="Rhythm" value={s.drill.rhythm} options={LINE_RHYTHM} onChange={(rhythm) => drill({ rhythm })} />
          </Field>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Write `PracticeRail.tsx`**

```tsx
// The Practice rail (D-22): the instrument, the four exercises, and this
// instrument's presets. Saving under a name that exists asks before replacing
// it (the States mockup).
import { useState } from 'react';

import type { ExerciseKind, PracticeDoc, PracticeInstrument, PracticePreset } from '../api/client';
import { Button, Segmented, TextField } from '../ui';
import styles from './Practice.module.css';

const EXERCISES: { kind: ExerciseKind; label: string; sub: (i: PracticeInstrument) => string }[] = [
  { kind: 'groove', label: 'Groove over chords', sub: (i) => (i === 'bass' ? 'Progression + pattern' : 'Progression + strum') },
  { kind: 'scale', label: 'Scales & modes', sub: () => 'Positions and sequences' },
  { kind: 'arpeggio', label: 'Arpeggios', sub: () => 'Chord tones, triads and 7ths' },
  { kind: 'drill', label: 'Technique drills', sub: () => 'Chromatic, spider, crossing' },
];

export function PracticeRail({
  doc,
  onInstrument,
  onExercise,
  onLoadPreset,
  onSavePreset,
}: {
  doc: PracticeDoc;
  onInstrument(instrument: PracticeInstrument): void;
  onExercise(kind: ExerciseKind): void;
  onLoadPreset(preset: PracticePreset): void;
  onSavePreset(name: string): void;
}) {
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const settings = doc[doc.instrument];
  const presets = doc.presets.filter((p) => p.instrument === doc.instrument);

  const save = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const existing = doc.presets.find((p) => p.name.toLowerCase() === trimmed.toLowerCase());
    if (existing && !window.confirm(`Replace the preset "${existing.name}"?`)) return;
    onSavePreset(existing?.name ?? trimmed);
    setSaving(false);
    setName('');
  };

  return (
    <aside className={styles.rail}>
      <span className={styles.cap}>Instrument</span>
      <Segmented
        label="Instrument"
        value={doc.instrument}
        onChange={onInstrument}
        options={[
          { value: 'bass', label: 'Bass' },
          { value: 'guitar', label: 'Guitar' },
        ]}
      />
      <span className={styles.cap}>Exercise</span>
      {EXERCISES.map((e) => (
        <button
          key={e.kind}
          type="button"
          className={styles.railItem}
          aria-current={settings.exercise === e.kind ? 'page' : undefined}
          onClick={() => onExercise(e.kind)}
        >
          <span>{e.label}</span>
          <small>{e.sub(doc.instrument)}</small>
        </button>
      ))}
      <span className={styles.cap}>Presets</span>
      {presets.length === 0 && <p className={styles.dim}>No presets for {doc.instrument} yet.</p>}
      {presets.map((p) => (
        <button key={p.name} type="button" className={styles.railItem} onClick={() => onLoadPreset(p)}>
          <span>{p.name}</span>
          <small>
            {p.settings.exercise} · {p.settings.bpm} bpm
          </small>
        </button>
      ))}
      <div className={styles.railFoot}>
        {saving ? (
          <>
            <TextField id="preset-name" label="Preset name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
            <div className={styles.row}>
              <Button variant="ghost" onClick={() => setSaving(false)}>
                Cancel
              </Button>
              <Button variant="primary" onClick={save} disabled={!name.trim()}>
                Save preset
              </Button>
            </div>
          </>
        ) : (
          <Button onClick={() => setSaving(true)}>Save as preset…</Button>
        )}
        <small className={styles.dim}>Settings are kept between visits, per instrument. Presets are named snapshots of them.</small>
      </div>
    </aside>
  );
}
```

- [ ] **Step 6: Write `SoundPanel.tsx`**

```tsx
// The Practice sound panel (D-22): the click and the reference parts, each with
// a level and (for the parts you play against) a mute. Chords and drums are
// Phase B, shown disabled so the layout does not move when they arrive.
import type { PracticeInstrument, PracticeLevels } from '../api/client';
import styles from './Practice.module.css';

type LevelKey = 'click' | 'ref' | 'backing';
type MuteKey = 'ref_muted' | 'backing_muted';

function Channel({
  label,
  hue,
  level,
  muted,
  onLevel,
  onMute,
}: {
  label: string;
  hue: string;
  level: number;
  muted?: boolean;
  onLevel(v: number): void;
  onMute?: () => void;
}) {
  return (
    <div className={styles.channel}>
      <span className={styles.channelName} style={{ color: hue }}>
        {label}
      </span>
      {onMute && (
        <button type="button" className={styles.mute} aria-pressed={muted} aria-label={`Mute ${label}`} onClick={onMute}>
          M
        </button>
      )}
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={level}
        aria-label={`${label} level`}
        onChange={(e) => onLevel(Number(e.target.value))}
      />
    </div>
  );
}

function Later({ label, hue }: { label: string; hue: string }) {
  return (
    <div className={`${styles.channel} ${styles.later}`}>
      <span className={styles.channelName} style={{ color: hue }}>
        {label}
      </span>
      <span className={styles.chip}>Phase B</span>
    </div>
  );
}

export function SoundPanel({
  instrument,
  levels,
  onChange,
}: {
  instrument: PracticeInstrument;
  levels: PracticeLevels;
  onChange(next: PracticeLevels): void;
}) {
  const level = (key: LevelKey) => (v: number) => onChange({ ...levels, [key]: v });
  const mute = (key: MuteKey) => () => onChange({ ...levels, [key]: !levels[key] });
  return (
    <div className={styles.sound}>
      <span className={styles.cap}>Sound</span>
      <Channel label="Click" hue="var(--ds-text)" level={levels.click} onLevel={level('click')} />
      {instrument === 'bass' ? (
        <>
          <Channel label="Ref. bass" hue="var(--ds-bass)" level={levels.ref} muted={levels.ref_muted} onLevel={level('ref')} onMute={mute('ref_muted')} />
          <Later label="Chords" hue="var(--ds-other)" />
        </>
      ) : (
        <>
          <Channel label="Ref. guitar" hue="var(--ds-other)" level={levels.ref} muted={levels.ref_muted} onLevel={level('ref')} onMute={mute('ref_muted')} />
          <Channel label="Backing bass" hue="var(--ds-bass)" level={levels.backing} muted={levels.backing_muted} onLevel={level('backing')} onMute={mute('backing_muted')} />
        </>
      )}
      <Later label="Drums" hue="var(--ds-drums)" />
    </div>
  );
}
```

The stem hues name a part (U-01: muted hues identify a stem), so the labels take them. The mute's lit state is the warn fill, as on the Stems mixer.

- [ ] **Step 7: Append the screen's styles to `Practice.module.css`**

```css
.layout {
  display: flex;
  min-height: calc(100vh - 65px);
}

.content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--ds-4);
  padding: var(--ds-4);
}

.cap {
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-size: var(--ds-t-xs);
  font-weight: 600;
  color: var(--ds-text-3);
}

.dim {
  color: var(--ds-text-3);
  font-size: var(--ds-t-sm);
  margin: 0;
}

.row {
  display: flex;
  gap: var(--ds-3);
  align-items: center;
  flex-wrap: wrap;
}

.panel {
  background: var(--ds-surface);
  border: 1px solid var(--ds-border);
  border-radius: var(--ds-r-panel);
  padding: var(--ds-4);
}

/* ---- rail ---- */
.rail {
  width: 264px;
  flex: none;
  display: flex;
  flex-direction: column;
  gap: var(--ds-2);
  padding: var(--ds-4) var(--ds-3);
  background: var(--ds-surface);
  border-right: 1px solid var(--ds-border);
}

.railItem {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  min-height: var(--ds-hit-setup);
  padding: var(--ds-2) var(--ds-3);
  border: 0;
  border-radius: var(--ds-r-btn);
  background: transparent;
  color: var(--ds-text-2);
  font: 400 var(--ds-t-sm) / 1.3 var(--ds-font);
  text-align: left;
  cursor: pointer;
}

.railItem small {
  font-size: var(--ds-t-xs);
  color: var(--ds-text-3);
}

.railItem:hover {
  background: var(--ds-raised);
  color: var(--ds-text);
}

.railItem[aria-current='page'] {
  background: var(--ds-overlay);
  color: var(--ds-text);
}

.railFoot {
  margin-top: auto;
  padding-top: var(--ds-3);
  border-top: 1px solid var(--ds-border);
  display: flex;
  flex-direction: column;
  gap: var(--ds-2);
}

/* ---- settings ---- */
.settings {
  background: var(--ds-surface);
  border: 1px solid var(--ds-border);
  border-radius: var(--ds-r-panel);
  padding: var(--ds-4);
  display: flex;
  flex-wrap: wrap;
  gap: var(--ds-4) var(--ds-5);
  align-items: flex-end;
}

.field {
  display: flex;
  flex-direction: column;
  gap: var(--ds-1);
}

.keys {
  display: flex;
  gap: var(--ds-1);
  flex-wrap: wrap;
}

.keys > button {
  min-width: 44px;
  height: var(--ds-hit-setup);
  padding: 0 var(--ds-2);
  border-radius: var(--ds-r-btn);
  background: var(--ds-raised);
  border: 1px solid var(--ds-border);
  font: 600 var(--ds-t-sm) / 1 var(--ds-font);
  color: var(--ds-text-2);
  cursor: pointer;
}

.keys > button[aria-pressed='true'] {
  background: var(--ds-accent);
  border-color: var(--ds-accent);
  color: var(--ds-on-accent);
}

.select {
  height: var(--ds-hit-setup);
  padding: 0 var(--ds-3);
  background: var(--ds-ground);
  border: 1px solid var(--ds-border-strong);
  border-radius: var(--ds-r-input);
  color: var(--ds-text);
  font: 400 var(--ds-t-sm) / 1 var(--ds-font);
}

/* ---- sound ---- */
.sound {
  background: var(--ds-surface);
  border: 1px solid var(--ds-border);
  border-radius: var(--ds-r-panel);
  padding: var(--ds-4);
  display: flex;
  flex-wrap: wrap;
  gap: var(--ds-4) var(--ds-6);
  align-items: center;
}

.channel {
  display: flex;
  align-items: center;
  gap: var(--ds-3);
  min-width: 220px;
}

.channel input[type='range'] {
  flex: 1;
  accent-color: var(--ds-accent);
}

.channelName {
  width: 104px;
  font-weight: 600;
  font-size: var(--ds-t-sm);
}

.mute {
  width: 40px;
  height: 40px;
  border-radius: var(--ds-r-btn);
  border: 1px solid var(--ds-border-strong);
  background: var(--ds-raised);
  color: var(--ds-text-2);
  font-weight: 700;
  cursor: pointer;
}

.mute[aria-pressed='true'] {
  background: var(--ds-warn);
  border-color: var(--ds-warn);
  color: var(--ds-on-warn);
}

.later {
  opacity: 0.45;
}

.chip {
  display: inline-flex;
  align-items: center;
  height: 28px;
  padding: 0 var(--ds-3);
  border-radius: var(--ds-r-pill);
  background: var(--ds-raised);
  border: 1px solid var(--ds-border-strong);
  font: 600 var(--ds-t-xs) / 1 var(--ds-font);
  color: var(--ds-text-2);
}

/* ---- help ---- */
.help {
  background: var(--ds-surface);
  border: 1px solid var(--ds-border);
  border-left: 3px solid var(--ds-accent);
  border-radius: var(--ds-r-btn);
  padding: var(--ds-3) var(--ds-4);
  font-size: var(--ds-t-sm);
  color: var(--ds-text-2);
  margin: 0;
}

@media (max-width: 760px) {
  .layout {
    flex-direction: column;
  }
  .rail {
    width: auto;
    border-right: 0;
    border-bottom: 1px solid var(--ds-border);
  }
}
```


- [ ] **Step 8: Run the tests and typecheck**

Run: `npm --prefix frontend test -- --run src/practice && npm --prefix frontend run typecheck`
Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/practice
git commit -m "feat(practice): settings panel, rail with presets, sound panel (D-22)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 18: Transport and ramp strip

**Files:**
- Create: `frontend/src/practice/PracticeTransport.tsx`, test `PracticeTransport.test.tsx`
- Create: `frontend/src/practice/RampStrip.tsx`
- Modify: `frontend/src/practice/Practice.module.css` (append)

**Interfaces:**
- Consumes: `PracticeSession` (Task 14); `rampLimits`, `rampState`, `tapTempo`, `BPM_MIN`, `BPM_MAX` (Task 13); `beatAt`, `chordNameAt` (Task 15); `STRING_NAMES` (Task 3); `usePlayhead`; `Stepper`, `Button`, `Popover`, `Segmented` (`ui`).
- Produces: `PracticeTransport({ session, settings, loop, canRegenerate, onSettings(next), onRegenerate() })`; `RampStrip({ ramp, loopsDone })`; `nowAndNext(loop, beat): { cap: string; now: string; next: string }`.

- [ ] **Step 1: Write the failing tests**

`frontend/src/practice/PracticeTransport.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';

import { DEFAULT_INSTRUMENT_SETTINGS, type InstrumentSettings } from '../api/client';
import { sampleIndex } from '../engine/types';
import { generate } from '../music/practice/generate';
import { renderPractice } from './audio/render';
import { nowAndNext, PracticeTransport } from './PracticeTransport';
import type { PracticeSession } from './usePracticeSession';

function loop(settings: InstrumentSettings = DEFAULT_INSTRUMENT_SETTINGS) {
  const r = generate('bass', settings);
  if (!r.ok) throw new Error(r.error);
  return r.loop;
}

function session(overrides: Partial<PracticeSession> = {}): PracticeSession {
  const l = loop();
  return {
    rendered: renderPractice(l, 100),
    playing: false,
    togglePlay: vi.fn(),
    getPosition: () => sampleIndex(0),
    seekNonce: 0,
    loopsDone: 0,
    error: null,
    ...overrides,
  };
}

test('nowAndNext: the chord for grooves, the note for scales, the string for drills', () => {
  expect(nowAndNext(loop(), 5)).toEqual({ cap: 'chord', now: 'D', next: 'Em' });
  const scale = loop({ ...DEFAULT_INSTRUMENT_SETTINGS, exercise: 'scale', key: 9 });
  expect(nowAndNext(scale, 0)).toEqual({ cap: 'note', now: 'A', next: 'C' });
  const drill = loop({ ...DEFAULT_INSTRUMENT_SETTINGS, exercise: 'drill' });
  expect(nowAndNext(drill, 2)).toEqual({ cap: 'string', now: 'A string', next: 'A' });
});

test('play, bpm, count-in and regenerate', async () => {
  const s = session();
  const onSettings = vi.fn();
  const onRegenerate = vi.fn();
  render(
    <PracticeTransport session={s} settings={DEFAULT_INSTRUMENT_SETTINGS} loop={loop()} canRegenerate onSettings={onSettings} onRegenerate={onRegenerate} />,
  );
  await userEvent.click(screen.getByRole('button', { name: 'Play' }));
  expect(s.togglePlay).toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Faster' }));
  expect(onSettings).toHaveBeenLastCalledWith(expect.objectContaining({ bpm: 101 }));
  await userEvent.click(screen.getByRole('button', { name: '2' }));
  expect(onSettings).toHaveBeenLastCalledWith(expect.objectContaining({ count_in_bars: 2 }));
  await userEvent.click(screen.getByRole('button', { name: /Regenerate/ }));
  expect(onRegenerate).toHaveBeenCalled();
});

test('the ramp editor cannot pass the engine’s range, and says why', async () => {
  const onSettings = vi.fn();
  const settings = { ...DEFAULT_INSTRUMENT_SETTINGS, ramp: { ...DEFAULT_INSTRUMENT_SETTINGS.ramp, on: true } };
  render(<PracticeTransport session={session()} settings={settings} loop={loop()} canRegenerate={false} onSettings={onSettings} onRegenerate={vi.fn()} />);
  expect(screen.queryByRole('button', { name: /Regenerate/ })).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Edit ramp' }));
  expect(screen.getByRole('button', { name: 'Ramp target up' })).toBeDisabled(); // 120 = 80 × 1.5
  expect(screen.getByText('The engine stretches 0.5–1.5× of the start, so 40–120 bpm from 80.')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npm --prefix frontend test -- --run src/practice/PracticeTransport.test.tsx`
Expected: FAIL, module not found.

- [ ] **Step 3: Write `PracticeTransport.tsx` and `RampStrip.tsx`**

`frontend/src/practice/PracticeTransport.tsx`:

```tsx
// The Practice transport (D-22), perform tier: play, the bar and beat, now →
// next, BPM (with tap), the ramp, the count-in and Regenerate. The readouts are
// written from the engine clock straight into the DOM (U-05), never through
// React state at audio rate.
import { useCallback, useRef, useState } from 'react';

import type { InstrumentSettings } from '../api/client';
import { STRING_NAMES } from '../music/practice/neck';
import type { PracticeLoop } from '../music/practice/types';
import { usePlayhead } from '../songview/usePlayhead';
import { Button, Popover, Segmented, Stepper } from '../ui';
import styles from './Practice.module.css';
import { beatAt, chordNameAt } from './practiceStaffPainter';
import { BPM_MAX, BPM_MIN, rampLimits, tapTempo } from './tempo';
import type { PracticeSession } from './usePracticeSession';

export function nowAndNext(loop: PracticeLoop, beat: number): { cap: string; now: string; next: string } {
  const total = loop.bars.length * 4;
  const b = ((beat % total) + total) % total;
  const bar = Math.floor(b / 4);
  if (loop.notes.some((n) => n.finger !== null)) {
    const i = loop.notes.findIndex((n) => b >= n.start && b < n.start + n.dur);
    const names = STRING_NAMES[loop.instrument];
    const now = loop.notes[Math.max(0, i)]!;
    const next = loop.notes[(Math.max(0, i) + 1) % loop.notes.length]!;
    return { cap: 'string', now: `${names[now.string]} string`, next: names[next.string]! };
  }
  if (loop.bars.every((x, i) => i === 0 || x.label === '')) {
    const i = loop.notes.findIndex((n) => b >= n.start && b < n.start + n.dur);
    const now = loop.notes[Math.max(0, i)]!;
    return { cap: 'note', now: now.name, next: loop.notes[(Math.max(0, i) + 1) % loop.notes.length]!.name };
  }
  const now = chordNameAt(loop, bar);
  let j = bar + 1;
  while (j < bar + loop.bars.length && chordNameAt(loop, j) === now) j++;
  return { cap: 'chord', now, next: chordNameAt(loop, j) };
}

export function PracticeTransport({
  session,
  settings,
  loop,
  canRegenerate,
  onSettings,
  onRegenerate,
}: {
  session: PracticeSession;
  settings: InstrumentSettings;
  /** Null while the exercise does not fit: the transport stays, Play is disabled, the readouts show "–". */
  loop: PracticeLoop | null;
  canRegenerate: boolean;
  onSettings(next: InstrumentSettings): void;
  onRegenerate(): void;
}) {
  const barRef = useRef<HTMLSpanElement | null>(null);
  const beatRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const nowRef = useRef<HTMLSpanElement | null>(null);
  const capRef = useRef<HTMLSpanElement | null>(null);
  const [rampOpen, setRampOpen] = useState(false);
  const taps = useRef<number[]>([]);
  const display = session.rendered?.display;

  const paint = useCallback(
    (position: number) => {
      if (!display || !loop) return;
      const beat = beatAt(display, position as never);
      const inLoop = beat === null ? null : beat % (loop.bars.length * 4);
      if (barRef.current) barRef.current.textContent = inLoop === null ? '–' : String(Math.floor(inLoop / 4) + 1);
      beatRefs.current.forEach((el, i) => el?.setAttribute('data-on', String(inLoop !== null && Math.floor(inLoop % 4) === i)));
      const nn = nowAndNext(loop, inLoop ?? 0);
      if (capRef.current) capRef.current.textContent = nn.cap;
      if (nowRef.current) nowRef.current.textContent = `${nn.now} → ${nn.next}`;
    },
    [display, loop],
  );
  usePlayhead(session.getPosition, paint, session.playing, session.seekNonce);

  const set = (patch: Partial<InstrumentSettings>) => onSettings({ ...settings, ...patch });
  const ramp = settings.ramp;
  const setRamp = (patch: Partial<InstrumentSettings['ramp']>) => set({ ramp: { ...ramp, ...patch } });
  const limits = rampLimits(ramp.start);

  const tap = () => {
    taps.current = [...taps.current, performance.now()].slice(-8);
    const bpm = tapTempo(taps.current);
    if (bpm !== null) set({ bpm });
  };

  return (
    <div className={styles.transport}>
      <button type="button" className={styles.play} aria-label={session.playing ? 'Pause' : 'Play'} onClick={session.togglePlay} disabled={!loop || !session.rendered || session.error !== null}>
        {session.playing ? '❚❚' : '▶'}
      </button>
      <div className={styles.readout}>
        <span className={styles.cap}>bar</span>
        <span className={styles.big}>
          <span ref={barRef}>–</span>
          <span className={styles.dim}> / {loop?.bars.length ?? '–'}</span>
        </span>
      </div>
      <div className={styles.readout} aria-hidden="true">
        <span className={styles.cap}>beat</span>
        <span className={styles.beats}>
          {[0, 1, 2, 3].map((i) => (
            <span key={i} ref={(el) => void (beatRefs.current[i] = el)} className={i === 0 ? styles.downbeat : styles.beat} data-on="false" />
          ))}
        </span>
      </div>
      <div className={styles.readout}>
        <span className={styles.cap} ref={capRef}>
          chord
        </span>
        <span className={styles.chord} ref={nowRef} />
      </div>
      <div className={styles.grow} />
      <div className={styles.readout}>
        <span className={styles.cap}>{ramp.on ? 'bpm · ramping' : 'bpm'}</span>
        <div className={styles.row}>
          <Stepper
            tier="perform"
            label="Tempo"
            downLabel="Slower"
            upLabel="Faster"
            value={ramp.on ? ramp.start : settings.bpm}
            min={BPM_MIN}
            max={BPM_MAX}
            step={1}
            format={String}
            onChange={(v) => (ramp.on ? setRamp({ start: v, target: Math.min(Math.max(ramp.target, rampLimits(v).lo), rampLimits(v).hi) }) : set({ bpm: v }))}
          />
          <Button tier="perform" onClick={tap}>
            Tap
          </Button>
        </div>
      </div>
      <Popover
        open={rampOpen}
        onClose={() => setRampOpen(false)}
        label="Tempo ramp"
        trigger={
          <div className={styles.row}>
            <Button tier="perform" aria-pressed={ramp.on} onClick={() => setRamp({ on: !ramp.on, start: ramp.on ? ramp.start : settings.bpm, target: Math.min(rampLimits(settings.bpm).hi, Math.max(ramp.target, settings.bpm)) })}>
              Ramp
            </Button>
            <Button tier="perform" variant="ghost" aria-label="Edit ramp" aria-expanded={rampOpen} onClick={() => setRampOpen((o) => !o)}>
              ▾
            </Button>
          </div>
        }
      >
        <div className={styles.field}>
          <span className={styles.cap}>From</span>
          <Stepper label="Ramp start" value={ramp.start} min={BPM_MIN} max={BPM_MAX} step={5} format={(v) => `${v} bpm`} onChange={(start) => setRamp({ start, target: Math.min(Math.max(ramp.target, rampLimits(start).lo), rampLimits(start).hi) })} />
        </div>
        <div className={styles.field}>
          <span className={styles.cap}>To</span>
          <Stepper label="Ramp target" value={ramp.target} min={limits.lo} max={limits.hi} step={5} format={(v) => `${v} bpm`} onChange={(target) => setRamp({ target })} />
        </div>
        <p className={styles.dim}>
          The engine stretches 0.5–1.5× of the start, so {limits.lo}–{limits.hi} bpm from {ramp.start}.
        </p>
        <div className={styles.field}>
          <span className={styles.cap}>Step</span>
          <Stepper label="Ramp step" value={ramp.step} min={1} max={20} step={1} format={(v) => `+${v} bpm`} onChange={(step) => setRamp({ step })} />
        </div>
        <div className={styles.field}>
          <span className={styles.cap}>Every</span>
          <Stepper label="Ramp every" value={ramp.every_loops} min={1} max={8} step={1} format={(v) => (v === 1 ? '1 loop' : `${v} loops`)} onChange={(every_loops) => setRamp({ every_loops })} />
        </div>
      </Popover>
      <div className={styles.readout}>
        <span className={styles.cap}>count-in</span>
        <Segmented
          label="Count-in bars"
          value={String(settings.count_in_bars) as '0'}
          onChange={(v) => set({ count_in_bars: Number(v) as 0 | 1 | 2 })}
          options={[
            { value: '0', label: 'Off' },
            { value: '1', label: '1' },
            { value: '2', label: '2' },
          ]}
        />
      </div>
      {canRegenerate && (
        <Button tier="perform" onClick={onRegenerate}>
          ⟳ Regenerate
        </Button>
      )}
    </div>
  );
}
```

The test clicks `'2'` for the count-in. `SettingsPanel` is not rendered in that test, so the name is unique there.

`frontend/src/practice/RampStrip.tsx`:

```tsx
// The ramp's progress (D-22): range, rule, a bar, and where in it the player is.
import type { PracticeRamp } from '../api/client';
import { ProgressBar } from '../ui';
import styles from './Practice.module.css';
import { rampState } from './tempo';

export function RampStrip({ ramp, loopsDone }: { ramp: PracticeRamp; loopsDone: number }) {
  const state = rampState(ramp, loopsDone);
  const where =
    state.loopInStep === null
      ? `holding at ${state.bpm} bpm`
      : `${state.bpm} bpm · step ${state.step + 1} of ${state.steps + 1} · loop ${state.loopInStep} of ${ramp.every_loops}`;
  return (
    <div className={styles.rampStrip} role="status">
      <span className={styles.chip}>Ramp</span>
      <span>
        <b>
          {ramp.start} → {ramp.target} bpm
        </b>
        , {ramp.target >= ramp.start ? '+' : '−'}
        {ramp.step} every {ramp.every_loops === 1 ? 'loop' : `${ramp.every_loops} loops`}
      </span>
      <ProgressBar label="Ramp progress" value={state.steps === 0 ? 1 : state.step / state.steps} />
      <span className={styles.dim}>{where}</span>
    </div>
  );
}
```

(`ProgressBar` takes a 0..1 fraction and an accessible `label`.)

Append to `Practice.module.css`:

```css
/* ---- transport ---- */
.transport {
  background: var(--ds-surface);
  border: 1px solid var(--ds-border);
  border-radius: var(--ds-r-panel);
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--ds-3) var(--ds-5);
  padding: var(--ds-3) var(--ds-4);
}

.play {
  width: var(--ds-hit-perform);
  height: var(--ds-hit-perform);
  border-radius: var(--ds-r-btn);
  border: 1px solid var(--ds-accent);
  background: var(--ds-accent);
  color: var(--ds-on-accent);
  font-size: 22px;
  cursor: pointer;
}

.play:disabled {
  opacity: 0.4;
  cursor: default;
}

.readout {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.big {
  font: 600 var(--ds-t-xl) / 1 var(--ds-mono);
  font-variant-numeric: tabular-nums;
}

.chord {
  font: 600 var(--ds-t-lg) / 1 var(--ds-font);
  white-space: nowrap;
}

.beats {
  display: flex;
  gap: 10px;
  align-items: center;
  height: 32px;
}

.beat,
.downbeat {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 2px solid var(--ds-border-strong);
}

.downbeat {
  width: 22px;
  height: 22px;
}

.beat[data-on='true'],
.downbeat[data-on='true'] {
  background: var(--ds-accent);
  border-color: var(--ds-accent);
}

.grow {
  flex: 1;
}

.rampStrip {
  background: var(--ds-surface);
  border: 1px solid var(--ds-border);
  border-radius: var(--ds-r-panel);
  display: flex;
  align-items: center;
  gap: var(--ds-4);
  padding: var(--ds-2) var(--ds-4);
  font-size: var(--ds-t-sm);
  color: var(--ds-text-2);
}

.rampStrip b {
  color: var(--ds-text);
}

.rampStrip > :nth-child(3) {
  flex: 1;
}
```

- [ ] **Step 4: Run the tests and typecheck**

Run: `npm --prefix frontend test -- --run src/practice && npm --prefix frontend run typecheck`
Expected: all pass. `nowAndNext(drill, 2)`: at beat 2 the drill plays its fifth note, A string fret 5. The next note is A6, so `next` is `'A'`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/practice
git commit -m "feat(practice): transport with tap tempo, ramp editor, count-in; ramp strip (D-22)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 19: The Practice screen, its route and the navbar

**Files:**
- Create: `frontend/src/screens/Practice.tsx`, test `Practice.test.tsx`
- Modify: `frontend/src/app/routes.tsx`, `frontend/src/app/AppShell.tsx`
- Modify: `frontend/src/practice/Practice.module.css` (append)

**Interfaces:**
- Consumes: everything above; `GuitarNeck`, `StrumLane` (`playalong/`); `Banner`, `Button`, `Loader` (`ui`).
- Produces: `Practice({ createEngine? })`, the route `/practice`, and the navbar item "Practice" between Theory and Job queue.

Screen behaviour:
- **Settings funnel:** `change(next)` writes `doc[doc.instrument] = next` through `update()`.
- **Loop:** `useMemo(() => generate(doc.instrument, settings), [doc.instrument, settings-without-levels-and-ramp-and-count-in])`. Levels, the ramp's target, step and every-loops, and the count-in must **not** regenerate. Key the memo on a JSON string of the note-affecting fields:
  `exercise, key, seed, groove, scale, arpeggio, drill`. The render BPM is the session's business (Task 14).
- **Generate error:** an error banner with the message and one button per fix (`change(fix.apply(settings))`). Nothing plays.
- **Session error:** an error banner, title "Can't play", trace = the message.
- **Load or save errors** for `practice.json`: as on the Theory screen. A load error shows the trace, Try again, and Reset to defaults… (confirmed). A save error shows a warning with Retry.
- **Space** plays and pauses, with the same text-field rules as `songview/Transport.tsx`.
- **Regenerate:** `change({ ...settings, seed: newSeed() })`.
- **Presets:** load copies a preset's settings into the current instrument. Save replaces or appends `{ name, instrument, settings }`.

- [ ] **Step 1: Write the failing screen tests**

`frontend/src/screens/Practice.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { DEFAULT_PRACTICE, type PracticeDoc } from '../api/client';
import { sampleIndex } from '../engine/types';
import type { PracticeEngine } from '../practice/usePracticeSession';
import { Practice } from './Practice';

let puts: PracticeDoc[];
function serve(doc: PracticeDoc = DEFAULT_PRACTICE) {
  puts = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url !== '/api/practice') throw new Error(`unexpected fetch: ${url}`);
      if (init?.method === 'PUT') {
        puts.push(JSON.parse(String(init.body)));
        return new Response(String(init.body));
      }
      return new Response(JSON.stringify(doc));
    }),
  );
}

const engine = (): PracticeEngine => ({
  replaceStems: vi.fn(), setGrid: vi.fn(), setLoop: vi.fn(), seek: vi.fn(), play: vi.fn(async () => {}),
  pause: vi.fn(), countInAndPlay: vi.fn(async () => {}), setStemGain: vi.fn(), setMetronome: vi.fn(),
  setMetronomeLevel: vi.fn(), setTempo: vi.fn(), getPositionSamples: () => sampleIndex(0), dispose: vi.fn(async () => {}),
});

function mount(createEngine = async () => engine()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Practice createEngine={createEngine} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('cancelAnimationFrame', () => {});
});
afterEach(() => vi.unstubAllGlobals());

test('opens on the saved exercise, ready to play', async () => {
  serve();
  mount();
  await screen.findByRole('button', { name: 'Play' });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Play' })).toBeEnabled());
  expect(screen.getByRole('img', { name: 'Tab, 4 bars, looping' })).toBeInTheDocument();
  expect(screen.getByText(/approach note falls on the last beat/)).toBeInTheDocument();
});

test('switching to guitar keeps each instrument’s settings and shows the strum', async () => {
  serve();
  mount();
  await userEvent.click(await screen.findByRole('button', { name: 'Guitar' }));
  expect(screen.getByRole('group', { name: 'Strum' })).toBeInTheDocument();
  await waitFor(() => expect(puts.at(-1)?.instrument).toBe('guitar'), { timeout: 2000 });
  expect(puts.at(-1)!.bass).toEqual(DEFAULT_PRACTICE.bass);
});

test('an exercise that does not fit says why, offers fixes, and nothing plays', async () => {
  serve({ ...DEFAULT_PRACTICE, bass: { ...DEFAULT_PRACTICE.bass, exercise: 'scale', key: 2, scale: { ...DEFAULT_PRACTICE.bass.scale, scale: 'blues', shape: 'two_octaves', from_fret: 9 } } });
  mount();
  expect(await screen.findByText(/Two octaves of D Blues do not fit from fret 9/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Play' })).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: 'One position' }));
  await waitFor(() => expect(screen.queryByText(/do not fit/)).toBeNull());
});

test('an engine that cannot start is shown with its message', async () => {
  serve();
  mount(async () => {
    throw new Error('The browser’s audio runs at 44100 Hz');
  });
  expect(await screen.findByText('The browser’s audio runs at 44100 Hz')).toBeInTheDocument();
});

test('Space plays and pauses', async () => {
  serve();
  const e = engine();
  mount(async () => e);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Play' })).toBeEnabled());
  await userEvent.keyboard(' ');
  expect(e.countInAndPlay).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npm --prefix frontend test -- --run src/screens/Practice.test.tsx`
Expected: FAIL, module not found.

- [ ] **Step 3: Write `screens/Practice.tsx`**

```tsx
// The Practice tab (D-22): song-free exercises. Settings come from practice.json
// (PracticeDoc); the loop is generated in the browser, rendered to stems and
// played by one engine (usePracticeSession). An exercise that does not fit, an
// engine that cannot start, and a practice.json that cannot be read or saved
// are each shown with the real message (N-08, U-09).
import { useCallback, useEffect, useMemo } from 'react';

import type { ExerciseKind, InstrumentSettings, PracticeInstrument, PracticePreset } from '../api/client';
import type { StemChannels } from '../engine/loopCursor';
import { generate, regenerable } from '../music/practice/generate';
import { newSeed } from '../music/practice/random';
import { GuitarNeck } from '../playalong/GuitarNeck';
import { StrumLane } from '../playalong/StrumLane';
import { helpFor } from '../practice/help';
import styles from '../practice/Practice.module.css';
import { PracticeDocProvider, usePracticeDoc } from '../practice/PracticeDoc';
import { PracticeNeck } from '../practice/PracticeNeck';
import { PracticeRail } from '../practice/PracticeRail';
import { PracticeStaff } from '../practice/PracticeStaff';
import { PracticeTransport } from '../practice/PracticeTransport';
import { RampStrip } from '../practice/RampStrip';
import { SettingsPanel } from '../practice/SettingsPanel';
import { SoundPanel } from '../practice/SoundPanel';
import { usePracticeSession, type PracticeEngine } from '../practice/usePracticeSession';
import { Banner, Button, Loader } from '../ui';

type CreateEngine = (stems: readonly StemChannels[]) => Promise<PracticeEngine>;

export function Practice({ createEngine }: { createEngine?: CreateEngine }) {
  return (
    <PracticeDocProvider>
      <PracticeScreen createEngine={createEngine} />
    </PracticeDocProvider>
  );
}

function PracticeScreen({ createEngine }: { createEngine?: CreateEngine }) {
  const { doc, loadError, reload, saveError, update, retry, resetToDefaults } = usePracticeDoc();

  if (!doc) {
    return loadError ? (
      <section className={styles.content}>
        <Banner tone="error" title="Couldn't load practice.json" trace={loadError}>
          Nothing has been overwritten. <Button onClick={reload}>Try again</Button>{' '}
          <Button
            variant="danger"
            onClick={() => {
              if (window.confirm('Replace practice.json with the defaults? Your settings and presets will be lost.')) void resetToDefaults();
            }}
          >
            Reset to defaults…
          </Button>
        </Banner>
      </section>
    ) : (
      <Loader size="page" label="Loading practice…" />
    );
  }
  return <Loaded createEngine={createEngine} saveError={saveError} retry={retry} update={update} doc={doc} />;
}

function Loaded({
  doc,
  update,
  saveError,
  retry,
  createEngine,
}: {
  doc: NonNullable<ReturnType<typeof usePracticeDoc>['doc']>;
  update: ReturnType<typeof usePracticeDoc>['update'];
  saveError: string | null;
  retry(): void;
  createEngine?: CreateEngine;
}) {
  const instrument = doc.instrument;
  const settings = doc[instrument];
  const change = useCallback((next: InstrumentSettings) => void update((d) => ({ ...d, [d.instrument]: next })), [update]);

  // Only what changes the notes regenerates; levels, count-in and the ramp's shape do not.
  const noteKey = JSON.stringify([instrument, settings.exercise, settings.key, settings.seed, settings.groove, settings.scale, settings.arpeggio, settings.drill]);
  const result = useMemo(() => generate(instrument, settings), [noteKey]);
  const loop = result.ok ? result.loop : null;
  const session = usePracticeSession({ instrument, settings, loop, createEngine });
  // A stable nextOf, so GuitarNeck and StrumLane repaint on a new loop, not on every render.
  const nextOf = useCallback((bar: number) => (bar + 1) % (loop?.bars.length ?? 1), [loop]);

  // Space plays and pauses; never from a text field (songview/Transport.tsx's rule).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== ' ' || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(TEXTAREA|SELECT)$/.test(target.tagName))) return;
      if (target instanceof HTMLInputElement && target.type !== 'range') return;
      event.preventDefault();
      session.togglePlay();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [session]);

  const onInstrument = (next: PracticeInstrument) => void update((d) => ({ ...d, instrument: next }));
  const onExercise = (exercise: ExerciseKind) => change({ ...settings, exercise });
  const onLoadPreset = (p: PracticePreset) => change(p.settings);
  const onSavePreset = (name: string) =>
    void update((d) => ({
      ...d,
      presets: [...d.presets.filter((p) => p.name.toLowerCase() !== name.toLowerCase()), { name, instrument, settings }],
    }));

  const rendered = session.rendered;
  return (
    <div className={styles.layout}>
      <PracticeRail doc={doc} onInstrument={onInstrument} onExercise={onExercise} onLoadPreset={onLoadPreset} onSavePreset={onSavePreset} />
      <section className={styles.content}>
        {saveError && (
          <Banner tone="warn" title="Couldn't save practice.json" trace={saveError}>
            Your change is kept on this page. <Button onClick={retry}>Retry</Button>
          </Banner>
        )}
        <PracticeTransport
          session={session}
          settings={settings}
          loop={loop}
          canRegenerate={loop !== null && regenerable(instrument, settings)}
          onSettings={change}
          onRegenerate={() => change({ ...settings, seed: newSeed() })}
        />
        {settings.ramp.on && <RampStrip ramp={settings.ramp} loopsDone={session.loopsDone} />}
        <SettingsPanel instrument={instrument} settings={settings} onChange={change} />
        {!result.ok && (
          <Banner tone="error" title="This exercise does not fit">
            {result.error} Nothing plays until it fits.
            {result.fixes.map((f) => (
              <Button key={f.label} onClick={() => change(f.apply(settings))}>
                {f.label}
              </Button>
            ))}
          </Banner>
        )}
        {session.error && <Banner tone="error" title="Can't play" trace={session.error} />}
        {loop && rendered && (
          <>
            <PracticeStaff loop={loop} display={rendered.display} getPosition={session.getPosition} playing={session.playing} seekNonce={session.seekNonce} />
            {loop.bars.some((b) => b.note) && (
              <p className={styles.dim}>
                {loop.bars.map((b, i) => (b.note ? `Bar ${i + 1}: ${b.note}. ` : '')).join('')}
              </p>
            )}
            {loop.guitarBars ? (
              <>
                <GuitarNeck bars={loop.guitarBars} nextOf={nextOf} grid={rendered.display} getPosition={session.getPosition} playing={session.playing} seekNonce={session.seekNonce} />
                <StrumLane bars={loop.guitarBars} nextOf={nextOf} grid={rendered.display} strum={settings.groove.strum} getPosition={session.getPosition} playing={session.playing} seekNonce={session.seekNonce} />
              </>
            ) : (
              <PracticeNeck loop={loop} display={rendered.display} getPosition={session.getPosition} playing={session.playing} seekNonce={session.seekNonce} />
            )}
          </>
        )}
        <SoundPanel instrument={instrument} levels={settings.levels} onChange={(levels) => change({ ...settings, levels })} />
        <p className={styles.help}>{helpFor(instrument, settings)}</p>
      </section>
    </div>
  );
}
```

`GuitarNeck`/`StrumLane` call `beatPosition(grid, position)` and index `bars[at.bar]`. With `rendered.display`, bar 0 is the loop's first bar and the lead-in reads as "Before the first bar". The ramp stretches time but not samples, so the display grid stays right at every tempo.


- [ ] **Step 4: Add the route and the nav item**

In `frontend/src/app/routes.tsx`, next to the lazy `Theory`:

```tsx
// D-22: Practice loads its music and audio code only when the tab is opened.
const Practice = lazy(() => import('../screens/Practice').then((m) => ({ default: m.Practice })));
```

and beside the theory routes:

```tsx
          <Route path="practice" element={<Suspense fallback={<Loader size="page" label="Loading practice…" />}><Practice /></Suspense>} />
```

In `frontend/src/app/AppShell.tsx` `NAV`, after the Theory entry:

```ts
  { to: '/practice', label: 'Practice' },
```

If `AppShell.test.tsx` or `routes.test.tsx` lists the nav items, add "Practice" there in the same position.

- [ ] **Step 5: Run every frontend test, typecheck and build**

Run: `npm --prefix frontend test -- --run && npm --prefix frontend run typecheck && npm --prefix frontend run build`
Expected: all pass. The build has no new chunk-size warning, because Practice is its own lazy chunk.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/screens/Practice.tsx frontend/src/screens/Practice.test.tsx frontend/src/app frontend/src/practice
git commit -m "feat(practice): the Practice screen, route and navbar tab (D-22)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 20: Verify by ear and in the browser (R-01 rule)

No code unless something is wrong. This task's output is a short report in the commit of Task 21 (or a fix commit here).

- [ ] **Step 1: Start the app** (use the `dev-setup` skill's commands: worker, API, Vite)

- [ ] **Step 2: Seam check on a click-only loop**
  - Open `/practice`, bass, Technique drills, crossing, Up, quarters, from fret 5. Mute Ref. bass, click at full, count-in off.
  - Play at **60 bpm** for 8 loops, then at **200 bpm** for 16. Listen at the wrap: the click must stay even, with no doubled or missing beat and no gap.
  - Un-mute the reference bass and repeat at 120. The last note's release must run into bar 1 without a click.
- [ ] **Step 3: Count-in.** With 1 and 2 bars, the click counts that many bars and the first note lands on beat 1.
- [ ] **Step 4: Ramp.** Set 80 → 120, +5 every loop, and play 9 loops. The strip advances once per loop, each step is heard at the wrap, and it holds at 120. Pause mid-loop and resume: the ramp continues where it was.
- [ ] **Step 5: Re-render while playing.** Change the key during playback: it restarts from bar 1 with the count-in. Change a level: no restart.
- [ ] **Step 6: Long loop glide.** Groove with 4 bars per chord (16 bars). The staff slides smoothly through the wrap and never jumps back.
- [ ] **Step 7: Guitar groove.** The strum is audible as a strum (staggered), the backing bass sits under it, and M mutes the guitar alone.
- [ ] **Step 8: Firefox and Chrome both.** If either refuses 48 kHz, the "Can't play" banner quotes the rate.

Report: what was heard, at which BPMs, in which browsers, and anything fixed.

---

### Task 21: Decision record, specs, design card, README, screenshot, push

**Files:**
- Modify: `design/tech-spec-stemcraft.md` (§11 add D-22 after D-21; §13 risks if any changed)
- Modify: `design/domain-spec.md` (a "Practice" section after Play along)
- Modify: `design/ui-spec.md` (a screen entry for Practice, next U-number)
- Create: `design/ui/src/pages/screens/practice.html` (design card)
- Modify: `README.md`; create `docs/screenshots/practice.png`

- [ ] **Step 1: D-22 in the tech spec.** Copy the "Decisions to record" block from the spec, and add the plan's deviations under it as an *Amended while planning* line: pure-TS synthesis, one engine with `replaceStems`, the metronome level, the staff follows the clock directly, arpeggios fill the bar, guitar groove via `guitarBars()`. Add `practice.json` to §5's data layout beside `theory.json`, and `GET/PUT /api/practice` to §6.

- [ ] **Step 2: Domain spec.** A short "Practice (no song)" section: what the four exercises are, that settings and presets persist per instrument, and that the spelling rule is key-aware with double names on the picker.

- [ ] **Step 3: UI spec.** A U-entry for the Practice screen: rail, transport, ramp strip, settings, staff (whole loop up to 8 bars, gliding past that), neck, sound panel, help, and the error states (does not fit, can't play, practice.json).

- [ ] **Step 4: Design card** `design/ui/src/pages/screens/practice.html`. Start with the header comment and `/* @inject */` style block the other cards use. Copy `play-along.html`'s first two lines and change the name, subtitle and viewport. Lay out the Main artboard from the canvas (read it with the Artifact tool, `path: "project/Main.dc.html"`) as static markup using `components.css` classes (`panel`, `seg`, `stepper`, `chip`, `tool-rail`, `help`). Then rebuild the design system: `uv run python design/ui/build.py`.

- [ ] **Step 5: README.**
  - Add a feature bullet: "**Practice** — no song needed: generated grooves, scales, arpeggios and drills for bass or guitar, with live tab, metronome, count-in, a tempo ramp and a reference part you can mute."
  - Capture the screenshot with the app running: `node scripts/capture-screens.mjs practice=/practice`.
  - Add `docs/screenshots/practice.png` to the README beside the others.

- [ ] **Step 6: Full check**

Run: `uv run pytest -q -p no:warnings && uv run ruff check packages ops && npm --prefix frontend test -- --run && npm --prefix frontend run typecheck && npm --prefix frontend run build`
Expected: all pass.

- [ ] **Step 7: Commit and push** (CLAUDE.md: README upkeep done, tests passing)

```bash
git add design docs README.md
git commit -m "docs: Practice tab (D-22), specs, design card, README and screenshot

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin main
```
