# Theory Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the Theory tab with its tool rail, `theory.json` (API-owned), the shared `TheoryNeck`, the "from a song" card, and four tools: Scale finder, Chord finder, Note finder and Chords in a key.

**Architecture:**
- **Backend:** `stemcraft_lib/theory.py` holds the pydantic model for `<data_dir>/theory.json`, with atomic writes and a history cap. `GET` and `PUT /api/theory` in a new torch-free API router serve it. The worker never touches it.
- **Frontend music logic:** pure TypeScript in `frontend/src/music/`. `spell.ts` wraps tonal (spelling, scales, chords, keys). `tuning.ts`, `positions.ts` and `progressions.ts` cover the neck and numerals.
- **Frontend UI:** everything lives in `frontend/src/theory/`, and the tab is lazy-loaded at `/theory/:tool`. The shared selection (root, scale, key mode, chord, notes) lives in the query string. `theory.json` holds the instrument, the last tool, the chosen song and the quiz history. Nothing derived is stored.

**Tech Stack:** Python 3.12, pydantic, FastAPI, pytest (`uv run pytest`), ruff; React 19, React Router 7, TanStack Query 5, tonal 6.4.3, Vitest + RTL (`npm --prefix frontend test`), CSS modules over `tokens.css` (D-16).

**Spec:** [docs/superpowers/specs/2026-09-29-music-theory-design.md](../specs/2026-09-29-music-theory-design.md). Decision D-19 in `design/tech-spec-stemcraft.md`; colour rule U-13 and the Theory rows in `design/ui-spec.md` §5–§7. Mockups: `design/ui/src/pages/screens/theory-*.html` and `design/ui/src/pages/components/neck.html` (build with `python3 design/ui/build.py`, open `design/ui/dist/…`). The later phases are `2026-09-29-theory-shapes-and-harmony.md` and `2026-09-29-theory-quizzes.md`.

## Global Constraints

- **The API never imports torch.** The only Python added is `stemcraft_lib/theory.py` and `stemcraft_api/routes/theory.py`.
- **One writer per file.** Only the API writes `theory.json`, and the worker never reads it (Task 2 adds a test that enforces this).
- **All file writes are atomic.** `write_theory` goes through `stemcraft_lib.atomic.atomic_write_json`.
- **Nothing derived is stored.** Spellings, positions, windows, fits and the song's chord list are recomputed on every render. The shared selection lives in the URL, not in `theory.json`.
- **Fail loudly (N-08, U-09).**
  - An unreadable `theory.json` is a 500 carrying the real reason. The UI shows it verbatim with a confirmed "Reset to defaults…".
  - A failed save is a warning with Retry, and the change stays in memory.
  - A chord it can't read is an inline error; nothing is guessed.
  - A missing or unanalysed song says so.
- **tonal is pinned to exactly `6.4.3`** (`npm install --save-exact`). 6.5.0 was published on 2026-09-28 without `dist/index.js` or `dist/index.mjs`, and it fails to resolve. Only modules in `frontend/src/music/` import tonal; no component does.
- **Colours (U-13, U-01):**
  - The root dot and root note chip take `--ds-bass`. `TheoryNeck.module.css` and `Theory.module.css` join `Fretboard.module.css` on the stem-hue allow-list in `styles/chrome.test.ts`.
  - Selected controls and "act on this" take `--ds-accent`.
  - No raw hex anywhere.
- **Neck rows:** row 0 is the **highest** string, drawn at the top. Tunings are stored as scientific pitch, **low string first** (`["E1","A1","D2","G2"]`). Every lookup goes through `rowMidi`.
- **Hit targets (U-03):** setup tier (40 px) for pickers and chips; the 32 px floor for dense chips.
- Match the surrounding style: header comments explain *why* and cite spec IDs (D-19, N-08, U-13, …).
- **Commits:**
  - Commit after every task, ending the message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  - Work on `main` (CLAUDE.md), and push once, at the end of Task 13.
  - Another session may be committing to `main` at the same time. Stage **only the files the task lists** (`git add <paths>`, never `git add -A`).


> **As shipped (read this before the task text):** this plan was executed with a review after every task and a whole-branch review at the end. The code blocks below are the *starting prototypes*; review-driven changes made the shipped code differ. The ledger of rulings and per-task reports lived in the git-ignored `.superpowers/sdd/` workspaces; the differences that matter are:
- T1/T2 (backend): `read_theory` also maps `OSError`/`UnicodeDecodeError` to `TheoryUnreadable`; `_PITCH` uses `fullmatch`; `put_theory` turns an `OSError` into a 500 that names the path.
- T3: `analysisChordSymbol` returns `null` for an unknown quality (no `?? ''` fallback to major).
- T4: `parseTuning` checks the server's pitch pattern, with a hint per string count.
- T6/T7 (later): `TheoryNeck` string names carry the octave when a note letter repeats (`E2 string`/`E4 string`).
- T8: `TheoryDoc` was rebuilt: serialized saves, dirty tracking (`rev`/`savedRev`), a module-level keep-store for unsaved documents, apply-on-read with a history merge, held saves while a kept document waits for a read, `isError` means no document, `update` returns a boolean (`{now, keep}`), `reload()` and `fileUnreadable` (Try again next to Reset), and `unloadGuard.ts` (`beforeunload`). The plan's TheoryDoc code and tests are obsolete.
- T9: `useChosenSong` has an `error` state for a failed songs fetch.
- T10: `chordLinkProblem` + inline alert for an unreadable `?chord=`; a typed chord or a song chord moves the root (`chordAndRoot`).
- T12/selection: `patchSelection` — a new root clears a stale `chord`/`bass`. Circle helpers `circleKeyName`, `circleNeighbours`, `keyAccidentalCount` were added by plan 2 T9.
- T13: `capture-screens.mjs` splits on the first `=` and rejects arguments without one; per-screen viewport heights and ready selectors.
- H1 (not in the plan): a hardening pass for serialized PUTs, OSError paths, tuning strictness.

---

## File map

| File | Responsibility |
|---|---|
| `packages/stemcraft_lib/src/stemcraft_lib/theory.py` | `Theory` model, `read_theory`, `write_theory`, `TheoryUnreadable`, `HISTORY_CAP` |
| `packages/stemcraft_lib/tests/test_theory.py` | Defaults, round trip, cap, loud errors, validation |
| `packages/stemcraft_api/src/stemcraft_api/routes/theory.py` | `GET`/`PUT /api/theory` |
| `packages/stemcraft_api/src/stemcraft_api/app.py` | Registers the router |
| `packages/stemcraft_api/tests/test_theory_routes.py` | Endpoint behaviour; worker never references theory |
| `frontend/package.json`, `package-lock.json` | `tonal` 6.4.3 exact |
| `frontend/src/api/client.ts` | `TheoryDoc` types, `DEFAULT_THEORY` |
| `frontend/src/music/spell.ts` | The tonal wrapper: spelling, scales, chords, keys, numerals, "fits over", "same notes" |
| `frontend/src/music/tuning.ts` | Instruments, presets, custom tuning parsing |
| `frontend/src/music/positions.ts` | Rows, positions of notes, position windows |
| `frontend/src/music/progressions.ts` | 15 progressions and Roman numeral → chord |
| `frontend/src/theory/TheoryNeck.tsx` + `.module.css` | The SVG neck (markers, window, heat, click targets, left-handed) |
| `frontend/src/theory/neckDots.ts` | Spelled notes → neck dots with label mode and dimming |
| `frontend/src/theory/selection.ts` | The query-string selection and `useSelection` |
| `frontend/src/theory/TheoryDoc.tsx` | `theory.json` in the browser: load, debounced save, errors, retry, reset |
| `frontend/src/theory/controls.tsx` | NotePicker, ChipRow, NoteChips, HelpBox, ToolHeader |
| `frontend/src/theory/Theory.module.css` | Styles for the tab |
| `frontend/src/theory/help.ts` | One plain-language line per scale |
| `frontend/src/theory/tools.ts` | Tool registry, which drives the rail and routes |
| `frontend/src/theory/ToolRail.tsx`, `InstrumentFooter.tsx`, `SongCard.tsx`, `useChosenSong.ts` | The rail and its parts |
| `frontend/src/theory/CircleOfFifths.tsx` + `.module.css` | The circle, small and large |
| `frontend/src/theory/tools/*.tsx` | ScaleFinder, ChordFinder, NoteFinder, ChordsInKey; `testing.tsx` helper |
| `frontend/src/screens/Theory.tsx` | The screen: provider, redirect, banners, tool outlet |
| `frontend/src/app/routes.tsx`, `AppShell.tsx` | Lazy `/theory` routes, nav item |
| `frontend/src/styles/chrome.test.ts` | Stem-hue allow-list |
| `scripts/capture-screens.mjs`, `README.md`, `docs/screenshots/theory.png` | README upkeep |

---

### Task 1: `theory.json` model

**Files:**
- Create: `packages/stemcraft_lib/src/stemcraft_lib/theory.py`
- Test: `packages/stemcraft_lib/tests/test_theory.py`

**Interfaces:**
- Produces:
  - `Theory` (pydantic, `extra="forbid"`) with fields `version: Literal[1]`, `instrument: Instrument`, `last_tool: Tool`, `song_id: str | None` and `quiz: Quiz`.
  - `QuizAnswer(quiz, mode, item, correct, ms, at)`.
  - `HISTORY_CAP = 2000`.
  - `read_theory(data_dir: Path) -> Theory`: defaults when the file is missing, raises `TheoryUnreadable` otherwise.
  - `write_theory(data_dir: Path, theory: Theory) -> Theory`: returns the trimmed document it wrote.
  - `theory_path(data_dir) -> Path`.

- [ ] **Step 1: Write the failing test**

```python
import json

import pytest
from stemcraft_lib.theory import (
    HISTORY_CAP,
    QuizAnswer,
    Theory,
    TheoryUnreadable,
    read_theory,
    theory_path,
    write_theory,
)


def _answer(i: int) -> QuizAnswer:
    return QuizAnswer(
        quiz="fretboard",
        mode="name-note",
        item=f"s0f{i % 12}",
        correct=True,
        ms=1000,
        at="2026-09-29T00:00:00Z",
    )


def test_missing_file_reads_as_defaults(tmp_path):
    theory = read_theory(tmp_path)
    assert theory == Theory()
    assert theory.instrument.tuning == ["E1", "A1", "D2", "G2"]
    assert theory.last_tool == "scale-finder"
    assert theory.quiz.settings.fretboard.frets == (0, 12)
    assert not theory_path(tmp_path).exists()  # reading never writes


def test_write_then_read_round_trips(tmp_path):
    theory = Theory.model_validate(
        {
            "instrument": {
                "kind": "guitar",
                "strings": 6,
                "tuning": ["D2", "A2", "D3", "G3", "B3", "E4"],
            },
            "last_tool": "chords-in-key",
            "song_id": "01SONG",
        }
    )
    write_theory(tmp_path / "data", theory)
    assert read_theory(tmp_path / "data") == theory


def test_history_is_capped_to_the_newest(tmp_path):
    theory = Theory()
    theory.quiz.history = [_answer(i) for i in range(HISTORY_CAP + 5)]
    written = write_theory(tmp_path, theory)
    assert len(written.quiz.history) == HISTORY_CAP
    assert written.quiz.history[0] == _answer(5)
    assert len(read_theory(tmp_path).quiz.history) == HISTORY_CAP


def test_invalid_json_is_loud(tmp_path):
    theory_path(tmp_path).write_text("{nope")
    with pytest.raises(TheoryUnreadable, match="invalid JSON at line 1"):
        read_theory(tmp_path)


def test_invalid_field_is_loud_and_names_it(tmp_path):
    raw = Theory().model_dump(mode="json")
    raw["quiz"]["history"] = [
        {
            "quiz": "fretboard",
            "mode": "name-note",
            "item": "s0f1",
            "correct": True,
            "ms": "fast",
            "at": "x",
        }
    ]
    theory_path(tmp_path).write_text(json.dumps(raw))
    with pytest.raises(TheoryUnreadable, match=r"quiz\.history\.0\.ms"):
        read_theory(tmp_path)


@pytest.mark.parametrize(
    "instrument, message",
    [
        ({"kind": "bass", "strings": 6, "tuning": ["E1"] * 6}, "a bass has 4 or 5 strings"),
        (
            {"kind": "guitar", "strings": 6, "tuning": ["E2", "A2", "D3", "G3", "B3"]},
            "tuning has 5 notes",
        ),
        ({"kind": "bass", "strings": 4, "tuning": ["E", "A", "D", "G"]}, "not scientific pitch"),
    ],
)
def test_instrument_is_validated(instrument, message):
    with pytest.raises(ValueError, match=message):
        Theory.model_validate({"instrument": instrument})


def test_unknown_fields_and_tools_are_refused():
    with pytest.raises(ValueError):
        Theory.model_validate({"surprise": 1})
    with pytest.raises(ValueError):
        Theory.model_validate({"last_tool": "tab-reader"})
    with pytest.raises(ValueError, match="fret range"):
        Theory.model_validate({"quiz": {"settings": {"fretboard": {"frets": [12, 3]}}}})
```

- [ ] **Step 2: Run it to see it fail**

Run: `uv run pytest packages/stemcraft_lib/tests/test_theory.py -v`
Expected: collection error `ModuleNotFoundError: No module named 'stemcraft_lib.theory'`.

- [ ] **Step 3: Implement**

```python
"""theory.json: the Theory tab's instrument, last tool, chosen song and quiz
history (D-19). The API is its only writer (§2); the worker never reads it.
It lives in the data dir beside jobs.sqlite, not in songs/: it belongs to the
player, not to any song.

Nothing derived is stored. Quiz stats, weak spots and the heatmap are computed
in the browser from `quiz.history` on every render, like song state is derived
from which files exist.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator

from .atomic import atomic_write_json

SCHEMA_VERSION = 1
# The newest answers kept. Weighting only ever reads each item's last five, so
# 2,000 is ample history for the heatmap and keeps the file small.
HISTORY_CAP = 2000

Tool = Literal[
    "scale-finder",
    "chord-finder",
    "note-finder",
    "name-that-chord",
    "scale-positions",
    "triads",
    "arpeggios",
    "chords-in-key",
    "circle-of-fifths",
    "progressions",
    "scales-over-chord",
    "fretboard-quiz",
    "theory-quiz",
]

# Scientific pitch: a letter, up to two accidentals, an octave. "E1", "F#2", "Bb0".
_PITCH = re.compile(r"^[A-G](#{1,2}|b{1,2})?-?\d$")


class TheoryUnreadable(Exception):
    """theory.json exists but cannot be used. Surfaced verbatim (U-09); the file
    is never replaced with defaults behind the player's back (N-08)."""


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Instrument(_Strict):
    kind: Literal["bass", "guitar"] = "bass"
    strings: int = 4
    tuning: list[str] = Field(default_factory=lambda: ["E1", "A1", "D2", "G2"])
    left_handed: bool = False

    @field_validator("tuning")
    @classmethod
    def _pitches(cls, tuning: list[str]) -> list[str]:
        bad = [n for n in tuning if not _PITCH.match(n)]
        if bad:
            raise ValueError(f"not scientific pitch (like E1 or F#2): {bad}")
        return tuning

    @model_validator(mode="after")
    def _shape(self) -> Instrument:
        allowed = {"bass": (4, 5), "guitar": (6,)}[self.kind]
        if self.strings not in allowed:
            raise ValueError(
                f"a {self.kind} has {' or '.join(map(str, allowed))} strings, not {self.strings}"
            )
        if len(self.tuning) != self.strings:
            raise ValueError(f"tuning has {len(self.tuning)} notes for {self.strings} strings")
        return self


class FretboardQuizSettings(_Strict):
    mode: Literal["name-note", "find-note", "find-interval", "spell-chord"] = "find-note"
    strings: list[int] = Field(default_factory=list)  # rows, 0 = highest string; empty = all
    frets: tuple[int, int] = (0, 12)
    accidentals: bool = False

    @field_validator("frets")
    @classmethod
    def _range(cls, frets: tuple[int, int]) -> tuple[int, int]:
        lo, hi = frets
        if not 0 <= lo < hi <= 24:
            raise ValueError(f"fret range must satisfy 0 <= lo < hi <= 24, got {lo}-{hi}")
        return frets


class TheoryQuizSettings(_Strict):
    topics: list[Literal["keys", "chords", "intervals"]] = Field(
        default_factory=lambda: ["keys", "chords", "intervals"], min_length=1
    )


class QuizSettings(_Strict):
    fretboard: FretboardQuizSettings = Field(default_factory=FretboardQuizSettings)
    theory: TheoryQuizSettings = Field(default_factory=TheoryQuizSettings)


class QuizAnswer(_Strict):
    quiz: Literal["fretboard", "theory"]
    mode: str
    item: str
    correct: bool
    ms: int = Field(ge=0)
    at: str


class Quiz(_Strict):
    settings: QuizSettings = Field(default_factory=QuizSettings)
    history: list[QuizAnswer] = Field(default_factory=list)


class Theory(_Strict):
    version: Literal[1] = SCHEMA_VERSION
    instrument: Instrument = Field(default_factory=Instrument)
    last_tool: Tool = "scale-finder"
    song_id: str | None = None
    quiz: Quiz = Field(default_factory=Quiz)


def theory_path(data_dir: Path) -> Path:
    return data_dir / "theory.json"


def read_theory(data_dir: Path) -> Theory:
    """The stored document, or the defaults when there is none yet (a normal
    first run). Anything else wrong raises TheoryUnreadable with the reason."""
    path = theory_path(data_dir)
    try:
        raw = json.loads(path.read_text())
    except FileNotFoundError:
        return Theory()
    except json.JSONDecodeError as exc:
        raise TheoryUnreadable(f"{path}: invalid JSON at line {exc.lineno}: {exc.msg}") from exc
    try:
        return Theory.model_validate(raw)
    except ValidationError as exc:
        raise TheoryUnreadable(f"{path}: {exc.error_count()} invalid field(s): {exc}") from exc


def write_theory(data_dir: Path, theory: Theory) -> Theory:
    """Writes atomically (invariant 8), keeping only the newest HISTORY_CAP
    answers. Returns what was written."""
    history = theory.quiz.history[-HISTORY_CAP:]
    trimmed = theory.model_copy(
        update={"quiz": theory.quiz.model_copy(update={"history": history})}
    )
    data_dir.mkdir(parents=True, exist_ok=True)
    atomic_write_json(theory_path(data_dir), trimmed.model_dump(mode="json"))
    return trimmed
```

- [ ] **Step 4: Run the tests and lint**

Run: `uv run pytest packages/stemcraft_lib/tests/test_theory.py -v && uv run ruff check packages/stemcraft_lib`
Expected: 9 passed; ruff `All checks passed!`

- [ ] **Step 5: Commit**

```bash
git add packages/stemcraft_lib/src/stemcraft_lib/theory.py packages/stemcraft_lib/tests/test_theory.py
git commit -m "feat(theory): theory.json model with atomic writes and a 2,000-answer history cap (D-19)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `GET` / `PUT /api/theory`

**Files:**
- Create: `packages/stemcraft_api/src/stemcraft_api/routes/theory.py`
- Modify: `packages/stemcraft_api/src/stemcraft_api/app.py`
- Test: `packages/stemcraft_api/tests/test_theory_routes.py` (not `test_theory.py`: pytest's default import mode refuses two test modules with the same basename, and `stemcraft_lib/tests/test_theory.py` exists)

**Interfaces:**
- Consumes: Task 1's `Theory`, `TheoryUnreadable`, `read_theory`, `write_theory`, `HISTORY_CAP` and `theory_path`.
- Produces:
  - `GET /api/theory` returns 200 with the document, or 500 with `{"detail": "<path>: <reason>"}`.
  - `PUT /api/theory` takes the whole document and returns 200 with it as written (history trimmed), or 422 if it doesn't validate.

- [ ] **Step 1: Write the failing test**

```python
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from stemcraft_api.app import create_app
from stemcraft_lib.theory import HISTORY_CAP, theory_path


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("STEMCRAFT_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("STEMCRAFT_SONGS_DIR", str(tmp_path / "songs"))
    monkeypatch.setenv("STEMCRAFT_DIST_DIR", str(tmp_path / "nodist"))
    monkeypatch.setenv("STEMCRAFT_SKIP_BOOT_CHECKS", "1")
    return TestClient(create_app())


def _answer(i: int) -> dict:
    return {
        "quiz": "theory",
        "mode": "keys",
        "item": f"v:{i}",
        "correct": i % 2 == 0,
        "ms": 900,
        "at": "2026-09-29T00:00:00Z",
    }


def test_first_run_gets_defaults_without_writing(client, tmp_path):
    resp = client.get("/api/theory")
    assert resp.status_code == 200
    body = resp.json()
    assert body["version"] == 1
    assert body["instrument"] == {
        "kind": "bass",
        "strings": 4,
        "tuning": ["E1", "A1", "D2", "G2"],
        "left_handed": False,
    }
    assert body["last_tool"] == "scale-finder"
    assert body["quiz"]["history"] == []
    assert not theory_path(tmp_path / "data").exists()


def test_put_round_trips_and_lands_on_disk(client, tmp_path):
    doc = client.get("/api/theory").json()
    doc["instrument"] = {
        "kind": "guitar",
        "strings": 6,
        "tuning": ["E2", "A2", "D3", "G3", "B3", "E4"],
        "left_handed": True,
    }
    doc["last_tool"] = "chord-finder"
    doc["quiz"]["history"] = [_answer(1)]
    resp = client.put("/api/theory", json=doc)
    assert resp.status_code == 200
    assert resp.json() == doc
    assert client.get("/api/theory").json() == doc
    assert theory_path(tmp_path / "data").is_file()


def test_put_caps_history(client):
    doc = client.get("/api/theory").json()
    doc["quiz"]["history"] = [_answer(i) for i in range(HISTORY_CAP + 3)]
    body = client.put("/api/theory", json=doc).json()
    assert len(body["quiz"]["history"]) == HISTORY_CAP
    assert body["quiz"]["history"][0]["item"] == "v:3"


def test_put_rejects_an_invalid_body_naming_the_field(client):
    doc = client.get("/api/theory").json()
    doc["instrument"]["strings"] = 7
    resp = client.put("/api/theory", json=doc)
    assert resp.status_code == 422
    assert "strings" in resp.text


def test_corrupt_file_is_a_500_with_the_reason_and_is_not_overwritten(client, tmp_path):
    path = theory_path(tmp_path / "data")
    path.parent.mkdir(parents=True)
    path.write_text('{"version": 1, "last_tool": "tab-reader"}')
    resp = client.get("/api/theory")
    assert resp.status_code == 500
    assert "last_tool" in resp.json()["detail"]
    assert path.read_text() == '{"version": 1, "last_tool": "tab-reader"}'


def test_the_worker_never_touches_theory_json():
    # §2: theory.json has one writer, the API, and the worker has no reason to read
    # it. A plain source scan: the worker's tests import torch, so importing the
    # package here to inspect it would be slow and prove less.
    worker_src = Path(__file__).resolve().parents[2] / "stemcraft_worker" / "src"
    assert worker_src.is_dir()
    assert [p for p in worker_src.rglob("*.py") if "theory" in p.read_text()] == []
```

- [ ] **Step 2: Run it to see it fail**

Run: `uv run pytest packages/stemcraft_api/tests/test_theory_routes.py -v`
Expected: the five endpoint tests FAIL with 404s (`assert 404 == 200`); the worker guard passes.

- [ ] **Step 3: Implement the router**

```python
"""GET/PUT /api/theory (D-19). The API is theory.json's only writer (§2).

A missing file is a normal first run and reads as the defaults. An unreadable
one is a 500 carrying the real reason (U-09), and is left on disk untouched:
the player decides whether to reset it, from the banner that quotes the error.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from stemcraft_lib.config import settings
from stemcraft_lib.theory import Theory, TheoryUnreadable, read_theory, write_theory

router = APIRouter()


@router.get("/api/theory")
def get_theory() -> dict:
    try:
        return read_theory(settings().data_dir).model_dump(mode="json")
    except TheoryUnreadable as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.put("/api/theory")
def put_theory(body: Theory) -> dict:
    # A full replacement, like PUT /api/songs/{id}. FastAPI has already refused
    # an invalid body with a 422 naming the field.
    return write_theory(settings().data_dir, body).model_dump(mode="json")
```

- [ ] **Step 4: Register it in `app.py`**

Change the routes import to:

```python
from .routes import albums, health, jobs, songs, theory
```

and add after `app.include_router(jobs.router)`:

```python
    app.include_router(theory.router)
```

- [ ] **Step 5: Run the tests, the torch guard and lint**

Run: `uv run pytest packages/stemcraft_api/tests/test_theory_routes.py packages/stemcraft_api/tests/test_api.py -v && uv run ruff check packages/stemcraft_api`
Expected: all pass, including `test_the_api_never_imports_torch`.

- [ ] **Step 6: Commit**

```bash
git add packages/stemcraft_api/src/stemcraft_api/routes/theory.py packages/stemcraft_api/src/stemcraft_api/app.py packages/stemcraft_api/tests/test_theory_routes.py
git commit -m "feat(api): GET/PUT /api/theory, loud on an unreadable file (D-19, N-08)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: tonal and `spell.ts`

**Files:**
- Modify: `frontend/package.json`, `frontend/package-lock.json`
- Create: `frontend/src/music/spell.ts`
- Test: `frontend/src/music/spell.test.ts`

**Interfaces:**
- Consumes: `mod12`, `parseChord` from `frontend/src/music/chordTones.ts` (existing).
- Produces:
  - Types: `Spelled { name; pc; interval }`, `KeyMode`, `ScaleId`, `QualityId`, `ChordInfo { symbol; name; root; bass; notes; extraBass }`, `ChordResult`, `KeyChord { numeral; symbol; fn }`.
  - Display and parsing: `pretty`, `ascii`, `pcOf`, `rootName(pc, mode)`, `intervalLabel`, `namer(context)`.
  - Scales: `SCALES`, `scaleDef`, `isScaleId`, `scaleNotes(root, scale)`, `fitsOver`, `sameNotes`.
  - Chords: `QUALITIES`, `chordInfo(text)`, `chordSymbol(root, quality, bass?)`, `analysisChordSymbol(label, name)`, `chordHomes`.
  - Keys: `keyChords(root, mode, 'triads' | 'sevenths')`, `keySignature`, `relativeKey`.

- [ ] **Step 1: Install tonal, pinned**

Run: `npm --prefix frontend install tonal@6.4.3 --save-exact`
Expected: `package.json` gains `"tonal": "6.4.3"` (no caret). Do **not** take 6.5.0: its package has no `dist/index.js` or `dist/index.mjs` and fails to resolve.

- [ ] **Step 2: Write the failing test**

```ts
import { describe, expect, test } from 'vitest';

import {
  analysisChordSymbol,
  ascii,
  chordHomes,
  chordInfo,
  chordSymbol,
  fitsOver,
  intervalLabel,
  keyChords,
  keySignature,
  namer,
  pretty,
  relativeKey,
  rootName,
  sameNotes,
  scaleNotes,
  SCALES,
} from './spell';

const names = (xs: { name: string }[]) => xs.map((x) => x.name);
const ivls = (xs: { interval: string }[]) => xs.map((x) => x.interval);

describe('display', () => {
  test.each([
    ['Bb', 'B♭'],
    ['F#', 'F♯'],
    ['Bbb', 'B𝄫'],
    ['F##', 'F𝄪'],
    ['Bbm7b5', 'B♭m7♭5'],
    ['C7#9', 'C7♯9'],
    ['Cadd9', 'Cadd9'],
  ])('pretty(%s) = %s', (input, out) => expect(pretty(input)).toBe(out));

  test.each([
    ['B♭m7♭5', 'Bbm7b5'],
    ['  c♯m ', 'C#m'],
    ['am7', 'Am7'],
  ])('ascii(%s) = %s', (input, out) => expect(ascii(input)).toBe(out));

  test.each([
    ['1P', 'R'],
    ['3m', '♭3'],
    ['3M', '3'],
    ['5d', '♭5'],
    ['5A', '♯5'],
    ['7d', '𝄫7'],
    ['7m', '♭7'],
    ['4A', '♯4'],
    ['9M', '9'],
    ['8P', 'R'],
  ])('intervalLabel(%s) = %s', (input, out) => expect(intervalLabel(input)).toBe(out));

  test('rootName picks the spelling with fewer accidentals per mode', () => {
    expect(rootName(1, 'major')).toBe('Db');
    expect(rootName(1, 'minor')).toBe('C#');
    expect(rootName(6, 'major')).toBe('F#');
    expect(rootName(8, 'minor')).toBe('G#');
    expect(rootName(10, 'minor')).toBe('Bb');
  });

  test('namer reuses the context spelling and falls back by accidental family', () => {
    const inF = namer(['F', 'G', 'A', 'Bb', 'C', 'D', 'E']);
    expect(inF(10)).toBe('Bb');
    expect(inF(1)).toBe('Db');
    const inG = namer(['G', 'A', 'B', 'C', 'D', 'E', 'F#']);
    expect(inG(6)).toBe('F#');
    expect(inG(1)).toBe('C#');
  });
});

describe('scales', () => {
  test('every scale in SCALES resolves to notes', () => {
    for (const s of SCALES) expect(scaleNotes('C', s.id).length, s.id).toBeGreaterThanOrEqual(5);
  });

  test('letter-correct spelling', () => {
    expect(names(scaleNotes('D', 'harmonic-minor'))).toEqual(['D', 'E', 'F', 'G', 'A', 'Bb', 'C#']);
    expect(names(scaleNotes('E', 'major'))).toEqual(['E', 'F#', 'G#', 'A', 'B', 'C#', 'D#']);
    expect(names(scaleNotes('A', 'minor-pentatonic'))).toEqual(['A', 'C', 'D', 'E', 'G']);
  });

  test('intervals relative to the root', () => {
    expect(ivls(scaleNotes('A', 'minor-pentatonic'))).toEqual(['R', '♭3', '4', '5', '♭7']);
    expect(ivls(scaleNotes('C', 'blues'))).toEqual(['R', '♭3', '4', '♭5', '5', '♭7']);
  });

  test('fitsOver lists only triads wholly inside the scale', () => {
    expect(fitsOver('A', 'minor-pentatonic')).toEqual(['Am', 'C']);
    expect(fitsOver('A', 'minor')).toEqual(['Am', 'Bdim', 'C', 'Dm', 'Em', 'F', 'G']);
  });

  test('sameNotes finds relatives and modes with the same notes', () => {
    expect(sameNotes('A', 'minor-pentatonic')).toEqual(['C major pentatonic']);
    expect(sameNotes('A', 'minor')).toEqual([
      'C major',
      'D dorian',
      'E phrygian',
      'F lydian',
      'G mixolydian',
      'B locrian',
    ]);
  });
});

describe('chords', () => {
  test('spells and labels chord tones', () => {
    const r = chordInfo('F#m7b5');
    expect(r.ok && names(r.chord.notes)).toEqual(['F#', 'A', 'C', 'E']);
    expect(r.ok && ivls(r.chord.notes)).toEqual(['R', '♭3', '♭5', '♭7']);
    const d = chordInfo('Cdim7');
    expect(d.ok && names(d.chord.notes)).toEqual(['C', 'Eb', 'Gb', 'Bbb']);
    expect(d.ok && ivls(d.chord.notes)).toEqual(['R', '♭3', '♭5', '𝄫7']);
  });

  test('accepts pretty and lowercase input', () => {
    const r = chordInfo('b♭maj7');
    expect(r.ok && r.chord.symbol).toBe('Bbmaj7');
    expect(r.ok && names(r.chord.notes)).toEqual(['Bb', 'D', 'F', 'A']);
  });

  test('slash chords keep the bass; a bass outside the chord is extra', () => {
    const ce = chordInfo('C/E');
    expect(ce.ok && ce.chord.bass).toBe('E');
    expect(ce.ok && ce.chord.extraBass).toBeNull();
    const cbb = chordInfo('C/Bb');
    expect(cbb.ok && cbb.chord.extraBass?.name).toBe('Bb');
    expect(cbb.ok && cbb.chord.extraBass?.interval).toBe('♭7');
  });

  test('never guesses', () => {
    expect(chordInfo('Cmaj13#11b9')).toEqual({ ok: false, reason: 'Don\'t know "Cmaj13#11b9"' });
    expect(chordInfo('Hm7').ok).toBe(false);
    expect(chordInfo('C/X').ok).toBe(false);
    expect(chordInfo('').ok).toBe(false);
  });

  test('chordSymbol builds from root, quality and bass', () => {
    expect(chordSymbol('A', 'm7')).toBe('Am7');
    expect(chordSymbol('C', 'maj', 'E')).toBe('C/E');
    expect(chordSymbol('F#', 'm7b5')).toBe('F#m7b5');
  });

  test('analysis labels become symbols spelled by the context', () => {
    const flat = namer(['Bb']);
    expect(analysisChordSymbol('A#:hdim7', flat)).toBe('Bbm7b5');
    expect(analysisChordSymbol('G:min', flat)).toBe('Gm');
    expect(analysisChordSymbol('C', flat)).toBe('C');
    expect(analysisChordSymbol('C:maj/3', flat)).toBe('C/E');
    expect(analysisChordSymbol('N', flat)).toBeNull();
    expect(analysisChordSymbol('X', flat)).toBeNull();
    expect(analysisChordSymbol('C:weird', flat)).toBeNull();
  });

  test('chordHomes names the major keys a chord is diatonic to', () => {
    const r = chordInfo('Am7');
    expect(r.ok && chordHomes(r.chord)).toEqual(['vi7 in C major', 'iii7 in F major', 'ii7 in G major']);
    const d = chordInfo('D');
    expect(d.ok && chordHomes(d.chord)).toEqual(['I in D major', 'V in G major', 'IV in A major']);
  });
});

describe('keys', () => {
  test('major key chords with numerals and function', () => {
    expect(keyChords('G', 'major', 'triads')).toEqual([
      { numeral: 'I', symbol: 'G', fn: 'home' },
      { numeral: 'ii', symbol: 'Am', fn: 'sub' },
      { numeral: 'iii', symbol: 'Bm', fn: 'home' },
      { numeral: 'IV', symbol: 'C', fn: 'sub' },
      { numeral: 'V', symbol: 'D', fn: 'tension' },
      { numeral: 'vi', symbol: 'Em', fn: 'home' },
      { numeral: 'vii°', symbol: 'F#dim', fn: 'tension' },
    ]);
    expect(keyChords('G', 'major', 'sevenths').map((c) => c.symbol)).toEqual([
      'Gmaj7', 'Am7', 'Bm7', 'Cmaj7', 'D7', 'Em7', 'F#m7b5',
    ]);
  });

  test('minor key chords', () => {
    expect(keyChords('E', 'minor', 'triads').map((c) => `${c.numeral}:${c.symbol}`)).toEqual([
      'i:Em', 'ii°:F#dim', 'III:G', 'iv:Am', 'v:Bm', 'VI:C', 'VII:D',
    ]);
  });

  test('key signatures and relatives', () => {
    expect(keySignature('G', 'major')).toEqual({ accidentals: ['F#'], sharps: true });
    expect(keySignature('A', 'minor')).toEqual({ accidentals: [], sharps: false });
    expect(keySignature('Eb', 'major')).toEqual({ accidentals: ['Bb', 'Eb', 'Ab'], sharps: false });
    expect(keySignature('G', 'minor').accidentals).toEqual(['Bb', 'Eb']);
    expect(relativeKey('G', 'major')).toEqual({ root: 'E', mode: 'minor' });
    expect(relativeKey('E', 'minor')).toEqual({ root: 'G', mode: 'major' });
  });
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `npm --prefix frontend test -- src/music/spell.test.ts`
Expected: FAIL, `Failed to resolve import "./spell"`.

- [ ] **Step 4: Implement**

```ts
// Letter-correct spelling and every scale, chord and key query the Theory tab
// makes (D-19). The only module that imports tonal: components see these
// Stemcraft types, so the library stays swappable behind one file. State and
// URLs keep ASCII names ("Bb", "F#"); `pretty` is for display only.
//
// Pure arithmetic with no model behind it (R-05): a chord it cannot read is an
// error the caller shows, never a guess (N-08).
import { Chord, Interval, Key, Note, Scale } from 'tonal';

import { mod12, parseChord } from './chordTones';

/** A spelled note with its interval label relative to the root ("R", "♭3", "♯11"). */
export interface Spelled {
  name: string;
  pc: number;
  interval: string;
}

export type KeyMode = 'major' | 'minor';

const SHARPS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLATS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

/** "Bb" -> "B♭", "F##" -> "F𝄪", "Bbb" -> "B𝄫", "Bbm7b5" -> "B♭m7♭5". */
export function pretty(text: string): string {
  return text
    .replace(/##/g, '𝄪')
    .replace(/([A-G])bb/g, '$1𝄫')
    .replace(/([A-G])b/g, '$1♭')
    .replace(/b(?=\d)/g, '♭')
    .replace(/#/g, '♯');
}

/** Typed text back to ASCII: "B♭m7♭5" -> "Bbm7b5", "c♯m" -> "C#m". */
export function ascii(text: string): string {
  const t = text.trim().replace(/♭/g, 'b').replace(/♯/g, '#').replace(/𝄫/g, 'bb').replace(/𝄪/g, '##');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Pitch class 0-11 of a note name, or null if it is not one. */
export function pcOf(name: string): number | null {
  const chroma = Note.chroma(name);
  return chroma === undefined || Number.isNaN(chroma) ? null : chroma;
}

/**
 * The key-root spelling with fewer accidentals for a pitch class: Db major not
 * C# major, but C# minor not Db minor. F#/Gb ties go to F#.
 */
export function rootName(pc: number, mode: KeyMode): string {
  const MAJOR = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
  const MINOR = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B'];
  return (mode === 'major' ? MAJOR : MINOR)[mod12(pc)]!;
}

/** "3m" -> "♭3", "5d" -> "♭5", "7d" -> "𝄫7", "4A" -> "♯4", "1P"/"8P" -> "R", "9M" -> "9". */
export function intervalLabel(name: string): string {
  const i = Interval.get(name);
  if (i.empty) return name;
  if (i.num === 1 || i.num === 8) return 'R';
  const perfect = i.type === 'perfectable';
  const acc =
    i.q === 'A' ? '♯' : i.q === 'AA' ? '𝄪' : i.q === 'd' ? (perfect ? '♭' : '𝄫') : i.q === 'm' ? '♭' : '';
  return `${acc}${i.num}`;
}

function spell(notes: string[], root: string): Spelled[] {
  return notes.map((name) => ({
    name,
    pc: pcOf(name)!,
    interval: intervalLabel(Interval.distance(root, name)),
  }));
}

/**
 * Names pitch classes the way the current context spells them: a pitch class in
 * `context` gets that name; any other one is sharp, or flat when the context
 * already uses flats.
 */
export function namer(context: readonly string[]): (pc: number) => string {
  const byPc = new Map<number, string>();
  for (const name of context) {
    const pc = pcOf(name);
    if (pc !== null && !byPc.has(pc)) byPc.set(pc, name);
  }
  const flats = context.some((n) => /^[A-G]b/.test(n));
  return (pc) => byPc.get(mod12(pc)) ?? (flats ? FLATS : SHARPS)[mod12(pc)]!;
}

// ---------------------------------------------------------------- scales

export const SCALES = [
  { id: 'major', label: 'Major', group: 'common', tonal: 'major', mode: 'major' },
  { id: 'minor', label: 'Minor', group: 'common', tonal: 'minor', mode: 'minor' },
  { id: 'major-pentatonic', label: 'Major pentatonic', group: 'common', tonal: 'major pentatonic', mode: 'major' },
  { id: 'minor-pentatonic', label: 'Minor pentatonic', group: 'common', tonal: 'minor pentatonic', mode: 'minor' },
  { id: 'blues', label: 'Blues', group: 'common', tonal: 'blues', mode: 'minor' },
  { id: 'dorian', label: 'Dorian', group: 'modes', tonal: 'dorian', mode: 'minor' },
  { id: 'phrygian', label: 'Phrygian', group: 'modes', tonal: 'phrygian', mode: 'minor' },
  { id: 'lydian', label: 'Lydian', group: 'modes', tonal: 'lydian', mode: 'major' },
  { id: 'mixolydian', label: 'Mixolydian', group: 'modes', tonal: 'mixolydian', mode: 'major' },
  { id: 'locrian', label: 'Locrian', group: 'modes', tonal: 'locrian', mode: 'minor' },
  { id: 'harmonic-minor', label: 'Harmonic minor', group: 'more', tonal: 'harmonic minor', mode: 'minor' },
  { id: 'melodic-minor', label: 'Melodic minor', group: 'more', tonal: 'melodic minor', mode: 'minor' },
  { id: 'whole-tone', label: 'Whole tone', group: 'more', tonal: 'whole tone', mode: 'major' },
  { id: 'diminished', label: 'Diminished', group: 'more', tonal: 'diminished', mode: 'minor' },
] as const;

export type ScaleId = (typeof SCALES)[number]['id'];
export type ScaleGroup = (typeof SCALES)[number]['group'];

export function scaleDef(id: ScaleId) {
  return SCALES.find((s) => s.id === id)!;
}

export function isScaleId(value: string): value is ScaleId {
  return SCALES.some((s) => s.id === value);
}

/** The scale's notes from the root, each with its interval: A minor pentatonic -> A C D E G. */
export function scaleNotes(root: string, scale: ScaleId): Spelled[] {
  const s = Scale.get(`${root} ${scaleDef(scale).tonal}`);
  return spell(s.notes, root);
}

const TRIAD_KINDS = [
  { suffix: '', steps: [0, 4, 7] },
  { suffix: 'm', steps: [0, 3, 7] },
  { suffix: 'dim', steps: [0, 3, 6] },
] as const;

/**
 * Major, minor and diminished triads whose three notes are all in the scale,
 * starting from the root: A minor pentatonic -> Am, C.
 */
export function fitsOver(root: string, scale: ScaleId): string[] {
  const notes = scaleNotes(root, scale);
  const pcs = new Set(notes.map((n) => n.pc));
  const name = namer(notes.map((n) => n.name));
  const rootPc = pcOf(root)!;
  const out: string[] = [];
  for (let step = 0; step < 12; step++) {
    const pc = mod12(rootPc + step);
    for (const kind of TRIAD_KINDS) {
      if (kind.steps.every((s) => pcs.has(mod12(pc + s)))) out.push(`${name(pc)}${kind.suffix}`);
    }
  }
  return out;
}

/** Other scales in SCALES with exactly the same notes: A minor pentatonic -> "C major pentatonic". */
export function sameNotes(root: string, scale: ScaleId): string[] {
  const key = (pcs: number[]) => [...new Set(pcs)].sort((a, b) => a - b).join(',');
  const target = key(scaleNotes(root, scale).map((n) => n.pc));
  const out: string[] = [];
  for (const def of SCALES) {
    for (let pc = 0; pc < 12; pc++) {
      const r = rootName(pc, def.mode);
      if (def.id === scale && pc === pcOf(root)) continue;
      if (key(scaleNotes(r, def.id).map((n) => n.pc)) === target) out.push(`${r} ${def.label.toLowerCase()}`);
    }
  }
  return out;
}

// ---------------------------------------------------------------- chords

export const QUALITIES = [
  { id: 'maj', label: 'maj', suffix: '' },
  { id: 'm', label: 'm', suffix: 'm' },
  { id: '7', label: '7', suffix: '7' },
  { id: 'maj7', label: 'maj7', suffix: 'maj7' },
  { id: 'm7', label: 'm7', suffix: 'm7' },
  { id: 'm7b5', label: 'm7♭5', suffix: 'm7b5' },
  { id: 'dim', label: 'dim', suffix: 'dim' },
  { id: 'dim7', label: 'dim7', suffix: 'dim7' },
  { id: 'aug', label: 'aug', suffix: 'aug' },
  { id: 'sus2', label: 'sus2', suffix: 'sus2' },
  { id: 'sus4', label: 'sus4', suffix: 'sus4' },
  { id: '6', label: '6', suffix: '6' },
  { id: 'm6', label: 'm6', suffix: 'm6' },
  { id: '9', label: '9', suffix: '9' },
  { id: 'add9', label: 'add9', suffix: 'add9' },
] as const;

export type QualityId = (typeof QUALITIES)[number]['id'];

export interface ChordInfo {
  /** ASCII symbol as typed or built, e.g. "Am7", "C/E". */
  symbol: string;
  /** tonal's long name, e.g. "A minor seventh". */
  name: string;
  root: string;
  /** The slash bass, or null for a root-position symbol. */
  bass: string | null;
  /** Chord tones from the root, intervals relative to the root. */
  notes: Spelled[];
  /** A slash bass that is not a chord tone (C/Bb), else null. */
  extraBass: Spelled | null;
}

export type ChordResult = { ok: true; chord: ChordInfo } | { ok: false; reason: string };

/** Reads a chord symbol ("Am7", "C/E", "F#m7b5", "B♭maj7"). Never guesses (N-08). */
export function chordInfo(text: string): ChordResult {
  const symbol = ascii(text);
  const fail = { ok: false as const, reason: `Don't know "${text.trim()}"` };
  const [main = '', bass, ...rest] = symbol.split('/');
  const chord = Chord.get(main);
  if (!symbol || rest.length > 0 || chord.empty || !chord.tonic) return fail;
  const notes = spell(chord.notes, chord.tonic);
  let extraBass: Spelled | null = null;
  if (bass !== undefined) {
    if (!/^[A-G](#{1,2}|b{1,2})?$/.test(bass)) return fail;
    if (!notes.some((n) => n.pc === pcOf(bass))) extraBass = spell([bass], chord.tonic)[0]!;
  }
  return {
    ok: true,
    chord: { symbol, name: chord.name || symbol, root: chord.tonic, bass: bass ?? null, notes, extraBass },
  };
}

export function chordSymbol(root: string, quality: QualityId, bass?: string | null): string {
  const suffix = QUALITIES.find((q) => q.id === quality)!.suffix;
  return `${root}${suffix}${bass ? `/${bass}` : ''}`;
}

const BTC_SUFFIX: Record<string, string> = {
  maj: '', min: 'm', dim: 'dim', aug: 'aug', min6: 'm6', maj6: '6', min7: 'm7',
  minmaj7: 'mMaj7', maj7: 'maj7', '7': '7', dim7: 'dim7', hdim7: 'm7b5', sus2: 'sus2', sus4: 'sus4',
};

/**
 * An analysis.json chord label ("G:min", "A#:hdim7", "C:maj/3") as a symbol
 * spelled by `name`; null for "N", "X" and labels chordTones cannot read.
 */
export function analysisChordSymbol(label: string, name: (pc: number) => string): string | null {
  const parsed = parseChord(label, 0);
  if (parsed.kind !== 'chord') return null;
  const { rootPc, bassPc, quality } = parsed.tones;
  const slash = bassPc !== rootPc ? `/${name(bassPc)}` : '';
  return `${name(rootPc)}${BTC_SUFFIX[quality] ?? ''}${slash}`;
}

// ---------------------------------------------------------------- keys

export type ChordFunction = 'home' | 'sub' | 'tension';

export interface KeyChord {
  numeral: string;
  symbol: string;
  fn: ChordFunction;
}

const NUMERALS = {
  major: { triads: ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°'], sevenths: ['Imaj7', 'ii7', 'iii7', 'IVmaj7', 'V7', 'vi7', 'viiø7'] },
  minor: { triads: ['i', 'ii°', 'III', 'iv', 'v', 'VI', 'VII'], sevenths: ['i7', 'iiø7', 'IIImaj7', 'iv7', 'v7', 'VImaj7', 'VII7'] },
} as const;

const FUNCTION: Record<string, ChordFunction> = { T: 'home', SD: 'sub', D: 'tension' };

/** The seven chords of a key with numerals and function (T -> home, SD -> sub, D -> tension). */
export function keyChords(root: string, mode: KeyMode, kind: 'triads' | 'sevenths'): KeyChord[] {
  const k = mode === 'major' ? Key.majorKey(root) : Key.minorKey(root).natural;
  const symbols = kind === 'triads' ? k.triads : k.chords;
  return symbols.map((symbol, i) => ({
    numeral: NUMERALS[mode][kind][i]!,
    symbol,
    fn: FUNCTION[k.chordsHarmonicFunction[i]!]!,
  }));
}

const SHARP_ORDER = ['F#', 'C#', 'G#', 'D#', 'A#', 'E#', 'B#'];
const FLAT_ORDER = ['Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Cb', 'Fb'];

/** G major -> 1 sharp, F#. A minor -> none. */
export function keySignature(root: string, mode: KeyMode): { accidentals: string[]; sharps: boolean } {
  const major = mode === 'major' ? root : Key.minorKey(root).relativeMajor;
  const sig = Key.majorKey(major).keySignature;
  const sharps = sig.startsWith('#');
  return { accidentals: (sharps ? SHARP_ORDER : FLAT_ORDER).slice(0, sig.length), sharps };
}

/** G major -> "E minor"; E minor -> "G major". */
export function relativeKey(root: string, mode: KeyMode): { root: string; mode: KeyMode } {
  return mode === 'major'
    ? { root: Key.majorKey(root).minorRelative, mode: 'minor' }
    : { root: Key.minorKey(root).relativeMajor, mode: 'major' };
}

/** Where a chord is diatonic, by major key: Am7 -> ["vi7 in C major", "iii7 in F major", "ii7 in G major"]. */
export function chordHomes(chord: ChordInfo): string[] {
  const same = (a: Set<number>, b: Set<number>) => a.size === b.size && [...a].every((p) => b.has(p));
  const target = new Set(chord.notes.map((n) => n.pc));
  const rootPc = pcOf(chord.root);
  const out: string[] = [];
  for (let pc = 0; pc < 12; pc++) {
    const key = rootName(pc, 'major');
    for (const kind of ['triads', 'sevenths'] as const) {
      for (const kc of keyChords(key, 'major', kind)) {
        const c = Chord.get(kc.symbol);
        if (pcOf(c.tonic ?? '') === rootPc && same(new Set(c.notes.map((n) => pcOf(n)!)), target)) {
          out.push(`${kc.numeral} in ${pretty(key)} major`);
        }
      }
    }
  }
  return out;
}
```

- [ ] **Step 5: Run the tests**

Run: `npm --prefix frontend test -- src/music/spell.test.ts`
Expected: 37 passed.

- [ ] **Step 6: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/src/music/spell.ts frontend/src/music/spell.test.ts
git commit -m "feat(theory): spell.ts, letter-correct scales, chords and keys over tonal 6.4.3 (D-19)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `TheoryDoc` types, tunings and neck positions

**Files:**
- Modify: `frontend/src/api/client.ts` (append)
- Create: `frontend/src/music/tuning.ts`, `frontend/src/music/positions.ts`
- Test: `frontend/src/music/tuning.test.ts`, `frontend/src/music/positions.test.ts`

**Interfaces:**
- Produces (client.ts): `TheoryTool`, `TheoryInstrument`, `FretboardQuizSettings`, `TheoryQuizSettings`, `QuizAnswer`, `TheoryDoc`, `DEFAULT_THEORY`, mirroring Task 1 field for field.
- Produces (tuning.ts):
  - `Instrument` (= `TheoryInstrument`), `PRESETS`, `INSTRUMENT_CHOICES`, `DEFAULT_INSTRUMENT`.
  - `choiceOf`, `instrumentFor(id, leftHanded)`, `presetsFor`, `presetOf`, `openMidi` (low first), `tuningLabel`.
  - `parseTuning(text, strings)`, `neckFrets(inst)`: 15 on bass, 17 on guitar.
- Produces (positions.ts):
  - `Cell { string; fret }`, where row 0 is the highest string. `Position extends Cell { midi; pc }`.
  - `rowMidi`, `positionsOf(inst, pcs, lo, hi)`, `positionAt`.
  - `Window { index; lo; hi }`, `positionWindows(inst, rootPc, scalePcs)`.

- [ ] **Step 1: Append the `theory.json` types to `frontend/src/api/client.ts`**

```ts
// Mirrors packages/stemcraft_lib/src/stemcraft_lib/theory.py (D-19). The API is
// theory.json's only writer; the browser GETs it and PUTs the whole document.
export type TheoryTool =
  | 'scale-finder' | 'chord-finder' | 'note-finder' | 'name-that-chord'
  | 'scale-positions' | 'triads' | 'arpeggios'
  | 'chords-in-key' | 'circle-of-fifths' | 'progressions' | 'scales-over-chord'
  | 'fretboard-quiz' | 'theory-quiz';

export interface TheoryInstrument {
  kind: 'bass' | 'guitar';
  strings: number;
  /** Scientific pitch, low string first: ["E1", "A1", "D2", "G2"]. */
  tuning: string[];
  left_handed: boolean;
}

export interface FretboardQuizSettings {
  mode: 'name-note' | 'find-note' | 'find-interval' | 'spell-chord';
  /** Rows (0 = highest string); empty = every string. */
  strings: number[];
  frets: [number, number];
  accidentals: boolean;
}

export interface TheoryQuizSettings {
  topics: ('keys' | 'chords' | 'intervals')[];
}

export interface QuizAnswer {
  quiz: 'fretboard' | 'theory';
  mode: string;
  item: string;
  correct: boolean;
  ms: number;
  at: string;
}

export interface TheoryDoc {
  version: 1;
  instrument: TheoryInstrument;
  last_tool: TheoryTool;
  song_id: string | null;
  quiz: {
    settings: { fretboard: FretboardQuizSettings; theory: TheoryQuizSettings };
    history: QuizAnswer[];
  };
}

/** The server's defaults, for "Reset to defaults" after an unreadable theory.json. */
export const DEFAULT_THEORY: TheoryDoc = {
  version: 1,
  instrument: { kind: 'bass', strings: 4, tuning: ['E1', 'A1', 'D2', 'G2'], left_handed: false },
  last_tool: 'scale-finder',
  song_id: null,
  quiz: {
    settings: {
      fretboard: { mode: 'find-note', strings: [], frets: [0, 12], accidentals: false },
      theory: { topics: ['keys', 'chords', 'intervals'] },
    },
    history: [],
  },
};
```

- [ ] **Step 2: Write the failing tests**

`frontend/src/music/tuning.test.ts`:

```ts
import { describe, expect, test } from 'vitest';

import {
  DEFAULT_INSTRUMENT,
  instrumentFor,
  neckFrets,
  openMidi,
  parseTuning,
  presetOf,
  presetsFor,
  tuningLabel,
} from './tuning';

const bass4 = DEFAULT_INSTRUMENT;
const bass5 = instrumentFor('bass5', false);
const guitar = instrumentFor('guitar6', false);
const dropD = { ...guitar, tuning: ['D2', 'A2', 'D3', 'G3', 'B3', 'E4'] };

describe('tuning', () => {
  test('open strings, low first', () => {
    expect(openMidi(bass4)).toEqual([28, 33, 38, 43]);
    expect(openMidi(bass5)).toEqual([23, 28, 33, 38, 43]);
    expect(openMidi(guitar)).toEqual([40, 45, 50, 55, 59, 64]);
  });

  test('labels and presets', () => {
    expect(tuningLabel(bass4)).toBe('E A D G');
    expect(presetOf(dropD)?.label).toBe('Drop D');
    expect(presetOf({ ...bass4, tuning: ['F1', 'A1', 'D2', 'G2'] })).toBeNull();
    expect(presetsFor(bass4).map((p) => p.label)).toEqual(['Standard', 'Drop D', 'Half-step down', 'D standard']);
    expect(presetsFor(bass5).map((p) => p.label)).toEqual(['Standard']);
    expect(neckFrets(bass4)).toBe(15);
    expect(neckFrets(guitar)).toBe(17);
  });

  test('custom tunings are validated, never guessed', () => {
    expect(parseTuning('d1 A1 D2 G2', 4)).toEqual({ ok: true, notes: ['D1', 'A1', 'D2', 'G2'] });
    expect(parseTuning('E A D G', 4)).toEqual({ ok: false, reason: '"E" is not a note with an octave, like E1 or F#2' });
    expect(parseTuning('E1 A1 D2', 4).ok).toBe(false);
    expect(parseTuning('G2 D2 A1 E1', 4)).toEqual({ ok: false, reason: 'Each string must be higher than the one before it' });
  });
});
```

`frontend/src/music/positions.test.ts`:

```ts
import { describe, expect, test } from 'vitest';

import { positionAt, positionsOf, positionWindows, rowMidi } from './positions';
import { DEFAULT_INSTRUMENT, instrumentFor } from './tuning';

const bass4 = DEFAULT_INSTRUMENT;
const guitar = instrumentFor('guitar6', false);
const dropD = { ...guitar, tuning: ['D2', 'A2', 'D3', 'G3', 'B3', 'E4'] };

describe('positions', () => {
  test('row 0 is the highest string', () => {
    expect(rowMidi(bass4)).toEqual([43, 38, 33, 28]);
    expect(positionAt(bass4, { string: 3, fret: 5 })).toEqual({ string: 3, fret: 5, midi: 33, pc: 9 });
  });

  test('every A from fret 0 to 12 on a 4-string bass', () => {
    const cells = positionsOf(bass4, new Set([9]), 0, 12).map((p) => `${p.string}:${p.fret}`);
    expect(cells).toEqual(['0:2', '1:7', '2:0', '2:12', '3:5']);
  });

  test('drop D moves the low string only', () => {
    const d = positionsOf(dropD, new Set([2]), 0, 0).map((p) => p.string);
    expect(d).toEqual([3, 5]);
  });

  test('position windows start on each scale note of the lowest string, root first', () => {
    const w = positionWindows(bass4, 9, [9, 0, 2, 4, 7]);
    expect(w.map((x) => `${x.index}:${x.lo}-${x.hi}`)).toEqual(['1:5-8', '2:8-11', '3:10-13', '4:12-15', '5:3-6']);
    expect(positionWindows(guitar, 9, [9, 0, 2, 4, 7])[0]).toEqual({ index: 1, lo: 5, hi: 9 });
    expect(positionWindows(bass4, 4, [4, 6, 8, 9, 11, 1, 3])[0]).toEqual({ index: 1, lo: 12, hi: 15 });
  });
});
```

- [ ] **Step 3: Run them to see them fail**

Run: `npm --prefix frontend test -- src/music/tuning.test.ts src/music/positions.test.ts`
Expected: FAIL, `Failed to resolve import "./tuning"`.

- [ ] **Step 4: Implement `tuning.ts`**

```ts
// Instruments and tunings for the Theory tab (D-19). A tuning is scientific
// pitch low string to high ("E1 A1 D2 G2"), the same order theory.json stores.
// Play along keeps its own fixed EADG (D-18); this module does not touch it.
import { Note } from 'tonal';

import type { TheoryInstrument } from '../api/client';

/** theory.json's instrument: kind, string count, tuning low string first, left-handed. */
export type Instrument = TheoryInstrument;
export type InstrumentKind = Instrument['kind'];

export interface TuningPreset {
  id: string;
  label: string;
  kind: InstrumentKind;
  notes: string[];
}

export const PRESETS: readonly TuningPreset[] = [
  { id: 'bass4-standard', label: 'Standard', kind: 'bass', notes: ['E1', 'A1', 'D2', 'G2'] },
  { id: 'bass4-drop-d', label: 'Drop D', kind: 'bass', notes: ['D1', 'A1', 'D2', 'G2'] },
  { id: 'bass4-half-down', label: 'Half-step down', kind: 'bass', notes: ['Eb1', 'Ab1', 'Db2', 'Gb2'] },
  { id: 'bass4-d-standard', label: 'D standard', kind: 'bass', notes: ['D1', 'G1', 'C2', 'F2'] },
  { id: 'bass5-standard', label: 'Standard', kind: 'bass', notes: ['B0', 'E1', 'A1', 'D2', 'G2'] },
  { id: 'guitar-standard', label: 'Standard', kind: 'guitar', notes: ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'] },
  { id: 'guitar-drop-d', label: 'Drop D', kind: 'guitar', notes: ['D2', 'A2', 'D3', 'G3', 'B3', 'E4'] },
  { id: 'guitar-half-down', label: 'Half-step down', kind: 'guitar', notes: ['Eb2', 'Ab2', 'Db3', 'Gb3', 'Bb3', 'Eb4'] },
  { id: 'guitar-d-standard', label: 'D standard', kind: 'guitar', notes: ['D2', 'G2', 'C3', 'F3', 'A3', 'D4'] },
  { id: 'guitar-dadgad', label: 'DADGAD', kind: 'guitar', notes: ['D2', 'A2', 'D3', 'G3', 'A3', 'D4'] },
  { id: 'guitar-open-g', label: 'Open G', kind: 'guitar', notes: ['D2', 'G2', 'D3', 'G3', 'B3', 'D4'] },
  { id: 'guitar-open-d', label: 'Open D', kind: 'guitar', notes: ['D2', 'A2', 'D3', 'F#3', 'A3', 'D4'] },
];

/** The three instruments the footer offers. 7-string guitar and 6-string bass are not offered (spec non-goal). */
export const INSTRUMENT_CHOICES = [
  { id: 'bass4', label: 'Bass · 4 string', kind: 'bass', strings: 4, preset: 'bass4-standard' },
  { id: 'bass5', label: 'Bass · 5 string', kind: 'bass', strings: 5, preset: 'bass5-standard' },
  { id: 'guitar6', label: 'Guitar · 6 string', kind: 'guitar', strings: 6, preset: 'guitar-standard' },
] as const;

export type InstrumentChoiceId = (typeof INSTRUMENT_CHOICES)[number]['id'];

export const DEFAULT_INSTRUMENT: Instrument = {
  kind: 'bass',
  strings: 4,
  tuning: ['E1', 'A1', 'D2', 'G2'],
  left_handed: false,
};

export function choiceOf(inst: Instrument): InstrumentChoiceId {
  return inst.kind === 'guitar' ? 'guitar6' : inst.strings === 5 ? 'bass5' : 'bass4';
}

export function instrumentFor(id: InstrumentChoiceId, leftHanded: boolean): Instrument {
  const choice = INSTRUMENT_CHOICES.find((c) => c.id === id)!;
  const preset = PRESETS.find((p) => p.id === choice.preset)!;
  return { kind: choice.kind, strings: choice.strings, tuning: [...preset.notes], left_handed: leftHanded };
}

/** Presets that fit this instrument's kind and string count. */
export function presetsFor(inst: Instrument): TuningPreset[] {
  return PRESETS.filter((p) => p.kind === inst.kind && p.notes.length === inst.strings);
}

export function presetOf(inst: Instrument): TuningPreset | null {
  return presetsFor(inst).find((p) => p.notes.join(' ') === inst.tuning.join(' ')) ?? null;
}

/** MIDI note of each open string, low string first. */
export function openMidi(inst: Instrument): number[] {
  return inst.tuning.map((n) => Note.midi(n)!);
}

/** "E A D G" for the footer: pitch classes low to high, no octaves. */
export function tuningLabel(inst: Instrument): string {
  return inst.tuning.map((n) => Note.pitchClass(n)).join(' ');
}

/**
 * A typed custom tuning, "D1 A1 D2 G2", low string first. Refused unless it has
 * one valid scientific pitch per string, each higher than the one before.
 */
export function parseTuning(
  text: string,
  strings: number,
): { ok: true; notes: string[] } | { ok: false; reason: string } {
  const notes = text.trim().split(/\s+/).filter(Boolean);
  if (notes.length !== strings) {
    return { ok: false, reason: `Need ${strings} notes, low string first, e.g. "${strings === 6 ? 'E2 A2 D3 G3 B3 E4' : 'E1 A1 D2 G2'}"` };
  }
  const midis = notes.map((n) => Note.midi(n.charAt(0).toUpperCase() + n.slice(1)));
  const bad = notes.find((_, i) => midis[i] == null || !/\d$/.test(notes[i]!));
  if (bad !== undefined) return { ok: false, reason: `"${bad}" is not a note with an octave, like E1 or F#2` };
  for (let i = 1; i < midis.length; i++) {
    if (midis[i]! <= midis[i - 1]!) return { ok: false, reason: 'Each string must be higher than the one before it' };
  }
  return { ok: true, notes: notes.map((n) => n.charAt(0).toUpperCase() + n.slice(1)) };
}

/** How many frets the whole-neck tools draw: 0–15 on bass, 0–17 on guitar. */
export function neckFrets(inst: Instrument): number {
  return inst.kind === 'bass' ? 15 : 17;
}
```

- [ ] **Step 5: Implement `positions.ts`**

```ts
// Where notes sit on a neck, for any tuning (D-19). Rows are numbered the way
// the neck is drawn (U-13): row 0 is the highest string, at the top, and the
// last row is the lowest string. Tunings are stored low string first, so every
// lookup goes through `rowMidi`.
import { mod12 } from './chordTones';
import { openMidi, type Instrument } from './tuning';

export interface Cell {
  /** 0 = highest string (top row). */
  string: number;
  fret: number;
}

export interface Position extends Cell {
  midi: number;
  pc: number;
}

/** Open-string MIDI per row, top row (highest string) first. */
export function rowMidi(inst: Instrument): number[] {
  return [...openMidi(inst)].reverse();
}

/** Every cell from fret `lo` to `hi` (inclusive) whose pitch class is in `pcs`. */
export function positionsOf(inst: Instrument, pcs: ReadonlySet<number>, lo: number, hi: number): Position[] {
  const out: Position[] = [];
  rowMidi(inst).forEach((open, string) => {
    for (let fret = lo; fret <= hi; fret++) {
      const midi = open + fret;
      if (pcs.has(mod12(midi))) out.push({ string, fret, midi, pc: mod12(midi) });
    }
  });
  return out;
}

export function positionAt(inst: Instrument, cell: Cell): Position {
  const midi = rowMidi(inst)[cell.string]! + cell.fret;
  return { ...cell, midi, pc: mod12(midi) };
}

export interface Window {
  /** 1-based, in the order the player meets them going up from the root. */
  index: number;
  lo: number;
  hi: number;
}

/**
 * One position per scale note: a box that starts on that note on the lowest
 * string, 4 frets wide on bass (one finger per fret) and 5 on guitar. Ordered
 * from the root going up the neck, wrapping at the 12th fret, so position 1 is
 * always the one that starts on the root. A minor pentatonic on a 4-string
 * bass: 5–8, 8–11, 10–13, 12–15, 3–6.
 */
export function positionWindows(inst: Instrument, rootPc: number, scalePcs: readonly number[]): Window[] {
  const lowest = openMidi(inst)[0]!;
  const fretOf = (pc: number) => mod12(pc - lowest) || 12;
  const rootFret = fretOf(rootPc);
  const span = inst.kind === 'bass' ? 3 : 4;
  return [...new Set(scalePcs.map(mod12))]
    .map(fretOf)
    .sort((a, b) => mod12(a - rootFret) - mod12(b - rootFret))
    .map((lo, i) => ({ index: i + 1, lo, hi: lo + span }));
}
```

- [ ] **Step 6: Run the tests and typecheck**

Run: `npm --prefix frontend test -- src/music/tuning.test.ts src/music/positions.test.ts && npm --prefix frontend run typecheck`
Expected: 7 passed (3 tuning, 4 positions); typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/api/client.ts frontend/src/music/tuning.ts frontend/src/music/tuning.test.ts frontend/src/music/positions.ts frontend/src/music/positions.test.ts
git commit -m "feat(theory): theory.json types, instruments and tunings, neck positions (D-19)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Progressions

**Files:**
- Create: `frontend/src/music/progressions.ts`
- Test: `frontend/src/music/progressions.test.ts`

**Interfaces:**
- Produces: `ProgressionDef { id; label; mode; numerals }`, `PROGRESSIONS` (15), `numeralToSymbol(tonic, numeral): string | null`, `progressionChords(def, tonic): string[]`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from 'vitest';

import { numeralToSymbol, progressionChords, PROGRESSIONS } from './progressions';

describe('progressions', () => {
  test.each([
    ['G', 'vi', 'Em'],
    ['G', 'bVII', 'F'],
    ['C', 'ii7', 'Dm7'],
    ['A', 'iiø7', 'Bm7b5'],
    ['C', 'vii°', 'Bdim'],
    ['E', 'bVI', 'C'],
    ['Eb', 'V7', 'Bb7'],
    ['C', 'IVmaj7', 'Fmaj7'],
  ])('%s: %s -> %s', (tonic, numeral, symbol) => expect(numeralToSymbol(tonic, numeral)).toBe(symbol));

  test('unreadable numerals are null', () => {
    expect(numeralToSymbol('C', 'VIII')).toBeNull();
    expect(numeralToSymbol('C', 'Imaj9')).toBeNull();
  });

  test('fifteen progressions, all readable', () => {
    expect(PROGRESSIONS).toHaveLength(15);
    for (const p of PROGRESSIONS) for (const n of p.numerals) expect(numeralToSymbol('C', n), `${p.id} ${n}`).not.toBeNull();
  });

  test('transposes to the key', () => {
    const pop = PROGRESSIONS.find((p) => p.id === 'pop')!;
    expect(progressionChords(pop, 'G')).toEqual(['G', 'D', 'Em', 'C']);
    const andalusian = PROGRESSIONS.find((p) => p.id === 'andalusian')!;
    expect(progressionChords(andalusian, 'A')).toEqual(['Am', 'G', 'F', 'E']);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm --prefix frontend test -- src/music/progressions.test.ts`
Expected: FAIL, `Failed to resolve import "./progressions"`.

- [ ] **Step 3: Implement**

```ts
// Roman-numeral progressions, transposed to any key (D-19). Numerals are read
// against the major scale of the tonic, as in most chord books: "bVII" in G is
// F, and a minor-key progression spells its flat degrees ("i bVI bIII bVII").
// tonal's own Progression.fromRomanNumerals drops the chord quality ("vi" in G
// comes back as "E", not "Em"), so the reading is done here.
import { Interval, Note } from 'tonal';

import type { KeyMode } from './spell';

export interface ProgressionDef {
  id: string;
  label: string;
  mode: KeyMode;
  numerals: string[];
}

export const PROGRESSIONS: readonly ProgressionDef[] = [
  { id: 'pop', label: 'I–V–vi–IV', mode: 'major', numerals: ['I', 'V', 'vi', 'IV'] },
  { id: 'fifties', label: 'I–vi–IV–V · 50s', mode: 'major', numerals: ['I', 'vi', 'IV', 'V'] },
  { id: 'two-five-one', label: 'ii–V–I', mode: 'major', numerals: ['ii7', 'V7', 'Imaj7'] },
  { id: 'one-four-five', label: 'I–IV–V', mode: 'major', numerals: ['I', 'IV', 'V'] },
  {
    id: 'twelve-bar',
    label: '12-bar blues',
    mode: 'major',
    numerals: ['I7', 'I7', 'I7', 'I7', 'IV7', 'IV7', 'I7', 'I7', 'V7', 'IV7', 'I7', 'V7'],
  },
  {
    id: 'minor-blues',
    label: 'Minor blues',
    mode: 'minor',
    numerals: ['i7', 'i7', 'i7', 'i7', 'iv7', 'iv7', 'i7', 'i7', 'bVI7', 'V7', 'i7', 'V7'],
  },
  { id: 'sensitive', label: 'vi–IV–I–V', mode: 'major', numerals: ['vi', 'IV', 'I', 'V'] },
  { id: 'andalusian', label: 'Andalusian i–♭VII–♭VI–V', mode: 'minor', numerals: ['i', 'bVII', 'bVI', 'V'] },
  { id: 'minor-one-four-five', label: 'i–iv–v', mode: 'minor', numerals: ['i', 'iv', 'v'] },
  { id: 'mixolydian', label: 'I–♭VII–IV', mode: 'major', numerals: ['I', 'bVII', 'IV'] },
  { id: 'minor-two-five-one', label: 'ii–V–i minor', mode: 'minor', numerals: ['iiø7', 'V7', 'i'] },
  { id: 'canon', label: 'Canon', mode: 'major', numerals: ['I', 'V', 'vi', 'iii', 'IV', 'I', 'IV', 'V'] },
  { id: 'one-four-six-five', label: 'I–IV–vi–V', mode: 'major', numerals: ['I', 'IV', 'vi', 'V'] },
  { id: 'epic-minor', label: 'i–♭VI–♭III–♭VII', mode: 'minor', numerals: ['i', 'bVI', 'bIII', 'bVII'] },
  { id: 'one-three-four-five', label: 'I–iii–IV–V', mode: 'major', numerals: ['I', 'iii', 'IV', 'V'] },
];

const NUMERAL = /^(b|#)?(VII|VI|IV|V|III|II|I|vii|vi|iv|v|iii|ii|i)(°7|°|ø7|maj7|7)?$/;
const STEPS = ['1P', '2M', '3M', '4P', '5P', '6M', '7M'];
const ROMANS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

function alter(interval: string, acc: string | undefined): string {
  if (!acc) return interval;
  const i = Interval.get(interval);
  const perfect = i.type === 'perfectable';
  const q = acc === 'b' ? (perfect ? 'd' : 'm') : 'A';
  return `${i.num}${q}`;
}

/** "vi" in G -> "Em", "bVII" in G -> "F", "ii7" in C -> "Dm7", "iiø7" in A -> "Bm7b5". Null if unreadable. */
export function numeralToSymbol(tonic: string, numeral: string): string | null {
  const m = NUMERAL.exec(numeral);
  if (!m) return null;
  const [, acc, roman = '', suffix = ''] = m;
  const degree = ROMANS.indexOf(roman.toUpperCase());
  const upper = roman === roman.toUpperCase();
  const root = Note.transpose(tonic, alter(STEPS[degree]!, acc));
  const quality =
    suffix === '°' ? 'dim'
    : suffix === '°7' ? 'dim7'
    : suffix === 'ø7' ? 'm7b5'
    : suffix === 'maj7' ? (upper ? 'maj7' : 'mMaj7')
    : suffix === '7' ? (upper ? '7' : 'm7')
    : upper ? '' : 'm';
  return `${root}${quality}`;
}

/** A progression's chords in a key: I–V–vi–IV in G -> G D Em C. */
export function progressionChords(def: ProgressionDef, tonic: string): string[] {
  return def.numerals.map((n) => numeralToSymbol(tonic, n) ?? n);
}
```

- [ ] **Step 4: Run the tests**

Run: `npm --prefix frontend test -- src/music/progressions.test.ts`
Expected: 11 passed.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/music/progressions.ts frontend/src/music/progressions.test.ts
git commit -m "feat(theory): fifteen progressions and numeral-to-chord that keeps the quality (D-19)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: `TheoryNeck` and neck dots

**Files:**
- Create: `frontend/src/theory/TheoryNeck.tsx`, `frontend/src/theory/TheoryNeck.module.css`, `frontend/src/theory/neckDots.ts`
- Modify: `frontend/src/styles/chrome.test.ts`
- Test: `frontend/src/theory/TheoryNeck.test.tsx`, `frontend/src/theory/neckDots.test.ts`

**Interfaces:**
- Consumes: `Cell`, `positionsOf` (Task 4); `pretty`, `Spelled` (Task 3); `Instrument` (Task 4).
- Produces:
  - `Marker` = `'root' | 'tone' | 'accent' | 'question' | 'next' | 'ok' | 'wrong' | 'mute'`.
  - `NeckDot extends Cell { label; marker; dim? }` and `HeatCell extends Cell { weakness }`.
  - `TheoryNeck` props: `{ instrument, start? = 1, frets, dots, window?, heat?, onPick?(cell), size? 'full' | 'card', label }`.
  - The DOM exposes `data-cell="s{row}f{fret}"`, `data-marker`, `data-dim` and `data-heat` for tests. Click targets are `role="button"` named like "A string, fret 7" or "E string, open".
  - `LabelMode` = `'note' | 'interval' | 'degree' | 'none'`, and `noteDots(inst, notes, { lo, hi, labels, window? })`.

- [ ] **Step 1: Write the failing tests**

`frontend/src/theory/TheoryNeck.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

import { DEFAULT_INSTRUMENT, instrumentFor } from '../music/tuning';
import { TheoryNeck, type NeckDot } from './TheoryNeck';

const dots: NeckDot[] = [
  { string: 3, fret: 5, label: 'A', marker: 'root' },
  { string: 2, fret: 0, label: 'A', marker: 'root' },
  { string: 1, fret: 7, label: 'A', marker: 'tone', dim: true },
];

test('draws one dot per note with its marker, label and dim state', () => {
  const { container } = render(<TheoryNeck instrument={DEFAULT_INSTRUMENT} frets={12} dots={dots} label="A on bass" />);
  const drawn = container.querySelectorAll('[data-cell]');
  expect([...drawn].map((d) => `${d.getAttribute('data-cell')}:${d.getAttribute('data-marker')}`)).toEqual([
    's3f5:root',
    's2f0:root',
    's1f7:tone',
  ]);
  expect(container.querySelector('[data-cell="s1f7"]')).toHaveAttribute('data-dim', 'true');
  expect(screen.getByRole('group', { name: 'A on bass' })).toBeInTheDocument();
});

test('names strings from the tuning, highest string on top', () => {
  const { container } = render(
    <TheoryNeck instrument={{ ...DEFAULT_INSTRUMENT, tuning: ['D1', 'A1', 'D2', 'G2'] }} frets={12} dots={[]} label="neck" />,
  );
  const names = [...container.querySelectorAll('text')].map((t) => t.textContent).filter((t) => /^[A-G]/.test(t ?? ''));
  expect(names).toEqual(['G', 'D', 'A', 'D']);
});

test('a zoomed window numbers its first fret and has no open column', () => {
  const { container } = render(
    <TheoryNeck instrument={instrumentFor('guitar6', false)} start={4} frets={5} size="card" dots={[]} label="card" />,
  );
  const numbers = [...container.querySelectorAll('text')].map((t) => t.textContent).filter((t) => /^\d+$/.test(t ?? ''));
  expect(numbers).toEqual(['4', '5', '7']);
});

test('wrong and question markers draw ✕ and ?', () => {
  const { container } = render(
    <TheoryNeck
      instrument={DEFAULT_INSTRUMENT}
      frets={12}
      label="quiz"
      dots={[
        { string: 3, fret: 4, label: 'G♯', marker: 'wrong' },
        { string: 2, fret: 10, label: 'G', marker: 'question' },
      ]}
    />,
  );
  expect(container.querySelector('[data-cell="s3f4"]')?.textContent).toBe('✕');
  expect(container.querySelector('[data-cell="s2f10"]')?.textContent).toBe('?');
});

test('click targets report the cell, by mouse and by keyboard', () => {
  const onPick = vi.fn();
  render(<TheoryNeck instrument={DEFAULT_INSTRUMENT} frets={12} dots={[]} label="pick" onPick={onPick} />);
  fireEvent.click(screen.getByRole('button', { name: 'A string, fret 7' }));
  expect(onPick).toHaveBeenLastCalledWith({ string: 2, fret: 7 });
  fireEvent.keyDown(screen.getByRole('button', { name: 'E string, open' }), { key: 'Enter' });
  expect(onPick).toHaveBeenLastCalledWith({ string: 3, fret: 0 });
});

test('left-handed mirrors the neck', () => {
  const { container } = render(
    <TheoryNeck instrument={{ ...DEFAULT_INSTRUMENT, left_handed: true }} frets={12} dots={dots} label="lefty" />,
  );
  expect(container.querySelector('svg > g')).toHaveAttribute('transform', 'translate(1000 0) scale(-1 1)');
});

test('heat cells are drawn weak or strong', () => {
  const { container } = render(
    <TheoryNeck
      instrument={DEFAULT_INSTRUMENT}
      frets={12}
      dots={[]}
      label="heat"
      heat={[
        { string: 2, fret: 7, weakness: 0.9 },
        { string: 3, fret: 3, weakness: 0.1 },
      ]}
    />,
  );
  expect(container.querySelector('[data-heat="s2f7"]')).toHaveClass('heatWeak');
  expect(container.querySelector('[data-heat="s3f3"]')).toHaveClass('heatStrong');
});
```

`frontend/src/theory/neckDots.test.ts`:

```ts
import { expect, test } from 'vitest';

import { scaleNotes } from '../music/spell';
import { DEFAULT_INSTRUMENT } from '../music/tuning';
import { noteDots } from './neckDots';

const amp = scaleNotes('A', 'minor-pentatonic');

test('labels by note, interval and degree; the root is marked', () => {
  const at = (labels: 'note' | 'interval' | 'degree') =>
    noteDots(DEFAULT_INSTRUMENT, amp, { lo: 5, hi: 5, labels }).map((d) => `${d.string}:${d.label}:${d.marker}`);
  expect(at('note')).toEqual(['0:C:tone', '1:G:tone', '2:D:tone', '3:A:root']);
  expect(at('interval')).toEqual(['0:♭3:tone', '1:♭7:tone', '2:4:tone', '3:R:root']);
  expect(at('degree')).toEqual(['0:2:tone', '1:5:tone', '2:3:tone', '3:1:root']);
});

test('dots outside the window are dimmed, not dropped', () => {
  const dots = noteDots(DEFAULT_INSTRUMENT, amp, { lo: 0, hi: 12, labels: 'none', window: { lo: 5, hi: 8 } });
  expect(dots.filter((d) => !d.dim).every((d) => d.fret >= 5 && d.fret <= 8)).toBe(true);
  expect(dots.some((d) => d.dim)).toBe(true);
  expect(dots.every((d) => d.label === '')).toBe(true);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npm --prefix frontend test -- src/theory`
Expected: FAIL, `Failed to resolve import "./TheoryNeck"`.

- [ ] **Step 3: Implement the neck**

`frontend/src/theory/TheoryNeck.tsx`:

```tsx
// The Theory tab's neck (D-19, U-13): any instrument and tuning, a fret window,
// an open-string column left of the nut, markers, a highlighted position,
// click targets and a left-handed mirror. SVG, not canvas: it is static between
// clicks and nothing on it moves with the engine clock. (playalong/Neck is the
// canvas one that does.) Reference: design/ui/src/pages/components/neck.html.
import type { KeyboardEvent } from 'react';

import type { Cell } from '../music/positions';
import { pretty } from '../music/spell';
import type { Instrument } from '../music/tuning';
import styles from './TheoryNeck.module.css';

export type Marker = 'root' | 'tone' | 'accent' | 'question' | 'next' | 'ok' | 'wrong' | 'mute';

export interface NeckDot extends Cell {
  label: string;
  marker: Marker;
  /** Outside the highlighted position: drawn at 28 % with a legible label. */
  dim?: boolean;
}

export interface HeatCell extends Cell {
  /** 0 strong … 1 weak. */
  weakness: number;
}

export interface TheoryNeckProps {
  instrument: Instrument;
  /** First fret column drawn. 1 (the default) also draws the open-string column. */
  start?: number;
  /** How many fret columns. */
  frets: number;
  dots: readonly NeckDot[];
  window?: { lo: number; hi: number } | null;
  heat?: readonly HeatCell[];
  onPick?: (cell: Cell) => void;
  size?: 'full' | 'card';
  /** Accessible name, e.g. "A minor pentatonic on bass". */
  label: string;
}

const INLAYS = new Set([3, 5, 7, 9, 12, 15, 17, 19, 21, 24]);

const MARKER_CLASS: Record<Marker, string | undefined> = {
  root: styles.root,
  tone: styles.tone,
  accent: styles.accent,
  question: styles.question,
  next: styles.next,
  ok: styles.ok,
  wrong: styles.wrong,
  mute: undefined,
};

export function TheoryNeck({
  instrument,
  start = 1,
  frets,
  dots,
  window,
  heat,
  onPick,
  size = 'full',
  label,
}: TheoryNeckProps) {
  const card = size === 'card';
  const W = card ? 360 : 1000;
  const SH = card ? 26 : 40;
  const R = card ? 11 : 14;
  const open = start === 1;
  const NUT = open ? 66 : 40;
  const TOP = 24;
  const fw = (W - NUT - 18) / frets;
  const rows = [...instrument.tuning].reverse();
  const H = TOP + SH * (rows.length - 1) + 32;
  // Fret 0 is the open column left of the nut; on a zoomed window it is the ✕ column for muted strings.
  const x = (fret: number) => (fret === 0 ? (open ? NUT - 22 : NUT - 10) : NUT + fw * (fret - start + 0.5));
  const y = (string: number) => TOP + SH * string;
  // Mirrored for a left-handed player; text is flipped back so it still reads.
  const flip = (cx: number) => (instrument.left_handed ? `translate(${2 * cx} 0) scale(-1 1)` : undefined);
  const columns = [...(open ? [0] : []), ...Array.from({ length: frets }, (_, i) => start + i)];

  const key = (cell: Cell) => (event: KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onPick?.(cell);
    }
  };

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={styles.svg} role="group" aria-label={label}>
      <g transform={instrument.left_handed ? `translate(${W} 0) scale(-1 1)` : undefined}>
        {window && (
          <rect
            className={styles.window}
            x={NUT + fw * (window.lo - start)}
            y={TOP - 14}
            width={fw * (window.hi - window.lo + 1)}
            height={SH * (rows.length - 1) + 28}
            rx={8}
          />
        )}
        {heat?.map((h) => (
          <rect
            key={`heat-${h.string}-${h.fret}`}
            data-heat={`s${h.string}f${h.fret}`}
            className={h.weakness >= 0.5 ? styles.heatWeak : styles.heatStrong}
            style={{ opacity: 0.12 + 0.38 * Math.abs(h.weakness - 0.5) * 2 }}
            x={h.fret === 0 ? NUT - 40 : NUT + fw * (h.fret - start) + 2}
            y={y(h.string) - SH / 2 + 2}
            width={h.fret === 0 ? 36 : fw - 4}
            height={SH - 4}
            rx={4}
          />
        ))}
        {Array.from({ length: frets + 1 }, (_, i) => (
          <line
            key={`fret-${i}`}
            className={i === 0 && open ? styles.nut : styles.fret}
            x1={NUT + fw * i}
            x2={NUT + fw * i}
            y1={TOP - 8}
            y2={y(rows.length - 1) + 8}
          />
        ))}
        {columns
          .filter((f) => f > 0 && (INLAYS.has(f) || (f === start && !open)))
          .map((f) => (
            <text key={`inlay-${f}`} className={styles.inlay} x={x(f)} y={H - 6} transform={flip(x(f))}>
              {f}
            </text>
          ))}
        {rows.map((note, string) => (
          <g key={`string-${string}`}>
            <line className={styles.string} x1={NUT} x2={W - 18} y1={y(string)} y2={y(string)} strokeWidth={1 + string * 0.5} />
            <text className={styles.stringName} x={14} y={y(string)} transform={flip(14)}>
              {pretty(note.replace(/-?\d+$/, ''))}
            </text>
          </g>
        ))}
        {dots.map((dot) => {
          const cx = x(dot.fret);
          const cy = y(dot.string);
          const common = { 'data-cell': `s${dot.string}f${dot.fret}`, 'data-marker': dot.marker };
          if (dot.marker === 'mute') {
            return (
              <text key={common['data-cell']} {...common} className={styles.muteMark} x={cx} y={cy} transform={flip(cx)}>
                ✕
              </text>
            );
          }
          const text = dot.marker === 'wrong' ? '✕' : dot.marker === 'question' ? '?' : dot.label;
          return (
            <g key={common['data-cell']} {...common} data-dim={dot.dim ? 'true' : undefined} className={dot.dim ? styles.dim : undefined}>
              {dot.marker === 'accent' && <circle className={styles.halo} cx={cx} cy={cy} r={R + 6} />}
              <circle className={MARKER_CLASS[dot.marker]} cx={cx} cy={cy} r={R} />
              {text && (
                <text
                  className={`${styles.label} ${styles[`label_${dot.marker}`] ?? ''}`}
                  x={cx}
                  y={cy}
                  transform={flip(cx)}
                  fontSize={text.length > 1 ? (card ? 10 : 12) : card ? 11 : 13}
                >
                  {text}
                </text>
              )}
            </g>
          );
        })}
        {onPick &&
          rows.flatMap((note, string) =>
            columns.map((fret) => {
              const cell = { string, fret };
              const name = `${pretty(note.replace(/-?\d+$/, ''))} string, ${fret === 0 ? 'open' : `fret ${fret}`}`;
              return (
                <rect
                  key={`pick-${string}-${fret}`}
                  className={styles.pick}
                  role="button"
                  tabIndex={0}
                  aria-label={name}
                  x={fret === 0 ? NUT - 40 : NUT + fw * (fret - start)}
                  y={y(string) - SH / 2}
                  width={fret === 0 ? 36 : fw}
                  height={SH}
                  onClick={() => onPick(cell)}
                  onKeyDown={key(cell)}
                />
              );
            }),
          )}
      </g>
    </svg>
  );
}
```

`frontend/src/theory/TheoryNeck.module.css`:

```css
/* The Theory tab's neck (D-19). Colours per U-13: the root takes the bass hue,
   "act on this" is accent, right/wrong are the vivid ok/error signals. This and
   Fretboard.module.css are the only stylesheets where a note dot names the
   instrument (chrome.test.ts allows them the bass hue). */
.svg {
  width: 100%;
  height: auto;
  display: block;
}

.fret {
  stroke: var(--ds-border-strong);
  stroke-width: 1.5;
}

.nut {
  stroke: var(--ds-text-2);
  stroke-width: 4;
}

.string {
  stroke: var(--ds-border-strong);
}

.inlay,
.stringName {
  fill: var(--ds-text-3);
  font: 400 13px var(--ds-mono);
  text-anchor: middle;
  dominant-baseline: central;
}

.window {
  fill: var(--ds-accent);
  fill-opacity: 0.08;
  stroke: var(--ds-accent);
  stroke-opacity: 0.45;
}

.root,
.tone,
.accent,
.question,
.next,
.ok,
.wrong {
  stroke-width: 2;
}

.root {
  fill: var(--ds-bass);
  stroke: var(--ds-bass);
}

.tone {
  fill: var(--ds-raised);
  stroke: var(--ds-bass);
}

.accent {
  fill: var(--ds-accent);
  stroke: var(--ds-accent);
}

.halo {
  fill: var(--ds-accent);
  opacity: 0.22;
}

.question {
  fill: var(--ds-ground);
  stroke: var(--ds-accent);
}

.next {
  fill: var(--ds-ground);
  stroke: var(--ds-text-3);
  stroke-dasharray: 4 3;
}

.ok {
  fill: var(--ds-ok);
  stroke: var(--ds-ok);
}

.wrong {
  fill: var(--ds-ground);
  stroke: var(--ds-error);
}

.label {
  font-weight: 700;
  font-family: var(--ds-font);
  fill: var(--ds-text);
  text-anchor: middle;
  dominant-baseline: central;
  pointer-events: none;
}

.label_root,
.label_ok {
  fill: var(--ds-ground);
}

.label_accent {
  fill: var(--ds-on-accent);
}

.label_question {
  fill: var(--ds-accent);
}

.label_next {
  fill: var(--ds-text-3);
}

.label_wrong {
  fill: var(--ds-error);
}

/* Outside the highlighted position: faded, but the label stays legible (U-13). */
.dim circle {
  opacity: 0.28;
}

.dim .label {
  fill: var(--ds-text-3);
}

.muteMark {
  fill: var(--ds-text-3);
  font: 700 15px var(--ds-font);
  text-anchor: middle;
  dominant-baseline: central;
}

.heatWeak {
  fill: var(--ds-error);
}

.heatStrong {
  fill: var(--ds-ok);
}

.pick {
  fill: transparent;
  cursor: pointer;
}

.pick:hover {
  fill: var(--ds-overlay);
  fill-opacity: 0.5;
}

.pick:focus-visible {
  outline: none;
  stroke: var(--ds-accent);
  stroke-width: 2;
}
```

- [ ] **Step 4: Implement `neckDots.ts`**

```ts
// Spelled notes -> dots on the neck (D-19). The label is the note, its interval
// from the root, its scale degree, or nothing; the root is marked (U-13); a dot
// outside the highlighted position is dimmed, not hidden.
import { positionsOf } from '../music/positions';
import { pretty, type Spelled } from '../music/spell';
import type { Instrument } from '../music/tuning';
import type { NeckDot } from './TheoryNeck';

export type LabelMode = 'note' | 'interval' | 'degree' | 'none';

export function noteDots(
  inst: Instrument,
  notes: readonly Spelled[],
  options: { lo: number; hi: number; labels: LabelMode; window?: { lo: number; hi: number } | null },
): NeckDot[] {
  const rootPc = notes[0]?.pc;
  const byPc = new Map(notes.map((n, i) => [n.pc, { note: n, degree: i + 1 }]));
  return positionsOf(inst, new Set(byPc.keys()), options.lo, options.hi).map((p) => {
    const { note, degree } = byPc.get(p.pc)!;
    const label =
      options.labels === 'note' ? pretty(note.name)
      : options.labels === 'interval' ? note.interval
      : options.labels === 'degree' ? String(degree)
      : '';
    const w = options.window;
    return {
      string: p.string,
      fret: p.fret,
      label,
      marker: p.pc === rootPc ? 'root' : 'tone',
      dim: w ? p.fret < w.lo || p.fret > w.hi : false,
    };
  });
}
```

- [ ] **Step 5: Allow the Theory stylesheets the bass hue (U-13)**

In `frontend/src/styles/chrome.test.ts`, test `stem hues appear only where a stem is named (U-01)`, replace the allow-list line with:

```ts
  const ALLOWED = ['Fretboard.module.css', 'TheoryNeck.module.css', 'Theory.module.css'];
```

(`Theory.module.css` arrives in Task 8. Its root note chip is the other place a note names the instrument.)

- [ ] **Step 6: Run the tests**

Run: `npm --prefix frontend test -- src/theory src/styles`
Expected: 9 theory tests pass; the chrome guards pass.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/theory/TheoryNeck.tsx frontend/src/theory/TheoryNeck.module.css frontend/src/theory/TheoryNeck.test.tsx frontend/src/theory/neckDots.ts frontend/src/theory/neckDots.test.ts frontend/src/styles/chrome.test.ts
git commit -m "feat(theory): TheoryNeck, any tuning, markers, position window, heat and click targets (D-19, U-13)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The shared selection in the URL

**Files:**
- Create: `frontend/src/theory/selection.ts`
- Test: `frontend/src/theory/selection.test.ts`

**Interfaces:**
- Produces:
  - `Selection { root; scale; mode; quality; bass; chord; notes }` and `DEFAULT_SELECTION`.
  - `parseSelection(URLSearchParams)` and `selectionParams(Selection)`, which only writes values that differ from the defaults.
  - `useSelection(): [Selection, (patch) => void]`, which pushes history so back and forward work.
  - URL params: `root`, `scale`, `mode` (only when it differs from the scale's own), `q`, `bass`, `chord` and `notes` (comma-separated pitch classes).

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from 'vitest';

import { DEFAULT_SELECTION, parseSelection, selectionParams } from './selection';

test('empty query string is the default selection', () => {
  expect(parseSelection(new URLSearchParams())).toEqual(DEFAULT_SELECTION);
});

test('round trip writes only what differs from the defaults', () => {
  const sel = { ...DEFAULT_SELECTION, root: 'A', scale: 'minor-pentatonic' as const, mode: 'minor' as const };
  const params = selectionParams(sel);
  expect(params.toString()).toBe('root=A&scale=minor-pentatonic');
  expect(parseSelection(params)).toEqual(sel);
});

test('mode defaults to the scale’s own and is written only when it differs', () => {
  expect(parseSelection(new URLSearchParams('scale=dorian')).mode).toBe('minor');
  const sel = { ...DEFAULT_SELECTION, mode: 'minor' as const };
  expect(selectionParams(sel).toString()).toBe('mode=minor');
});

test('chord, bass and notes', () => {
  const sel = parseSelection(new URLSearchParams('chord=Am7%2FG&bass=G&notes=4,7,7,13'));
  expect(sel.chord).toBe('Am7/G');
  expect(sel.bass).toBe('G');
  expect(sel.notes).toEqual([4, 7]);
});

test('values no tool knows read as defaults', () => {
  const sel = parseSelection(new URLSearchParams('root=H&scale=bebop&q=13&mode=lydian'));
  expect(sel.root).toBe('C');
  expect(sel.scale).toBe('major');
  expect(sel.quality).toBe('maj');
  expect(sel.mode).toBe('major');
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm --prefix frontend test -- src/theory/selection.test.ts`
Expected: FAIL, `Failed to resolve import "./selection"`.

- [ ] **Step 3: Implement**

```ts
// The shared selection lives in the query string (D-19): root, scale, key mode,
// chord quality, slash bass, a typed chord and Note finder's notes. Every tool
// reads and writes the same parameters, so picking A minor in Scale finder and
// opening Chords in a key shows A minor, and back/forward and bookmarks work.
// theory.json never stores it.
import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

import { isScaleId, pcOf, QUALITIES, scaleDef, type KeyMode, type QualityId, type ScaleId } from '../music/spell';

export interface Selection {
  /** ASCII note name: "A", "Bb", "F#". */
  root: string;
  scale: ScaleId;
  /** Key mode for the key tools; defaults to the scale's own. */
  mode: KeyMode;
  quality: QualityId;
  bass: string | null;
  /** A typed chord symbol that overrides root + quality in Chord finder. */
  chord: string | null;
  /** Note finder's pitch classes. */
  notes: number[];
}

export const DEFAULT_SELECTION: Selection = {
  root: 'C',
  scale: 'major',
  mode: 'major',
  quality: 'maj',
  bass: null,
  chord: null,
  notes: [],
};

const isNote = (s: string | null): s is string => s !== null && /^[A-G](#|b)?$/.test(s) && pcOf(s) !== null;

/** A hand-edited URL with a value no tool knows reads as the default for that value. */
export function parseSelection(params: URLSearchParams): Selection {
  const scaleParam = params.get('scale');
  const scale = scaleParam && isScaleId(scaleParam) ? scaleParam : DEFAULT_SELECTION.scale;
  const modeParam = params.get('mode');
  const q = params.get('q');
  const root = params.get('root');
  const bass = params.get('bass');
  const notes = (params.get('notes') ?? '')
    .split(',')
    .filter((n) => /^\d{1,2}$/.test(n))
    .map(Number)
    .filter((n) => n < 12);
  return {
    root: isNote(root) ? root : DEFAULT_SELECTION.root,
    scale,
    mode: modeParam === 'major' || modeParam === 'minor' ? modeParam : scaleDef(scale).mode,
    quality: QUALITIES.some((x) => x.id === q) ? (q as QualityId) : DEFAULT_SELECTION.quality,
    bass: isNote(bass) ? bass : null,
    chord: params.get('chord') || null,
    notes: [...new Set(notes)],
  };
}

/** Only values that differ from the defaults are written, so URLs stay short. */
export function selectionParams(sel: Selection): URLSearchParams {
  const p = new URLSearchParams();
  if (sel.root !== DEFAULT_SELECTION.root) p.set('root', sel.root);
  if (sel.scale !== DEFAULT_SELECTION.scale) p.set('scale', sel.scale);
  if (sel.mode !== scaleDef(sel.scale).mode) p.set('mode', sel.mode);
  if (sel.quality !== DEFAULT_SELECTION.quality) p.set('q', sel.quality);
  if (sel.bass) p.set('bass', sel.bass);
  if (sel.chord) p.set('chord', sel.chord);
  if (sel.notes.length) p.set('notes', sel.notes.join(','));
  return p;
}

export function useSelection(): [Selection, (patch: Partial<Selection>) => void] {
  const [params, setParams] = useSearchParams();
  const selection = useMemo(() => parseSelection(params), [params]);
  const update = useCallback(
    (patch: Partial<Selection>) => setParams(selectionParams({ ...parseSelection(params), ...patch })),
    [params, setParams],
  );
  return [selection, update];
}
```

- [ ] **Step 4: Run the tests**

Run: `npm --prefix frontend test -- src/theory/selection.test.ts`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/theory/selection.ts frontend/src/theory/selection.test.ts
git commit -m "feat(theory): the shared selection lives in the query string (D-19)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: The Theory tab: screen, rail, `theory.json` in the browser, Scale finder

The tab becomes reachable, with its first tool.

**Files:**
- Create:
  - `frontend/src/theory/TheoryDoc.tsx`, `controls.tsx`, `Theory.module.css`, `help.ts`, `tools.ts`, `ToolRail.tsx`, `InstrumentFooter.tsx`
  - `frontend/src/theory/tools/ScaleFinder.tsx`, `frontend/src/theory/tools/testing.tsx`
  - `frontend/src/screens/Theory.tsx`
- Modify: `frontend/src/app/routes.tsx`, `frontend/src/app/AppShell.tsx`, `frontend/src/app/routes.test.tsx`
- Test: `frontend/src/screens/Theory.test.tsx`, `frontend/src/theory/tools/scaleFinder.test.tsx`

**Interfaces:**
- Consumes: Tasks 3–7.
- Produces:
  - `TheoryDocProvider` and `useTheoryDoc(): { doc, loadError, saveError, update(change, { now? }), retry, resetToDefaults }`. `update` applies the change at once and PUTs the whole document 500 ms later, or straight away with `{ now: true }`.
  - `TOOLS: ToolDef[]` (`{ slug, label, group, Component }`), `GROUPS` and `toolBySlug`. Later tasks and phases register tools here.
  - Controls: `NotePicker({ label, selected: pc[], onPick(pc) })`, `ChipRow({ label, options, value, onChange, large? })`, `NoteChips({ notes })`, `HelpBox`, `ToolHeader({ title, children })`.
  - `renderTool(path, { theory?, analysis?, songTitle? }) -> { puts, where(), dots(), ...render }`, the test helper used by every tool test.
  - The screen waits for `theory.json` (or its error) before drawing a tool, so a tool never flashes the default bass neck.

- [ ] **Step 1: Write the failing screen test**

`frontend/src/screens/Theory.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, expect, test, vi } from 'vitest';

import { DEFAULT_THEORY, type TheoryDoc } from '../api/client';
import { Theory } from './Theory';

const songEntry = (id: string, title: string, hasAnalysis: boolean, lastPlayed: string | null) => ({
  dir: `${id}-x`,
  song: { id, title, last_played_at: lastPlayed },
  state: hasAnalysis ? 'analyzed' : 'separated',
  unreadable: null,
  files: { has_audio: true, has_peaks: true, has_stems: true, has_analysis: hasAnalysis },
});

const analysis = {
  schema_version: 1,
  key_candidates: [
    { tonic: 'G', mode: 'minor', confidence: 0.72 },
    { tonic: 'A#', mode: 'major', confidence: 0.18 },
  ],
  beat_grid: { bpm: 120, beats: [0], downbeats: [0] },
  chords: [
    { bar: 0, start_sample: 0, end_sample: 1, chord: 'G:min' },
    { bar: 1, start_sample: 1, end_sample: 2, chord: 'G:min' },
    { bar: 2, start_sample: 2, end_sample: 3, chord: 'D#:maj' },
    { bar: 3, start_sample: 3, end_sample: 4, chord: 'N' },
    { bar: 4, start_sample: 4, end_sample: 5, chord: 'D:7' },
  ],
};

interface Server {
  theory?: TheoryDoc | { status: number; detail: string };
  putStatus?: number;
}

function setup(path: string, server: Server = {}) {
  const puts: TheoryDoc[] = [];
  let stored: TheoryDoc | { status: number; detail: string } = server.theory ?? DEFAULT_THEORY;
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/theory' && init?.method === 'PUT') {
      const body = JSON.parse(String(init.body)) as TheoryDoc;
      puts.push(body);
      if (server.putStatus) return new Response('disk full', { status: server.putStatus });
      stored = body;
      return new Response(JSON.stringify(body));
    }
    if (url === '/api/theory') {
      return 'status' in stored
        ? new Response(JSON.stringify({ detail: stored.detail }), { status: stored.status })
        : new Response(JSON.stringify(stored));
    }
    if (url === '/api/songs') {
      return new Response(
        JSON.stringify({
          songs: [
            songEntry('01OLD', 'Old Song', true, '2026-01-01T00:00:00Z'),
            songEntry('01TIGHT', 'Tightrope', true, '2026-09-01T00:00:00Z'),
            songEntry('01RAW', 'Raw Song', false, null),
          ],
        }),
      );
    }
    if (url === '/api/songs/01TIGHT/analysis') return new Response(JSON.stringify(analysis));
    throw new Error(`unexpected fetch: ${init?.method ?? 'GET'} ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let location = '';
  function Where() {
    const l = useLocation();
    location = `${l.pathname}${l.search}`;
    return null;
  }
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="theory" element={<Theory />} />
          <Route path="theory/:tool" element={<Theory />} />
        </Routes>
        <Where />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { puts, fetchMock, where: () => location };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test('the rail lists the registered tools and marks the open one', async () => {
  setup('/theory/scale-finder');
  const rail = await screen.findByRole('navigation', { name: 'Theory tools' });
  expect(within(rail).getByRole('link', { name: 'Scale finder' })).toHaveAttribute('aria-current', 'page');
  expect(within(rail).getByRole('link', { name: 'Scale finder' })).toHaveAttribute('href', '/theory/scale-finder');
});

test('opening a tool saves it as the last tool', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const { puts } = setup('/theory/scale-finder', { theory: { ...DEFAULT_THEORY, last_tool: 'note-finder' } });
  await screen.findByRole('heading', { name: 'Scale finder' });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(600);
  });
  expect(puts.at(-1)?.last_tool).toBe('scale-finder');
});

test('an unknown tool says so', async () => {
  setup('/theory/tab-reader');
  expect(await screen.findByText(/There is no tool called “tab-reader”/)).toBeInTheDocument();
});

test('an unreadable theory.json is an error with the real reason and a confirmed reset', async () => {
  const { puts } = setup('/theory/scale-finder', {
    theory: { status: 500, detail: 'data/theory.json: 1 invalid field(s): quiz.history.0.ms' },
  });
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent("theory.json can't be read");
  expect(alert).toHaveTextContent('quiz.history.0.ms');
  vi.spyOn(window, 'confirm').mockReturnValueOnce(false);
  fireEvent.click(within(alert).getByRole('button', { name: 'Reset to defaults…' }));
  expect(puts).toHaveLength(0);
  vi.spyOn(window, 'confirm').mockReturnValueOnce(true);
  fireEvent.click(within(alert).getByRole('button', { name: 'Reset to defaults…' }));
  await waitFor(() => expect(puts).toEqual([DEFAULT_THEORY]));
});

test('a failed save keeps the change and offers Retry', async () => {
  const { puts } = setup('/theory/scale-finder', { putStatus: 500 });
  const instrument = await screen.findByRole('combobox', { name: 'Instrument' });
  await waitFor(() => expect(instrument).toBeEnabled());
  fireEvent.change(instrument, { target: { value: 'guitar6' } });
  const warning = await screen.findByText("Couldn't save", {}, { timeout: 2000 });
  expect(screen.getByRole('combobox', { name: 'Instrument' })).toHaveValue('guitar6');
  expect(warning.closest('[role="status"]')).toHaveTextContent('disk full');
  const before = puts.length;
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await waitFor(() => expect(puts.length).toBe(before + 1));
  expect(puts.at(-1)?.instrument.kind).toBe('guitar');
});

test('instrument footer: guitar, drop D, custom tuning and left-handed', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const { puts } = setup('/theory/scale-finder');
  const instrument = await screen.findByRole('combobox', { name: 'Instrument' });
  await waitFor(() => expect(instrument).toBeEnabled());
  fireEvent.change(instrument, { target: { value: 'guitar6' } });
  fireEvent.change(screen.getByRole('combobox', { name: 'Tuning' }), { target: { value: 'guitar-drop-d' } });
  fireEvent.click(screen.getByRole('checkbox', { name: 'Left-handed' }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(600);
  });
  expect(puts.at(-1)?.instrument).toEqual({
    kind: 'guitar',
    strings: 6,
    tuning: ['D2', 'A2', 'D3', 'G3', 'B3', 'E4'],
    left_handed: true,
  });

  fireEvent.change(screen.getByRole('combobox', { name: 'Tuning' }), { target: { value: 'custom' } });
  const field = screen.getByRole('textbox', { name: 'Custom tuning, low string first' });
  fireEvent.change(field, { target: { value: 'D A D G B E' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  expect(screen.getByRole('alert')).toHaveTextContent('"D" is not a note with an octave');
  fireEvent.change(field, { target: { value: 'C2 G2 C3 G3 C4 E4' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(600);
  });
  expect(puts.at(-1)?.instrument.tuning).toEqual(['C2', 'G2', 'C3', 'G3', 'C4', 'E4']);
});
```

- [ ] **Step 2: Write the tool test helper and the Scale finder test**

`frontend/src/theory/tools/testing.tsx`:

```tsx
// Renders one Theory tool inside the Theory screen with a mocked API, for the
// per-tool tests. `where()` reports the current path + query string.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { vi } from 'vitest';

import { DEFAULT_THEORY, type Analysis, type TheoryDoc } from '../../api/client';
import { Theory } from '../../screens/Theory';

export function renderTool(
  path: string,
  options: { theory?: Partial<TheoryDoc>; analysis?: Analysis; songTitle?: string } = {},
) {
  const theory = { ...DEFAULT_THEORY, ...options.theory };
  const puts: TheoryDoc[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/theory' && init?.method === 'PUT') {
        puts.push(JSON.parse(String(init.body)));
        return new Response(String(init.body));
      }
      if (url === '/api/theory') return new Response(JSON.stringify(theory));
      if (url === '/api/songs') {
        const songs = options.analysis
          ? [{ dir: 'x', song: { id: '01SONG', title: options.songTitle ?? 'Tightrope', last_played_at: null }, state: 'analyzed', unreadable: null, files: { has_audio: true, has_peaks: true, has_stems: true, has_analysis: true } }]
          : [];
        return new Response(JSON.stringify({ songs }));
      }
      if (url === '/api/songs/01SONG/analysis' && options.analysis) return new Response(JSON.stringify(options.analysis));
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );
  let location = '';
  function Where() {
    const l = useLocation();
    location = `${l.pathname}${l.search}`;
    return null;
  }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="theory" element={<Theory />} />
          <Route path="theory/:tool" element={<Theory />} />
        </Routes>
        <Where />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const dots = () =>
    [...view.container.querySelectorAll('[data-cell]')].map(
      (d) => `${d.getAttribute('data-cell')}:${d.textContent}${d.getAttribute('data-dim') ? ':dim' : ''}`,
    );
  return { ...view, puts, where: () => location, dots };
}
```

`frontend/src/theory/tools/scaleFinder.test.tsx`:

```tsx
import { fireEvent, screen, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

import { renderTool } from './testing';

afterEach(() => vi.unstubAllGlobals());

test('scale finder: root and scale pickers drive the neck and the URL', async () => {
  const { where, dots } = renderTool('/theory/scale-finder');
  await screen.findByRole('heading', { name: 'Scale finder' });
  fireEvent.click(within(screen.getByRole('group', { name: 'Root' })).getByRole('button', { name: 'A' }));
  fireEvent.click(screen.getByRole('button', { name: 'Minor pentatonic' }));
  expect(where()).toBe('/theory/scale-finder?root=A&scale=minor-pentatonic');
  expect(dots()).toContain('s3f5:A');
  expect(dots()).toContain('s0f5:C');
  expect(dots().some((d) => d.includes(':F'))).toBe(false);
  expect(screen.getByText(/Fits over:/).parentElement).toHaveTextContent('Fits over: Am, C.');
  expect(screen.getByText(/Same notes as/).parentElement).toHaveTextContent('Same notes as C major pentatonic.');
});

test('scale finder: labels and one highlighted position', async () => {
  const { dots } = renderTool('/theory/scale-finder?root=A&scale=minor-pentatonic');
  await screen.findByRole('heading', { name: 'Scale finder' });
  fireEvent.click(screen.getByRole('button', { name: 'Interval' }));
  expect(dots()).toContain('s3f5:R');
  fireEvent.click(within(screen.getByRole('group', { name: 'Highlight position' })).getByRole('button', { name: '1' }));
  expect(screen.getByText('frets 5–8')).toBeInTheDocument();
  expect(dots()).toContain('s3f5:R');
  expect(dots()).toContain('s3f3:♭7:dim');
});

test('scale finder: a flat key is spelled with flats', async () => {
  const { dots } = renderTool('/theory/scale-finder?root=Eb');
  await screen.findByRole('heading', { name: 'Scale finder' });
  expect(dots()).toContain('s2f1:B♭');
  expect(dots().some((d) => d.includes('♯'))).toBe(false);
});
```

- [ ] **Step 3: Run them to see them fail**

Run: `npm --prefix frontend test -- src/screens/Theory.test.tsx src/theory/tools`
Expected: FAIL, `Failed to resolve import "./Theory"`.

- [ ] **Step 4: `theory.json` in the browser**

`frontend/src/theory/TheoryDoc.tsx`:

```tsx
// theory.json in the browser (D-19): one GET, then every change is applied
// locally at once and PUT as the whole document. Instrument and last-tool
// changes are debounced 500 ms; quiz answers are sent immediately when a round
// ends. A failed save keeps the unsaved document in memory and says so with a
// Retry; nothing is dropped and nothing is retried silently (N-08).
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { api, DEFAULT_THEORY, type TheoryDoc } from '../api/client';

const KEY = ['theory'] as const;
const DEBOUNCE_MS = 500;

export interface TheoryDocState {
  /** The document as the player last changed it; null until the first GET succeeds. */
  doc: TheoryDoc | null;
  /** GET /api/theory failed: the server's message, verbatim (U-09). */
  loadError: string | null;
  /** The last PUT failed: its message. Cleared by the next successful save. */
  saveError: string | null;
  /** Applies `change` now and saves it: after 500 ms, or at once with `{ now: true }`. */
  update: (change: (doc: TheoryDoc) => TheoryDoc, options?: { now?: boolean }) => void;
  retry: () => void;
  /** PUTs the defaults over an unreadable theory.json. Only after the player confirms. */
  resetToDefaults: () => Promise<void>;
}

const Ctx = createContext<TheoryDocState | null>(null);

export function TheoryDocProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const query = useQuery({ queryKey: KEY, queryFn: () => api.get<TheoryDoc>('/api/theory'), retry: false });
  const [local, setLocal] = useState<TheoryDoc | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const latest = useRef<TheoryDoc | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const doc = local ?? query.data ?? null;
  latest.current = doc;

  const save = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const body = latest.current;
    if (!body) return;
    try {
      const saved = await api.put<TheoryDoc>('/api/theory', body);
      client.setQueryData(KEY, saved);
      setSaveError(null);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    }
  }, [client]);

  const update = useCallback<TheoryDocState['update']>(
    (change, options) => {
      const base = latest.current;
      if (!base) return;
      const next = change(base);
      latest.current = next;
      setLocal(next);
      if (timer.current) clearTimeout(timer.current);
      if (options?.now) void save();
      else timer.current = setTimeout(() => void save(), DEBOUNCE_MS);
    },
    [save],
  );

  // Leaving the tab with a debounced change pending still saves it.
  useEffect(
    () => () => {
      if (timer.current) void save();
    },
    [save],
  );

  const resetToDefaults = useCallback(async () => {
    latest.current = DEFAULT_THEORY;
    setLocal(DEFAULT_THEORY);
    await save();
    await client.invalidateQueries({ queryKey: KEY });
  }, [client, save]);

  const value = useMemo<TheoryDocState>(
    () => ({
      doc,
      loadError: query.error ? query.error.message : null,
      saveError,
      update,
      retry: () => void save(),
      resetToDefaults,
    }),
    [doc, query.error, saveError, update, save, resetToDefaults],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheoryDoc(): TheoryDocState {
  const value = useContext(Ctx);
  if (!value) throw new Error('useTheoryDoc outside <TheoryDocProvider>');
  return value;
}
```

- [ ] **Step 5: Shared controls, styles and scale help**

`frontend/src/theory/controls.tsx`:

```tsx
// Controls every Theory tool shares (D-19, ui-spec §5): the 12-note picker, a
// row of selectable chips, the scale's or chord's note chips, the help box and
// the tool header. Styles: Theory.module.css.
import type { ReactNode } from 'react';

import { pretty, type Spelled } from '../music/spell';
import styles from './Theory.module.css';

const KEYS = ['C', 'C♯/D♭', 'D', 'E♭', 'E', 'F', 'F♯/G♭', 'G', 'A♭', 'A', 'B♭', 'B'];

/** Twelve buttons, C … B. `selected` lights them (U-01: accent); `onPick` gets the pitch class. */
export function NotePicker({
  label,
  selected,
  onPick,
}: {
  label: string;
  selected: readonly number[];
  onPick: (pc: number) => void;
}) {
  return (
    <div className={styles.notekeys} role="group" aria-label={label}>
      {KEYS.map((name, pc) => (
        <button key={name} type="button" className={styles.notekey} aria-pressed={selected.includes(pc)} onClick={() => onPick(pc)}>
          {name}
        </button>
      ))}
    </div>
  );
}

export interface ChipOption<T extends string> {
  value: T;
  label: ReactNode;
}

/** A labelled row of selectable chips, e.g. "Common: Major · Minor · …". */
export function ChipRow<T extends string>({
  label,
  options,
  value,
  onChange,
  large = false,
}: {
  label: string;
  options: readonly ChipOption<T>[];
  value: T | null;
  onChange: (value: T) => void;
  large?: boolean;
}) {
  return (
    <div className={styles.chipRow} role="group" aria-label={label}>
      <span className={styles.cap}>{label}</span>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={large ? `${styles.chip} ${styles.chipLarge}` : styles.chip}
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** The notes with their intervals; the root filled in the bass hue (U-13). */
export function NoteChips({ notes }: { notes: readonly Spelled[] }) {
  return (
    <ul className={styles.notechips} aria-label="Notes">
      {notes.map((n, i) => (
        <li key={`${n.name}-${i}`} className={i === 0 ? `${styles.notechip} ${styles.rootChip}` : styles.notechip}>
          {pretty(n.name)}
          <small>{n.interval}</small>
        </li>
      ))}
    </ul>
  );
}

export function HelpBox({ children }: { children: ReactNode }) {
  return <div className={styles.help}>{children}</div>;
}

export function ToolHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className={styles.toolHead}>
      <h1 className={styles.title}>{title}</h1>
      {children}
    </div>
  );
}
```

`frontend/src/theory/Theory.module.css`:

```css
/* The Theory tab (D-19). Reference: design/ui/src/pages/screens/theory-*.html and
   ui-spec §5 (tool rail, note picker, chips, note chips, help box). A lit control
   is chrome and takes the accent (U-01); the root note chip is the one place here
   that names the instrument, so it takes the bass hue (U-13). */
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
  padding: var(--ds-5);
}

/* ---- rail ---- */
.rail {
  width: 232px;
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--ds-4) var(--ds-3);
  background: var(--ds-surface);
  border-right: 1px solid var(--ds-border);
}

.railGroup {
  padding: var(--ds-3) var(--ds-3) var(--ds-1);
}

.railLink {
  display: flex;
  align-items: center;
  min-height: var(--ds-hit-setup);
  padding: 0 var(--ds-3);
  border-radius: var(--ds-r-btn);
  color: var(--ds-text-2);
  font-size: var(--ds-t-sm);
  text-decoration: none;
}

.railLink:hover {
  background: var(--ds-raised);
  color: var(--ds-text);
}

.railLink[aria-current='page'] {
  background: var(--ds-overlay);
  color: var(--ds-text);
  box-shadow: inset 3px 0 0 var(--ds-accent);
}

.railFoot {
  margin-top: auto;
  display: flex;
  flex-direction: column;
  gap: var(--ds-2);
  padding: var(--ds-3) var(--ds-3) 0;
  border-top: 1px solid var(--ds-border);
  font-size: var(--ds-t-xs);
  color: var(--ds-text-2);
}

.select {
  min-height: var(--ds-hit-min);
  padding: 0 var(--ds-2);
  background: var(--ds-raised);
  color: var(--ds-text);
  border: 1px solid var(--ds-border-strong);
  border-radius: var(--ds-r-input);
  font: 600 var(--ds-t-sm) / 1 var(--ds-font);
}

.check {
  display: flex;
  align-items: center;
  gap: var(--ds-2);
  min-height: var(--ds-hit-min);
}

.songCard {
  display: flex;
  flex-direction: column;
  gap: var(--ds-1);
  margin-bottom: var(--ds-3);
  padding: var(--ds-3);
  background: var(--ds-raised);
  border: 1px solid var(--ds-border-strong);
  border-radius: var(--ds-r-btn);
  font-size: var(--ds-t-xs);
  color: var(--ds-text-2);
}

.songCardWarn {
  border-color: var(--ds-warn);
}

.warnText {
  color: var(--ds-warn);
}

.candidates {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ds-1);
}

/* ---- shared controls ---- */
.cap {
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-size: var(--ds-t-xs);
  font-weight: 600;
  color: var(--ds-text-3);
  min-width: 72px;
}

.toolHead {
  display: flex;
  align-items: center;
  gap: var(--ds-3);
  flex-wrap: wrap;
}

.title {
  margin: 0 auto 0 0;
  font: 600 var(--ds-t-lg) / var(--ds-lh-lg) var(--ds-font);
}

.row {
  display: flex;
  align-items: center;
  gap: var(--ds-3);
  flex-wrap: wrap;
}

.stack {
  display: flex;
  flex-direction: column;
  gap: var(--ds-2);
}

.notekeys {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ds-1);
}

.notekey {
  min-width: 44px;
  min-height: var(--ds-hit-setup);
  padding: 0 var(--ds-2);
  background: var(--ds-raised);
  color: var(--ds-text-2);
  border: 1px solid var(--ds-border);
  border-radius: var(--ds-r-btn);
  font: 600 var(--ds-t-sm) / 1 var(--ds-font);
  cursor: pointer;
}

.notekey:hover {
  background: var(--ds-overlay);
  color: var(--ds-text);
}

.notekey[aria-pressed='true'] {
  background: var(--ds-accent);
  border-color: var(--ds-accent);
  color: var(--ds-on-accent);
}

.chipRow {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--ds-2);
}

.chip {
  min-height: var(--ds-hit-min);
  padding: 0 var(--ds-3);
  background: var(--ds-raised);
  color: var(--ds-text-2);
  border: 1px solid var(--ds-border-strong);
  border-radius: var(--ds-r-pill);
  font: 600 var(--ds-t-xs) / 1 var(--ds-font);
  cursor: pointer;
}

.chipLarge {
  min-height: var(--ds-hit-setup);
  padding: 0 var(--ds-4);
  font-size: var(--ds-t-sm);
}

.chip[aria-pressed='true'] {
  color: var(--ds-accent);
  border-color: var(--ds-accent);
}

.notechips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ds-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.notechip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 44px;
  height: 36px;
  padding: 0 var(--ds-3);
  justify-content: center;
  background: var(--ds-raised);
  border: 1px solid var(--ds-border-strong);
  border-radius: var(--ds-r-btn);
  font: 600 var(--ds-t-sm) / 1 var(--ds-font);
}

.notechip small {
  font-size: 11px;
  font-weight: 500;
  color: var(--ds-text-3);
}

.rootChip {
  background: var(--ds-bass);
  border-color: var(--ds-bass);
  color: var(--ds-ground);
}

.rootChip small {
  color: var(--ds-ground);
}

.help {
  padding: var(--ds-3) var(--ds-4);
  background: var(--ds-surface);
  border: 1px solid var(--ds-border);
  border-left: 3px solid var(--ds-accent);
  border-radius: var(--ds-r-btn);
  font-size: var(--ds-t-sm);
  line-height: var(--ds-lh-sm);
  color: var(--ds-text-2);
}

.help b {
  color: var(--ds-text);
}

.neck {
  padding: var(--ds-3) var(--ds-3) var(--ds-1);
  background: var(--ds-ground);
  border: 1px solid var(--ds-border);
  border-radius: var(--ds-r-panel);
}

.big {
  font: 600 var(--ds-t-xl) / var(--ds-lh-xl) var(--ds-font);
}

.dimText {
  color: var(--ds-text-2);
  font-size: var(--ds-t-sm);
}

.errorText {
  color: var(--ds-error);
  font-size: var(--ds-t-sm);
  margin: 0;
}

/* ---- chords in a key ---- */
.keyCards {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: var(--ds-2);
}

.keyCard {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: var(--ds-3) var(--ds-2);
  background: var(--ds-surface);
  color: var(--ds-text);
  border: 1px solid var(--ds-border);
  border-radius: var(--ds-r-btn);
  font-family: var(--ds-font);
  cursor: pointer;
}

.keyCard[aria-pressed='true'] {
  border-color: var(--ds-accent);
}

.numeral {
  font: 700 var(--ds-t-sm) / 1 var(--ds-mono);
  color: var(--ds-text-3);
}

.keyChord {
  font: 700 var(--ds-t-lg) / 1 var(--ds-font);
}

.fn {
  font-size: 11px;
  color: var(--ds-text-3);
}

.split {
  display: flex;
  gap: var(--ds-5);
  align-items: flex-start;
}

.grow {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--ds-4);
}

.circleCol {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--ds-2);
}
```

`frontend/src/theory/help.ts`:

```ts
// One plain-language line per scale for the Scale finder's help box (D-19):
// what it sounds like and where a player meets it. Chord lists and "same notes
// as" are computed (spell.ts), not written here.
import type { ScaleId } from '../music/spell';

export const SCALE_HELP: Record<ScaleId, string> = {
  major: 'The do-re-mi scale. Bright and settled; most pop and folk melodies live here.',
  minor: 'The natural minor. Darker and sadder than major; the default for rock and pop in a minor key.',
  'major-pentatonic': 'Major without its two half steps, so nothing clashes. Country, soul and happy riffs.',
  'minor-pentatonic': 'Five notes, no half steps, so it is hard to hit a wrong note. The go-to for rock and blues fills and solos.',
  blues: 'Minor pentatonic plus the ♭5 "blue note". Use the ♭5 as a passing note, not a place to rest.',
  dorian: 'Minor with a raised 6th: minor but not sad. Funk, jazz and a lot of classic rock jams.',
  phrygian: 'Minor with a ♭2 that gives a Spanish or metal edge.',
  lydian: 'Major with a ♯4: floating and dreamy. Film scores and some prog.',
  mixolydian: 'Major with a ♭7: bluesy and rocking. Fits dominant 7th chords and a lot of classic rock.',
  locrian: 'The unstable one, built on a diminished chord. Mostly heard over m7♭5 chords.',
  'harmonic-minor': 'Minor with a raised 7th, which makes a strong V chord. Classical and neoclassical metal.',
  'melodic-minor': 'Minor with a raised 6th and 7th. The jazz minor; a smooth line up to the root.',
  'whole-tone': 'Six notes, all a whole step apart. Dreamy and unresolved; fits augmented chords.',
  diminished: 'Whole step, half step, repeating: eight notes. Fits diminished 7th chords.',
};
```

- [ ] **Step 6: The registry, the rail and the instrument footer**

`frontend/src/theory/tools.ts`:

```ts
// The Theory tab's tools, in rail order (D-19). The rail, the routes and the
// "last tool" redirect all read this list; a tool exists in the UI exactly when
// it is registered here.
import type { ComponentType } from 'react';

import type { TheoryTool } from '../api/client';
import { ScaleFinder } from './tools/ScaleFinder';

export type ToolGroup = 'Find' | 'Shapes' | 'Harmony' | 'Practice';

export interface ToolDef {
  slug: TheoryTool;
  label: string;
  group: ToolGroup;
  Component: ComponentType;
}

export const GROUPS: readonly ToolGroup[] = ['Find', 'Shapes', 'Harmony', 'Practice'];

export const TOOLS: readonly ToolDef[] = [
  { slug: 'scale-finder', label: 'Scale finder', group: 'Find', Component: ScaleFinder },
];

export function toolBySlug(slug: string | undefined): ToolDef | undefined {
  return TOOLS.find((t) => t.slug === slug);
}
```

`frontend/src/theory/ToolRail.tsx`:

```tsx
// The tool rail (D-19): "from a song" on top, the tools by group, the
// instrument footer at the bottom. Links keep the query string, which is how
// the shared selection carries from one tool to the next.
import { NavLink, useLocation } from 'react-router-dom';

import { InstrumentFooter } from './InstrumentFooter';
import styles from './Theory.module.css';
import { GROUPS, TOOLS } from './tools';

export function ToolRail() {
  const { search } = useLocation();
  return (
    <nav className={styles.rail} aria-label="Theory tools">
      {GROUPS.map((group) => {
        const tools = TOOLS.filter((t) => t.group === group);
        if (tools.length === 0) return null;
        return [
          <span key={group} className={`${styles.cap} ${styles.railGroup}`}>
            {group}
          </span>,
          ...tools.map((t) => (
            <NavLink key={t.slug} to={{ pathname: `/theory/${t.slug}`, search }} className={styles.railLink}>
              {t.label}
            </NavLink>
          )),
        ];
      })}
      <InstrumentFooter />
    </nav>
  );
}
```

`frontend/src/theory/InstrumentFooter.tsx`:

```tsx
// Instrument, tuning and left-handed (D-19). Applies to every tool and is
// saved to theory.json. Play along keeps its own EADG (D-18). A custom tuning
// that doesn't parse is refused with the reason, never corrected (N-08).
import { useState, type FormEvent } from 'react';

import { DEFAULT_THEORY } from '../api/client';
import {
  choiceOf,
  INSTRUMENT_CHOICES,
  instrumentFor,
  parseTuning,
  presetOf,
  presetsFor,
  tuningLabel,
  type Instrument,
  type InstrumentChoiceId,
} from '../music/tuning';
import { Button } from '../ui';
import styles from './Theory.module.css';
import { useTheoryDoc } from './TheoryDoc';

const CUSTOM = 'custom';

export function InstrumentFooter() {
  const { doc, update } = useTheoryDoc();
  const inst = doc?.instrument ?? DEFAULT_THEORY.instrument;
  const preset = presetOf(inst);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const set = (next: Instrument) => update((d) => ({ ...d, instrument: next }));

  const onTuning = (id: string) => {
    if (id === CUSTOM) {
      setText(inst.tuning.join(' '));
      setError(null);
      setEditing(true);
      return;
    }
    const p = presetsFor(inst).find((x) => x.id === id);
    if (p) set({ ...inst, tuning: [...p.notes] });
  };

  const apply = (event: FormEvent) => {
    event.preventDefault();
    const parsed = parseTuning(text, inst.strings);
    if (!parsed.ok) {
      setError(parsed.reason);
      return;
    }
    set({ ...inst, tuning: parsed.notes });
    setEditing(false);
  };

  return (
    <div className={styles.railFoot}>
      <span className={styles.cap}>instrument</span>
      <select
        className={styles.select}
        aria-label="Instrument"
        value={choiceOf(inst)}
        disabled={!doc}
        onChange={(e) => set(instrumentFor(e.target.value as InstrumentChoiceId, inst.left_handed))}
      >
        {INSTRUMENT_CHOICES.map((c) => (
          <option key={c.id} value={c.id}>
            {c.label}
          </option>
        ))}
      </select>
      <label className={styles.stack}>
        Tuning {tuningLabel(inst)}
        <select className={styles.select} aria-label="Tuning" value={editing ? CUSTOM : preset?.id ?? CUSTOM} disabled={!doc} onChange={(e) => onTuning(e.target.value)}>
          {presetsFor(inst).map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
          <option value={CUSTOM}>Custom…</option>
        </select>
      </label>
      {editing && (
        <form className={styles.stack} onSubmit={apply}>
          <input
            className={styles.select}
            aria-label="Custom tuning, low string first"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          {error && (
            <p className={styles.errorText} role="alert">
              {error}
            </p>
          )}
          <div className={styles.row}>
            <Button type="submit">Apply</Button>
            <Button variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
      <label className={styles.check}>
        <input
          type="checkbox"
          checked={inst.left_handed}
          disabled={!doc}
          onChange={(e) => set({ ...inst, left_handed: e.target.checked })}
        />
        Left-handed
      </label>
    </div>
  );
}
```

- [ ] **Step 7: Scale finder**

`frontend/src/theory/tools/ScaleFinder.tsx`:

```tsx
// Scale finder (D-19): a root and a scale, every scale note on the neck, one
// position highlighted at a time, and a help box that says what the scale is
// for, which chords it fits over and which scales share its notes.
import { useState } from 'react';

import { DEFAULT_THEORY } from '../../api/client';
import { positionWindows } from '../../music/positions';
import { fitsOver, pcOf, pretty, rootName, sameNotes, scaleDef, scaleNotes, SCALES, type ScaleId } from '../../music/spell';
import { neckFrets } from '../../music/tuning';
import { Segmented } from '../../ui';
import { ChipRow, HelpBox, NoteChips, NotePicker, ToolHeader } from '../controls';
import { SCALE_HELP } from '../help';
import { noteDots, type LabelMode } from '../neckDots';
import { useSelection } from '../selection';
import styles from '../Theory.module.css';
import { TheoryNeck } from '../TheoryNeck';
import { useTheoryDoc } from '../TheoryDoc';

const GROUP_LABEL = { common: 'Common', modes: 'Modes', more: 'More' } as const;

export function ScaleFinder() {
  const { doc } = useTheoryDoc();
  const inst = doc?.instrument ?? DEFAULT_THEORY.instrument;
  const [sel, select] = useSelection();
  const [labels, setLabels] = useState<LabelMode>('note');
  const [position, setPosition] = useState<{ key: string; index: number } | null>(null);

  const notes = scaleNotes(sel.root, sel.scale);
  const frets = neckFrets(inst);
  const windows = positionWindows(inst, pcOf(sel.root)!, notes.map((n) => n.pc));
  const key = `${sel.root}-${sel.scale}-${inst.tuning.join('')}`;
  // A position belongs to one root, scale and tuning; changing any of them shows the whole neck again.
  const active = position?.key === key ? windows.find((w) => w.index === position.index) ?? null : null;
  const fits = fitsOver(sel.root, sel.scale);
  const same = sameNotes(sel.root, sel.scale);
  const title = `${pretty(sel.root)} ${scaleDef(sel.scale).label.toLowerCase()}`;

  const pickScale = (scale: ScaleId) => select({ scale, mode: scaleDef(scale).mode, root: rootName(pcOf(sel.root)!, scaleDef(scale).mode) });

  return (
    <>
      <ToolHeader title="Scale finder">
        <Segmented<LabelMode>
          label="Labels"
          value={labels}
          onChange={setLabels}
          options={[
            { value: 'note', label: 'Note' },
            { value: 'interval', label: 'Interval' },
            { value: 'degree', label: 'Degree' },
          ]}
        />
      </ToolHeader>
      <div className={styles.stack}>
        <span className={styles.cap}>root</span>
        <NotePicker label="Root" selected={[pcOf(sel.root)!]} onPick={(pc) => select({ root: rootName(pc, scaleDef(sel.scale).mode) })} />
      </div>
      <div className={styles.stack}>
        {(['common', 'modes', 'more'] as const).map((group) => (
          <ChipRow
            key={group}
            label={GROUP_LABEL[group]}
            large={group === 'common'}
            value={sel.scale}
            onChange={pickScale}
            options={SCALES.filter((s) => s.group === group).map((s) => ({ value: s.id, label: s.label }))}
          />
        ))}
      </div>
      <div className={styles.neck}>
        <TheoryNeck
          instrument={inst}
          frets={frets}
          window={active}
          label={`${title} on ${inst.kind}`}
          dots={noteDots(inst, notes, { lo: 0, hi: frets, labels, window: active })}
        />
      </div>
      <div className={styles.row}>
        <NoteChips notes={notes} />
        <span className={styles.cap}>highlight position</span>
        <Segmented<string>
          label="Highlight position"
          value={active ? String(active.index) : 'all'}
          onChange={(v) => setPosition(v === 'all' ? null : { key, index: Number(v) })}
          options={[{ value: 'all', label: 'All' }, ...windows.map((w) => ({ value: String(w.index), label: String(w.index) }))]}
        />
        {active && <span className={styles.dimText}>frets {active.lo}–{active.hi}</span>}
      </div>
      <HelpBox>
        <b>{title}</b>: {SCALE_HELP[sel.scale]}{' '}
        {fits.length > 0 && (
          <>
            <b>Fits over:</b> {fits.map(pretty).join(', ')}.{' '}
          </>
        )}
        {same.length > 0 && (
          <>
            <b>Same notes as</b> {same.map(pretty).join(', ')}.
          </>
        )}
      </HelpBox>
    </>
  );
}
```

- [ ] **Step 8: The screen**

`frontend/src/screens/Theory.tsx`:

```tsx
// The Theory tab (D-19): a tool rail and the chosen tool. /theory redirects to
// the tool used last (theory.json's last_tool). theory.json failures are shown
// here, above whichever tool is open: an unreadable file is an error banner with
// the verbatim reason and a confirmed reset (U-09, N-08); a failed save is a
// warning with Retry, and the unsaved change stays in memory.
import { useEffect } from 'react';
import { Link, Navigate, useLocation, useParams } from 'react-router-dom';

import styles from '../theory/Theory.module.css';
import { TheoryDocProvider, useTheoryDoc } from '../theory/TheoryDoc';
import { ToolRail } from '../theory/ToolRail';
import { toolBySlug } from '../theory/tools';
import { Banner, Button } from '../ui';

export function Theory() {
  return (
    <TheoryDocProvider>
      <TheoryScreen />
    </TheoryDocProvider>
  );
}

function TheoryScreen() {
  const { tool } = useParams();
  const { search } = useLocation();
  const { doc, loadError, saveError, update, retry, resetToDefaults } = useTheoryDoc();
  const def = toolBySlug(tool);

  useEffect(() => {
    if (def && doc && doc.last_tool !== def.slug) update((d) => ({ ...d, last_tool: def.slug }));
  }, [def, doc, update]);

  if (!tool) {
    if (!doc && !loadError) return null;
    const last = toolBySlug(doc?.last_tool)?.slug ?? 'scale-finder';
    return <Navigate to={{ pathname: `/theory/${last}`, search }} replace />;
  }

  const reset = () => {
    if (window.confirm('Replace theory.json with the defaults? Your instrument setting and quiz history will be lost.')) {
      void resetToDefaults();
    }
  };

  return (
    <div className={styles.layout}>
      <ToolRail />
      <section className={styles.content}>
        {loadError && (
          <Banner tone="error" title="theory.json can't be read" trace={loadError}>
            Your settings and quiz history were not loaded, and nothing has been overwritten.{' '}
            <Button variant="danger" onClick={reset}>
              Reset to defaults…
            </Button>
          </Banner>
        )}
        {saveError && (
          <Banner tone="warn" title="Couldn't save" trace={saveError}>
            Your changes are kept here until a save succeeds. <Button onClick={retry}>Retry</Button>
          </Banner>
        )}
        {/* A tool draws with the player's instrument, so it waits for theory.json (or its error) instead of flashing the default bass. */}
        {!doc && !loadError ? null : def ? (
          <def.Component />
        ) : (
          <p>
            There is no tool called “{tool}”. <Link to="/theory/scale-finder">Open Scale finder</Link>
          </p>
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 9: Routes (lazy) and nav**

In `frontend/src/app/routes.tsx` (it already imports `lazy` and `Suspense` from `react`), add this just above the `// Task 8: dev-only manual verification page` comment:

```tsx
// D-19: the Theory tab and tonal load only when the tab is opened, keeping the
// main bundle under Vite's 500 kB warning.
const Theory = lazy(() => import('../screens/Theory').then((m) => ({ default: m.Theory })));
```

and inside `<Route element={<AppShell />}>`, after the `jobs` route:

```tsx
          {/* D-19: the tool is in the path, the shared selection in the query string. */}
          <Route path="theory" element={<Suspense fallback={null}><Theory /></Suspense>} />
          <Route path="theory/:tool" element={<Suspense fallback={null}><Theory /></Suspense>} />
```

In `frontend/src/app/AppShell.tsx`, add to `NAV` after the Job queue entry:

```ts
  { to: '/theory', label: 'Theory' },
```

In `frontend/src/app/routes.test.tsx`:
- Import `DEFAULT_THEORY` from `'../api/client'`.
- Add `if (url === '/api/theory') return new Response(JSON.stringify(DEFAULT_THEORY));` to the `beforeEach` fetch stub, after the `/api/songs/01ABC` line.
- Add this case to the `'%s renders its screen'` table:

```ts
  // D-19: lazy-loaded, and /theory redirects to the last tool (Scale finder by default).
  ['/theory', /^scale finder$/i],
```

- [ ] **Step 10: Run the tests, typecheck and build**

Run: `npm --prefix frontend test && npm --prefix frontend run build`
Expected:
- Every test passes: `Theory.test.tsx` 6, `scaleFinder.test.tsx` 3, and the routes smoke test including `/theory`.
- The build succeeds with a separate `Theory-*.js` chunk and no "larger than 500 kB" warning.

- [ ] **Step 11: Commit**

```bash
git add frontend/src/theory/TheoryDoc.tsx frontend/src/theory/controls.tsx frontend/src/theory/Theory.module.css frontend/src/theory/help.ts frontend/src/theory/tools.ts frontend/src/theory/ToolRail.tsx frontend/src/theory/InstrumentFooter.tsx frontend/src/theory/tools/ScaleFinder.tsx frontend/src/theory/tools/testing.tsx frontend/src/theory/tools/scaleFinder.test.tsx frontend/src/screens/Theory.tsx frontend/src/screens/Theory.test.tsx frontend/src/app/routes.tsx frontend/src/app/routes.test.tsx frontend/src/app/AppShell.tsx
git commit -m "feat(theory): the Theory tab, tool rail, instrument footer and Scale finder (D-19)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: "From a song"

**Files:**
- Create: `frontend/src/theory/useChosenSong.ts`, `frontend/src/theory/SongCard.tsx`
- Modify: `frontend/src/theory/ToolRail.tsx`
- Test: `frontend/src/screens/Theory.test.tsx` (append)

**Interfaces:**
- Consumes: `useSongs`, `useAnalysis` (existing, `api/queries.ts`); `useTheoryDoc`, `useSelection`; `analysisChordSymbol`, `namer`, `rootName`, `scaleNotes` (Task 3).
- Produces:
  - `useChosenSong(): ChosenSong`, a union of `none`, `missing`, `unanalysed`, `loading`, `error`, and `ready { title, candidates, sequence, distinct }`. `sequence` is the chord chart as symbols, with runs merged and N/X dropped.
  - `candidateRoot(KeyCandidate)`.

- [ ] **Step 1: Append the failing tests to `frontend/src/screens/Theory.test.tsx`**

```tsx
test('song card: analysed songs newest first, key candidates load the key', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const { where } = setup('/theory/scale-finder', { theory: { ...DEFAULT_THEORY, song_id: '01TIGHT' } });
  const picker = await screen.findByRole('combobox', { name: 'Song' });
  await waitFor(() => expect(within(picker).getAllByRole('option').map((o) => o.textContent)).toEqual([
    'Pick an analysed song',
    'Tightrope',
    'Old Song',
  ]));
  fireEvent.click(await screen.findByRole('button', { name: 'B♭ major 18%' }));
  expect(where()).toBe('/theory/scale-finder?root=Bb');
  fireEvent.click(screen.getByRole('button', { name: 'G minor 72%' }));
  expect(where()).toBe('/theory/scale-finder?root=G&scale=minor');
});

test('song card: an unanalysed or missing song says so', async () => {
  setup('/theory/scale-finder', { theory: { ...DEFAULT_THEORY, song_id: '01RAW' } });
  expect(await screen.findByText(/Raw Song has no analysis yet/)).toBeInTheDocument();
});

test('song card: a deleted song says so', async () => {
  setup('/theory/scale-finder', { theory: { ...DEFAULT_THEORY, song_id: '01GONE' } });
  expect(await screen.findByText('That song no longer exists. Pick another.')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npm --prefix frontend test -- src/screens/Theory.test.tsx`
Expected: the 3 song card tests FAIL (`Unable to find an accessible element with the role "combobox" and name "Song"`).

- [ ] **Step 3: Implement**

`frontend/src/theory/useChosenSong.ts`:

```ts
// The song the "from a song" card points at (D-19): theory.json's song_id,
// looked up in the library and read through the existing analysis endpoint.
// Read only; nothing here writes to the song. A missing or unanalysed song is
// its own state with its own message, never a silent switch to another song.
import type { KeyCandidate } from '../api/client';
import { useAnalysis, useSongs } from '../api/queries';
import { analysisChordSymbol, namer, pcOf, rootName, scaleNotes, type KeyMode } from '../music/spell';
import { useTheoryDoc } from './TheoryDoc';

export type ChosenSong =
  | { state: 'none' }
  | { state: 'missing'; songId: string }
  | { state: 'unanalysed'; title: string }
  | { state: 'loading'; title: string }
  | { state: 'error'; title: string; message: string }
  | {
      state: 'ready';
      title: string;
      candidates: KeyCandidate[];
      /** The chord chart as symbols, runs of the same chord merged, N/X dropped. */
      sequence: string[];
      /** Each chord once, in order of first appearance. */
      distinct: string[];
    };

/** A key candidate's root spelled for its mode: "A#" minor -> "Bb". */
export function candidateRoot(c: KeyCandidate): { root: string; mode: KeyMode } {
  return { root: rootName(pcOf(c.tonic)!, c.mode), mode: c.mode };
}

export function useChosenSong(): ChosenSong {
  const { doc } = useTheoryDoc();
  const songs = useSongs();
  const songId = doc?.song_id ?? null;
  const entry = songs.data?.find((e) => e.song?.id === songId);
  const analysed = Boolean(entry?.files?.has_analysis);
  const analysis = useAnalysis(analysed ? songId ?? undefined : undefined);

  if (!songId) return { state: 'none' };
  if (songs.isPending) return { state: 'loading', title: '' };
  if (!entry?.song) return { state: 'missing', songId };
  const title = entry.song.title;
  if (!analysed) return { state: 'unanalysed', title };
  if (analysis.error) return { state: 'error', title, message: analysis.error.message };
  if (!analysis.data) return { state: 'loading', title };

  const candidates = analysis.data.key_candidates;
  const top = candidates[0] ? candidateRoot(candidates[0]) : { root: 'C', mode: 'major' as const };
  const name = namer(scaleNotes(top.root, top.mode === 'minor' ? 'minor' : 'major').map((n) => n.name));
  const sequence: string[] = [];
  for (const seg of analysis.data.chords) {
    const symbol = analysisChordSymbol(seg.chord, name);
    if (symbol && symbol !== sequence[sequence.length - 1]) sequence.push(symbol);
  }
  return { state: 'ready', title, candidates, sequence, distinct: [...new Set(sequence)] };
}
```

`frontend/src/theory/SongCard.tsx`:

```tsx
// "From a song" (D-19): pick an analysed song, then load one of its key
// candidates into the shared selection. The song's chords become available to
// Chord finder (and later Progressions and Name that chord) through
// useChosenSong. Candidates are probabilistic (R-05), so they are shown with
// their confidence and the player picks.
import { useSongs } from '../api/queries';
import { pretty } from '../music/spell';
import { useSelection } from './selection';
import styles from './Theory.module.css';
import { useTheoryDoc } from './TheoryDoc';
import { candidateRoot, useChosenSong } from './useChosenSong';

export function SongCard() {
  const { doc, update } = useTheoryDoc();
  const songs = useSongs();
  const chosen = useChosenSong();
  const [, select] = useSelection();
  const analysed = (songs.data ?? [])
    .filter((e) => e.song && e.files?.has_analysis)
    .sort((a, b) => (b.song!.last_played_at ?? '').localeCompare(a.song!.last_played_at ?? ''));

  const choose = (songId: string) => update((d) => ({ ...d, song_id: songId || null }));

  return (
    <div className={chosen.state === 'missing' || chosen.state === 'unanalysed' || chosen.state === 'error' ? `${styles.songCard} ${styles.songCardWarn}` : styles.songCard}>
      <span className={styles.cap}>from a song</span>
      <select
        className={styles.select}
        aria-label="Song"
        value={doc?.song_id ?? ''}
        onChange={(e) => choose(e.target.value)}
        disabled={!doc}
      >
        <option value="">{analysed.length ? 'Pick an analysed song' : 'No analysed songs yet'}</option>
        {analysed.map((e) => (
          <option key={e.song!.id} value={e.song!.id}>
            {e.song!.title}
          </option>
        ))}
      </select>
      {chosen.state === 'missing' && <span className={styles.warnText}>That song no longer exists. Pick another.</span>}
      {chosen.state === 'unanalysed' && (
        <span className={styles.warnText}>{chosen.title} has no analysis yet. The analyze job hasn&apos;t run.</span>
      )}
      {chosen.state === 'error' && <span className={styles.warnText}>{chosen.message}</span>}
      {chosen.state === 'ready' && (
        <>
          <span>
            {chosen.distinct.length} chords · load a key:
          </span>
          <div className={styles.candidates}>
            {chosen.candidates.map((c) => {
              const { root, mode } = candidateRoot(c);
              return (
                <button
                  key={`${c.tonic}-${c.mode}`}
                  type="button"
                  className={styles.chip}
                  onClick={() => select({ root, mode, scale: mode === 'minor' ? 'minor' : 'major', chord: null })}
                >
                  {pretty(root)} {mode} {Math.round(c.confidence * 100)}%
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
```

In `frontend/src/theory/ToolRail.tsx`, import `SongCard` from `'./SongCard'` and render `<SongCard />` as the first child of the `<nav>`.

- [ ] **Step 4: Run the tests**

Run: `npm --prefix frontend test -- src/screens/Theory.test.tsx`
Expected: 9 passed.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/theory/useChosenSong.ts frontend/src/theory/SongCard.tsx frontend/src/theory/ToolRail.tsx frontend/src/screens/Theory.test.tsx
git commit -m "feat(theory): from a song, load an analysed song's key candidates and chords (D-19)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Chord finder

**Files:**
- Create: `frontend/src/theory/tools/ChordFinder.tsx`
- Modify: `frontend/src/theory/tools.ts`
- Test: `frontend/src/theory/tools/chordFinder.test.tsx`

**Interfaces:**
- Produces: `selectedChord(sel): ChordInfo`, which is the typed chord if any, else root + quality (+ bass). The Shapes and Harmony phase reuses it.

- [ ] **Step 1: Write the failing test**

```tsx
import { fireEvent, screen, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

import { renderTool } from './testing';

afterEach(() => vi.unstubAllGlobals());

const analysis = {
  schema_version: 1,
  key_candidates: [{ tonic: 'G', mode: 'minor' as const, confidence: 0.9 }],
  beat_grid: { bpm: 120, beats: [0], downbeats: [0] },
  chords: [
    { bar: 0, start_sample: 0, end_sample: 1, chord: 'G:min' },
    { bar: 1, start_sample: 1, end_sample: 2, chord: 'A#:hdim7' },
    { bar: 2, start_sample: 2, end_sample: 3, chord: 'G:min' },
  ],
};

test('chord finder: root + quality, notes, intervals and where it is diatonic', async () => {
  const { dots, where } = renderTool('/theory/chord-finder?root=A&q=m7');
  await screen.findByRole('heading', { name: 'Chord finder' });
  expect(screen.getByText('A minor seventh')).toBeInTheDocument();
  expect(dots()).toContain('s3f5:R');
  expect(dots()).toContain('s3f3:♭7');
  expect(screen.getByText(/It is the/)).toHaveTextContent('vi7 in C major, iii7 in F major, ii7 in G major');
  fireEvent.click(screen.getByRole('button', { name: 'maj7' }));
  expect(where()).toBe('/theory/chord-finder?root=A&q=maj7');
});

test('chord finder: a typed chord is shown; an unreadable one is refused and the last stays', async () => {
  const { where } = renderTool('/theory/chord-finder');
  await screen.findByRole('heading', { name: 'Chord finder' });
  fireEvent.change(screen.getByRole('textbox', { name: 'Type a chord' }), { target: { value: 'f♯m7♭5' } });
  fireEvent.click(screen.getByRole('button', { name: 'Show' }));
  expect(where()).toBe('/theory/chord-finder?root=F%23&chord=F%23m7b5');
  expect(screen.getAllByText('F♯m7♭5').length).toBeGreaterThan(0);
  fireEvent.change(screen.getByRole('textbox', { name: 'Type a chord' }), { target: { value: 'Cmaj13#11b9' } });
  fireEvent.click(screen.getByRole('button', { name: 'Show' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Don\'t know "Cmaj13#11b9"');
  expect(where()).toBe('/theory/chord-finder?root=F%23&chord=F%23m7b5');
});

test("chord finder: the chosen song's chords are chips", async () => {
  const { where } = renderTool('/theory/chord-finder', { theory: { song_id: '01SONG' }, analysis });
  const row = await screen.findByRole('group', { name: 'In Tightrope' });
  expect(within(row).getAllByRole('button').map((b) => b.textContent)).toEqual(['Gm', 'B♭m7♭5']);
  fireEvent.click(within(row).getByRole('button', { name: 'B♭m7♭5' }));
  expect(where()).toBe('/theory/chord-finder?chord=Bbm7b5');
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm --prefix frontend test -- src/theory/tools/chordFinder.test.tsx`
Expected: FAIL, "There is no tool called “chord-finder”" (no heading named Chord finder).

- [ ] **Step 3: Implement**

`frontend/src/theory/tools/ChordFinder.tsx`:

```tsx
// Chord finder (D-19): pick a root and quality or type any chord tonal can
// read. Shows the chord's notes and intervals on the whole neck and where it is
// diatonic. A typed chord it can't read is an inline error and the last chord
// stays on screen; nothing is guessed (N-08).
import { useState, type FormEvent } from 'react';

import { DEFAULT_THEORY } from '../../api/client';
import { chordHomes, chordInfo, chordSymbol, pcOf, pretty, QUALITIES, rootName, type ChordInfo } from '../../music/spell';
import { neckFrets } from '../../music/tuning';
import { Button } from '../../ui';
import { ChipRow, HelpBox, NoteChips, NotePicker, ToolHeader } from '../controls';
import { noteDots } from '../neckDots';
import { useSelection } from '../selection';
import styles from '../Theory.module.css';
import { TheoryNeck } from '../TheoryNeck';
import { useTheoryDoc } from '../TheoryDoc';
import { useChosenSong } from '../useChosenSong';

/** The chord the selection names: a typed one if any, else root + quality (+ bass). */
export function selectedChord(sel: { chord: string | null; root: string; quality: (typeof QUALITIES)[number]['id']; bass: string | null }): ChordInfo {
  const typed = sel.chord ? chordInfo(sel.chord) : null;
  if (typed?.ok) return typed.chord;
  const built = chordInfo(chordSymbol(sel.root, sel.quality, sel.bass));
  if (built.ok) return built.chord;
  throw new Error(`chord finder cannot build ${sel.root} ${sel.quality}`);
}

export function ChordFinder() {
  const { doc } = useTheoryDoc();
  const inst = doc?.instrument ?? DEFAULT_THEORY.instrument;
  const [sel, select] = useSelection();
  const song = useChosenSong();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const chord = selectedChord(sel);
  const notes = chord.extraBass ? [...chord.notes, chord.extraBass] : chord.notes;
  const homes = chordHomes(chord);
  const frets = neckFrets(inst);

  const typeChord = (event: FormEvent) => {
    event.preventDefault();
    const parsed = chordInfo(text);
    if (!parsed.ok) {
      setError(parsed.reason);
      return;
    }
    setError(null);
    setText('');
    // The root follows the typed chord so the next tool opens on it; a double
    // sharp or flat root (rare) has no note-picker button and is left as it was.
    const root = /^[A-G](#|b)?$/.test(parsed.chord.root) ? parsed.chord.root : sel.root;
    select({ chord: parsed.chord.symbol, root });
  };

  return (
    <>
      <ToolHeader title="Chord finder">
        <form className={styles.row} onSubmit={typeChord}>
          <input
            className={styles.select}
            aria-label="Type a chord"
            placeholder="or type a chord: Am7, C/E, F#m7b5…"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <Button type="submit">Show</Button>
        </form>
      </ToolHeader>
      {error && (
        <p className={styles.errorText} role="alert">
          {error}. Nothing is guessed; the last chord stays shown.
        </p>
      )}
      <div className={styles.stack}>
        <span className={styles.cap}>root</span>
        <NotePicker label="Root" selected={[pcOf(chord.root)!]} onPick={(pc) => select({ root: rootName(pc, 'major'), chord: null, bass: null })} />
      </div>
      <ChipRow
        label="Quality"
        value={sel.chord ? null : sel.quality}
        onChange={(quality) => select({ quality, chord: null })}
        options={QUALITIES.map((q) => ({ value: q.id, label: q.label }))}
      />
      {song.state === 'ready' && song.distinct.length > 0 && (
        <ChipRow
          label={`In ${song.title}`}
          value={sel.chord}
          onChange={(symbol) => select({ chord: symbol })}
          options={song.distinct.map((s) => ({ value: s, label: pretty(s) }))}
        />
      )}
      <div className={styles.row}>
        <span className={styles.big}>{pretty(chord.symbol)}</span>
        <span className={styles.dimText}>{pretty(chord.name)}</span>
        <NoteChips notes={notes} />
      </div>
      <div className={styles.neck}>
        <TheoryNeck
          instrument={inst}
          frets={frets}
          label={`${pretty(chord.symbol)} on ${inst.kind}`}
          dots={noteDots(inst, notes, { lo: 0, hi: frets, labels: 'interval' })}
        />
      </div>
      <HelpBox>
        <b>{pretty(chord.symbol)}</b>: {notes.map((n) => `${pretty(n.name)} (${n.interval})`).join(', ')}.{' '}
        {homes.length > 0 ? (
          <>
            It is the <b>{homes.slice(0, 3).join(', ')}</b>.
          </>
        ) : (
          'It is not a chord of any major key.'
        )}
      </HelpBox>
    </>
  );
}
```

Register it in `frontend/src/theory/tools.ts`: add `import { ChordFinder } from './tools/ChordFinder';` and, after the Scale finder entry:

```ts
  { slug: 'chord-finder', label: 'Chord finder', group: 'Find', Component: ChordFinder },
```

- [ ] **Step 4: Run the tests**

Run: `npm --prefix frontend test -- src/theory`
Expected: all pass (chordFinder 3).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/theory/tools/ChordFinder.tsx frontend/src/theory/tools/chordFinder.test.tsx frontend/src/theory/tools.ts
git commit -m "feat(theory): Chord finder, pick or type a chord, never guess one (D-19, N-08)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Note finder

**Files:**
- Create: `frontend/src/theory/tools/NoteFinder.tsx`
- Modify: `frontend/src/theory/tools.ts`
- Test: `frontend/src/theory/tools/noteFinder.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { fireEvent, screen, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

import { renderTool } from './testing';

afterEach(() => vi.unstubAllGlobals());

test('note finder: every E and G with octaves', async () => {
  const { dots, where } = renderTool('/theory/note-finder');
  await screen.findByRole('heading', { name: 'Note finder' });
  expect(screen.getByText(/Pick one or more notes/)).toBeInTheDocument();
  const picker = screen.getByRole('group', { name: 'Notes' });
  fireEvent.click(within(picker).getByRole('button', { name: 'E' }));
  fireEvent.click(within(picker).getByRole('button', { name: 'G' }));
  expect(where()).toBe('/theory/note-finder?notes=4%2C7');
  expect(dots()).toEqual(expect.arrayContaining(['s3f0:E1', 's3f12:E2', 's0f0:G2', 's3f3:G1']));
  fireEvent.click(within(picker).getByRole('button', { name: 'E' }));
  expect(dots().some((d) => d.includes('E'))).toBe(false);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm --prefix frontend test -- src/theory/tools/noteFinder.test.tsx`
Expected: FAIL (no heading named Note finder).

- [ ] **Step 3: Implement**

`frontend/src/theory/tools/NoteFinder.tsx`:

```tsx
// Note finder (D-19): pick one or more notes and see every place each one sits,
// labelled with its octave (E1, E2…) so the same letter in two places reads as
// two different pitches. All picked notes use the same neutral dot; the label
// says which note it is (U-13 keeps stem and signal hues for their own jobs).
import { DEFAULT_THEORY } from '../../api/client';
import { positionsOf } from '../../music/positions';
import { pretty, rootName } from '../../music/spell';
import { neckFrets } from '../../music/tuning';
import { HelpBox, NotePicker, ToolHeader } from '../controls';
import { useSelection } from '../selection';
import styles from '../Theory.module.css';
import { TheoryNeck, type NeckDot } from '../TheoryNeck';
import { useTheoryDoc } from '../TheoryDoc';

export function NoteFinder() {
  const { doc } = useTheoryDoc();
  const inst = doc?.instrument ?? DEFAULT_THEORY.instrument;
  const [sel, select] = useSelection();
  const frets = neckFrets(inst);
  const toggle = (pc: number) =>
    select({ notes: sel.notes.includes(pc) ? sel.notes.filter((n) => n !== pc) : [...sel.notes, pc] });

  const dots: NeckDot[] = positionsOf(inst, new Set(sel.notes), 0, frets).map((p) => {
    const letter = rootName(p.pc, 'major');
    // Scientific pitch octave: MIDI 12 is C0, so E1 is the open low E on a bass.
    return { string: p.string, fret: p.fret, marker: 'tone', label: `${pretty(letter)}${Math.floor(p.midi / 12) - 1}` };
  });

  return (
    <>
      <ToolHeader title="Note finder" />
      <div className={styles.stack}>
        <span className={styles.cap}>notes</span>
        <NotePicker label="Notes" selected={sel.notes} onPick={toggle} />
      </div>
      <div className={styles.neck}>
        <TheoryNeck instrument={inst} frets={frets} dots={dots} label={`Picked notes on ${inst.kind}`} />
      </div>
      <HelpBox>
        {sel.notes.length === 0 ? (
          'Pick one or more notes to see every place they sit on the neck.'
        ) : (
          <>
            <b>{dots.length}</b> places from the open strings to fret {frets}. The number after the letter is the octave:
            the same letter with a higher number sounds higher.
          </>
        )}
      </HelpBox>
    </>
  );
}
```

Register it in `tools.ts` (import `NoteFinder`), after Chord finder:

```ts
  { slug: 'note-finder', label: 'Note finder', group: 'Find', Component: NoteFinder },
```

- [ ] **Step 4: Run the tests**

Run: `npm --prefix frontend test -- src/theory`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/theory/tools/NoteFinder.tsx frontend/src/theory/tools/noteFinder.test.tsx frontend/src/theory/tools.ts
git commit -m "feat(theory): Note finder, every place a note sits, with octaves (D-19)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Chords in a key and the circle of fifths

**Files:**
- Create: `frontend/src/theory/CircleOfFifths.tsx`, `frontend/src/theory/CircleOfFifths.module.css`, `frontend/src/theory/tools/ChordsInKey.tsx`
- Modify: `frontend/src/theory/tools.ts`
- Test: `frontend/src/theory/tools/chordsInKey.test.tsx`

**Interfaces:**
- Produces:
  - `CircleOfFifths({ root, mode, size? = 300, onPick(root, mode) })`. Every key is a `role="button"` named like "E♭ major", with `aria-pressed` on the current key.
  - `signatureText(root, mode)`, e.g. "2 sharps · F♯ C♯".
  - `circleIndex`.

- [ ] **Step 1: Write the failing test**

```tsx
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

import { renderTool } from './testing';

afterEach(() => vi.unstubAllGlobals());

test('/theory opens the tool used last, keeping the selection', async () => {
  const { where } = renderTool('/theory?root=A', { theory: { last_tool: 'chords-in-key' } });
  expect(await screen.findByRole('heading', { name: 'Chords in a key' })).toBeInTheDocument();
  expect(where()).toBe('/theory/chords-in-key?root=A');
});

test('the selection carries from one tool to the next', async () => {
  const { where } = renderTool('/theory/scale-finder?root=A&scale=minor-pentatonic');
  const rail = await screen.findByRole('navigation', { name: 'Theory tools' });
  fireEvent.click(within(rail).getByRole('link', { name: 'Chords in a key' }));
  expect(await screen.findByRole('heading', { name: 'Chords in a key' })).toBeInTheDocument();
  expect(where()).toBe('/theory/chords-in-key?root=A&scale=minor-pentatonic');
  // A minor pentatonic is a minor scale, so the key tools open on A minor.
  expect(screen.getByRole('button', { name: 'A minor' })).toHaveAttribute('aria-pressed', 'true');
});

test('chords in a key: seven chords with numerals and function, one on the neck', async () => {
  const { dots } = renderTool('/theory/chords-in-key?root=G');
  const cards = await screen.findByRole('group', { name: 'Chords' });
  expect(within(cards).getAllByRole('button').map((b) => b.textContent)).toEqual([
    'IGhome', 'iiAmsub', 'iiiBmhome', 'IVCsub', 'VDtension', 'viEmhome', 'vii°F♯dimtension',
  ]);
  fireEvent.click(within(cards).getByRole('button', { name: /IV/ }));
  expect(screen.getByText('IV · C major')).toBeInTheDocument();
  expect(dots()).toContain('s2f3:R');
  expect(screen.getByText(/Relative minor/)).toHaveTextContent('E minor');
  expect(screen.getByText(/Common progressions in G major/)).toHaveTextContent('I–V–vi–IV G D Em C');
});

test('chords in a key: 7th chords, minor mode and the circle of fifths', async () => {
  const { where } = renderTool('/theory/chords-in-key?root=G');
  await screen.findByRole('group', { name: 'Chords' });
  fireEvent.click(screen.getByRole('button', { name: '7th chords' }));
  expect(within(screen.getByRole('group', { name: 'Chords' })).getAllByRole('button')[4]).toHaveTextContent('D7');
  fireEvent.click(within(screen.getByRole('group', { name: 'Mode' })).getByRole('button', { name: 'Minor' }));
  expect(where()).toBe('/theory/chords-in-key?root=G&scale=minor');
  fireEvent.click(screen.getByRole('button', { name: 'E♭ major' }));
  await waitFor(() => expect(where()).toBe('/theory/chords-in-key?root=Eb'));
  expect(screen.getByRole('button', { name: 'E♭ major' })).toHaveAttribute('aria-pressed', 'true');
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm --prefix frontend test -- src/theory/tools/chordsInKey.test.tsx`
Expected: FAIL (no heading named Chords in a key).

- [ ] **Step 3: The circle**

`frontend/src/theory/CircleOfFifths.tsx`:

```tsx
// The circle of fifths (D-19): 12 major keys outside, their relative minors
// inside. The current key is lit in the accent (a selection is chrome, U-01)
// and its neighbours, which share six of seven notes, are outlined. Every key
// is a button. Drawn small on Chords in a key and large as its own tool.
import { keySignature, pcOf, pretty, type KeyMode } from '../music/spell';
import styles from './CircleOfFifths.module.css';

const MAJORS = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'Db', 'Ab', 'Eb', 'Bb', 'F'];
const MINORS = ['A', 'E', 'B', 'F#', 'C#', 'G#', 'D#', 'Bb', 'F', 'C', 'G', 'D'];

export function signatureText(root: string, mode: KeyMode): string {
  const { accidentals, sharps } = keySignature(root, mode);
  if (accidentals.length === 0) return 'no sharps or flats';
  const n = accidentals.length;
  const word = sharps ? (n === 1 ? 'sharp' : 'sharps') : n === 1 ? 'flat' : 'flats';
  return `${n} ${word} · ${accidentals.map(pretty).join(' ')}`;
}

/** Position of a key on the circle, 0 = C / A minor at the top. */
export function circleIndex(root: string, mode: KeyMode): number {
  const pc = pcOf(root);
  return (mode === 'major' ? MAJORS : MINORS).findIndex((k) => pcOf(k) === pc);
}

export function CircleOfFifths({
  root,
  mode,
  size = 300,
  onPick,
}: {
  root: string;
  mode: KeyMode;
  size?: number;
  onPick: (root: string, mode: KeyMode) => void;
}) {
  const c = size / 2;
  const lit = circleIndex(root, mode);
  const near = (i: number) => (i - lit + 12) % 12 === 1 || (i - lit + 12) % 12 === 11;
  const ring = (i: number, r: number) => {
    const a = ((i * 30 - 90) * Math.PI) / 180;
    return { x: c + r * Math.cos(a), y: c + r * Math.sin(a) };
  };
  const key = (i: number, keyMode: KeyMode) => {
    const name = keyMode === 'major' ? MAJORS[i]! : MINORS[i]!;
    const on = i === lit && keyMode === mode;
    const outlined = !on && (i === lit || near(i));
    const { x, y } = ring(i, keyMode === 'major' ? c - 29 : c - 77);
    const label = keyMode === 'major' ? pretty(name) : `${pretty(name)}m`;
    return (
      <g
        key={`${keyMode}-${name}`}
        role="button"
        tabIndex={0}
        aria-label={`${pretty(name)} ${keyMode}`}
        aria-pressed={on}
        className={styles.key}
        onClick={() => onPick(name, keyMode)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onPick(name, keyMode);
          }
        }}
      >
        <circle cx={x} cy={y} r={keyMode === 'major' ? 19 : 17} className={on ? styles.on : outlined ? styles.near : styles.off} />
        <text x={x} y={y} className={`${keyMode === 'major' ? styles.major : styles.minor} ${on ? styles.onText : ''}`}>
          {label}
        </text>
      </g>
    );
  };
  return (
    <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} className={styles.svg} role="group" aria-label="Circle of fifths">
      <circle cx={c} cy={c} r={c - 4} className={styles.outer} />
      <circle cx={c} cy={c} r={c - 54} className={styles.inner} />
      <circle cx={c} cy={c} r={c - 100} className={styles.hub} />
      {MAJORS.map((_, i) => key(i, 'major'))}
      {MINORS.map((_, i) => key(i, 'minor'))}
      <text x={c} y={c - 8} className={styles.center}>
        {pretty(root)} {mode}
      </text>
      <text x={c} y={c + 12} className={styles.sig}>
        {signatureText(root, mode).split(' · ')[0]}
      </text>
    </svg>
  );
}
```

`frontend/src/theory/CircleOfFifths.module.css`:

```css
/* Circle of fifths (D-19). The lit key is chrome, so accent (U-01). */
.svg {
  display: block;
  max-width: 100%;
  height: auto;
}

.outer {
  fill: var(--ds-surface);
  stroke: var(--ds-border-strong);
}

.inner {
  fill: var(--ds-raised);
  stroke: var(--ds-border-strong);
}

.hub {
  fill: var(--ds-ground);
  stroke: var(--ds-border-strong);
}

.key {
  cursor: pointer;
}

.key:focus-visible {
  outline: none;
}

.key:focus-visible circle {
  stroke: var(--ds-accent);
  stroke-width: 3;
}

.off {
  fill: transparent;
}

.near {
  fill: transparent;
  stroke: var(--ds-accent);
  stroke-width: 1.5;
}

.on {
  fill: var(--ds-accent);
}

.major,
.minor,
.center,
.sig {
  text-anchor: middle;
  dominant-baseline: central;
  font-family: var(--ds-font);
  pointer-events: none;
}

.major {
  font-size: 17px;
  font-weight: 700;
  fill: var(--ds-text-2);
}

.minor {
  font-size: 13px;
  font-weight: 700;
  fill: var(--ds-text-3);
}

.onText {
  fill: var(--ds-on-accent);
}

.center {
  font-size: 15px;
  font-weight: 700;
  fill: var(--ds-text);
}

.sig {
  font-size: 12px;
  fill: var(--ds-text-3);
}
```

- [ ] **Step 4: Chords in a key**

`frontend/src/theory/tools/ChordsInKey.tsx`:

```tsx
// Chords in a key (D-19): the seven chords with numerals and what each one
// does (home / sub / tension, from tonal's harmonic function), one of them on
// the neck, common progressions in the key and a small circle of fifths.
import { useState } from 'react';

import { DEFAULT_THEORY } from '../../api/client';
import { progressionChords, PROGRESSIONS } from '../../music/progressions';
import { chordInfo, keyChords, pcOf, pretty, relativeKey, rootName } from '../../music/spell';
import { Segmented } from '../../ui';
import { CircleOfFifths } from '../CircleOfFifths';
import { HelpBox, NoteChips, NotePicker, ToolHeader } from '../controls';
import { noteDots } from '../neckDots';
import { useSelection } from '../selection';
import styles from '../Theory.module.css';
import { TheoryNeck } from '../TheoryNeck';
import { useTheoryDoc } from '../TheoryDoc';

const FN_TEXT = { home: 'feels like home', sub: 'moves away from home', tension: 'pulls back to home' } as const;

export function ChordsInKey() {
  const { doc } = useTheoryDoc();
  const inst = doc?.instrument ?? DEFAULT_THEORY.instrument;
  const [sel, select] = useSelection();
  const [kind, setKind] = useState<'triads' | 'sevenths'>('triads');
  const [picked, setPicked] = useState(0);

  const chords = keyChords(sel.root, sel.mode, kind);
  const current = chords[picked] ?? chords[0]!;
  const info = chordInfo(current.symbol);
  const rel = relativeKey(sel.root, sel.mode);
  const progressions = PROGRESSIONS.filter((p) => p.mode === sel.mode);

  const setKey = (root: string, mode: typeof sel.mode) => select({ root, mode, scale: mode === 'minor' ? 'minor' : 'major' });

  return (
    <>
      <ToolHeader title="Chords in a key">
        <Segmented
          label="Chord size"
          value={kind}
          onChange={setKind}
          options={[
            { value: 'triads', label: 'Triads' },
            { value: 'sevenths', label: '7th chords' },
          ]}
        />
      </ToolHeader>
      <div className={styles.row}>
        <span className={styles.cap}>key</span>
        <NotePicker label="Key" selected={[pcOf(sel.root)!]} onPick={(pc) => setKey(rootName(pc, sel.mode), sel.mode)} />
        <Segmented
          label="Mode"
          value={sel.mode}
          onChange={(mode) => setKey(rootName(pcOf(sel.root)!, mode), mode)}
          options={[
            { value: 'major', label: 'Major' },
            { value: 'minor', label: 'Minor' },
          ]}
        />
      </div>
      <p className={styles.dimText}>
        Relative {rel.mode}: <b>{pretty(rel.root)} {rel.mode}</b>, the same chords with a different home.
      </p>
      <div className={styles.split}>
        <div className={styles.grow}>
          <div className={styles.keyCards} role="group" aria-label="Chords">
            {chords.map((c, i) => (
              <button key={c.numeral} type="button" className={styles.keyCard} aria-pressed={i === picked} onClick={() => setPicked(i)}>
                <span className={styles.numeral}>{c.numeral}</span>
                <span className={styles.keyChord}>{pretty(c.symbol)}</span>
                <span className={styles.fn}>{c.fn}</span>
              </button>
            ))}
          </div>
          {info.ok && (
            <>
              <div className={styles.row}>
                <b>
                  {current.numeral} · {pretty(info.chord.name)}
                </b>
                <NoteChips notes={info.chord.notes} />
              </div>
              <div className={styles.neck}>
                <TheoryNeck
                  instrument={inst}
                  frets={12}
                  label={`${pretty(current.symbol)} on ${inst.kind}`}
                  dots={noteDots(inst, info.chord.notes, { lo: 0, hi: 12, labels: 'interval' })}
                />
              </div>
            </>
          )}
          <HelpBox>
            <b>{current.numeral}</b> {FN_TEXT[current.fn]}. Common progressions in {pretty(sel.root)} {sel.mode}:{' '}
            {progressions.map((p, i) => (
              <span key={p.id}>
                {i > 0 && ' · '}
                <b>{p.label}</b> {progressionChords(p, sel.root).map(pretty).join(' ')}
              </span>
            ))}
          </HelpBox>
        </div>
        <div className={styles.circleCol}>
          <CircleOfFifths root={sel.root} mode={sel.mode} onPick={setKey} />
          <span className={styles.dimText}>Click a key to jump. Neighbours share 6 of 7 notes.</span>
        </div>
      </div>
    </>
  );
}
```

Register it in `tools.ts` (import `ChordsInKey`), after Note finder:

```ts
  { slug: 'chords-in-key', label: 'Chords in a key', group: 'Harmony', Component: ChordsInKey },
```

`tools.ts` now reads:

```ts
// The Theory tab's tools, in rail order (D-19). The rail, the routes and the
// "last tool" redirect all read this list; a tool exists in the UI exactly when
// it is registered here.
import type { ComponentType } from 'react';

import type { TheoryTool } from '../api/client';
import { ChordFinder } from './tools/ChordFinder';
import { ChordsInKey } from './tools/ChordsInKey';
import { NoteFinder } from './tools/NoteFinder';
import { ScaleFinder } from './tools/ScaleFinder';

export type ToolGroup = 'Find' | 'Shapes' | 'Harmony' | 'Practice';

export interface ToolDef {
  slug: TheoryTool;
  label: string;
  group: ToolGroup;
  Component: ComponentType;
}

export const GROUPS: readonly ToolGroup[] = ['Find', 'Shapes', 'Harmony', 'Practice'];

export const TOOLS: readonly ToolDef[] = [
  { slug: 'scale-finder', label: 'Scale finder', group: 'Find', Component: ScaleFinder },
  { slug: 'chord-finder', label: 'Chord finder', group: 'Find', Component: ChordFinder },
  { slug: 'note-finder', label: 'Note finder', group: 'Find', Component: NoteFinder },
  { slug: 'chords-in-key', label: 'Chords in a key', group: 'Harmony', Component: ChordsInKey },
];

export function toolBySlug(slug: string | undefined): ToolDef | undefined {
  return TOOLS.find((t) => t.slug === slug);
}
```

- [ ] **Step 5: Run everything**

Run: `npm --prefix frontend test && npm --prefix frontend run build`
Expected: all pass (chordsInKey 4); build clean with the `Theory-*.js` chunk.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/theory/CircleOfFifths.tsx frontend/src/theory/CircleOfFifths.module.css frontend/src/theory/tools/ChordsInKey.tsx frontend/src/theory/tools/chordsInKey.test.tsx frontend/src/theory/tools.ts
git commit -m "feat(theory): Chords in a key with numerals, function, progressions and the circle of fifths (D-19)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: README, screenshot, verification, push

**Files:**
- Modify: `scripts/capture-screens.mjs`, `README.md`
- Create: `docs/screenshots/theory.png`

- [ ] **Step 1: Let the capture script take a URL with a query string**

In `scripts/capture-screens.mjs`, `const [name, path] = arg.split('=');` cuts `theory=/theory/scale-finder?root=A&scale=minor-pentatonic` at the second `=`. Split on the first `=` only:

```js
const shots = process.argv.slice(2).map((arg) => {
  const eq = arg.indexOf('=');
  const name = arg.slice(0, eq);
  const path = arg.slice(eq + 1);
```

(Keep the rest of the map callback as it is.)

- [ ] **Step 2: Update `README.md`**

- Add a feature bullet after the Play along bullet:

  ```markdown
  - Theory tab: a scale finder, chord finder, note finder and chords-in-a-key view with a
    circle of fifths, for 4- and 5-string bass and guitar in any tuning, left-handed too.
    Load an analysed song's key and chords into it with one click
  ```

- Under `## Screens`, add `![Theory](docs/screenshots/theory.png)` after the Play along image. Change "All six are captures" to "All seven are captures", and add `theory=/theory/scale-finder?root=A&scale=minor-pentatonic` to the capture command.

- [ ] **Step 3: Capture the screenshot**

With the API and dev server running (see the `dev-setup` skill):

Run: `node scripts/capture-screens.mjs "theory=/theory/scale-finder?root=A&scale=minor-pentatonic"`
Expected: `docs/screenshots/theory.png` is written. Open it and check it against `design/ui/dist/screens/theory-scale-finder.html`: the rail on the left, the note picker, the scale chips, the neck with A minor pentatonic, the note chips and the help box.

- [ ] **Step 4: Full verification**

Run: `uv run pytest && uv run ruff check packages && npm --prefix frontend test && npm --prefix frontend run build`
Expected: everything passes, and the build shows no 500 kB warning. Then open `/theory` in the running app and check that:
- the nav highlights Theory;
- switching the instrument to guitar redraws the neck and survives a reload (it's in `theory.json`);
- a typed chord like `C/E` works;
- picking a song's key candidate loads it.

- [ ] **Step 5: Commit and push**

```bash
git add scripts/capture-screens.mjs README.md docs/screenshots/theory.png
git commit -m "docs: README and screenshot for the Theory tab (D-19)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin main
```
