# Stemcraft Phase 5: Analysis — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** turn a separated Song's `audio.wav` and `stems/*.wav` into `analysis.json` —
2-3 key candidates with confidence, a beat grid (BPM, beats, downbeats as integer sample
indices at 48 kHz), and a chord chart aligned to bars — via a new `analyze` job kind
chained automatically onto a successful `separate`. The Scale & fretboard screen (pure
lookup from a chosen key candidate to its notes and fretboard positions, no model, no
failure mode) is built against it, wired to a new read-only `GET
/api/songs/{id}/analysis` route. No Song-view UI yet (Phase 6) — the beat grid and chord
chart are consumed there, once Phase 3's engine, this phase's grid and Phase 6's UI all
exist together.

**Architecture:** All three analysis steps run in the worker (torch stays out of the API,
§4) but, unlike Separation, are **lazy-loaded per job, not cached in `WorkerState`** —
N-02 already characterizes analysis as "CPU, seconds," each model here is small enough
that a cold load costs at most a couple of seconds, and `analyze` runs once per song
(after `separate`) rather than repeatedly per session the way playback does. This is a
real simplification, not an oversight: it means zero changes to `device.py`, `main.py`'s
boot sequence, or `registry.py`'s `JobContext.worker_state` typing. It's also mandated by
the tech spec's own dependency table (§7): unlike ffmpeg/yt-dlp/PyTorch, a failure in
"Essentia / beat_this / autochord" is scoped to **"Analysis job fails; playback and
separation unaffected"** — not a boot refusal. Key detection runs on the bass and other
stems mixed together (domain spec); beat and chord detection run on the full mix
(`audio.wav`), which is why `analyze` depends on `separate` (for the stems) rather than
just `import` (which only guarantees `audio.wav`).

**Tech Stack:** `essentia` (key: HPCP chroma extraction, correlated against Krumhansl-Kessler
profiles for multiple ranked candidates — code we write, not a black-box call, because
essentia's own `Key`/`KeyExtractor` algorithms return only a single top answer), `beat-this`
(beats/downbeats: a maintained, MIT-licensed, torch-native PyPI package — replaces the
domain spec's `beat_this`-or-`madmom` choice, decided below), a vendored, MIT-licensed
subset of `BTC-ISMIR19` (chords: replaces the domain spec's `autochord`-or-BTC choice,
decided below), `librosa` + `soundfile` (BTC's CQT feature extraction and audio loading).

**Spec:** [design/tech-spec-stemcraft.md](../../../design/tech-spec-stemcraft.md) §2 N-02,
§5 (analysis.json layout, sample rate and the beat grid, one writer per file), §7
(external dependency table's Essentia/beat_this/autochord row), §9 (analysis failure is
job-scoped, not a boot refusal), §11 R-05, §13 Q-01/Q-02; [design/domain-spec.md
](../../../design/domain-spec.md) "Analysis" (key/scale, beat grid, chords) and "Scale
view"; [design/ui-spec.md](../../../design/ui-spec.md) §4 "Scale & fretboard"; phase map:
[2026-09-27-stemcraft-roadmap.md](2026-09-27-stemcraft-roadmap.md) Phase 5. Phase 4's plan
(separation, already done): [2026-09-27-phase-4-separation.md](2026-09-27-phase-4-separation.md).

## Global constraints (repeated because every task inherits them)

- **The API never imports torch (§4).** `stemcraft-api` and `stemcraft-lib` never gain
  `essentia`, `beat-this`, `torch`, `torchaudio` or `librosa` as a dependency. Every
  torch/essentia/librosa-touching module in this phase lives under
  `packages/stemcraft_worker/src/stemcraft_worker/analysis/`. The API's only new code is a
  route that reads a JSON file the worker already wrote — exactly the pattern
  `derive_files`/`has_analysis` already uses.
- **48 kHz stereo end to end (D-03); the beat grid is integer sample indices at 48 kHz,
  never float seconds.** `beat_this` returns beat times in seconds; every value that
  reaches `analysis.json` is `round(seconds * SAMPLE_RATE)` before it's written.
- **One writer per file (§2).** The worker owns `analysis.json`, same as `stems/`. The
  API's new route only reads it.
- **All writes atomic (invariant #8).** `analysis.json` is written via the existing
  `stemcraft_lib.atomic.atomic_write_json`, the same helper `song.json` uses. The BTC
  checkpoint's one-time download also lands via the existing `atomic_output` context
  manager, not a raw file write, so a crash mid-download never leaves a half-written
  checkpoint that a later run mistakes for a good one.
- **Every job kind idempotent by re-derivation (§6).** `analyze` re-runs cleanly from
  `audio.wav` and `stems/*.wav` (both immutable) and simply overwrites `analysis.json`.
  Nothing here has hidden randomness: `essentia`'s HPCP/correlation math is pure
  arithmetic, `beat_this` and BTC are both run in eval mode with no dropout active, so two
  runs on identical input produce identical output.
- **Fail loudly (N-08), but job-scoped, not boot-scoped (§7/§9).** Unlike ffmpeg or the
  separation device probe, a missing/broken analysis dependency, insufficient beats, or
  silent stems fails *this job* with the real exception text in the Job Queue view — it
  never blocks worker boot and never takes down a previously separated Song.

## Why `beat_this`, not `madmom` (Q-01)

Verified empirically before writing this plan, mirroring Phase 4's own standard for
dependency claims:

- **`madmom` (PyPI 0.16.1, unmaintained since 2018) fails to install cleanly with this
  project's toolchain.** `uv pip install madmom` fails outright — its `setup.py` imports
  `Cython` at build time without declaring it as a build dependency (PEP 517 build
  isolation rejects it). Forcing it through with `Cython`, `setuptools` and
  `--no-build-isolation` gets the wheel to *build*, but it then fails at **import time**
  with `ModuleNotFoundError: No module named 'pkg_resources'` — `madmom.__init__` imports
  `pkg_resources` unconditionally, and modern `setuptools` (84.x, what `uv` resolves
  today) no longer ships it. This is exactly the risk R-02 and the tech-spec's own
  dependency table called out in advance ("madmom's install health on Python 3.12 +
  NumPy 2 should be checked before it is adopted") — checked, and it fails.
- **`beat_this` (PyPI `beat-this` 1.1.0, MIT, pushed to GitHub as recently as 2026-05-28)
  installs cleanly** (`einops`, `rotary-embedding-torch`, `soxr`, `torchaudio` — all real
  wheels, no native-toolchain surprises) and its `beat_this.inference.File2Beats` class
  was run end-to-end against a synthetic 120 BPM click track during this research: it
  returned beats at exactly 0.5 s spacing (median-interval BPM = 120.0, exact), and
  correctly returned an empty array against a non-rhythmic pure sine tone rather than
  hallucinating beats. It also returns downbeats directly (`beat_this` calls this "beat
  tracking without DBN postprocessing" in its own paper title — no `madmom`-based DBN
  step is needed or used here; `dbn=False` is passed explicitly).
- `beat_this`'s own PyPI metadata declares `torchaudio` as a dependency, and
  `torchaudio==2.11.0+cu128` exists on the same `download.pytorch.org/whl/cu128` index
  this project already pins `torch` to (verified: both `torch` and `torchaudio` publish a
  `2.11.0+cu128` build) — so Task 1 adds one more `[tool.uv.sources]` redirect, not a
  second index.

## Why a vendored BTC, not `autochord` (Q-02)

Also verified empirically:

- **`autochord` (PyPI 0.1.4) depends on `tensorflow>=2.6` (a 546 MB download — a second ML
  runtime this project otherwise has none of, D-08's spirit if not its letter), `gdown`
  (downloads model weights from a Google Drive share link — the same class of
  "breaks whenever the host changes something" fragility C-08 already accepts for
  `yt-dlp`, but adopted here with no corresponding "refuse to start and update often"
  discipline), and `vamp`.** `vamp` alone is enough to disqualify it: `uv pip install
  vamp` fails to build (it imports `numpy` and then `setuptools` at build time without
  declaring either as build dependencies — the same undeclared-build-dependency failure
  class as `madmom`, worked around with the same `--no-build-isolation` hammer, and it
  *still* fails). Even if it built, `vamp` is a Python binding to the system-installed
  Vamp Plugin SDK host library — a native dependency entirely outside `uv`'s reach, on
  top of everything else.
- **`BTC-ISMIR19` (github.com/jayg996/BTC-ISMIR19, MIT license, 214 stars, last pushed
  2020-05-23) is pure PyTorch** — `btc_model.py` and `utils/transformer_modules.py` import
  only `torch`, `numpy` and `math`; no TensorFlow, no native host library. It is not a
  PyPI package (no `pip install btc`), but unlike most abandoned research repos it ships
  its **pretrained checkpoints committed directly in the repo**
  (`test/btc_model.pt`, 12,154,754 bytes; `test/btc_model_large_voca.pt`, 12,229,576
  bytes) — no Google Drive link, no `gdown`, nothing to go dark. This plan vendors the
  ~150 lines of inference-path code (`btc_model.py` + `transformer_modules.py`, both
  MIT-licensed, attributed in a header comment) into `stemcraft_worker`, downloads the one
  checkpoint file it needs directly from GitHub on first use (mirroring the "one-time
  download, then cached on disk" pattern §7 already accepts for model weights generally),
  and fixes the one real incompatibility found while reading the source: `transformer_modules.py`
  calls `np.arange(...).astype(np.float)` — `np.float` was removed in NumPy 1.24+ and this
  project pins `numpy>=2`. Task 5 changes it to `float`.
  - The large-vocabulary checkpoint (170 chord classes: 12 roots × 14 qualities, plus
    no-chord/unclassifiable) is used, matching upstream's own recommended default
    (`test.py --voca` defaults to `True`) — a musician gets `Cmaj7`/`Dsus4`, not just
    `C`/`Dm`.
  - The alternative repo actually named in the domain spec's Q-02, a hypothetical
    "BTC" PyPI package, does not exist under that name; this deviation is the same shape
    as Phase 4's audio-separator→demucs substitution — an instantiation choice within
    what Q-02 already left open, not a tech-spec reversal.
- Considered and rejected: training BTC from scratch instead of using its shipped
  checkpoint. The repo's own README states its training data's audio files aren't
  redistributable "due to copyright issue" — there is no practical way to reproduce the
  checkpoint from this repo alone, which is exactly why using the one it already ships is
  the right call rather than a corner cut.

## Why essentia's algorithms directly, not `Key`/`KeyExtractor` (top-N candidates)

Essentia's own `Key` and `KeyExtractor` algorithms (verified present in
`essentia.standard`, version `2.1b6.dev1389` — the only released build with a
`manylinux`/Python-3.12 wheel; every later dev build up to today's `2.1b6.dev1438` only
ships macOS and Python-3.14 wheels, so this exact version string is pinned, not a
range) return a single best key plus a scalar "strength," not multiple ranked candidates.
The domain spec explicitly wants 2-3 candidates with confidence (R-05: "always show
confidence and multiple key candidates; never present a single answer as fact"), so Task
3 uses essentia only for the well-tested DSP step — `Windowing` → `Spectrum` →
`SpectralPeaks` → `HPCP`, the standard chroma-extraction chain `Key`/`KeyExtractor` use
internally — and this plan's own ~20 lines do the final step: correlate the averaged HPCP
vector against the Krumhansl-Kessler major/minor profiles for all 12 tonics (24
correlations), rank them, and normalize the top 3 into confidence percentages. This was
verified against a synthetic G-minor triad (G3+B♭3+D4 sine mix) during this research: the
averaged HPCP vector peaked at exactly the G/B♭/D bins (0.855/0.902/0.92 out of the other
nine bins' 0.23-0.49), and hand-checked against the rotated minor profile for a G-minor
tonic candidate, those same three bins carry that profile's three highest weights
(root/♭3/5th) — the DSP and the correlation math agree.

## Why this order

```
Task 1 (deps: essentia, beat-this, torchaudio index, librosa/soundfile) ───────────────┐
                                                                                         │
Task 2 (stemcraft_lib.analysis: schema + atomic read/write) ───────────────┬───────────┤
                                                                            │            │
Task 3 (key.py: HPCP + Krumhansl-Kessler) ─────────────────────────────────┤            │
Task 4 (beats.py: beat_this wrapper) ───────────────────────────────────────┤            │
Task 5 (chords/: vendored BTC + frame-level recognition) ──────────────────┤            │
Task 6 (chords/align.py: frame chords -> bar-aligned ChordSegments) ───────┤            │
                                                                            ▼            │
                                              Task 7 (analyze_song.py: orchestration, ◄──┘
                                                       chained from separate)
                                                            │
                              ┌─────────────────────────────┼─────────────────────────┐
                              ▼                              ▼                         ▼
                    Task 8 (API: GET .../analysis)  Task 9 (frontend music/theory.ts)  Task 12 (docs +
                              │                              │                          real-hardware
                              │                              ▼                          verification)
                              │                    Task 10 (Fretboard.tsx)
                              │                              │
                              └──────────────┬───────────────┘
                                             ▼
                              Task 11 (ScaleSheet screen, wired to real data)
```

Task 1 has to land before anything in this phase can import `essentia` or `beat_this`.
Task 2 defines the shape everything downstream writes into or reads out of, so it comes
before the three detectors. Tasks 3, 4, 5 are independent of each other (three different
libraries, three different stem/mix inputs) and can be done in any order; Task 6 depends
only on Task 5's raw output shape, not on Task 5's model internals, and is pure,
model-free logic, deliberately split out so it can be tested without a checkpoint on
disk. Task 7 is the centerpiece: it depends on everything before it. Tasks 8-11 are the
read side and can start once Task 7's `analysis.json` shape is real; Task 9 (pure
TypeScript music theory, no backend dependency at all) could technically run in parallel
with Tasks 3-7, but is sequenced after Task 7 here so its `KeyCandidate.tonic` contract
(always sharp-spelled, e.g. `"G"`/`"A#"`, never `"Ab"`) is checked against the real
Python-side type in Task 2 rather than assumed. Task 12 is real hardware, last, by
construction — mirroring Phase 4's Task 11.

---

### Task 1: Pin analysis dependencies

**Files:**
- Modify: `pyproject.toml` (workspace root)
- Modify: `packages/stemcraft_worker/pyproject.toml`

**Interfaces:**
- Produces: `essentia`, `beat_this` (import name; PyPI name `beat-this`), `torchaudio`,
  `librosa`, `soundfile` all importable from `stemcraft_worker`'s environment; `torch` and
  `torchaudio` both resolve from the `pytorch-cu128` index.

- [ ] **Step 1: Add the `torchaudio` index redirect and the new worker dependencies**

In `pyproject.toml` (workspace root), add `torchaudio` next to the existing `torch` line:

```toml
[tool.uv.sources]
stemcraft-lib = { workspace = true }
stemcraft-worker = { workspace = true }
stemcraft-api = { workspace = true }
# D-02: torch is pinned to the cu128 index, not a version range (see the comment
# above this table). torchaudio must be pinned the same way: beat_this depends on
# it, and left alone uv could resolve a plain-PyPI torchaudio build mismatched
# against the cu128 torch this project actually runs -- the two ship as matched
# pairs (verified: both publish a 2.11.0+cu128 build on this same index).
torch = [{ index = "pytorch-cu128" }]
torchaudio = [{ index = "pytorch-cu128" }]
```

In `packages/stemcraft_worker/pyproject.toml`, extend `dependencies`:

```toml
dependencies = [
    "stemcraft-lib", "torch", "torchaudio", "demucs>=4.1", "numpy>=2",
    # Phase 5 (Q-01): beat_this replaces madmom, which fails to install on this
    # toolchain (verified: undeclared Cython build dep, then a pkg_resources
    # ImportError at runtime against modern setuptools -- see the phase-5 plan's
    # "Why beat_this" section). torchaudio and soundfile are its audio-loading
    # backends; without soundfile it falls through to a madmom-based loader we
    # don't want.
    "beat-this>=1.1", "soundfile>=0.12",
    # Phase 5 (chords, vendored BTC): CQT feature extraction, same tool BTC's own
    # upstream code uses.
    "librosa>=0.10",
    # Phase 5 (Q-02 deviation, key detection): pinned to an exact dev build, not a
    # range -- it is the *only* essentia release with a manylinux/cp312 Linux wheel.
    # Every later dev build (up to today's 2.1b6.dev1438) only ships macOS and
    # Python-3.14 wheels; a bare "essentia" or a floor pin would silently break the
    # next `uv sync` on this machine.
    "essentia==2.1b6.dev1389",
]
```

- [ ] **Step 2: Sync and verify resolution**

Run: `uv sync`
Expected: resolves successfully; `essentia`, `beat-this`, `librosa`, `soundfile` appear as
new packages in `uv.lock`.

Run: `grep -A2 'name = "torchaudio"' uv.lock`
Expected: `source = { registry = "https://download.pytorch.org/whl/cu128" }` — confirms
the index redirect actually took effect and torchaudio didn't fall back to plain PyPI.

- [ ] **Step 3: Smoke-import from the worker's environment**

Run: `uv run --package stemcraft-worker python -c "import essentia.standard, beat_this.inference, librosa, soundfile; print('ok')"`
Expected: prints `ok` with no import error.

- [ ] **Step 4: Confirm the API still never imports torch**

Run: `uv run --package stemcraft-api pytest packages/stemcraft_api -k torch -q`
Expected: the existing `test_the_api_never_imports_torch` (added in Phase 4) still
passes — nothing in this task touches `stemcraft_api`'s or `stemcraft_lib`'s own
dependencies.

- [ ] **Step 5: Commit**

```bash
git add pyproject.toml packages/stemcraft_worker/pyproject.toml uv.lock
git commit -m "feat(deps): pin essentia, beat-this, torchaudio(cu128), librosa (Task 1)"
```

---

### Task 2: `stemcraft_lib.analysis` — schema and atomic read/write

**Files:**
- Create: `packages/stemcraft_lib/src/stemcraft_lib/analysis.py`
- Test: `packages/stemcraft_lib/tests/test_analysis.py`

**Interfaces:**
- Produces: `KeyCandidate(tonic: str, mode: Literal["major","minor"], confidence: float)`,
  `BeatGrid(bpm: float, beats: list[int], downbeats: list[int])`,
  `ChordSegment(bar: int, start_sample: int, end_sample: int, chord: str)`,
  `Analysis(schema_version: int, key_candidates: list[KeyCandidate], beat_grid: BeatGrid,
  chords: list[ChordSegment])`, `read_analysis(song_dir: Path) -> Analysis`,
  `write_analysis(song_dir: Path, analysis: Analysis) -> None`.
- Consumes: `stemcraft_lib.atomic.atomic_write_json` (existing).

- [ ] **Step 1: Write the failing test**

```python
# packages/stemcraft_lib/tests/test_analysis.py
import pytest
from pydantic import ValidationError
from stemcraft_lib.analysis import Analysis, BeatGrid, ChordSegment, KeyCandidate, read_analysis, write_analysis


def _sample_analysis() -> Analysis:
    return Analysis(
        key_candidates=[
            KeyCandidate(tonic="G", mode="minor", confidence=0.72),
            KeyCandidate(tonic="A#", mode="major", confidence=0.18),
            KeyCandidate(tonic="D", mode="minor", confidence=0.10),
        ],
        beat_grid=BeatGrid(bpm=120.0, beats=[1920, 25920, 49920], downbeats=[1920]),
        chords=[ChordSegment(bar=0, start_sample=1920, end_sample=25920, chord="G:min")],
    )


def test_write_then_read_round_trips(tmp_path):
    write_analysis(tmp_path, _sample_analysis())
    loaded = read_analysis(tmp_path)
    assert loaded == _sample_analysis()


def test_write_is_atomic_and_json_on_disk(tmp_path):
    write_analysis(tmp_path, _sample_analysis())
    path = tmp_path / "analysis.json"
    assert path.is_file()
    assert not list(tmp_path.glob("*.tmp"))  # no leftover temp file


def test_mode_rejects_anything_other_than_major_or_minor():
    with pytest.raises(ValidationError):
        KeyCandidate(tonic="G", mode="dorian", confidence=1.0)


def test_beat_grid_defaults_to_empty_lists():
    grid = BeatGrid(bpm=120.0)
    assert grid.beats == []
    assert grid.downbeats == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest packages/stemcraft_lib/tests/test_analysis.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'stemcraft_lib.analysis'`

- [ ] **Step 3: Write the implementation**

```python
# packages/stemcraft_lib/src/stemcraft_lib/analysis.py
"""analysis.json: key candidates, beat grid and chord chart. The worker is the
only writer (§2), same as stems/ -- the API only reads this to serve it to the
frontend, the same pattern derive_files/has_analysis already uses for presence.

The beat grid is integer sample indices at 48 kHz (D-03), never float seconds:
loops and the metronome need sample-accurate positions, and a float round trip
through JSON would not guarantee that two reads of the same value agree.
"""

from __future__ import annotations

from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field

from .atomic import atomic_write_json

SCHEMA_VERSION = 1


class KeyCandidate(BaseModel):
    # One of the 12 sharp-spelled pitch-class names -- "G", "A#", never "Ab".
    # The frontend re-spells for display (flats where a key's family calls for
    # them); the wire format stays a single canonical form.
    tonic: str
    mode: Literal["major", "minor"]
    confidence: float  # 0..1; a song's candidates sum to 1.0


class BeatGrid(BaseModel):
    bpm: float = 0.0
    beats: list[int] = Field(default_factory=list)  # sample indices @ 48 kHz, ascending
    downbeats: list[int] = Field(default_factory=list)  # subset of beats: bar starts


class ChordSegment(BaseModel):
    bar: int  # 0-indexed, counted from the first downbeat
    start_sample: int
    end_sample: int
    chord: str  # e.g. "G:min", "C:maj7", "N" (no chord), "X" (BTC: unclassifiable)


class Analysis(BaseModel):
    schema_version: int = SCHEMA_VERSION
    key_candidates: list[KeyCandidate] = Field(default_factory=list)
    beat_grid: BeatGrid = Field(default_factory=BeatGrid)
    chords: list[ChordSegment] = Field(default_factory=list)


def read_analysis(song_dir: Path) -> Analysis:
    return Analysis.model_validate_json((song_dir / "analysis.json").read_text())


def write_analysis(song_dir: Path, analysis: Analysis) -> None:
    atomic_write_json(song_dir / "analysis.json", analysis.model_dump(mode="json"))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest packages/stemcraft_lib/tests/test_analysis.py -v`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/stemcraft_lib/src/stemcraft_lib/analysis.py packages/stemcraft_lib/tests/test_analysis.py
git commit -m "feat(lib): analysis.json schema and atomic read/write (Task 2)"
```

---

### Task 3: Key detection — HPCP + Krumhansl-Kessler

**Files:**
- Create: `packages/stemcraft_worker/src/stemcraft_worker/analysis/__init__.py`
- Create: `packages/stemcraft_worker/src/stemcraft_worker/analysis/key.py`
- Test: `packages/stemcraft_worker/tests/analysis/test_key.py`

**Interfaces:**
- Consumes: `stemcraft_lib.analysis.KeyCandidate`.
- Produces: `detect_key(wav_paths: list[Path], *, sample_rate: int, top_n: int = 3) ->
  list[KeyCandidate]`; `InsufficientSignal` (exception, raised when the input is too
  near-silent to carry tonal information).

- [ ] **Step 1: Write the failing test**

```python
# packages/stemcraft_worker/src/stemcraft_worker/analysis/__init__.py
```
(empty — makes `analysis` a package)

```python
# packages/stemcraft_worker/tests/analysis/__init__.py
```
(empty)

```python
# packages/stemcraft_worker/tests/analysis/test_key.py
import subprocess

import pytest
from stemcraft_worker.analysis.key import InsufficientSignal, detect_key

SAMPLE_RATE = 48000


def _sine_mix(path, freqs, seconds=4, sample_rate=SAMPLE_RATE):
    inputs = []
    for f in freqs:
        inputs += ["-f", "lavfi", "-i", f"sine=frequency={f}:duration={seconds}"]
    n = len(freqs)
    subprocess.run(
        ["ffmpeg", "-hide_banner", "-nostdin", "-y", *inputs,
         "-filter_complex", f"amix=inputs={n}:duration=longest",
         "-ar", str(sample_rate), "-ac", "1", str(path)],
        check=True, capture_output=True,
    )


def test_g_minor_triad_ranks_g_minor_in_top_candidates(tmp_path):
    # G3, Bb3, D4 -- a G minor triad.
    wav = tmp_path / "chord.wav"
    _sine_mix(wav, [196.00, 233.08, 293.66])

    candidates = detect_key([wav], sample_rate=SAMPLE_RATE)

    assert len(candidates) == 3
    assert abs(sum(c.confidence for c in candidates) - 1.0) < 1e-6
    top_pairs = {(c.tonic, c.mode) for c in candidates}
    assert ("G", "minor") in top_pairs


def test_two_stems_are_mixed_together(tmp_path):
    bass = tmp_path / "bass.wav"
    other = tmp_path / "other.wav"
    _sine_mix(bass, [196.00])       # G
    _sine_mix(other, [233.08, 293.66])  # Bb, D

    candidates = detect_key([bass, other], sample_rate=SAMPLE_RATE)
    assert ("G", "minor") in {(c.tonic, c.mode) for c in candidates}


def test_near_silence_raises_insufficient_signal(tmp_path):
    silence = tmp_path / "silence.wav"
    subprocess.run(
        ["ffmpeg", "-hide_banner", "-nostdin", "-y", "-f", "lavfi",
         "-i", f"anullsrc=r={SAMPLE_RATE}:cl=mono", "-t", "2", str(silence)],
        check=True, capture_output=True,
    )
    with pytest.raises(InsufficientSignal):
        detect_key([silence], sample_rate=SAMPLE_RATE)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest packages/stemcraft_worker/tests/analysis/test_key.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'stemcraft_worker.analysis.key'`

- [ ] **Step 3: Write the implementation**

```python
# packages/stemcraft_worker/src/stemcraft_worker/analysis/key.py
"""Key detection: essentia's HPCP (chroma) chain, correlated against the
Krumhansl-Kessler major/minor key profiles for all 12 tonics, ranked and
normalized into confidence percentages.

essentia.standard.Key/KeyExtractor do this same correlation internally but
only surface the single winning answer plus a strength scalar. The domain
spec (R-05) wants 2-3 ranked candidates with confidence, never one answer
presented as fact, so this module does the final ranking step itself on top
of essentia's well-tested chroma extraction.
"""

from __future__ import annotations

from pathlib import Path

import essentia.standard as es
import numpy as np

from stemcraft_lib.analysis import KeyCandidate

# essentia's HPCP bin 0 is A, ascending by semitone (verified empirically: a
# synthetic G+Bb+D chord's HPCP peaked at bins 10, 1 and 5 respectively).
_NOTE_NAMES = ["A", "A#", "B", "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#"]

# Krumhansl-Kessler key profiles, indexed from the tonic (index 0 = tonic's
# own scale degree weight). Standard published values, used the same way
# essentia's own Key algorithm and most MIR key-detection work does.
_KK_MAJOR = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
_KK_MINOR = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])

# Empirical floor separating "has tonal content" from near-silence -- a
# stem's HPCP frames all near zero (see test_near_silence_raises_...).
_MIN_ENERGY = 1e-3


class InsufficientSignal(Exception):
    """Raised when the input carries no detectable tonal content (e.g. both
    the bass and other stems are near-silent) -- fail loudly (N-08) rather
    than emit meaningless confidence numbers."""


def _load_mono(path: Path, sample_rate: int) -> np.ndarray:
    return es.MonoLoader(filename=str(path), sampleRate=sample_rate)()


def _average_hpcp(audio: np.ndarray, sample_rate: int) -> np.ndarray:
    window = es.Windowing(type="hann")
    spectrum = es.Spectrum()
    spectral_peaks = es.SpectralPeaks(sampleRate=sample_rate)
    hpcp = es.HPCP(sampleRate=sample_rate)

    vectors = [
        hpcp(*spectral_peaks(spectrum(window(frame))))
        for frame in es.FrameGenerator(audio, frameSize=4096, hopSize=2048, startFromZero=True)
    ]
    if not vectors:
        return np.zeros(12)
    return np.mean(np.array(vectors), axis=0)


def detect_key(wav_paths: list[Path], *, sample_rate: int, top_n: int = 3) -> list[KeyCandidate]:
    signals = [_load_mono(p, sample_rate) for p in wav_paths]
    length = max(len(s) for s in signals)
    mixed = np.zeros(length, dtype=np.float32)
    for s in signals:
        mixed[: len(s)] += s

    chroma = _average_hpcp(mixed, sample_rate)
    if float(np.sum(chroma)) < _MIN_ENERGY:
        raise InsufficientSignal(
            f"no detectable tonal content in {[str(p) for p in wav_paths]}"
        )

    scores: list[tuple[float, str, str]] = []
    for tonic_bin, tonic_name in enumerate(_NOTE_NAMES):
        for mode, profile in (("major", _KK_MAJOR), ("minor", _KK_MINOR)):
            expected = np.roll(profile, tonic_bin)
            corr = float(np.corrcoef(chroma, expected)[0, 1])
            scores.append((corr, tonic_name, mode))
    scores.sort(key=lambda s: s[0], reverse=True)

    top = scores[:top_n]
    weights = [max(c, 0.0) for c, _, _ in top]
    total = sum(weights) or 1.0
    return [
        KeyCandidate(tonic=tonic, mode=mode, confidence=w / total)
        for (_, tonic, mode), w in zip(top, weights)
    ]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest packages/stemcraft_worker/tests/analysis/test_key.py -v`
Expected: PASS (3 tests). If `test_g_minor_triad_...` fails because a *different* but
musically adjacent candidate (e.g. D minor or B♭ major — G minor's dominant and relative
major) ranks first, that is not a bug: assert `("G", "minor") in top_pairs`, not that it
ranks first, exactly as written above — profile correlation is inherently ambiguous
between closely related keys, which is the entire reason R-05 asks for multiple
candidates instead of one answer.

- [ ] **Step 5: Commit**

```bash
git add packages/stemcraft_worker/src/stemcraft_worker/analysis/__init__.py \
        packages/stemcraft_worker/src/stemcraft_worker/analysis/key.py \
        packages/stemcraft_worker/tests/analysis/__init__.py \
        packages/stemcraft_worker/tests/analysis/test_key.py
git commit -m "feat(worker): key detection via HPCP + Krumhansl-Kessler (Task 3)"
```

---

### Task 4: Beat detection — `beat_this` wrapper

**Files:**
- Create: `packages/stemcraft_worker/src/stemcraft_worker/analysis/beats.py`
- Test: `packages/stemcraft_worker/tests/analysis/test_beats.py`

**Interfaces:**
- Consumes: `stemcraft_lib.config.SAMPLE_RATE`.
- Produces: `detect_beats(audio_wav: Path, *, sample_rate: int = 48000, checkpoint_path:
  str = "final0") -> BeatGridRaw` where `BeatGridRaw` is a small dataclass `(bpm: float,
  beats: list[int], downbeats: list[int])` matching `stemcraft_lib.analysis.BeatGrid`'s
  fields; `InsufficientBeats` (exception).

- [ ] **Step 1: Write the failing test**

```python
# packages/stemcraft_worker/tests/analysis/test_beats.py
import subprocess

import pytest
from stemcraft_worker.analysis.beats import InsufficientBeats, detect_beats

SAMPLE_RATE = 48000
# beat_this's smallest published checkpoint (~8 MB vs. final0's ~78 MB) -- plenty
# accurate for these synthetic fixtures and far cheaper to download once in CI/dev.
_TEST_CHECKPOINT = "small0"


def _click_track(path, *, bpm=120, seconds=16, sample_rate=SAMPLE_RATE):
    interval = 60.0 / bpm
    subprocess.run(
        ["ffmpeg", "-hide_banner", "-nostdin", "-y", "-f", "lavfi",
         "-i", f"aevalsrc=0.6*sin(2*PI*1000*t)*lt(mod(t\\,{interval})\\,0.03):d={seconds}",
         "-ar", str(sample_rate), "-ac", "1", str(path)],
        check=True, capture_output=True,
    )


def test_click_track_bpm_detected_within_tolerance(tmp_path):
    wav = tmp_path / "click.wav"
    _click_track(wav, bpm=120)

    grid = detect_beats(wav, checkpoint_path=_TEST_CHECKPOINT)

    assert abs(grid.bpm - 120.0) < 2.0
    assert len(grid.beats) >= 10
    assert grid.beats == sorted(grid.beats)


def test_beats_are_48khz_sample_indices_not_seconds(tmp_path):
    wav = tmp_path / "click.wav"
    _click_track(wav, bpm=120, seconds=8)

    grid = detect_beats(wav, checkpoint_path=_TEST_CHECKPOINT)

    # A 120 BPM beat every 0.5s is 24000 samples at 48kHz -- values in the
    # thousands, not in the single digits a seconds-denominated list would be.
    assert all(b > 1000 for b in grid.beats[1:])


def test_silence_raises_insufficient_beats(tmp_path):
    silence = tmp_path / "silence.wav"
    subprocess.run(
        ["ffmpeg", "-hide_banner", "-nostdin", "-y", "-f", "lavfi",
         "-i", f"anullsrc=r={SAMPLE_RATE}:cl=mono", "-t", "3", str(silence)],
        check=True, capture_output=True,
    )
    with pytest.raises(InsufficientBeats):
        detect_beats(silence, checkpoint_path=_TEST_CHECKPOINT)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest packages/stemcraft_worker/tests/analysis/test_beats.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'stemcraft_worker.analysis.beats'`

- [ ] **Step 3: Write the implementation**

```python
# packages/stemcraft_worker/src/stemcraft_worker/analysis/beats.py
"""Beat/downbeat/BPM detection via beat_this (Q-01 -- see the phase-5 plan's
"Why beat_this, not madmom" section). Runs on the full mix (audio.wav), not
stems -- rhythm is clearest with everything present, including drums.

beat_this returns beat and downbeat times in seconds; this module is the one
place those get converted to integer sample indices at 48 kHz (D-03) -- the
only unit that ever reaches analysis.json.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np
from beat_this.inference import File2Beats


class InsufficientBeats(Exception):
    """Raised when beat_this finds too few beats or no downbeats to build a
    usable grid (silence, a corrupt decode, or non-musical audio) -- fail
    loudly (N-08) rather than write a degenerate one-point grid Phase 6's
    looping and metronome could never resolve bars against."""


@dataclass(frozen=True)
class BeatGridRaw:
    bpm: float
    beats: list[int]
    downbeats: list[int]


def detect_beats(
    audio_wav: Path, *, sample_rate: int = 48000, checkpoint_path: str = "final0"
) -> BeatGridRaw:
    file2beats = File2Beats(checkpoint_path=checkpoint_path, device="cpu", dbn=False)
    beats_sec, downbeats_sec = file2beats(str(audio_wav))

    if len(beats_sec) < 2:
        raise InsufficientBeats(f"only {len(beats_sec)} beat(s) detected in {audio_wav}")
    if len(downbeats_sec) < 1:
        raise InsufficientBeats(f"no downbeats detected in {audio_wav}")

    bpm = 60.0 / float(np.median(np.diff(beats_sec)))
    beats = [round(float(t) * sample_rate) for t in beats_sec]
    downbeats = [round(float(t) * sample_rate) for t in downbeats_sec]
    return BeatGridRaw(bpm=bpm, beats=beats, downbeats=downbeats)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest packages/stemcraft_worker/tests/analysis/test_beats.py -v`
Expected: PASS (3 tests). First run downloads the `small0` checkpoint (~8 MB, one time,
cached under `~/.cache/torch/hub/checkpoints/` by `beat_this` itself) — expect this run to
take longer than subsequent ones.

- [ ] **Step 5: Commit**

```bash
git add packages/stemcraft_worker/src/stemcraft_worker/analysis/beats.py \
        packages/stemcraft_worker/tests/analysis/test_beats.py
git commit -m "feat(worker): beat/downbeat/BPM detection via beat_this (Task 4)"
```

---

### Task 5: Chord recognition — vendored BTC + frame-level inference

**Files:**
- Create: `packages/stemcraft_worker/src/stemcraft_worker/analysis/chords/__init__.py`
- Create: `packages/stemcraft_worker/src/stemcraft_worker/analysis/chords/transformer_modules.py`
- Create: `packages/stemcraft_worker/src/stemcraft_worker/analysis/chords/btc_model.py`
- Create: `packages/stemcraft_worker/src/stemcraft_worker/analysis/chords/weights.py`
- Create: `packages/stemcraft_worker/src/stemcraft_worker/analysis/chords/recognize.py`
- Test: `packages/stemcraft_worker/tests/analysis/test_chords_recognize.py`

**Interfaces:**
- Consumes: `stemcraft_lib.config.settings` (for the checkpoint cache directory).
- Produces: `recognize_frames(audio_wav: Path) -> list[tuple[float, float, str]]` —
  `(start_seconds, end_seconds, chord_label)` triples covering the whole file, chord
  labels drawn from BTC's 170-class large-vocabulary vocabulary (e.g. `"G:min"`,
  `"C:maj7"`, `"N"` for no-chord, `"X"` for unclassifiable).

- [ ] **Step 1: Resolve the exact upstream commit to vendor against**

Run: `git ls-remote https://github.com/jayg996/BTC-ISMIR19 HEAD`
Record the returned commit SHA (call it `<btc-sha>` below) — the repo has had no commits
since 2020-05-23, so this pins an already-frozen state, the same way a version pin would.
Use `https://raw.githubusercontent.com/jayg996/BTC-ISMIR19/<btc-sha>/...` for every file
reference and download below, not `.../master/...`, so this plan's vendoring is
reproducible even if that changes in the future.

- [ ] **Step 2: Vendor `transformer_modules.py`, with the one NumPy-2 fix**

Fetch `https://raw.githubusercontent.com/jayg996/BTC-ISMIR19/<btc-sha>/utils/transformer_modules.py`
and save it as `packages/stemcraft_worker/src/stemcraft_worker/analysis/chords/transformer_modules.py`,
with a header attribution comment and exactly one line changed:

```python
"""Vendored from jayg996/BTC-ISMIR19 (MIT License), commit <btc-sha>,
utils/transformer_modules.py -- see the phase-5 plan's "Why a vendored BTC"
section for why this is vendored rather than pip-installed.

The one change from upstream: _gen_timing_signal's `.astype(np.float)` used
NumPy's now-removed `np.float` alias (removed in NumPy 1.24+; this project
pins numpy>=2). Changed to the builtin `float` below -- verified this is the
only NumPy-2 incompatibility in this file.
"""
from __future__ import absolute_import
from __future__ import division
from __future__ import print_function
import torch
import torch.nn as nn
import torch.nn.functional as F
import numpy as np
import math

def _gen_bias_mask(max_length):
    """
    Generates bias values (-Inf) to mask future timesteps during attention
    """
    np_mask = np.triu(np.full([max_length, max_length], -np.inf), 1)
    torch_mask = torch.from_numpy(np_mask).type(torch.FloatTensor)
    return torch_mask.unsqueeze(0).unsqueeze(1)

def _gen_timing_signal(length, channels, min_timescale=1.0, max_timescale=1.0e4):
    """
    Generates a [1, length, channels] timing signal consisting of sinusoids
    Adapted from:
    https://github.com/tensorflow/tensor2tensor/blob/master/tensor2tensor/layers/common_attention.py
    """
    position = np.arange(length)
    num_timescales = channels // 2
    log_timescale_increment = (
            math.log(float(max_timescale) / float(min_timescale)) /
            (float(num_timescales) - 1))
    inv_timescales = min_timescale * np.exp(
        np.arange(num_timescales).astype(float) * -log_timescale_increment)
    scaled_time = np.expand_dims(position, 1) * np.expand_dims(inv_timescales, 0)

    signal = np.concatenate([np.sin(scaled_time), np.cos(scaled_time)], axis=1)
    signal = np.pad(signal, [[0, 0], [0, channels % 2]],
                    'constant', constant_values=[0.0, 0.0])
    signal = signal.reshape([1, length, channels])

    return torch.from_numpy(signal).type(torch.FloatTensor)

class LayerNorm(nn.Module):
    def __init__(self, features, eps=1e-6):
        super(LayerNorm, self).__init__()
        self.gamma = nn.Parameter(torch.ones(features))
        self.beta = nn.Parameter(torch.zeros(features))
        self.eps = eps

    def forward(self, x):
        mean = x.mean(-1, keepdim=True)
        std = x.std(-1, keepdim=True)
        return self.gamma * (x - mean) / (std + self.eps) + self.beta

class OutputLayer(nn.Module):
    def __init__(self, hidden_size, output_size, probs_out=False):
        super(OutputLayer, self).__init__()
        self.output_size = output_size
        self.output_projection = nn.Linear(hidden_size, output_size)
        self.probs_out = probs_out
        self.lstm = nn.LSTM(input_size=hidden_size, hidden_size=int(hidden_size/2), batch_first=True, bidirectional=True)
        self.hidden_size = hidden_size

    def loss(self, hidden, labels):
        raise NotImplementedError('Must implement {}.loss'.format(self.__class__.__name__))

class SoftmaxOutputLayer(OutputLayer):
    def forward(self, hidden):
        logits = self.output_projection(hidden)
        probs = F.softmax(logits, -1)
        topk, indices = torch.topk(probs, 2)
        predictions = indices[:,:,0]
        second = indices[:,:,1]
        if self.probs_out is True:
            return logits
        return predictions, second

    def loss(self, hidden, labels):
        logits = self.output_projection(hidden)
        log_probs = F.log_softmax(logits, -1)
        return F.nll_loss(log_probs.view(-1, self.output_size), labels.view(-1))

class MultiHeadAttention(nn.Module):
    def __init__(self, input_depth, total_key_depth, total_value_depth, output_depth,
                 num_heads, bias_mask=None, dropout=0.0, attention_map=False):
        super(MultiHeadAttention, self).__init__()
        if total_key_depth % num_heads != 0:
            raise ValueError("Key depth (%d) must be divisible by the number of "
                             "attention heads (%d)." % (total_key_depth, num_heads))
        if total_value_depth % num_heads != 0:
            raise ValueError("Value depth (%d) must be divisible by the number of "
                             "attention heads (%d)." % (total_value_depth, num_heads))
        self.attention_map = attention_map
        self.num_heads = num_heads
        self.query_scale = (total_key_depth // num_heads) ** -0.5
        self.bias_mask = bias_mask
        self.query_linear = nn.Linear(input_depth, total_key_depth, bias=False)
        self.key_linear = nn.Linear(input_depth, total_key_depth, bias=False)
        self.value_linear = nn.Linear(input_depth, total_value_depth, bias=False)
        self.output_linear = nn.Linear(total_value_depth, output_depth, bias=False)
        self.dropout = nn.Dropout(dropout)

    def _split_heads(self, x):
        if len(x.shape) != 3:
            raise ValueError("x must have rank 3")
        shape = x.shape
        return x.view(shape[0], shape[1], self.num_heads, shape[2] // self.num_heads).permute(0, 2, 1, 3)

    def _merge_heads(self, x):
        if len(x.shape) != 4:
            raise ValueError("x must have rank 4")
        shape = x.shape
        return x.permute(0, 2, 1, 3).contiguous().view(shape[0], shape[2], shape[3] * self.num_heads)

    def forward(self, queries, keys, values):
        queries = self.query_linear(queries)
        keys = self.key_linear(keys)
        values = self.value_linear(values)
        queries = self._split_heads(queries)
        keys = self._split_heads(keys)
        values = self._split_heads(values)
        queries *= self.query_scale
        logits = torch.matmul(queries, keys.permute(0, 1, 3, 2))
        if self.bias_mask is not None:
            logits += self.bias_mask[:, :, :logits.shape[-2], :logits.shape[-1]].type_as(logits.data)
        weights = nn.functional.softmax(logits, dim=-1)
        weights = self.dropout(weights)
        contexts = torch.matmul(weights, values)
        contexts = self._merge_heads(contexts)
        outputs = self.output_linear(contexts)
        if self.attention_map is True:
            return outputs, weights
        return outputs

class Conv(nn.Module):
    def __init__(self, input_size, output_size, kernel_size, pad_type):
        super(Conv, self).__init__()
        padding = (kernel_size - 1, 0) if pad_type == 'left' else (kernel_size // 2, (kernel_size - 1) // 2)
        self.pad = nn.ConstantPad1d(padding, 0)
        self.conv = nn.Conv1d(input_size, output_size, kernel_size=kernel_size, padding=0)

    def forward(self, inputs):
        inputs = self.pad(inputs.permute(0, 2, 1))
        outputs = self.conv(inputs).permute(0, 2, 1)
        return outputs

class PositionwiseFeedForward(nn.Module):
    def __init__(self, input_depth, filter_size, output_depth, layer_config='ll', padding='left', dropout=0.0):
        super(PositionwiseFeedForward, self).__init__()
        layers = []
        sizes = ([(input_depth, filter_size)] +
                 [(filter_size, filter_size)] * (len(layer_config) - 2) +
                 [(filter_size, output_depth)])
        for lc, s in zip(list(layer_config), sizes):
            if lc == 'l':
                layers.append(nn.Linear(*s))
            elif lc == 'c':
                layers.append(Conv(*s, kernel_size=3, pad_type=padding))
            else:
                raise ValueError("Unknown layer type {}".format(lc))
        self.layers = nn.ModuleList(layers)
        self.relu = nn.ReLU()
        self.dropout = nn.Dropout(dropout)

    def forward(self, inputs):
        x = inputs
        for i, layer in enumerate(self.layers):
            x = layer(x)
            if i < len(self.layers):
                x = self.relu(x)
                x = self.dropout(x)
        return x
```

- [ ] **Step 3: Vendor `btc_model.py`, adjusted for a plain-module import (no wildcard)**

Fetch `https://raw.githubusercontent.com/jayg996/BTC-ISMIR19/<btc-sha>/btc_model.py` and
save as `.../chords/btc_model.py`. Upstream imports its sibling module with `from
utils.transformer_modules import *`; replace that with an explicit import from the
vendored module in this package, and drop the `if __name__ == "__main__":` smoke block
(upstream's own manual test, not ours):

```python
"""Vendored from jayg996/BTC-ISMIR19 (MIT License), commit <btc-sha>,
btc_model.py -- see the phase-5 plan's "Why a vendored BTC" section.
"""
import torch
import torch.nn as nn

from .transformer_modules import LayerNorm, MultiHeadAttention, PositionwiseFeedForward, SoftmaxOutputLayer
from .transformer_modules import _gen_timing_signal, _gen_bias_mask

class self_attention_block(nn.Module):
    def __init__(self, hidden_size, total_key_depth, total_value_depth, filter_size, num_heads,
                 bias_mask=None, layer_dropout=0.0, attention_dropout=0.0, relu_dropout=0.0, attention_map=False):
        super(self_attention_block, self).__init__()
        self.attention_map = attention_map
        self.multi_head_attention = MultiHeadAttention(hidden_size, total_key_depth, total_value_depth,hidden_size, num_heads, bias_mask, attention_dropout, attention_map)
        self.positionwise_convolution = PositionwiseFeedForward(hidden_size, filter_size, hidden_size, layer_config='cc', padding='both', dropout=relu_dropout)
        self.dropout = nn.Dropout(layer_dropout)
        self.layer_norm_mha = LayerNorm(hidden_size)
        self.layer_norm_ffn = LayerNorm(hidden_size)

    def forward(self, inputs):
        x = inputs
        x_norm = self.layer_norm_mha(x)
        if self.attention_map is True:
            y, weights = self.multi_head_attention(x_norm, x_norm, x_norm)
        else:
            y = self.multi_head_attention(x_norm, x_norm, x_norm)
        x = self.dropout(x + y)
        x_norm = self.layer_norm_ffn(x)
        y = self.positionwise_convolution(x_norm)
        y = self.dropout(x + y)
        if self.attention_map is True:
            return y, weights
        return y

class bi_directional_self_attention(nn.Module):
    def __init__(self, hidden_size, total_key_depth, total_value_depth, filter_size, num_heads, max_length,
                 layer_dropout=0.0, attention_dropout=0.0, relu_dropout=0.0):
        super(bi_directional_self_attention, self).__init__()
        self.weights_list = list()
        params = (hidden_size, total_key_depth or hidden_size, total_value_depth or hidden_size,
                  filter_size, num_heads, _gen_bias_mask(max_length),
                  layer_dropout, attention_dropout, relu_dropout, True)
        self.attn_block = self_attention_block(*params)
        params = (hidden_size, total_key_depth or hidden_size, total_value_depth or hidden_size,
                  filter_size, num_heads, torch.transpose(_gen_bias_mask(max_length), dim0=2, dim1=3),
                  layer_dropout, attention_dropout, relu_dropout, True)
        self.backward_attn_block = self_attention_block(*params)
        self.linear = nn.Linear(hidden_size*2, hidden_size)

    def forward(self, inputs):
        x, list_ = inputs
        encoder_outputs, weights = self.attn_block(x)
        reverse_outputs, reverse_weights = self.backward_attn_block(x)
        outputs = torch.cat((encoder_outputs, reverse_outputs), dim=2)
        y = self.linear(outputs)
        self.weights_list = list_
        self.weights_list.append(weights)
        self.weights_list.append(reverse_weights)
        return y, self.weights_list

class bi_directional_self_attention_layers(nn.Module):
    def __init__(self, embedding_size, hidden_size, num_layers, num_heads, total_key_depth, total_value_depth,
                 filter_size, max_length=100, input_dropout=0.0, layer_dropout=0.0,
                 attention_dropout=0.0, relu_dropout=0.0):
        super(bi_directional_self_attention_layers, self).__init__()
        self.timing_signal = _gen_timing_signal(max_length, hidden_size)
        params = (hidden_size, total_key_depth or hidden_size, total_value_depth or hidden_size,
                  filter_size, num_heads, max_length, layer_dropout, attention_dropout, relu_dropout)
        self.embedding_proj = nn.Linear(embedding_size, hidden_size, bias=False)
        self.self_attn_layers = nn.Sequential(*[bi_directional_self_attention(*params) for _ in range(num_layers)])
        self.layer_norm = LayerNorm(hidden_size)
        self.input_dropout = nn.Dropout(input_dropout)

    def forward(self, inputs):
        x = self.input_dropout(inputs)
        x = self.embedding_proj(x)
        x += self.timing_signal[:, :inputs.shape[1], :].type_as(inputs.data)
        y, weights_list = self.self_attn_layers((x, []))
        y = self.layer_norm(y)
        return y, weights_list

class BTC_model(nn.Module):
    def __init__(self, config):
        super(BTC_model, self).__init__()
        self.timestep = config['timestep']
        self.probs_out = config['probs_out']
        params = (config['feature_size'], config['hidden_size'], config['num_layers'], config['num_heads'],
                  config['total_key_depth'], config['total_value_depth'], config['filter_size'], config['timestep'],
                  config['input_dropout'], config['layer_dropout'], config['attention_dropout'], config['relu_dropout'])
        self.self_attn_layers = bi_directional_self_attention_layers(*params)
        self.output_layer = SoftmaxOutputLayer(hidden_size=config['hidden_size'], output_size=config['num_chords'], probs_out=config['probs_out'])

    def forward(self, x, labels):
        labels = labels.view(-1, self.timestep)
        self_attn_output, weights_list = self.self_attn_layers(x)
        if self.probs_out is True:
            logits = self.output_layer(self_attn_output)
            return logits
        prediction, second = self.output_layer(self_attn_output)
        prediction = prediction.view(-1)
        second = second.view(-1)
        loss = self.output_layer.loss(self_attn_output, labels)
        return prediction, loss, weights_list, second
```

- [ ] **Step 4: Write the checkpoint downloader**

```python
# packages/stemcraft_worker/src/stemcraft_worker/analysis/chords/weights.py
"""Downloads BTC's large-vocabulary checkpoint once and caches it under the
data directory -- the same "one-time download, then cached on disk" pattern
§7 already accepts for model weights generally. Unlike autochord's rejected
gdown+Google-Drive approach, this fetches directly from the source repo,
pinned to one commit, over a plain HTTPS GET.
"""

from __future__ import annotations

import logging
import urllib.request
from pathlib import Path

from stemcraft_lib.atomic import atomic_output

log = logging.getLogger("stemcraft.worker.chords")

# <btc-sha>: pin this to the commit resolved in Task 5 Step 1.
_CHECKPOINT_URL = (
    "https://raw.githubusercontent.com/jayg996/BTC-ISMIR19/<btc-sha>/"
    "test/btc_model_large_voca.pt"
)
_CHECKPOINT_NAME = "btc_model_large_voca.pt"
_EXPECTED_MIN_BYTES = 10_000_000  # real file is ~12.2 MB; catches a truncated/HTML-error download


def checkpoint_path(cache_dir: Path) -> Path:
    dest = cache_dir / _CHECKPOINT_NAME
    if dest.is_file():
        return dest
    cache_dir.mkdir(parents=True, exist_ok=True)
    log.info("downloading BTC chord-recognition checkpoint (~12 MB, one-time) to %s", dest)
    with atomic_output(dest) as tmp:
        urllib.request.urlretrieve(_CHECKPOINT_URL, tmp)
        size = tmp.stat().st_size
        if size < _EXPECTED_MIN_BYTES:
            raise RuntimeError(
                f"downloaded checkpoint is only {size} bytes (expected >= "
                f"{_EXPECTED_MIN_BYTES}); the source URL likely returned an error page"
            )
    return dest
```

- [ ] **Step 5: Write the failing test for frame-level recognition**

```python
# packages/stemcraft_worker/tests/analysis/test_chords_recognize.py
import subprocess

from stemcraft_worker.analysis.chords.recognize import recognize_frames

SAMPLE_RATE = 48000


def test_recognize_frames_covers_the_whole_file(tmp_path):
    wav = tmp_path / "chord.wav"
    # A sustained G minor triad for 6 seconds -- longer than BTC's one 10s chunk
    # boundary isn't required to exercise this, just enough real audio to get a
    # non-trivial, stable prediction.
    subprocess.run(
        ["ffmpeg", "-hide_banner", "-nostdin", "-y",
         "-f", "lavfi", "-i", "sine=frequency=196.00:duration=6",
         "-f", "lavfi", "-i", "sine=frequency=233.08:duration=6",
         "-f", "lavfi", "-i", "sine=frequency=293.66:duration=6",
         "-filter_complex", "amix=inputs=3:duration=longest",
         "-ar", str(SAMPLE_RATE), "-ac", "1", str(wav)],
        check=True, capture_output=True,
    )

    segments = recognize_frames(wav)

    assert len(segments) >= 1
    starts = [s for s, _, _ in segments]
    ends = [e for _, e, _ in segments]
    assert starts[0] == 0.0
    assert ends == sorted(ends)
    assert all(isinstance(label, str) and label for _, _, label in segments)
    # Contiguous: each segment's end is the next one's start.
    for (_, end, _), (next_start, _, _) in zip(segments, segments[1:]):
        assert abs(end - next_start) < 1e-6
```

- [ ] **Step 6: Run test to verify it fails**

Run: `uv run pytest packages/stemcraft_worker/tests/analysis/test_chords_recognize.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named
'stemcraft_worker.analysis.chords.recognize'`

- [ ] **Step 7: Write `recognize.py`**

```python
# packages/stemcraft_worker/src/stemcraft_worker/analysis/chords/__init__.py
```
(empty — makes `chords` a package)

```python
# packages/stemcraft_worker/src/stemcraft_worker/analysis/chords/recognize.py
"""Frame-level chord recognition: BTC's CQT feature extraction (adapted from
utils/mir_eval_modules.py's audio_file_to_features, MIT-licensed, same source
as btc_model.py) feeds the vendored BTC_model; this module turns its
frame-by-frame class predictions into a compact list of (start, end, label)
segments covering the whole file. Bar alignment happens separately, in
align.py, so this stays testable without a beat grid at all.
"""

from __future__ import annotations

from pathlib import Path

import librosa
import numpy as np
import torch

from stemcraft_lib.config import settings

from .btc_model import BTC_model
from .weights import checkpoint_path

# Hyperparameters and preprocessing constants, transcribed from BTC-ISMIR19's
# run_config.yaml (large-vocabulary settings: num_chords=170, not the
# commented-out majmin-only 25). Hardcoded rather than loaded from YAML at
# runtime -- these are fixed by the pretrained checkpoint's architecture, and
# upstream's own HParams.load(path) calls a bare `yaml.load(f)` with no
# Loader argument, which is worth avoiding rather than reproducing.
_MP3_CONFIG = {"song_hz": 22050, "inst_len": 10.0}
_FEATURE_CONFIG = {"n_bins": 144, "bins_per_octave": 24, "hop_length": 2048}
_MODEL_CONFIG = {
    "feature_size": 144, "timestep": 108, "num_chords": 170,
    "input_dropout": 0.2, "layer_dropout": 0.2, "attention_dropout": 0.2,
    "relu_dropout": 0.2, "num_layers": 8, "num_heads": 4, "hidden_size": 128,
    "total_key_depth": 128, "total_value_depth": 128, "filter_size": 128,
    "loss": "ce", "probs_out": False,
}

_ROOTS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
_QUALITIES = [
    "min", "maj", "dim", "aug", "min6", "maj6", "min7", "minmaj7", "maj7", "7",
    "dim7", "hdim7", "sus2", "sus4",
]


def _idx2voca_chord() -> dict[int, str]:
    # Ported from utils/mir_eval_modules.py's idx2voca_chord().
    mapping: dict[int, str] = {169: "N", 168: "X"}
    for i in range(168):
        root = _ROOTS[i // 14]
        quality = _QUALITIES[i % 14]
        mapping[i] = root if i % 14 == 1 else f"{root}:{quality}"
    return mapping


_IDX2VOCA = _idx2voca_chord()


def _audio_file_to_features(audio_file: Path) -> tuple[np.ndarray, float]:
    # Ported from utils/mir_eval_modules.py's audio_file_to_features(), minus
    # the song_length_second return value this module doesn't need.
    song_hz = _MP3_CONFIG["song_hz"]
    inst_len = _MP3_CONFIG["inst_len"]
    original_wav, sr = librosa.load(str(audio_file), sr=song_hz, mono=True)

    chunks = []
    cursor = 0
    chunk_frames = int(song_hz * inst_len)
    while len(original_wav) > cursor + chunk_frames:
        chunk = original_wav[cursor : cursor + chunk_frames]
        chunks.append(
            librosa.cqt(chunk, sr=sr, n_bins=_FEATURE_CONFIG["n_bins"],
                        bins_per_octave=_FEATURE_CONFIG["bins_per_octave"],
                        hop_length=_FEATURE_CONFIG["hop_length"])
        )
        cursor += chunk_frames
    chunks.append(
        librosa.cqt(original_wav[cursor:], sr=sr, n_bins=_FEATURE_CONFIG["n_bins"],
                    bins_per_octave=_FEATURE_CONFIG["bins_per_octave"],
                    hop_length=_FEATURE_CONFIG["hop_length"])
    )
    feature = np.concatenate(chunks, axis=1)
    feature = np.log(np.abs(feature) + 1e-6)
    feature_per_second = inst_len / _MODEL_CONFIG["timestep"]
    return feature, feature_per_second


def recognize_frames(audio_wav: Path) -> list[tuple[float, float, str]]:
    device = torch.device("cpu")
    cache_dir = settings().data_dir / "models" / "btc"
    ckpt = torch.load(checkpoint_path(cache_dir), map_location=device, weights_only=False)

    model = BTC_model(config=_MODEL_CONFIG).to(device)
    model.load_state_dict(ckpt["model"])
    model.eval()
    mean, std = ckpt["mean"], ckpt["std"]

    feature, feature_per_second = _audio_file_to_features(audio_wav)
    feature = feature.T
    feature = (feature - mean) / std

    n_timestep = _MODEL_CONFIG["timestep"]
    num_pad = n_timestep - (feature.shape[0] % n_timestep)
    feature = np.pad(feature, ((0, num_pad), (0, 0)), mode="constant", constant_values=0)
    num_instance = feature.shape[0] // n_timestep

    segments: list[tuple[float, float, str]] = []
    start_time = 0.0
    prev_chord: int | None = None
    with torch.no_grad():
        feature_t = torch.tensor(feature, dtype=torch.float32).unsqueeze(0).to(device)
        for t in range(num_instance):
            window = feature_t[:, n_timestep * t : n_timestep * (t + 1), :]
            self_attn_output, _ = model.self_attn_layers(window)
            prediction, _ = model.output_layer(self_attn_output)
            prediction = prediction.squeeze()
            for i in range(n_timestep):
                idx = int(prediction[i].item())
                if prev_chord is None:
                    prev_chord = idx
                    continue
                if idx != prev_chord:
                    global_i = n_timestep * t + i
                    end_time = feature_per_second * global_i
                    segments.append((start_time, end_time, _IDX2VOCA[prev_chord]))
                    start_time = end_time
                    prev_chord = idx

    total_frames = num_instance * n_timestep - num_pad
    end_time = feature_per_second * total_frames
    segments.append((start_time, end_time, _IDX2VOCA[prev_chord]))
    return segments
```

- [ ] **Step 8: Run test to verify it passes**

Run: `uv run pytest packages/stemcraft_worker/tests/analysis/test_chords_recognize.py -v`
Expected: PASS. First run downloads the checkpoint (~12 MB) into
`data/models/btc/btc_model_large_voca.pt`. If it fails with a
`RuntimeError` about state-dict key mismatches, the vendored `BTC_model` diverges from
what `<btc-sha>`'s checkpoint expects — re-diff `btc_model.py`/`transformer_modules.py`
against the fetched originals; nothing beyond the `import` line and the `np.float` fix
in Step 2/3 should differ.

- [ ] **Step 9: Commit**

```bash
git add packages/stemcraft_worker/src/stemcraft_worker/analysis/chords/ \
        packages/stemcraft_worker/tests/analysis/test_chords_recognize.py
git commit -m "feat(worker): vendor BTC, frame-level chord recognition (Task 5)"
```

---

### Task 6: Bar alignment — frame chords to `ChordSegment`s

**Files:**
- Create: `packages/stemcraft_worker/src/stemcraft_worker/analysis/chords/align.py`
- Test: `packages/stemcraft_worker/tests/analysis/test_chords_align.py`

**Interfaces:**
- Consumes: `stemcraft_lib.analysis.ChordSegment`; the `(start_sec, end_sec, label)`
  triples Task 5's `recognize_frames` produces.
- Produces: `align_to_bars(frame_chords: list[tuple[float, float, str]], downbeats:
  list[int], total_samples: int, *, sample_rate: int) -> list[ChordSegment]`.

- [ ] **Step 1: Write the failing test**

```python
# packages/stemcraft_worker/tests/analysis/test_chords_align.py
import pytest
from stemcraft_worker.analysis.chords.align import align_to_bars

SR = 48000


def test_one_chord_per_bar_by_majority_overlap():
    # Two one-second bars at 48kHz: [0, 48000) and [48000, 96000).
    downbeats = [0, 48000]
    total_samples = 96000
    # Bar 0 is mostly G:maj (0.0-0.9s) with a brief C:maj tail (0.9-1.0s).
    # Bar 1 is entirely D:maj.
    frame_chords = [(0.0, 0.9, "G:maj"), (0.9, 1.0, "C:maj"), (1.0, 2.0, "D:maj")]

    bars = align_to_bars(frame_chords, downbeats, total_samples, sample_rate=SR)

    assert len(bars) == 2
    assert bars[0].bar == 0 and bars[0].chord == "G:maj"
    assert bars[0].start_sample == 0 and bars[0].end_sample == 48000
    assert bars[1].bar == 1 and bars[1].chord == "D:maj"
    assert bars[1].start_sample == 48000 and bars[1].end_sample == 96000


def test_final_bar_extends_to_total_samples():
    downbeats = [0]
    frame_chords = [(0.0, 2.0, "A:min")]
    bars = align_to_bars(frame_chords, downbeats, total_samples=96000, sample_rate=SR)
    assert len(bars) == 1
    assert bars[0].start_sample == 0
    assert bars[0].end_sample == 96000


def test_no_downbeats_raises():
    with pytest.raises(ValueError):
        align_to_bars([(0.0, 1.0, "N")], [], total_samples=48000, sample_rate=SR)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest packages/stemcraft_worker/tests/analysis/test_chords_align.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named
'stemcraft_worker.analysis.chords.align'`

- [ ] **Step 3: Write the implementation**

```python
# packages/stemcraft_worker/src/stemcraft_worker/analysis/chords/align.py
"""Bar-aligns BTC's frame-level chord segments to the beat grid's downbeats:
one chord label per bar, chosen by which label covers the most sample-time
within that bar. Pure and model-free -- testable with synthetic frame_chords
and no checkpoint on disk, which is why it is a separate module from
recognize.py.

Bar 0 starts at the first downbeat, not at sample 0: any lead-in audio before
the first detected beat isn't part of any bar, the same convention a DAW or a
chord chart uses (bar 1 begins on beat 1).
"""

from __future__ import annotations

from stemcraft_lib.analysis import ChordSegment


def align_to_bars(
    frame_chords: list[tuple[float, float, str]],
    downbeats: list[int],
    total_samples: int,
    *,
    sample_rate: int,
) -> list[ChordSegment]:
    if not downbeats:
        raise ValueError("cannot align chords to bars with no downbeats")

    bar_bounds = [*downbeats, total_samples]
    frame_bounds = [
        (round(start * sample_rate), round(end * sample_rate), chord)
        for start, end, chord in frame_chords
    ]

    segments: list[ChordSegment] = []
    for bar_idx in range(len(bar_bounds) - 1):
        bar_start, bar_end = bar_bounds[bar_idx], bar_bounds[bar_idx + 1]
        if bar_end <= bar_start:
            continue
        overlap: dict[str, int] = {}
        for f_start, f_end, chord in frame_bounds:
            lo, hi = max(f_start, bar_start), min(f_end, bar_end)
            if hi > lo:
                overlap[chord] = overlap.get(chord, 0) + (hi - lo)
        if not overlap:
            continue
        winner = max(overlap, key=overlap.get)
        segments.append(
            ChordSegment(bar=bar_idx, start_sample=bar_start, end_sample=bar_end, chord=winner)
        )
    return segments
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest packages/stemcraft_worker/tests/analysis/test_chords_align.py -v`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/stemcraft_worker/src/stemcraft_worker/analysis/chords/align.py \
        packages/stemcraft_worker/tests/analysis/test_chords_align.py
git commit -m "feat(worker): bar-align frame-level chords to the beat grid (Task 6)"
```

---

### Task 7: The `analyze` job kind

**Files:**
- Create: `packages/stemcraft_worker/src/stemcraft_worker/kinds/analyze_song.py`
- Modify: `packages/stemcraft_worker/src/stemcraft_worker/kinds/__init__.py`
- Modify: `packages/stemcraft_worker/src/stemcraft_worker/kinds/separate_song.py`
- Test: `packages/stemcraft_worker/tests/test_analyze_song.py`
- Test: modify `packages/stemcraft_worker/tests/test_separate_song.py`

**Interfaces:**
- Consumes: `stemcraft_worker.analysis.key.detect_key`,
  `stemcraft_worker.analysis.beats.detect_beats`,
  `stemcraft_worker.analysis.chords.recognize.recognize_frames`,
  `stemcraft_worker.analysis.chords.align.align_to_bars`,
  `stemcraft_lib.analysis.{Analysis,BeatGrid,write_analysis}`,
  `stemcraft_lib.song.{STEM_NAMES,derive_files,find_song_dir,read_song}`.
- Produces: registers `"analyze"` in the job registry; `separate_song.py` enqueues it on
  success, same as `import_song.py` already enqueues `separate`.

- [ ] **Step 1: Write the failing test**

```python
# packages/stemcraft_worker/tests/test_analyze_song.py
import shutil
import subprocess

import pytest
import stemcraft_worker.kinds.analyze_song  # noqa: F401  (registers on import)
from stemcraft_lib.analysis import read_analysis
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


@pytest.fixture
def data_dir(tmp_path, monkeypatch):
    # BTC's checkpoint cache lives under settings().data_dir/models/btc.
    d = tmp_path / "data"
    monkeypatch.setenv("STEMCRAFT_DATA_DIR", str(d))
    return d


def _click_and_chord_wav(path, *, bpm=120, seconds=12, sample_rate=SAMPLE_RATE):
    interval = 60.0 / bpm
    subprocess.run(
        ["ffmpeg", "-hide_banner", "-nostdin", "-y",
         "-f", "lavfi", "-i", f"aevalsrc=0.5*sin(2*PI*1000*t)*lt(mod(t\\,{interval})\\,0.03):d={seconds}",
         "-f", "lavfi", "-i", f"sine=frequency=196.00:duration={seconds}",
         "-f", "lavfi", "-i", f"sine=frequency=233.08:duration={seconds}",
         "-f", "lavfi", "-i", f"sine=frequency=293.66:duration={seconds}",
         "-filter_complex", "amix=inputs=4:duration=longest",
         "-ar", str(sample_rate), "-ac", "2", "-c:a", "pcm_s16le", str(path)],
        check=True, capture_output=True,
    )


def _mono_sine_wav(path, freqs, *, seconds=12, sample_rate=SAMPLE_RATE):
    inputs = []
    for f in freqs:
        inputs += ["-f", "lavfi", "-i", f"sine=frequency={f}:duration={seconds}"]
    subprocess.run(
        ["ffmpeg", "-hide_banner", "-nostdin", "-y", *inputs,
         "-filter_complex", f"amix=inputs={len(freqs)}:duration=longest",
         "-ar", str(sample_rate), "-ac", "2", "-c:a", "pcm_s16le", str(path)],
        check=True, capture_output=True,
    )


def _make_analyzable_song(songs_dir):
    song = new_song(title="T", artist="A", source_kind="upload", source_value="original.mp3")
    song_dir = create_song_dir(songs_dir, song)
    _click_and_chord_wav(song_dir / "audio.wav")
    stems_dir = song_dir / "stems"
    stems_dir.mkdir()
    _mono_sine_wav(stems_dir / "bass.wav", [196.00])
    _mono_sine_wav(stems_dir / "other.wav", [233.08, 293.66])
    for name in STEM_NAMES:
        if name in ("bass", "other"):
            continue
        _mono_sine_wav(stems_dir / f"{name}.wav", [440.0], seconds=1)
    for name in STEM_NAMES:
        (stems_dir / f"{name}.opus").write_bytes(b"")  # has_stems only checks presence
    return song, song_dir


def test_analyze_writes_analysis_json(conn, songs_dir, data_dir):
    song, song_dir = _make_analyzable_song(songs_dir)

    job_id = enqueue(conn, kind="analyze", song_id=song.id, payload={"song_id": song.id})
    assert run_one(conn, device="cpu") == job_id

    done = get_job(conn, job_id)
    assert done.state == "done", done.error
    analysis = read_analysis(song_dir)
    assert len(analysis.key_candidates) == 3
    assert analysis.beat_grid.bpm > 0
    assert len(analysis.beat_grid.beats) > 0
    assert len(analysis.chords) > 0


def test_analyze_without_stems_fails_loudly(conn, songs_dir, data_dir):
    song = new_song(title="T", artist="A", source_kind="upload", source_value="original.mp3")
    song_dir = create_song_dir(songs_dir, song)
    _click_and_chord_wav(song_dir / "audio.wav")
    # stems/ deliberately never written.

    job_id = enqueue(conn, kind="analyze", song_id=song.id, payload={"song_id": song.id})
    run_one(conn, device="cpu")

    failed = get_job(conn, job_id)
    assert failed.state == "failed"
    assert song.id in failed.error


def test_rerunning_analyze_is_idempotent(conn, songs_dir, data_dir):
    song, song_dir = _make_analyzable_song(songs_dir)

    enqueue(conn, kind="analyze", song_id=song.id, payload={"song_id": song.id})
    run_one(conn, device="cpu")
    first = (song_dir / "analysis.json").read_bytes()

    enqueue(conn, kind="analyze", song_id=song.id, payload={"song_id": song.id})
    run_one(conn, device="cpu")
    second = (song_dir / "analysis.json").read_bytes()

    assert first == second
```

Also append to `packages/stemcraft_worker/tests/test_separate_song.py` (chain-enqueue
coverage, mirroring how Phase 2/4 tested `import`→`separate`):

```python
def test_separate_chains_into_analyze(conn, songs_dir, worker_state):
    song, _ = _make_song(songs_dir)

    job_id = enqueue(conn, kind="separate", song_id=song.id, payload={"song_id": song.id})
    run_one(conn, device="cpu", worker_state=worker_state)

    assert get_job(conn, job_id).state == "done"
    jobs = jobs_db.list_jobs(conn)
    analyze_jobs = [j for j in jobs if j.kind == "analyze"]
    assert len(analyze_jobs) == 1
    assert analyze_jobs[0].song_id == song.id
```

(This test file already imports `jobs_db` and `enqueue`/`get_job`/`run_one` — no new
imports needed beyond what Task 4's separate_song tests already have.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest packages/stemcraft_worker/tests/test_analyze_song.py packages/stemcraft_worker/tests/test_separate_song.py -k "analyze" -v`
Expected: FAIL — `test_analyze_song.py` with `ModuleNotFoundError`; the new
`test_separate_chains_into_analyze` with `assert len(analyze_jobs) == 1` failing (0
found), since `separate_song.py` doesn't enqueue `analyze` yet.

- [ ] **Step 3: Write the `analyze` job kind**

```python
# packages/stemcraft_worker/src/stemcraft_worker/kinds/analyze_song.py
"""The `analyze` job kind: key candidates (essentia + Krumhansl-Kessler),
beat grid (beat_this) and a bar-aligned chord chart (vendored BTC) from a
separated Song's audio.wav and stems/*.wav.

Unlike `separate`, none of this phase's models are cached in WorkerState
(§7's own dependency table scopes an analysis failure to the job, not to
worker boot, unlike ffmpeg/PyTorch) -- each helper below lazy-loads its own
model per call. Idempotent by re-derivation (§6): audio.wav and stems/*.wav
never change once written, and every step here is deterministic (models run
in eval mode; essentia's HPCP/correlation math has no randomness at all), so
a retry after a lease reclaim reproduces byte-identical output.
"""

from __future__ import annotations

import wave

from stemcraft_lib.analysis import Analysis, BeatGrid, write_analysis
from stemcraft_lib.config import SAMPLE_RATE, settings
from stemcraft_lib.song import STEM_NAMES, derive_files, find_song_dir, read_song

from ..analysis.beats import detect_beats
from ..analysis.chords.align import align_to_bars
from ..analysis.chords.recognize import recognize_frames
from ..analysis.key import detect_key
from ..registry import JobCancelled, JobContext, register


def run(ctx: JobContext) -> dict:
    song_id = ctx.payload["song_id"]
    song_dir = find_song_dir(settings().songs_dir, song_id)
    if song_dir is None:
        raise RuntimeError(f"no song directory for song_id={song_id!r}")
    read_song(song_dir)  # fail loudly if song.json itself is unreadable

    audio_wav = song_dir / "audio.wav"
    if not audio_wav.is_file():
        raise RuntimeError(f"song {song_id} has no audio.wav to analyze")
    if not derive_files(song_dir).has_stems:
        raise RuntimeError(f"song {song_id} has no separated stems to analyze")

    key_candidates = detect_key(
        [song_dir / "stems" / "bass.wav", song_dir / "stems" / "other.wav"],
        sample_rate=SAMPLE_RATE,
    )
    ctx.progress(0.3)
    if ctx.cancelled():
        raise JobCancelled

    raw_grid = detect_beats(audio_wav, sample_rate=SAMPLE_RATE)
    ctx.progress(0.6)
    if ctx.cancelled():
        raise JobCancelled

    frame_chords = recognize_frames(audio_wav)
    total_samples = _wav_sample_count(audio_wav)
    chords = align_to_bars(frame_chords, raw_grid.downbeats, total_samples, sample_rate=SAMPLE_RATE)
    ctx.progress(0.95)

    analysis = Analysis(
        key_candidates=key_candidates,
        beat_grid=BeatGrid(bpm=raw_grid.bpm, beats=raw_grid.beats, downbeats=raw_grid.downbeats),
        chords=chords,
    )
    write_analysis(song_dir, analysis)
    ctx.progress(1.0)

    top = key_candidates[0]
    return {"bpm": raw_grid.bpm, "top_key": f"{top.tonic} {top.mode}", "bar_count": len(chords)}


def _wav_sample_count(path) -> int:
    with wave.open(str(path), "rb") as wav_file:
        return wav_file.getnframes()


register("analyze", run)
```

- [ ] **Step 4: Register the kind and chain it from `separate`**

Edit `packages/stemcraft_worker/src/stemcraft_worker/kinds/__init__.py`:

```python
"""Importing this package registers every built-in job kind."""

from . import analyze_song, import_song, probe, separate_song  # noqa: F401
```

Edit `packages/stemcraft_worker/src/stemcraft_worker/kinds/separate_song.py` — add the
import and the chain-enqueue, mirroring `import_song.py`'s `jobs_db.enqueue(..., kind="separate", ...)`:

```python
from stemcraft_lib import jobs as jobs_db  # add to existing imports
```

```python
    ctx.progress(1.0)
    jobs_db.enqueue(ctx.conn, kind="analyze", song_id=song_id, payload={"song_id": song_id})
    return {"near_silent": near_silent}
```

(This replaces the existing `ctx.progress(1.0)` / `return {"near_silent": near_silent}`
pair at the end of `run()` — `song_id` is already a local variable from the top of the
function, no new lookup needed.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `uv run pytest packages/stemcraft_worker/tests/test_analyze_song.py packages/stemcraft_worker/tests/test_separate_song.py -v`
Expected: PASS. `test_analyze_writes_analysis_json` and its siblings will be the slowest
tests in the suite so far (real beat_this `final0` + BTC inference on ~12s of audio) —
that's expected and acceptable per N-02's "seconds" budget, not a bug.

- [ ] **Step 6: Commit**

```bash
git add packages/stemcraft_worker/src/stemcraft_worker/kinds/analyze_song.py \
        packages/stemcraft_worker/src/stemcraft_worker/kinds/__init__.py \
        packages/stemcraft_worker/src/stemcraft_worker/kinds/separate_song.py \
        packages/stemcraft_worker/tests/test_analyze_song.py \
        packages/stemcraft_worker/tests/test_separate_song.py
git commit -m "feat(worker): the analyze job kind, chained onto a successful separate (Task 7)"
```

---

### Task 8: API — `GET /api/songs/{id}/analysis`

**Files:**
- Modify: `packages/stemcraft_api/src/stemcraft_api/routes/songs.py`
- Test: `packages/stemcraft_api/tests/test_songs_analysis.py`

**Interfaces:**
- Consumes: `stemcraft_lib.analysis.read_analysis` (existing, Task 2).
- Produces: `GET /api/songs/{song_id}/analysis` → `Analysis` as JSON, or 404 before
  `analysis.json` exists.

- [ ] **Step 1: Write the failing test**

```python
# packages/stemcraft_api/tests/test_songs_analysis.py
# No shared conftest.py exists yet -- test_songs_import.py's `client` fixture
# is copied verbatim here rather than introducing shared fixture plumbing this
# phase doesn't otherwise need.
import pytest
from fastapi.testclient import TestClient
from stemcraft_api.app import create_app
from stemcraft_lib.analysis import Analysis, BeatGrid, ChordSegment, KeyCandidate, write_analysis
from stemcraft_lib.song import create_song_dir, new_song


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("STEMCRAFT_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("STEMCRAFT_SONGS_DIR", str(tmp_path / "songs"))
    monkeypatch.setenv("STEMCRAFT_DIST_DIR", str(tmp_path / "nodist"))
    monkeypatch.setenv("STEMCRAFT_SKIP_BOOT_CHECKS", "1")
    return TestClient(create_app())


def test_get_analysis_before_it_exists_is_404(client, tmp_path):
    song = new_song(title="T", artist="A", source_kind="upload", source_value="original.mp3")
    create_song_dir(tmp_path / "songs", song)

    resp = client.get(f"/api/songs/{song.id}/analysis")
    assert resp.status_code == 404


def test_get_analysis_returns_the_written_file(client, tmp_path):
    song = new_song(title="T", artist="A", source_kind="upload", source_value="original.mp3")
    song_dir = create_song_dir(tmp_path / "songs", song)
    write_analysis(
        song_dir,
        Analysis(
            key_candidates=[KeyCandidate(tonic="G", mode="minor", confidence=1.0)],
            beat_grid=BeatGrid(bpm=120.0, beats=[1920], downbeats=[1920]),
            chords=[ChordSegment(bar=0, start_sample=1920, end_sample=48000, chord="G:min")],
        ),
    )

    resp = client.get(f"/api/songs/{song.id}/analysis")
    assert resp.status_code == 200
    body = resp.json()
    assert body["key_candidates"][0]["tonic"] == "G"
    assert body["beat_grid"]["bpm"] == 120.0
    assert body["chords"][0]["chord"] == "G:min"
```

`STEMCRAFT_SONGS_DIR` is set to `tmp_path / "songs"` by the `client` fixture above, so
`create_song_dir` is called against that same path directly (`tmp_path / "songs"`) rather
than through a `settings()` call the test would otherwise need to import — matching
exactly how `test_songs_import.py`'s own tests locate their song directories.

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest packages/stemcraft_api/tests/test_songs_analysis.py -v`
Expected: FAIL with a 404 on both (the route doesn't exist yet) or a routing error.

- [ ] **Step 3: Add the route**

Edit `packages/stemcraft_api/src/stemcraft_api/routes/songs.py` — add the import and the
route (placed after `get_song`, before `upload_song`):

```python
from stemcraft_lib.analysis import read_analysis  # add to existing stemcraft_lib imports
```

```python
@router.get("/api/songs/{song_id}/analysis")
def get_analysis(song_id: str) -> dict:
    song_dir = _find_dir(song_id)
    if not (song_dir / "analysis.json").is_file():
        raise HTTPException(status_code=404, detail=f"song {song_id} has no analysis yet")
    return read_analysis(song_dir).model_dump(mode="json")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest packages/stemcraft_api/tests/test_songs_analysis.py -v`
Expected: PASS (2 tests)

- [ ] **Step 5: Confirm the full API suite and the torch-free guarantee still hold**

Run: `uv run pytest packages/stemcraft_api -q`
Expected: all pass, including the existing `test_the_api_never_imports_torch` — this
route only reads a JSON file through `stemcraft_lib`, same as everything else in
`songs.py`.

- [ ] **Step 6: Commit**

```bash
git add packages/stemcraft_api/src/stemcraft_api/routes/songs.py \
        packages/stemcraft_api/tests/test_songs_analysis.py
git commit -m "feat(api): GET /api/songs/{id}/analysis (Task 8)"
```

---

### Task 9: Frontend — music theory module

**Files:**
- Create: `frontend/src/music/theory.ts`
- Test: `frontend/src/music/theory.test.ts`

**Interfaces:**
- Produces: `pitchClassOf(name: string): number`, `noteName(pitchClass: number,
  tonicPitchClass: number, mode: Mode): string`, `scaleSemitones(mode: Mode, pentatonic:
  boolean): number[]`, `scaleNoteNames(tonicPitchClass: number, mode: Mode, pentatonic?:
  boolean): string[]`, `noteAtFret(openNotePitchClass: number, fret: number,
  tonicPitchClass: number, mode: Mode): string`, `BASS_TUNING: string[]`, `GUITAR_TUNING:
  string[]`, `type Mode = 'major' | 'minor'`.

- [ ] **Step 1: Write the failing test**

```typescript
// frontend/src/music/theory.test.ts
import { expect, test } from 'vitest';

import {
  BASS_TUNING,
  GUITAR_TUNING,
  noteAtFret,
  noteName,
  pitchClassOf,
  scaleNoteNames,
  scaleSemitones,
} from './theory';

test('pitchClassOf resolves both sharp and flat spellings to the same class', () => {
  expect(pitchClassOf('G')).toBe(7);
  expect(pitchClassOf('A#')).toBe(10);
  expect(pitchClassOf('Bb')).toBe(10);
});

test('G natural minor is spelled with a flat family (relative major: Bb)', () => {
  expect(scaleNoteNames(pitchClassOf('G'), 'minor')).toEqual([
    'G', 'A', 'Bb', 'C', 'D', 'Eb', 'F',
  ]);
});

test('E natural minor is spelled with a sharp family (relative major: G)', () => {
  expect(scaleNoteNames(pitchClassOf('E'), 'minor')).toEqual([
    'E', 'F#', 'G', 'A', 'B', 'C', 'D',
  ]);
});

test('C major has no accidentals', () => {
  expect(scaleNoteNames(pitchClassOf('C'), 'major')).toEqual([
    'C', 'D', 'E', 'F', 'G', 'A', 'B',
  ]);
});

test('pentatonic scales are a 5-note subset in the same key', () => {
  expect(scaleNoteNames(pitchClassOf('G'), 'minor', true)).toEqual(['G', 'Bb', 'C', 'D', 'F']);
});

test('scaleSemitones: minor pentatonic is root, b3, 4, 5, b7', () => {
  expect(scaleSemitones('minor', true)).toEqual([0, 3, 5, 7, 10]);
});

test('noteAtFret walks up in semitones from the open string', () => {
  const tonic = pitchClassOf('G');
  expect(noteAtFret(pitchClassOf('E'), 0, tonic, 'minor')).toBe('E');
  expect(noteAtFret(pitchClassOf('E'), 3, tonic, 'minor')).toBe('G');
});

test('standard tunings are 4 and 6 strings, low to high', () => {
  expect(BASS_TUNING).toEqual(['E', 'A', 'D', 'G']);
  expect(GUITAR_TUNING).toEqual(['E', 'A', 'D', 'G', 'B', 'E']);
});

test('noteName throws on an unknown name via pitchClassOf', () => {
  expect(() => pitchClassOf('H')).toThrow();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- theory.test.ts`
Expected: FAIL — `theory.ts` does not exist.

- [ ] **Step 3: Write the implementation**

```typescript
// frontend/src/music/theory.ts
// Pure music theory: pitch classes, key-appropriate note spelling, scale and
// pentatonic generation, and fretboard note lookup. No model, no failure mode
// (R-05) -- this is arithmetic over the tonic the user picks from the
// analyzed key candidates, not a prediction of its own.

export type Mode = 'major' | 'minor';

const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

// Major-key tonics conventionally spelled with flats (the flat side of the
// circle of fifths); everything else -- including F#/Gb, called F# here --
// uses sharps. A minor key follows its relative major's family (tonic + 3
// semitones), e.g. G minor (pc 7) -> Bb major (pc 10) -> flat family.
const FLAT_FAMILY_MAJOR_TONICS = new Set([5, 10, 3, 8, 1]); // F, Bb, Eb, Ab, Db

const NAME_TO_PC: Record<string, number> = {};
SHARP_NAMES.forEach((n, i) => (NAME_TO_PC[n] = i));
FLAT_NAMES.forEach((n, i) => (NAME_TO_PC[n] = i));

export function pitchClassOf(name: string): number {
  const pc = NAME_TO_PC[name];
  if (pc === undefined) throw new Error(`unknown note name: ${name}`);
  return pc;
}

function familyIsFlat(tonicPitchClass: number, mode: Mode): boolean {
  const majorTonic = mode === 'minor' ? (tonicPitchClass + 3) % 12 : tonicPitchClass;
  return FLAT_FAMILY_MAJOR_TONICS.has(majorTonic);
}

export function noteName(pitchClass: number, tonicPitchClass: number, mode: Mode): string {
  const pc = ((pitchClass % 12) + 12) % 12;
  return familyIsFlat(tonicPitchClass, mode) ? FLAT_NAMES[pc] : SHARP_NAMES[pc];
}

const MAJOR_INTERVALS = [0, 2, 4, 5, 7, 9, 11];
const MINOR_INTERVALS = [0, 2, 3, 5, 7, 8, 10];
const MAJOR_PENTATONIC_DEGREES = [0, 1, 2, 4, 5]; // scale degrees 1,2,3,5,6
const MINOR_PENTATONIC_DEGREES = [0, 2, 3, 4, 6]; // scale degrees 1,b3,4,5,b7

export function scaleSemitones(mode: Mode, pentatonic: boolean): number[] {
  const base = mode === 'major' ? MAJOR_INTERVALS : MINOR_INTERVALS;
  if (!pentatonic) return base;
  const degrees = mode === 'major' ? MAJOR_PENTATONIC_DEGREES : MINOR_PENTATONIC_DEGREES;
  return degrees.map((d) => base[d]);
}

export function scaleNoteNames(
  tonicPitchClass: number,
  mode: Mode,
  pentatonic = false,
): string[] {
  return scaleSemitones(mode, pentatonic).map((semitone) =>
    noteName((tonicPitchClass + semitone) % 12, tonicPitchClass, mode),
  );
}

export function noteAtFret(
  openNotePitchClass: number,
  fret: number,
  tonicPitchClass: number,
  mode: Mode,
): string {
  return noteName((openNotePitchClass + fret) % 12, tonicPitchClass, mode);
}

// Standard tunings, low string to high string.
export const BASS_TUNING = ['E', 'A', 'D', 'G'];
export const GUITAR_TUNING = ['E', 'A', 'D', 'G', 'B', 'E'];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm test -- theory.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/music/theory.ts frontend/src/music/theory.test.ts
git commit -m "feat(frontend): music theory -- key-aware note spelling and scales (Task 9)"
```

---

### Task 10: Frontend — `Fretboard` component

**Files:**
- Create: `frontend/src/music/Fretboard.tsx`
- Create: `frontend/src/music/Fretboard.module.css`
- Test: `frontend/src/music/Fretboard.test.tsx`

**Interfaces:**
- Consumes: `frontend/src/music/theory.ts` (Task 9).
- Produces: `<Fretboard tuning={string[]} tonic={string} mode={Mode} scaleNotes={Set<number>} />`.

- [ ] **Step 1: Write the failing test**

```typescript
// frontend/src/music/Fretboard.test.tsx
import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';

import { Fretboard } from './Fretboard';
import { BASS_TUNING, pitchClassOf, scaleSemitones } from './theory';

function scaleSet(tonic: string, mode: 'major' | 'minor') {
  const tonicPc = pitchClassOf(tonic);
  return new Set(scaleSemitones(mode, false).map((s) => (tonicPc + s) % 12));
}

test('renders an svg with role img labelled by the key', () => {
  render(<Fretboard tuning={BASS_TUNING} tonic="G" mode="minor" scaleNotes={scaleSet('G', 'minor')} />);
  expect(screen.getByRole('img', { name: /G minor fretboard/i })).toBeInTheDocument();
});

test('marks the open low-E string as a scale note in G minor (E is not in G minor)', () => {
  // Sanity check on the fixture itself: G natural minor is G,A,Bb,C,D,Eb,F --
  // no E -- so the open low string (E) should NOT get a note marker.
  const { container } = render(
    <Fretboard tuning={BASS_TUNING} tonic="G" mode="minor" scaleNotes={scaleSet('G', 'minor')} />,
  );
  const labels = Array.from(container.querySelectorAll('text')).map((el) => el.textContent);
  expect(labels).not.toContain('E');
  expect(labels).toContain('G');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- Fretboard.test.tsx`
Expected: FAIL — `Fretboard.tsx` does not exist.

- [ ] **Step 3: Write the implementation**

```css
/* frontend/src/music/Fretboard.module.css */
.svg {
  width: 100%;
  height: auto;
  display: block;
}

.fret {
  stroke: var(--ds-border);
  stroke-width: 1;
}

.nut {
  stroke: var(--ds-border-strong);
  stroke-width: 3;
}

.string {
  stroke: var(--ds-border-strong);
  stroke-width: 1;
}

.note {
  fill: var(--ds-raised);
  stroke: var(--ds-border-strong);
  stroke-width: 2;
}

.root {
  fill: var(--ds-bass);
  stroke: var(--ds-bass);
}

.label {
  font: 600 11px var(--ds-font);
  fill: var(--ds-text);
  text-anchor: middle;
  dominant-baseline: central;
  pointer-events: none;
}
```

```tsx
// frontend/src/music/Fretboard.tsx
import { noteAtFret, pitchClassOf } from './theory';
import type { Mode } from './theory';
import styles from './Fretboard.module.css';

const FRETS = 12;
const STRING_GAP = 32;
const FRET_GAP = 56;
const NECK_LEFT = 40;
const TOP = 20;

export interface FretboardProps {
  tuning: string[]; // low to high, e.g. ['E', 'A', 'D', 'G']
  tonic: string; // sharp-spelled pitch-class name from analysis.json, e.g. 'G'
  mode: Mode;
  scaleNotes: Set<number>; // pitch classes (0-11) in the currently displayed scale
}

export function Fretboard({ tuning, tonic, mode, scaleNotes }: FretboardProps) {
  const tonicPc = pitchClassOf(tonic);
  const width = NECK_LEFT + FRET_GAP * FRETS + 20;
  const height = TOP + STRING_GAP * (tuning.length - 1) + 20;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={styles.svg}
      role="img"
      aria-label={`${tonic} ${mode} fretboard`}
    >
      {Array.from({ length: FRETS + 1 }, (_, fret) => (
        <line
          key={`fret-${fret}`}
          x1={NECK_LEFT + fret * FRET_GAP}
          x2={NECK_LEFT + fret * FRET_GAP}
          y1={TOP}
          y2={TOP + STRING_GAP * (tuning.length - 1)}
          className={fret === 0 ? styles.nut : styles.fret}
        />
      ))}
      {tuning.map((_, stringIndex) => (
        <line
          key={`string-${stringIndex}`}
          x1={NECK_LEFT}
          x2={NECK_LEFT + FRET_GAP * FRETS}
          y1={TOP + STRING_GAP * stringIndex}
          y2={TOP + STRING_GAP * stringIndex}
          className={styles.string}
        />
      ))}
      {tuning.map((openNote, stringIndex) => {
        const openPc = pitchClassOf(openNote);
        return Array.from({ length: FRETS + 1 }, (_, fret) => {
          const pc = (openPc + fret) % 12;
          if (!scaleNotes.has(pc)) return null;
          const isRoot = pc === tonicPc;
          const cx = fret === 0 ? NECK_LEFT - 14 : NECK_LEFT + fret * FRET_GAP - FRET_GAP / 2;
          const cy = TOP + STRING_GAP * stringIndex;
          return (
            <g key={`${stringIndex}-${fret}`}>
              <circle cx={cx} cy={cy} r={12} className={isRoot ? styles.root : styles.note} />
              <text x={cx} y={cy} className={styles.label}>
                {noteAtFret(openPc, fret, tonicPc, mode)}
              </text>
            </g>
          );
        });
      })}
    </svg>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm test -- Fretboard.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/music/Fretboard.tsx frontend/src/music/Fretboard.module.css \
        frontend/src/music/Fretboard.test.tsx
git commit -m "feat(frontend): Fretboard SVG component (Task 10)"
```

---

### Task 11: Frontend — the Scale & fretboard screen, wired to real data

**Files:**
- Modify: `frontend/src/api/client.ts`
- Modify: `frontend/src/api/queries.ts`
- Modify: `frontend/src/screens/ScaleSheet.tsx` (replace the stub)
- Create: `frontend/src/screens/ScaleSheet.module.css`
- Create: `frontend/src/screens/ScaleSheet.test.tsx`
- Modify: `frontend/src/screens/Library.tsx`
- Modify: `frontend/src/screens/Library.module.css`

**Interfaces:**
- Consumes: `GET /api/songs/{id}/analysis` (Task 8), `frontend/src/music/theory.ts` (Task
  9), `frontend/src/music/Fretboard.tsx` (Task 10).

- [ ] **Step 1: Write the failing test**

```typescript
// frontend/src/screens/ScaleSheet.test.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, expect, test, vi } from 'vitest';

import { ScaleSheet } from './ScaleSheet';

const songEntry = {
  dir: '01SONG-tightrope',
  song: {
    schema_version: 1, id: '01SONG', title: 'Tightrope', artist: 'Someone',
    source: { kind: 'upload', value: 'original.mp3' }, created_at: '2026-01-01T00:00:00Z',
    last_played_at: null, mix: {}, playback: { tempo: 1, pitch_semitones: 0 }, loops: [],
  },
  state: 'analyzed',
  unreadable: null,
  files: { has_audio: true, has_peaks: true, has_stems: true, has_analysis: true },
};

const analysis = {
  schema_version: 1,
  key_candidates: [
    { tonic: 'G', mode: 'minor', confidence: 0.72 },
    { tonic: 'A#', mode: 'major', confidence: 0.18 },
    { tonic: 'D', mode: 'minor', confidence: 0.1 },
  ],
  beat_grid: { bpm: 120, beats: [1920], downbeats: [1920] },
  chords: [{ bar: 0, start_sample: 1920, end_sample: 48000, chord: 'G:min' }],
};

afterEach(() => vi.unstubAllGlobals());

function renderScaleSheet() {
  const fetchMock = vi.fn(async (url: string) => {
    if (url === '/api/songs') return new Response(JSON.stringify({ songs: [songEntry] }));
    if (url === '/api/songs/01SONG/analysis') return new Response(JSON.stringify(analysis));
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/songs/01SONG/scale']}>
        <Routes>
          <Route path="songs/:songId/scale" element={<ScaleSheet />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

test('shows key candidates with confidence percentages', async () => {
  renderScaleSheet();
  expect(await screen.findByText(/72%/)).toBeInTheDocument();
  expect(screen.getByText(/18%/)).toBeInTheDocument();
  expect(screen.getByText(/10%/)).toBeInTheDocument();
});

test('defaults to the top candidate and shows its correctly-spelled notes', async () => {
  renderScaleSheet();
  await screen.findByText(/72%/);
  // G natural minor: G, A, Bb, C, D, Eb, F.
  expect(screen.getByText('Bb')).toBeInTheDocument();
  expect(screen.getByText('Eb')).toBeInTheDocument();
});

test('switching candidates re-renders the fretboard for the new key', async () => {
  renderScaleSheet();
  await screen.findByText(/72%/);
  await userEvent.click(screen.getByRole('button', { name: /A# major/i }));
  expect(screen.getByRole('img', { name: /A# major fretboard/i })).toBeInTheDocument();
});

test('pentatonic toggle shrinks the note list', async () => {
  renderScaleSheet();
  await screen.findByText(/72%/);
  const fullCount = screen.getAllByText(/^(G|A|Bb|C|D|Eb|F)$/).length;
  await userEvent.click(screen.getByRole('button', { name: /pentatonic/i }));
  const pentaCount = screen.getAllByText(/^(G|Bb|C|D|F)$/).length;
  expect(pentaCount).toBeLessThan(fullCount);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- ScaleSheet.test.tsx`
Expected: FAIL — the current `ScaleSheet` stub renders only `<h1>Scale sheet</h1>` and
`useAnalysis` doesn't exist yet.

- [ ] **Step 3: Add the `Analysis` types and `useAnalysis` query**

Append to `frontend/src/api/client.ts`:

```typescript
// Mirrors packages/stemcraft_lib/src/stemcraft_lib/analysis.py.
export interface KeyCandidate {
  tonic: string;
  mode: 'major' | 'minor';
  confidence: number;
}

export interface BeatGrid {
  bpm: number;
  beats: number[];
  downbeats: number[];
}

export interface ChordSegment {
  bar: number;
  start_sample: number;
  end_sample: number;
  chord: string;
}

export interface Analysis {
  schema_version: number;
  key_candidates: KeyCandidate[];
  beat_grid: BeatGrid;
  chords: ChordSegment[];
}
```

Append to `frontend/src/api/queries.ts`:

```typescript
import type { Analysis } from './client'; // add to the existing type-only import line
```

```typescript
export function useAnalysis(songId: string | undefined) {
  return useQuery({
    queryKey: ['analysis', songId],
    queryFn: () => api.get<Analysis>(`/api/songs/${songId}/analysis`),
    enabled: Boolean(songId),
  });
}
```

- [ ] **Step 4: Write the `ScaleSheet` screen**

```css
/* frontend/src/screens/ScaleSheet.module.css */
.page {
  display: flex;
  flex-direction: column;
  gap: var(--ds-4);
}

.topbar {
  display: flex;
  align-items: center;
  gap: var(--ds-3);
}

.seg {
  display: flex;
  gap: var(--ds-1);
  margin-left: auto;
}

.seg button[aria-pressed='true'] {
  background: var(--ds-bass);
  color: var(--ds-ground);
  border-color: var(--ds-bass);
}

.candidates {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--ds-3);
}

.cap {
  font: 400 var(--ds-t-xs) / 1 var(--ds-mono);
  color: var(--ds-text-3);
  text-transform: uppercase;
}

.candidates button[aria-pressed='true'] {
  background: var(--ds-bass);
  color: var(--ds-ground);
  border-color: var(--ds-bass);
}

.panel {
  display: flex;
  flex-direction: column;
  gap: var(--ds-4);
  padding: var(--ds-4);
  background: var(--ds-surface);
  border: 1px solid var(--ds-border);
  border-radius: var(--ds-r-panel);
}

.notes {
  display: flex;
  gap: var(--ds-2);
  flex-wrap: wrap;
}

.notes b {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 44px;
  padding: 0 var(--ds-3);
  border-radius: var(--ds-r-btn);
  background: var(--ds-raised);
  border: 1px solid var(--ds-border-strong);
}

.root {
  background: var(--ds-bass) !important;
  border-color: var(--ds-bass) !important;
  color: var(--ds-ground);
}

.note {
  color: var(--ds-text-2);
  font-size: var(--ds-t-sm);
}
```

```tsx
// frontend/src/screens/ScaleSheet.tsx
// Domain spec, "Scale view": pure lookup from a chosen key candidate to its
// notes and fretboard positions -- no model, no failure mode (R-05). Key
// candidates themselves come from analysis.json (probabilistic, shown with
// confidence); everything below that is arithmetic.
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { useAnalysis, useSongs } from '../api/queries';
import { Fretboard } from '../music/Fretboard';
import { BASS_TUNING, GUITAR_TUNING, pitchClassOf, scaleNoteNames, scaleSemitones } from '../music/theory';
import type { Mode } from '../music/theory';
import styles from './ScaleSheet.module.css';

export function ScaleSheet() {
  const { songId } = useParams();
  const songs = useSongs();
  const analysis = useAnalysis(songId);
  const [instrument, setInstrument] = useState<'bass' | 'guitar'>('bass');
  const [pentatonic, setPentatonic] = useState(false);
  const [selected, setSelected] = useState(0);

  const entry = songs.data?.find((e) => e.song?.id === songId);
  const candidates = analysis.data?.key_candidates ?? [];
  const active = candidates[selected];

  const tonicPc = active ? pitchClassOf(active.tonic) : null;
  const mode = (active?.mode ?? 'major') as Mode;

  const scaleNotes = useMemo(() => {
    if (tonicPc === null) return new Set<number>();
    return new Set(scaleSemitones(mode, pentatonic).map((s) => (tonicPc + s) % 12));
  }, [tonicPc, mode, pentatonic]);

  const noteNames = useMemo(() => {
    if (tonicPc === null) return [];
    return scaleNoteNames(tonicPc, mode, pentatonic);
  }, [tonicPc, mode, pentatonic]);

  return (
    <section className={styles.page}>
      <div className={styles.topbar}>
        <Link to={`/songs/${songId}`}>&larr; Back</Link>
        <h1>{entry?.song?.title ?? songId}</h1>
        <div className={styles.seg}>
          <button aria-pressed={instrument === 'bass'} onClick={() => setInstrument('bass')}>
            Bass &middot; 4 string
          </button>
          <button aria-pressed={instrument === 'guitar'} onClick={() => setInstrument('guitar')}>
            Guitar &middot; 6 string
          </button>
        </div>
      </div>

      {analysis.isError && <p role="alert">{String(analysis.error)}</p>}
      {analysis.data && candidates.length === 0 && <p>No key candidates in this analysis.</p>}

      {candidates.length > 0 && (
        <>
          <div className={styles.candidates}>
            <span className={styles.cap}>key candidates</span>
            {candidates.map((c, i) => (
              <button key={`${c.tonic}-${c.mode}`} aria-pressed={i === selected} onClick={() => setSelected(i)}>
                {c.tonic} {c.mode} <b>{Math.round(c.confidence * 100)}%</b>
              </button>
            ))}
            <div className={styles.seg}>
              <button aria-pressed={!pentatonic} onClick={() => setPentatonic(false)}>
                Full scale
              </button>
              <button aria-pressed={pentatonic} onClick={() => setPentatonic(true)}>
                Pentatonic
              </button>
            </div>
          </div>

          {active && (
            <div className={styles.panel}>
              <h2>
                {active.tonic} {active.mode}
              </h2>
              <div className={styles.notes}>
                {noteNames.map((n, i) => (
                  <b key={`${n}-${i}`} className={i === 0 ? styles.root : undefined}>
                    {n}
                  </b>
                ))}
              </div>
              <Fretboard
                tuning={instrument === 'bass' ? BASS_TUNING : GUITAR_TUNING}
                tonic={active.tonic}
                mode={mode}
                scaleNotes={scaleNotes}
              />
              <p className={styles.note}>
                Detected on the bass and other stems, not the full mix -- key detection is
                probabilistic (R-05), which is why candidates are shown with confidence
                instead of one answer as fact. But the map from a key to its notes and
                fretboard positions is arithmetic: no model, no failure mode.
              </p>
            </div>
          )}
        </>
      )}
    </section>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && npm test -- ScaleSheet.test.tsx`
Expected: PASS (4 tests)

- [ ] **Step 6: Link to the Scale Sheet from the Library once a Song is analyzed**

Read `frontend/src/screens/Library.tsx` and `Library.module.css` (already open from this
plan's research) and add a link inside the existing `entry.song ? (...)` branch, after the
state span:

```tsx
{entry.state === 'analyzed' && (
  <Link className={styles.scale} to={`/songs/${entry.song.id}/scale`}>
    Scale &amp; fretboard
  </Link>
)}
```

Append to `Library.module.css`:

```css
.scale {
  align-self: flex-start;
  font-size: var(--ds-t-sm);
}
```

- [ ] **Step 7: Run the full frontend suite and typecheck**

Run: `cd frontend && npm test && npm run typecheck`
Expected: all tests pass (including the pre-existing `Library.test.tsx`, unaffected by
the additive change), no type errors.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/api/client.ts frontend/src/api/queries.ts \
        frontend/src/screens/ScaleSheet.tsx frontend/src/screens/ScaleSheet.module.css \
        frontend/src/screens/ScaleSheet.test.tsx \
        frontend/src/screens/Library.tsx frontend/src/screens/Library.module.css
git commit -m "feat(frontend): Scale & fretboard screen wired to real analysis (Task 11)"
```

---

### Task 12: Docs and real-hardware verification

**Files:**
- Modify: `docs/running.md` (or wherever Phase 4's real-hardware entry was recorded —
  check `git show 36cf6f1 --stat` for the exact file Phase 4 used and append in the same
  place, same format)

**Interfaces:** none (documentation only).

- [ ] **Step 1: Run the full test suite one more time, everywhere**

Run: `uv run pytest -q && (cd frontend && npm test && npm run typecheck)`
Expected: all green.

- [ ] **Step 2: Run the real pipeline against a real song, on the real target machine**

This mirrors Phase 4's Task 11 exactly, extended one step further (import → separate now
auto-chains into analyze): import a real song, let `import` → `separate` → `analyze` run
to completion via the Job Queue screen, then open `/songs/{id}/scale` in the browser and
confirm:
- The key candidates shown add up to 100% and the top candidate is musically plausible
  for the song.
- Switching candidates changes the fretboard.
- The full/pentatonic toggle changes the note count.
- Bass and guitar tunings both render correctly.

- [ ] **Step 3: Record the verification entry**

Append an entry in the same format and location as Phase 4's Task 11 entry (see `git show
36cf6f1` for the exact structure used there), noting: the real song used, the detected
BPM/key/chord-count, wall-clock time for the `analyze` job (checking it against N-02's
"seconds" budget on real CPU, not the small-checkpoint test fixtures), and confirming the
Scale & fretboard screen matches the four checks in Step 2.

- [ ] **Step 4: Commit**

```bash
git add docs/running.md  # or the actual file Phase 4's entry lives in
git commit -m "docs: Phase 5 plan and real-hardware verification entry (Task 12)"
```
