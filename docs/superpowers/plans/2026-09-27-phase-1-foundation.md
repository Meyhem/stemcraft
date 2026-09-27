# Stemcraft Phase 1: Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the repo, both Python processes, the job queue with lease-based crash recovery, the `songs/` tree primitives and the SPA shell — with a trivial `probe` job proving the whole loop — and no audio, no ffmpeg, no torch anywhere.

**Architecture:** A `uv` workspace of three Python packages (`stemcraft_lib`, `stemcraft_api`, `stemcraft_worker`) plus a `frontend/` npm project. API and worker share `stemcraft_lib` and never import each other. They coordinate only through `jobs.sqlite` and the `songs/` tree. The package split is not cosmetic: `stemcraft_api` declares no torch dependency, so the invariant "the API never imports torch" is enforced by the dependency graph and asserted by a test, not by discipline.

**Tech Stack:** Python 3.12, `uv`, FastAPI + Uvicorn, stdlib `sqlite3`, pydantic v2, pytest. TypeScript + React 19 on Vite, React Router, TanStack Query, CSS modules, vitest + @testing-library/react. npm.

**Spec:** [design/tech-spec-stemcraft.md](../../../design/tech-spec-stemcraft.md) (authoritative), [design/domain-spec.md](../../../design/domain-spec.md), [design/ui-spec.md](../../../design/ui-spec.md). Phase map: [2026-09-27-stemcraft-roadmap.md](2026-09-27-stemcraft-roadmap.md).

## Global Constraints

Every task's requirements implicitly include this section. Exact values, copied from the spec.

- **`SAMPLE_RATE = 48000`** (D-03). Never 44.1 kHz. Beat grids are integer sample indices at 48 kHz, never float seconds. (domain-spec.md:67 and :143 still say 44.1 — those lines are stale, D-03 supersedes them.)
- **The API never imports torch** (§4). Asserted by test in Task 9.
- **One writer per file** (§5): the API owns `song.json`; the worker owns `stems/`, `analysis.json`, `peaks.json`, `exports/`.
- **All file writes are atomic**: temp file in the same directory, then `os.replace`.
- **The original upload/download is never modified or deleted.**
- **No status field.** Song state (imported / separated / analyzed) is *derived* from which files exist (D-01). Asserted by test in Task 3.
- **Fail loudly** (N-08): both processes refuse to start on an unmet dependency, with the real error text reaching the UI. No silent fallback.
- **Strictly serial jobs** (C-07): one worker, one running job at a time.
- **Every job kind is idempotent by re-derivation** (§6). Crash recovery re-runs from the start.
- **No CORS middleware anywhere** (D-15). Dev is one origin via the Vite proxy; prod is one origin via the static mount.
- SQLite pragmas, verbatim (domain spec): `journal_mode=WAL`, `busy_timeout=5000`, `synchronous=NORMAL`.
- Ports: API `:8000`, Vite dev `:5173`, both bound `0.0.0.0` (C-05).
- Python 3.12, `uv` for Python deps, `npm` for the SPA (D-12).

---

## File Structure

**Python workspace**

| File | Responsibility |
| --- | --- |
| `pyproject.toml` | `uv` workspace root; dev tooling config (ruff, pytest) |
| `packages/stemcraft_lib/src/stemcraft_lib/config.py` | Settings resolved from env; `SAMPLE_RATE` |
| `packages/stemcraft_lib/src/stemcraft_lib/atomic.py` | Atomic write primitives — the only way anything writes a file |
| `packages/stemcraft_lib/src/stemcraft_lib/ids.py` | Song id (ULID) and slug generation |
| `packages/stemcraft_lib/src/stemcraft_lib/song.py` | `song.json` models, read/write, migration, derived state |
| `packages/stemcraft_lib/src/stemcraft_lib/deps.py` | Boot dependency validation shared by both processes |
| `packages/stemcraft_lib/src/stemcraft_lib/jobs.py` | `jobs.sqlite` schema, pragmas, queue and lease operations |
| `packages/stemcraft_api/src/stemcraft_api/app.py` | App factory, lifespan boot validation, router wiring |
| `packages/stemcraft_api/src/stemcraft_api/routes/health.py` | `/api/health` — deps and device, for the banner |
| `packages/stemcraft_api/src/stemcraft_api/routes/songs.py` | Song scan and CRUD; sole writer of `song.json` |
| `packages/stemcraft_api/src/stemcraft_api/routes/jobs.py` | Enqueue, list, cancel |
| `packages/stemcraft_api/src/stemcraft_api/ws.py` | WebSocket push of job rows, driven by `PRAGMA data_version` |
| `packages/stemcraft_api/src/stemcraft_api/static.py` | Built-bundle mount and SPA fallback (D-15) |
| `packages/stemcraft_worker/src/stemcraft_worker/registry.py` | Job-kind registry and `JobContext` |
| `packages/stemcraft_worker/src/stemcraft_worker/kinds/probe.py` | The `probe` kind — exercises the loop with no audio |
| `packages/stemcraft_worker/src/stemcraft_worker/main.py` | Boot validation, poll loop, lease renewal, failure capture |

**Frontend**

| File | Responsibility |
| --- | --- |
| `frontend/vite.config.ts` | Dev proxy for `/api` + WebSocket, `host: '0.0.0.0'`, build output |
| `frontend/src/styles/tokens.css` | Copy of `design/ui/src/tokens.css` — the design system's authority (D-16) |
| `frontend/src/api/client.ts` | Typed fetch wrapper; the only place a URL is written |
| `frontend/src/api/queries.ts` | Query keys and hooks (D-13) |
| `frontend/src/api/useJobStream.ts` | WebSocket → query invalidation. The socket carries no state |
| `frontend/src/app/AppShell.tsx` | Chrome: nav, device/deps banner, outlet |
| `frontend/src/app/routes.tsx` | Seven routes (D-14) |
| `frontend/src/screens/JobQueue.tsx` | The operational dashboard (§10) |
| `frontend/src/screens/*.tsx` | Six route stubs, each rendering its title only |

**Ops**

| File | Responsibility |
| --- | --- |
| `ops/systemd/stemcraft-api.service` | API unit, restart-on-failure |
| `ops/systemd/stemcraft-worker.service` | Worker unit, restart-on-failure |
| `.claude/launch.json` | Add `api`, `worker`, `frontend` next to the existing `ui-preview` |

---

## Task 1: Workspace, tooling and settings

**Files:**
- Create: `pyproject.toml`, `packages/stemcraft_lib/pyproject.toml`, `packages/stemcraft_lib/src/stemcraft_lib/__init__.py`, `packages/stemcraft_lib/src/stemcraft_lib/config.py`
- Test: `packages/stemcraft_lib/tests/test_config.py`

**Interfaces:**
- Produces: `SAMPLE_RATE: int`, `Settings` dataclass with fields `data_dir: Path`, `songs_dir: Path`, `jobs_db: Path`, `host: str`, `port: int`, `dist_dir: Path | None`; `settings() -> Settings` reading env each call.

- [ ] **Step 1: Write the failing test**

```python
# packages/stemcraft_lib/tests/test_config.py
from pathlib import Path

from stemcraft_lib.config import SAMPLE_RATE, settings


def test_sample_rate_is_48k_not_441():
    assert SAMPLE_RATE == 48000


def test_defaults_put_songs_and_db_under_data_dir(monkeypatch):
    monkeypatch.delenv("STEMCRAFT_DATA_DIR", raising=False)
    s = settings()
    assert s.data_dir == Path("data").resolve()
    assert s.songs_dir == Path("songs").resolve()
    assert s.jobs_db == Path("data/jobs.sqlite").resolve()


def test_env_overrides_data_dir(monkeypatch, tmp_path):
    monkeypatch.setenv("STEMCRAFT_DATA_DIR", str(tmp_path / "d"))
    monkeypatch.setenv("STEMCRAFT_SONGS_DIR", str(tmp_path / "s"))
    s = settings()
    assert s.jobs_db == (tmp_path / "d" / "jobs.sqlite").resolve()
    assert s.songs_dir == (tmp_path / "s").resolve()


def test_binds_lan_by_default(monkeypatch):
    monkeypatch.delenv("STEMCRAFT_HOST", raising=False)
    assert settings().host == "0.0.0.0"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest packages/stemcraft_lib/tests/test_config.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'stemcraft_lib'`

- [ ] **Step 3: Create the workspace**

```toml
# pyproject.toml
[project]
name = "stemcraft"
version = "0.1.0"
requires-python = ">=3.12,<3.13"
# Only stemcraft-lib exists yet. Task 8 appends stemcraft-worker here when the
# worker package is created, Task 9 appends stemcraft-api — each addition is a
# real `uv sync` after the fact, not a forward reference to a package that
# doesn't exist. Listing all three now would break this task's own `uv sync`.
dependencies = [
    "stemcraft-lib",
]

[tool.uv.workspace]
members = ["packages/*"]

[tool.uv.sources]
stemcraft-lib = { workspace = true }

[dependency-groups]
dev = ["pytest>=8", "ruff>=0.6", "httpx>=0.27"]

[tool.pytest.ini_options]
testpaths = ["packages"]
addopts = "-q"

[tool.ruff]
line-length = 100
target-version = "py312"

[tool.ruff.lint]
select = ["E", "F", "I", "UP", "B"]
```

```toml
# packages/stemcraft_lib/pyproject.toml
[project]
name = "stemcraft-lib"
version = "0.1.0"
requires-python = ">=3.12,<3.13"
dependencies = ["pydantic>=2.9", "python-ulid>=3.0"]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["src/stemcraft_lib"]
```

Create empty `packages/stemcraft_lib/src/stemcraft_lib/__init__.py`.

- [ ] **Step 4: Write the implementation**

```python
# packages/stemcraft_lib/src/stemcraft_lib/config.py
"""Runtime settings. Read from the environment on every call so tests can
monkeypatch without reloading modules."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

# D-03: one sample rate is true end to end. Opus codes only at 48 kHz, so a
# 44.1 kHz master would make server and client sample indices denote different
# instants and silently defeat N-05.
SAMPLE_RATE = 48000


@dataclass(frozen=True)
class Settings:
    data_dir: Path
    songs_dir: Path
    jobs_db: Path
    host: str
    port: int
    dist_dir: Path | None


def _path(env: str, default: str) -> Path:
    return Path(os.environ.get(env, default)).resolve()


def settings() -> Settings:
    data_dir = _path("STEMCRAFT_DATA_DIR", "data")
    dist = os.environ.get("STEMCRAFT_DIST_DIR", "frontend/dist")
    dist_path = Path(dist).resolve()
    return Settings(
        data_dir=data_dir,
        songs_dir=_path("STEMCRAFT_SONGS_DIR", "songs"),
        jobs_db=data_dir / "jobs.sqlite",
        # C-05: served over the home LAN, not just loopback.
        host=os.environ.get("STEMCRAFT_HOST", "0.0.0.0"),
        port=int(os.environ.get("STEMCRAFT_PORT", "8000")),
        dist_dir=dist_path if dist_path.is_dir() else None,
    )
```

- [ ] **Step 5: Run tests and lint**

Run: `uv sync && uv run pytest packages/stemcraft_lib/tests/test_config.py -v && uv run ruff check .`
Expected: 4 passed, ruff clean.

- [ ] **Step 6: Commit**

```bash
git add pyproject.toml packages/stemcraft_lib uv.lock .gitignore
git commit -m "feat(lib): uv workspace and settings with the 48 kHz constant"
```

---

## Task 2: Atomic writes

**Files:**
- Create: `packages/stemcraft_lib/src/stemcraft_lib/atomic.py`
- Test: `packages/stemcraft_lib/tests/test_atomic.py`

**Interfaces:**
- Produces: `atomic_write_bytes(path: Path, data: bytes) -> None`, `atomic_write_text(path: Path, text: str) -> None`, `atomic_write_json(path: Path, obj: object) -> None`. All create parent directories, fsync the file, `os.replace`, then fsync the directory.

- [ ] **Step 1: Write the failing test**

```python
# packages/stemcraft_lib/tests/test_atomic.py
import json

import pytest

from stemcraft_lib.atomic import atomic_write_bytes, atomic_write_json


def test_writes_content_and_creates_parents(tmp_path):
    target = tmp_path / "nested" / "f.bin"
    atomic_write_bytes(target, b"hello")
    assert target.read_bytes() == b"hello"


def test_leaves_no_temp_files_behind(tmp_path):
    atomic_write_bytes(tmp_path / "f.bin", b"x")
    assert [p.name for p in tmp_path.iterdir()] == ["f.bin"]


def test_failed_write_leaves_previous_file_intact(tmp_path, monkeypatch):
    target = tmp_path / "f.json"
    atomic_write_json(target, {"v": 1})

    def boom(*_args, **_kwargs):
        raise OSError("No space left on device")

    monkeypatch.setattr("os.replace", boom)
    with pytest.raises(OSError):
        atomic_write_json(target, {"v": 2})

    # §9 disk full: a failed write leaves the previous good file intact.
    assert json.loads(target.read_text()) == {"v": 1}
    assert [p.name for p in tmp_path.iterdir()] == ["f.json"]


def test_json_is_readable_and_stable(tmp_path):
    target = tmp_path / "f.json"
    atomic_write_json(target, {"b": 2, "a": 1})
    assert target.read_text().endswith("\n")
    assert json.loads(target.read_text()) == {"a": 1, "b": 2}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest packages/stemcraft_lib/tests/test_atomic.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'stemcraft_lib.atomic'`

- [ ] **Step 3: Write the implementation**

```python
# packages/stemcraft_lib/src/stemcraft_lib/atomic.py
"""The only way anything in Stemcraft writes a file.

Temp file in the same directory, fsync, rename, fsync the directory. Same
directory matters: os.replace is only atomic within one filesystem.
"""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path


def atomic_write_bytes(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.", suffix=".tmp")
    tmp = Path(tmp_name)
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(data)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, path)
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise
    dir_fd = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(dir_fd)
    finally:
        os.close(dir_fd)


def atomic_write_text(path: Path, text: str) -> None:
    atomic_write_bytes(path, text.encode("utf-8"))


def atomic_write_json(path: Path, obj: object) -> None:
    atomic_write_text(path, json.dumps(obj, indent=2, sort_keys=True) + "\n")
```

- [ ] **Step 4: Run tests**

Run: `uv run pytest packages/stemcraft_lib/tests/test_atomic.py -v`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/stemcraft_lib/src/stemcraft_lib/atomic.py packages/stemcraft_lib/tests/test_atomic.py
git commit -m "feat(lib): atomic write primitives"
```

---

## Task 3: Song ids and slugs

**Files:**
- Create: `packages/stemcraft_lib/src/stemcraft_lib/ids.py`
- Test: `packages/stemcraft_lib/tests/test_ids.py`

**Interfaces:**
- Produces: `new_song_id() -> str` (26-char ULID, lexicographically sortable by creation time), `slugify(text: str) -> str`, `song_dirname(song_id: str, title: str) -> str` returning `<id>-<slug>`.

- [ ] **Step 1: Write the failing test**

```python
# packages/stemcraft_lib/tests/test_ids.py
from stemcraft_lib.ids import new_song_id, slugify, song_dirname


def test_ids_are_unique_and_time_sortable():
    ids = [new_song_id() for _ in range(50)]
    assert len(set(ids)) == 50
    assert ids == sorted(ids)
    assert all(len(i) == 26 for i in ids)


def test_slugify_handles_punctuation_unicode_and_case():
    assert slugify("Björk — Army of Me!") == "bjork-army-of-me"
    assert slugify("  multiple   spaces  ") == "multiple-spaces"
    assert slugify("///") == "untitled"


def test_slug_is_bounded_so_paths_stay_sane():
    assert len(slugify("a" * 200)) <= 60


def test_dirname_pairs_id_with_slug():
    assert song_dirname("01J9Z3K8Q4ABCDEFGHJKMNPQRS", "My Song") == (
        "01J9Z3K8Q4ABCDEFGHJKMNPQRS-my-song"
    )
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest packages/stemcraft_lib/tests/test_ids.py -v`
Expected: FAIL — no module `stemcraft_lib.ids`

- [ ] **Step 3: Write the implementation**

```python
# packages/stemcraft_lib/src/stemcraft_lib/ids.py
"""Song identity. The id is authoritative; the slug is decoration that makes
the songs/ tree readable, and nothing ever parses it back."""

from __future__ import annotations

import re
import unicodedata

from ulid import ULID

_SLUG_STRIP = re.compile(r"[^a-z0-9]+")
_MAX_SLUG = 60


def new_song_id() -> str:
    return str(ULID())


def slugify(text: str) -> str:
    normalized = unicodedata.normalize("NFKD", text)
    ascii_only = normalized.encode("ascii", "ignore").decode("ascii")
    slug = _SLUG_STRIP.sub("-", ascii_only.lower()).strip("-")
    return slug[:_MAX_SLUG].strip("-") or "untitled"


def song_dirname(song_id: str, title: str) -> str:
    return f"{song_id}-{slugify(title)}"
```

- [ ] **Step 4: Run tests**

Run: `uv run pytest packages/stemcraft_lib/tests/test_ids.py -v`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/stemcraft_lib/src/stemcraft_lib/ids.py packages/stemcraft_lib/tests/test_ids.py
git commit -m "feat(lib): song id and slug generation"
```

---

## Task 4: song.json — models, migration, derived state

**Files:**
- Create: `packages/stemcraft_lib/src/stemcraft_lib/song.py`
- Test: `packages/stemcraft_lib/tests/test_song.py`

**Interfaces:**
- Consumes: `atomic_write_json` (Task 2).
- Produces: `SCHEMA_VERSION: int = 1`; models `StemMix(gain_db: float, muted: bool)`, `Playback(tempo: float, pitch_semitones: int)`, `Loop(name: str, start_bar: int, end_bar: int)`, `Source(kind: str, value: str)`, `Song`; `new_song(title, artist, source) -> Song`; `read_song(song_dir: Path) -> Song` raising `SongUnreadable`; `write_song(song_dir: Path, song: Song) -> None`; `SongFiles` dataclass with `has_audio/has_stems/has_analysis/has_peaks` and `state` property returning `"imported" | "separated" | "analyzed"`; `derive_files(song_dir: Path) -> SongFiles`; `STEM_NAMES: tuple[str, ...] = ("vocals", "drums", "bass", "other")`.

- [ ] **Step 1: Write the failing test**

```python
# packages/stemcraft_lib/tests/test_song.py
import json

import pytest

from stemcraft_lib.song import (
    SCHEMA_VERSION,
    STEM_NAMES,
    SongUnreadable,
    derive_files,
    new_song,
    read_song,
    write_song,
)


def test_new_song_defaults_every_stem_unmuted_at_unity():
    song = new_song(title="My Song", artist="Artist", source_kind="upload", source_value="original.mp3")
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
    write_song(tmp_path, new_song(title="T", artist="A", source_kind="upload", source_value="o.mp3"))
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
    write_song(tmp_path, new_song(title="T", artist="A", source_kind="upload", source_value="o.mp3"))
    assert derive_files(tmp_path).state == "imported"

    (tmp_path / "stems").mkdir()
    for name in STEM_NAMES:
        (tmp_path / "stems" / f"{name}.wav").write_bytes(b"")
    assert derive_files(tmp_path).state == "separated"

    (tmp_path / "analysis.json").write_text("{}")
    assert derive_files(tmp_path).state == "analyzed"


def test_partial_stems_do_not_count_as_separated(tmp_path):
    # A cancelled or crashed separation must not read as a finished one.
    (tmp_path / "stems").mkdir()
    (tmp_path / "stems" / "bass.wav").write_bytes(b"")
    assert derive_files(tmp_path).has_stems is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest packages/stemcraft_lib/tests/test_song.py -v`
Expected: FAIL — no module `stemcraft_lib.song`

- [ ] **Step 3: Write the implementation**

```python
# packages/stemcraft_lib/src/stemcraft_lib/song.py
"""song.json: metadata and the practice recipe. The API is its only writer.

Everything else about a Song — whether it is imported, separated or analyzed —
is derived from which files exist on disk, never stored.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field, ValidationError

from .atomic import atomic_write_json
from .ids import new_song_id

SCHEMA_VERSION = 1

# Fixed at HTDemucs v4 training time, not configured and not detected.
STEM_NAMES: tuple[str, ...] = ("vocals", "drums", "bass", "other")

SongState = Literal["imported", "separated", "analyzed"]


class SongUnreadable(Exception):
    """One bad song.json never breaks the library (§9); it is listed with this
    reason and the other songs are unaffected."""


class StemMix(BaseModel):
    gain_db: float = 0.0
    muted: bool = False


class Playback(BaseModel):
    tempo: float = 1.0
    pitch_semitones: int = 0


class Loop(BaseModel):
    name: str
    start_bar: int
    end_bar: int


class Source(BaseModel):
    kind: Literal["upload", "url"]
    value: str


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


def new_song(*, title: str, artist: str, source_kind: str, source_value: str) -> Song:
    return Song(
        id=new_song_id(),
        title=title,
        artist=artist,
        source=Source(kind=source_kind, value=source_value),
        created_at=datetime.now(UTC).isoformat(),
        mix={name: StemMix() for name in STEM_NAMES},
    )


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
    # No older versions exist yet. When v2 lands, upgrade steps chain here and
    # write_song persists the result forward in place.
    raise SongUnreadable(f"{path}: no migration from schema_version {version}")


def read_song(song_dir: Path) -> Song:
    path = song_dir / "song.json"
    try:
        raw = json.loads(path.read_text())
    except FileNotFoundError as exc:
        raise SongUnreadable(f"{path}: missing") from exc
    except json.JSONDecodeError as exc:
        raise SongUnreadable(f"{path}: invalid JSON at line {exc.lineno}: {exc.msg}") from exc
    if not isinstance(raw, dict):
        raise SongUnreadable(f"{path}: expected an object")
    try:
        return Song.model_validate(_migrate(raw, path))
    except ValidationError as exc:
        raise SongUnreadable(f"{path}: {exc.error_count()} invalid field(s): {exc}") from exc


def write_song(song_dir: Path, song: Song) -> None:
    atomic_write_json(song_dir / "song.json", song.model_dump(mode="json"))


@dataclass(frozen=True)
class SongFiles:
    has_audio: bool
    has_peaks: bool
    has_stems: bool
    has_analysis: bool

    @property
    def state(self) -> SongState:
        if self.has_analysis:
            return "analyzed"
        if self.has_stems:
            return "separated"
        return "imported"


def derive_files(song_dir: Path) -> SongFiles:
    stems = song_dir / "stems"
    return SongFiles(
        has_audio=(song_dir / "audio.wav").is_file(),
        has_peaks=(song_dir / "peaks.json").is_file(),
        # All four, or none: a partial set is a crashed job, not a separated song.
        has_stems=all((stems / f"{name}.wav").is_file() for name in STEM_NAMES),
        has_analysis=(song_dir / "analysis.json").is_file(),
    )
```

- [ ] **Step 4: Run tests**

Run: `uv run pytest packages/stemcraft_lib/tests/test_song.py -v`
Expected: 7 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/stemcraft_lib/src/stemcraft_lib/song.py packages/stemcraft_lib/tests/test_song.py
git commit -m "feat(lib): song.json models, migration guard and derived state"
```

---

## Task 5: Boot dependency validation

**Files:**
- Create: `packages/stemcraft_lib/src/stemcraft_lib/deps.py`
- Test: `packages/stemcraft_lib/tests/test_deps.py`

**Interfaces:**
- Consumes: `settings()` (Task 1).
- Produces: `DepCheck(name: str, ok: bool, detail: str)` dataclass; `check_all(*, require_yt_dlp: bool = True) -> list[DepCheck]`; `DependencyError(Exception)`; `assert_ready(*, require_yt_dlp: bool = True) -> list[DepCheck]` which raises `DependencyError` listing every failure.

Checks, per §4: ffmpeg on PATH and able to decode and encode MP3; `yt-dlp` present; data and songs directories writable; SQLite opens in WAL mode. The worker adds its model/inference proof in Phase 4 — not here.

- [ ] **Step 1: Write the failing test**

```python
# packages/stemcraft_lib/tests/test_deps.py
import pytest

from stemcraft_lib.deps import DependencyError, assert_ready, check_all


def test_reports_one_check_per_dependency(monkeypatch, tmp_path):
    monkeypatch.setenv("STEMCRAFT_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("STEMCRAFT_SONGS_DIR", str(tmp_path / "songs"))
    names = {c.name for c in check_all()}
    assert names == {"ffmpeg", "yt-dlp", "data_dirs", "sqlite_wal"}


def test_missing_ffmpeg_fails_loudly_with_the_real_reason(monkeypatch, tmp_path):
    monkeypatch.setenv("STEMCRAFT_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("STEMCRAFT_SONGS_DIR", str(tmp_path / "songs"))
    monkeypatch.setenv("PATH", str(tmp_path / "empty"))
    checks = {c.name: c for c in check_all()}
    assert checks["ffmpeg"].ok is False
    assert "not on PATH" in checks["ffmpeg"].detail

    # N-08: refuse to start, and name every failure, not just the first.
    with pytest.raises(DependencyError) as err:
        assert_ready()
    assert "ffmpeg" in str(err.value)
    assert "yt-dlp" in str(err.value)


def test_unwritable_data_dir_is_a_failure(monkeypatch, tmp_path):
    blocked = tmp_path / "ro"
    blocked.mkdir(mode=0o500)
    monkeypatch.setenv("STEMCRAFT_DATA_DIR", str(blocked / "data"))
    monkeypatch.setenv("STEMCRAFT_SONGS_DIR", str(tmp_path / "songs"))
    checks = {c.name: c for c in check_all()}
    assert checks["data_dirs"].ok is False


@pytest.mark.skipif(
    __import__("shutil").which("ffmpeg") is None, reason="ffmpeg not installed on this host"
)
def test_real_ffmpeg_can_decode_and_encode_mp3(monkeypatch, tmp_path):
    monkeypatch.setenv("STEMCRAFT_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("STEMCRAFT_SONGS_DIR", str(tmp_path / "songs"))
    checks = {c.name: c for c in check_all()}
    assert checks["ffmpeg"].ok is True, checks["ffmpeg"].detail
    assert checks["sqlite_wal"].ok is True, checks["sqlite_wal"].detail
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest packages/stemcraft_lib/tests/test_deps.py -v`
Expected: FAIL — no module `stemcraft_lib.deps`

- [ ] **Step 3: Write the implementation**

```python
# packages/stemcraft_lib/src/stemcraft_lib/deps.py
"""Boot validation. Both processes refuse to start when these fail (§4, N-08).

An MP3 round trip is the check that matters, not merely `ffmpeg -version`: a
build without an MP3 encoder passes a version check and then fails at export.
"""

from __future__ import annotations

import shutil
import sqlite3
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path

from .config import SAMPLE_RATE, settings


class DependencyError(Exception):
    pass


@dataclass(frozen=True)
class DepCheck:
    name: str
    ok: bool
    detail: str


def _check_ffmpeg() -> DepCheck:
    exe = shutil.which("ffmpeg")
    if exe is None:
        return DepCheck("ffmpeg", False, "ffmpeg is not on PATH (C-04: the only audio I/O path)")
    with tempfile.TemporaryDirectory() as tmp:
        mp3 = Path(tmp) / "probe.mp3"
        encode = subprocess.run(
            [exe, "-hide_banner", "-nostdin", "-f", "lavfi", "-i",
             f"sine=frequency=440:duration=0.1:sample_rate={SAMPLE_RATE}",
             "-ac", "2", "-codec:a", "libmp3lame", "-y", str(mp3)],
            capture_output=True, text=True, timeout=30,
        )
        if encode.returncode != 0:
            return DepCheck("ffmpeg", False, f"MP3 encode failed: {encode.stderr.strip()[-500:]}")
        decode = subprocess.run(
            [exe, "-hide_banner", "-nostdin", "-i", str(mp3), "-f", "null", "-"],
            capture_output=True, text=True, timeout=30,
        )
        if decode.returncode != 0:
            return DepCheck("ffmpeg", False, f"decode failed: {decode.stderr.strip()[-500:]}")
    return DepCheck("ffmpeg", True, exe)


def _check_yt_dlp() -> DepCheck:
    exe = shutil.which("yt-dlp")
    if exe is None:
        # R-04: currently absent on the host. C-08 makes it refuse-to-start.
        return DepCheck("yt-dlp", False, "yt-dlp is not on PATH (C-08: required, keep it updated)")
    proc = subprocess.run([exe, "--version"], capture_output=True, text=True, timeout=30)
    if proc.returncode != 0:
        return DepCheck("yt-dlp", False, proc.stderr.strip()[-500:])
    return DepCheck("yt-dlp", True, f"{exe} ({proc.stdout.strip()})")


def _check_dirs() -> DepCheck:
    cfg = settings()
    for directory in (cfg.data_dir, cfg.songs_dir):
        try:
            directory.mkdir(parents=True, exist_ok=True)
            probe = directory / ".write-probe"
            probe.write_text("ok")
            probe.unlink()
        except OSError as exc:
            return DepCheck("data_dirs", False, f"{directory}: {exc}")
    return DepCheck("data_dirs", True, f"{cfg.data_dir}, {cfg.songs_dir}")


def _check_sqlite_wal() -> DepCheck:
    cfg = settings()
    try:
        cfg.jobs_db.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(cfg.jobs_db)
        try:
            mode = conn.execute("PRAGMA journal_mode=WAL").fetchone()[0]
        finally:
            conn.close()
    except OSError as exc:
        return DepCheck("sqlite_wal", False, f"{cfg.jobs_db}: {exc}")
    except sqlite3.Error as exc:
        return DepCheck("sqlite_wal", False, f"{cfg.jobs_db}: {exc}")
    if str(mode).lower() != "wal":
        return DepCheck("sqlite_wal", False, f"journal_mode is {mode!r}, not wal")
    return DepCheck("sqlite_wal", True, str(cfg.jobs_db))


def check_all(*, require_yt_dlp: bool = True) -> list[DepCheck]:
    checks = [_check_ffmpeg(), _check_dirs(), _check_sqlite_wal()]
    yt = _check_yt_dlp()
    if not require_yt_dlp and not yt.ok:
        yt = DepCheck("yt-dlp", True, f"not required in this configuration ({yt.detail})")
    checks.append(yt)
    return checks


def assert_ready(*, require_yt_dlp: bool = True) -> list[DepCheck]:
    checks = check_all(require_yt_dlp=require_yt_dlp)
    failed = [c for c in checks if not c.ok]
    if failed:
        lines = "\n".join(f"  - {c.name}: {c.detail}" for c in failed)
        raise DependencyError(f"refusing to start; unmet dependencies:\n{lines}")
    return checks
```

- [ ] **Step 4: Run tests**

Run: `uv run pytest packages/stemcraft_lib/tests/test_deps.py -v`
Expected: 4 passed (the last may skip if ffmpeg is absent; on this host it is present).

- [ ] **Step 5: Commit**

```bash
git add packages/stemcraft_lib/src/stemcraft_lib/deps.py packages/stemcraft_lib/tests/test_deps.py
git commit -m "feat(lib): boot dependency validation with an MP3 round trip"
```

---

## Task 6: jobs.sqlite schema and enqueue

**Files:**
- Create: `packages/stemcraft_lib/src/stemcraft_lib/jobs.py`
- Test: `packages/stemcraft_lib/tests/test_jobs_schema.py`

**Interfaces:**
- Produces: `connect(path: Path) -> sqlite3.Connection` (applies pragmas, creates schema, `row_factory = sqlite3.Row`); `Job` TypedDict-like `dataclass` with every column; `enqueue(conn, *, kind: str, song_id: str | None = None, payload: dict | None = None) -> int`; `get_job(conn, job_id: int) -> Job | None`; `list_jobs(conn, *, states: tuple[str, ...] | None = None, limit: int = 200) -> list[Job]`; `data_version(conn) -> int`.

- [ ] **Step 1: Write the failing test**

```python
# packages/stemcraft_lib/tests/test_jobs_schema.py
from stemcraft_lib.jobs import connect, data_version, enqueue, get_job, list_jobs


def test_pragmas_match_the_spec(tmp_path):
    conn = connect(tmp_path / "jobs.sqlite")
    assert conn.execute("PRAGMA journal_mode").fetchone()[0].lower() == "wal"
    assert conn.execute("PRAGMA busy_timeout").fetchone()[0] == 5000
    assert conn.execute("PRAGMA synchronous").fetchone()[0] == 1  # NORMAL


def test_schema_has_every_documented_column(tmp_path):
    conn = connect(tmp_path / "jobs.sqlite")
    cols = {r[1] for r in conn.execute("PRAGMA table_info(jobs)")}
    assert cols == {
        "id", "song_id", "kind", "payload", "state", "cancel_requested", "progress",
        "device", "lease_until", "created_at", "started_at", "finished_at", "error", "result",
    }


def test_enqueue_starts_queued_at_zero_progress(tmp_path):
    conn = connect(tmp_path / "jobs.sqlite")
    job_id = enqueue(conn, kind="probe", payload={"steps": 3})
    job = get_job(conn, job_id)
    assert job.state == "queued"
    assert job.progress == 0
    assert job.payload == {"steps": 3}
    assert job.created_at > 0
    assert job.started_at is None


def test_connecting_twice_is_idempotent(tmp_path):
    path = tmp_path / "jobs.sqlite"
    enqueue(connect(path), kind="probe")
    assert len(list_jobs(connect(path))) == 1


def test_list_is_newest_first_and_filterable(tmp_path):
    conn = connect(tmp_path / "jobs.sqlite")
    first = enqueue(conn, kind="probe")
    second = enqueue(conn, kind="probe")
    assert [j.id for j in list_jobs(conn)] == [second, first]
    assert list_jobs(conn, states=("done",)) == []


def test_data_version_changes_on_write(tmp_path):
    conn = connect(tmp_path / "jobs.sqlite")
    before = data_version(conn)
    enqueue(conn, kind="probe")
    assert data_version(conn) != before
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest packages/stemcraft_lib/tests/test_jobs_schema.py -v`
Expected: FAIL — no module `stemcraft_lib.jobs`

- [ ] **Step 3: Write the implementation**

```python
# packages/stemcraft_lib/src/stemcraft_lib/jobs.py
"""jobs.sqlite: the real contract between API and worker.

The API enqueues and cancels; the worker claims, renews and finishes. Neither
calls the other. Schema and pragmas are verbatim from the domain spec.
"""

from __future__ import annotations

import json
import sqlite3
import time
from dataclasses import dataclass
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS jobs (
  id               INTEGER PRIMARY KEY,
  song_id          TEXT,
  kind             TEXT,
  payload          TEXT,
  state            TEXT,
  cancel_requested INTEGER DEFAULT 0,
  progress         REAL DEFAULT 0,
  device           TEXT,
  lease_until      REAL,
  created_at       REAL,
  started_at       REAL,
  finished_at      REAL,
  error            TEXT,
  result           TEXT
);
CREATE INDEX IF NOT EXISTS jobs_state_id ON jobs (state, id);
CREATE INDEX IF NOT EXISTS jobs_song ON jobs (song_id);
"""


@dataclass(frozen=True)
class Job:
    id: int
    song_id: str | None
    kind: str
    payload: dict
    state: str
    cancel_requested: bool
    progress: float
    device: str | None
    lease_until: float | None
    created_at: float | None
    started_at: float | None
    finished_at: float | None
    error: str | None
    result: dict | None


def _row_to_job(row: sqlite3.Row) -> Job:
    return Job(
        id=row["id"],
        song_id=row["song_id"],
        kind=row["kind"],
        payload=json.loads(row["payload"]) if row["payload"] else {},
        state=row["state"],
        cancel_requested=bool(row["cancel_requested"]),
        progress=row["progress"] or 0.0,
        device=row["device"],
        lease_until=row["lease_until"],
        created_at=row["created_at"],
        started_at=row["started_at"],
        finished_at=row["finished_at"],
        error=row["error"],
        result=json.loads(row["result"]) if row["result"] else None,
    )


def connect(path: Path) -> sqlite3.Connection:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path, isolation_level=None, timeout=5.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.executescript(SCHEMA)
    return conn


def data_version(conn: sqlite3.Connection) -> int:
    """Cheap change detector: bumps when another connection commits. Lets the
    WebSocket poll skip the query entirely when nothing has happened."""
    return conn.execute("PRAGMA data_version").fetchone()[0]


def enqueue(
    conn: sqlite3.Connection,
    *,
    kind: str,
    song_id: str | None = None,
    payload: dict | None = None,
) -> int:
    cur = conn.execute(
        "INSERT INTO jobs (song_id, kind, payload, state, progress, created_at) "
        "VALUES (?, ?, ?, 'queued', 0, ?)",
        (song_id, kind, json.dumps(payload or {}), time.time()),
    )
    return int(cur.lastrowid)


def get_job(conn: sqlite3.Connection, job_id: int) -> Job | None:
    row = conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
    return _row_to_job(row) if row else None


def list_jobs(
    conn: sqlite3.Connection,
    *,
    states: tuple[str, ...] | None = None,
    limit: int = 200,
) -> list[Job]:
    sql = "SELECT * FROM jobs"
    params: list[object] = []
    if states:
        sql += f" WHERE state IN ({','.join('?' * len(states))})"
        params.extend(states)
    sql += " ORDER BY id DESC LIMIT ?"
    params.append(limit)
    return [_row_to_job(r) for r in conn.execute(sql, params)]
```

- [ ] **Step 4: Run tests**

Run: `uv run pytest packages/stemcraft_lib/tests/test_jobs_schema.py -v`
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/stemcraft_lib/src/stemcraft_lib/jobs.py packages/stemcraft_lib/tests/test_jobs_schema.py
git commit -m "feat(lib): jobs.sqlite schema, pragmas and enqueue"
```

---

## Task 7: Leases, cancellation and crash recovery

**Files:**
- Modify: `packages/stemcraft_lib/src/stemcraft_lib/jobs.py` (append)
- Test: `packages/stemcraft_lib/tests/test_jobs_lease.py`

**Interfaces:**
- Consumes: `connect`, `enqueue`, `get_job`, `Job` (Task 6).
- Produces: `LEASE_SECONDS: float = 30.0`; `claim_next(conn, *, device: str, lease_seconds: float = LEASE_SECONDS, now: float | None = None) -> Job | None`; `renew(conn, job_id: int, *, lease_seconds: float = LEASE_SECONDS) -> None`; `set_progress(conn, job_id: int, progress: float) -> None`; `finish(conn, job_id: int, result: dict | None = None) -> None`; `fail(conn, job_id: int, error: str) -> None`; `request_cancel(conn, job_id: int) -> str` returning the resulting state; `is_cancel_requested(conn, job_id: int) -> bool`; `cancelled(conn, job_id: int) -> None` (terminal state for a job that stopped at a checkpoint); `reclaim_expired(conn, *, now: float | None = None) -> list[int]`.

- [ ] **Step 1: Write the failing test**

```python
# packages/stemcraft_lib/tests/test_jobs_lease.py
import time

from stemcraft_lib.jobs import (
    claim_next,
    connect,
    enqueue,
    fail,
    finish,
    get_job,
    is_cancel_requested,
    reclaim_expired,
    renew,
    request_cancel,
    set_progress,
)


def test_claim_marks_running_and_stamps_lease_device_and_start(tmp_path):
    conn = connect(tmp_path / "j.sqlite")
    job_id = enqueue(conn, kind="probe")
    claimed = claim_next(conn, device="cpu", lease_seconds=30)
    assert claimed.id == job_id
    stored = get_job(conn, job_id)
    assert stored.state == "running"
    assert stored.device == "cpu"
    assert stored.started_at > 0
    assert stored.lease_until > time.time()


def test_claims_oldest_first(tmp_path):
    conn = connect(tmp_path / "j.sqlite")
    first = enqueue(conn, kind="probe")
    enqueue(conn, kind="probe")
    assert claim_next(conn, device="cpu").id == first


def test_only_one_job_runs_at_a_time(tmp_path):
    # C-07: strictly serial. One worker, one job.
    conn = connect(tmp_path / "j.sqlite")
    enqueue(conn, kind="probe")
    enqueue(conn, kind="probe")
    assert claim_next(conn, device="cpu") is not None
    assert claim_next(conn, device="cpu") is None


def test_claim_returns_none_on_empty_queue(tmp_path):
    assert claim_next(connect(tmp_path / "j.sqlite"), device="cpu") is None


def test_expired_lease_is_reclaimed_and_rerun_from_the_start(tmp_path):
    # §9 worker crash mid-job. Safe because every kind is idempotent by
    # re-derivation (§6), so re-running reproduces the same outputs.
    conn = connect(tmp_path / "j.sqlite")
    job_id = enqueue(conn, kind="probe")
    claim_next(conn, device="cpu", lease_seconds=-1)
    set_progress(conn, job_id, 0.6)

    assert reclaim_expired(conn) == [job_id]
    requeued = get_job(conn, job_id)
    assert requeued.state == "queued"
    assert requeued.progress == 0
    assert requeued.lease_until is None
    assert claim_next(conn, device="cpu").id == job_id


def test_live_lease_is_not_reclaimed(tmp_path):
    conn = connect(tmp_path / "j.sqlite")
    enqueue(conn, kind="probe")
    claim_next(conn, device="cpu", lease_seconds=60)
    assert reclaim_expired(conn) == []


def test_renew_extends_the_lease(tmp_path):
    conn = connect(tmp_path / "j.sqlite")
    job_id = enqueue(conn, kind="probe")
    claim_next(conn, device="cpu", lease_seconds=1)
    before = get_job(conn, job_id).lease_until
    renew(conn, job_id, lease_seconds=120)
    assert get_job(conn, job_id).lease_until > before


def test_cancelling_a_queued_job_is_immediate_and_it_never_runs(tmp_path):
    conn = connect(tmp_path / "j.sqlite")
    job_id = enqueue(conn, kind="probe")
    assert request_cancel(conn, job_id) == "cancelled"
    assert get_job(conn, job_id).finished_at > 0
    assert claim_next(conn, device="cpu") is None


def test_cancelling_a_running_job_only_sets_the_flag(tmp_path):
    conn = connect(tmp_path / "j.sqlite")
    job_id = enqueue(conn, kind="probe")
    claim_next(conn, device="cpu")
    assert request_cancel(conn, job_id) == "running"
    assert is_cancel_requested(conn, job_id) is True
    assert get_job(conn, job_id).state == "running"


def test_finish_and_fail_record_terminal_state(tmp_path):
    conn = connect(tmp_path / "j.sqlite")
    ok = enqueue(conn, kind="probe")
    claim_next(conn, device="cpu")
    finish(conn, ok, {"steps": 3})
    done = get_job(conn, ok)
    assert done.state == "done" and done.progress == 1.0 and done.result == {"steps": 3}
    assert done.finished_at > 0

    bad = enqueue(conn, kind="probe")
    claim_next(conn, device="cpu")
    fail(conn, bad, "Traceback...\nRuntimeError: boom")
    broken = get_job(conn, bad)
    assert broken.state == "failed"
    assert "RuntimeError: boom" in broken.error
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest packages/stemcraft_lib/tests/test_jobs_lease.py -v`
Expected: FAIL — `ImportError: cannot import name 'claim_next'`

- [ ] **Step 3: Append the implementation to `jobs.py`**

```python
LEASE_SECONDS = 30.0


def claim_next(
    conn: sqlite3.Connection,
    *,
    device: str,
    lease_seconds: float = LEASE_SECONDS,
    now: float | None = None,
) -> Job | None:
    """Atomically take the oldest queued job, but only if nothing is running
    (C-07). IMMEDIATE opens the write transaction up front so two workers can
    never both read an empty running set."""
    at = time.time() if now is None else now
    conn.execute("BEGIN IMMEDIATE")
    try:
        running = conn.execute(
            "SELECT COUNT(*) FROM jobs WHERE state = 'running'"
        ).fetchone()[0]
        if running:
            conn.execute("ROLLBACK")
            return None
        row = conn.execute(
            "UPDATE jobs SET state = 'running', device = ?, started_at = ?, lease_until = ? "
            "WHERE id = (SELECT id FROM jobs WHERE state = 'queued' ORDER BY id LIMIT 1) "
            "RETURNING *",
            (device, at, at + lease_seconds),
        ).fetchone()
        conn.execute("COMMIT")
    except BaseException:
        conn.execute("ROLLBACK")
        raise
    return _row_to_job(row) if row else None


def renew(conn: sqlite3.Connection, job_id: int, *, lease_seconds: float = LEASE_SECONDS) -> None:
    conn.execute(
        "UPDATE jobs SET lease_until = ? WHERE id = ? AND state = 'running'",
        (time.time() + lease_seconds, job_id),
    )


def set_progress(conn: sqlite3.Connection, job_id: int, progress: float) -> None:
    conn.execute(
        "UPDATE jobs SET progress = ? WHERE id = ? AND state = 'running'",
        (max(0.0, min(1.0, progress)), job_id),
    )


def finish(conn: sqlite3.Connection, job_id: int, result: dict | None = None) -> None:
    conn.execute(
        "UPDATE jobs SET state = 'done', progress = 1.0, finished_at = ?, lease_until = NULL, "
        "result = ? WHERE id = ?",
        (time.time(), json.dumps(result) if result is not None else None, job_id),
    )


def fail(conn: sqlite3.Connection, job_id: int, error: str) -> None:
    # N-08: the real message and traceback, kept verbatim for the Job Queue view.
    conn.execute(
        "UPDATE jobs SET state = 'failed', finished_at = ?, lease_until = NULL, error = ? "
        "WHERE id = ?",
        (time.time(), error, job_id),
    )


def request_cancel(conn: sqlite3.Connection, job_id: int) -> str:
    """Queued jobs cancel immediately. A running job gets a flag and stops at
    its next checkpoint (§9) — never hard-killed, which is what keeps VRAM from
    being orphaned."""
    conn.execute("BEGIN IMMEDIATE")
    try:
        row = conn.execute("SELECT state FROM jobs WHERE id = ?", (job_id,)).fetchone()
        if row is None:
            conn.execute("ROLLBACK")
            raise KeyError(job_id)
        state = row["state"]
        if state == "queued":
            conn.execute(
                "UPDATE jobs SET state = 'cancelled', finished_at = ? WHERE id = ?",
                (time.time(), job_id),
            )
            state = "cancelled"
        elif state == "running":
            conn.execute("UPDATE jobs SET cancel_requested = 1 WHERE id = ?", (job_id,))
        conn.execute("COMMIT")
    except BaseException:
        conn.execute("ROLLBACK")
        raise
    return state


def is_cancel_requested(conn: sqlite3.Connection, job_id: int) -> bool:
    row = conn.execute("SELECT cancel_requested FROM jobs WHERE id = ?", (job_id,)).fetchone()
    return bool(row and row["cancel_requested"])


def cancelled(conn: sqlite3.Connection, job_id: int) -> None:
    conn.execute(
        "UPDATE jobs SET state = 'cancelled', finished_at = ?, lease_until = NULL WHERE id = ?",
        (time.time(), job_id),
    )


def reclaim_expired(conn: sqlite3.Connection, *, now: float | None = None) -> list[int]:
    """Requeue jobs whose worker died holding the lease. Progress resets to 0
    because the job re-runs from the start."""
    at = time.time() if now is None else now
    rows = conn.execute(
        "UPDATE jobs SET state = 'queued', progress = 0, lease_until = NULL, started_at = NULL, "
        "device = NULL WHERE state = 'running' AND lease_until IS NOT NULL AND lease_until < ? "
        "RETURNING id",
        (at,),
    ).fetchall()
    return [r["id"] for r in rows]
```

- [ ] **Step 4: Run tests**

Run: `uv run pytest packages/stemcraft_lib/tests/test_jobs_lease.py -v`
Expected: 10 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/stemcraft_lib/src/stemcraft_lib/jobs.py packages/stemcraft_lib/tests/test_jobs_lease.py
git commit -m "feat(lib): lease claim, cancellation and crash recovery"
```

---

## Task 8: Worker — registry, probe kind, poll loop

**Files:**
- Create: `packages/stemcraft_worker/pyproject.toml`, `packages/stemcraft_worker/src/stemcraft_worker/__init__.py`, `registry.py`, `kinds/__init__.py`, `kinds/probe.py`, `main.py`
- Test: `packages/stemcraft_worker/tests/test_worker_loop.py`

**Interfaces:**
- Consumes: `stemcraft_lib.jobs` (Tasks 6–7), `stemcraft_lib.deps.assert_ready` (Task 5), `stemcraft_lib.config.settings` (Task 1).
- Produces: `JobContext` with `job_id: int`, `payload: dict`, `progress(fraction: float) -> None`, `cancelled() -> bool`; `JobCancelled(Exception)`; `register(name: str, fn: Callable[[JobContext], dict | None]) -> None`; `get_kind(name: str) -> Callable`; `KINDS: dict[str, Callable]`; `run_one(conn, *, device: str) -> int | None` returning the job id it handled or `None` when the queue was empty; `main() -> None`.

Detail that matters: a `sqlite3.Connection` belongs to the thread that made it, so the lease-renewal thread opens its own connection to the same file. WAL makes that concurrent writer safe.

- [ ] **Step 1: Write the failing test**

```python
# packages/stemcraft_worker/tests/test_worker_loop.py
import pytest

from stemcraft_lib.jobs import connect, enqueue, get_job, request_cancel
from stemcraft_worker.registry import JobCancelled, JobContext, register
from stemcraft_worker.main import run_one


@pytest.fixture
def conn(tmp_path):
    return connect(tmp_path / "jobs.sqlite")


def test_runs_a_job_and_records_its_result(conn):
    register("t_ok", lambda ctx: {"doubled": ctx.payload["n"] * 2})
    job_id = enqueue(conn, kind="t_ok", payload={"n": 21})

    assert run_one(conn, device="cpu") == job_id
    done = get_job(conn, job_id)
    assert done.state == "done"
    assert done.result == {"doubled": 42}
    assert done.progress == 1.0


def test_empty_queue_returns_none(conn):
    assert run_one(conn, device="cpu") is None


def test_progress_reaches_the_row_while_running(conn):
    seen = []

    def kind(ctx: JobContext) -> None:
        ctx.progress(0.5)
        seen.append(get_job(ctx.conn, ctx.job_id).progress)

    register("t_progress", kind)
    enqueue(conn, kind="t_progress")
    run_one(conn, device="cpu")
    assert seen == [0.5]


def test_cancel_requested_mid_run_lands_as_cancelled(conn):
    def kind(ctx: JobContext) -> None:
        request_cancel(ctx.conn, ctx.job_id)
        if ctx.cancelled():
            raise JobCancelled
        raise AssertionError("cancel flag was not visible to the job")

    register("t_cancel", kind)
    job_id = enqueue(conn, kind="t_cancel")
    run_one(conn, device="cpu")
    cancelled = get_job(conn, job_id)
    assert cancelled.state == "cancelled"
    assert cancelled.error is None


def test_exception_fails_the_job_with_the_real_traceback(conn):
    def kind(ctx: JobContext) -> None:
        raise RuntimeError("boom")

    register("t_boom", kind)
    job_id = enqueue(conn, kind="t_boom")
    run_one(conn, device="cpu")
    failed = get_job(conn, job_id)
    assert failed.state == "failed"
    assert "RuntimeError: boom" in failed.error
    assert "Traceback" in failed.error


def test_unknown_kind_fails_loudly_instead_of_being_skipped(conn):
    job_id = enqueue(conn, kind="t_does_not_exist")
    run_one(conn, device="cpu")
    failed = get_job(conn, job_id)
    assert failed.state == "failed"
    assert "t_does_not_exist" in failed.error


def test_probe_kind_completes_and_reports_its_steps(conn):
    import stemcraft_worker.kinds.probe  # noqa: F401  (registers on import)

    job_id = enqueue(conn, kind="probe", payload={"steps": 3, "step_seconds": 0.01})
    run_one(conn, device="cpu")
    assert get_job(conn, job_id).result == {"steps": 3}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest packages/stemcraft_worker -v`
Expected: FAIL — no module `stemcraft_worker`

- [ ] **Step 3: Create the package**

```toml
# packages/stemcraft_worker/pyproject.toml
[project]
name = "stemcraft-worker"
version = "0.1.0"
requires-python = ">=3.12,<3.13"
# Phase 4 adds torch here, pinned to the cu128 index by a constraints file (D-02).
dependencies = ["stemcraft-lib"]

[project.scripts]
stemcraft-worker = "stemcraft_worker.main:main"

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["src/stemcraft_worker"]

[tool.uv.sources]
stemcraft-lib = { workspace = true }
```

Now that the package exists, register it with the root workspace so `uv sync`
at the repo root installs it too. Edit the root `pyproject.toml` (Task 1):

```toml
# pyproject.toml — add to [project] dependencies
dependencies = [
    "stemcraft-lib",
    "stemcraft-worker",
]
```

```toml
# pyproject.toml — add to [tool.uv.sources]
[tool.uv.sources]
stemcraft-lib = { workspace = true }
stemcraft-worker = { workspace = true }
```

- [ ] **Step 4: Write the registry**

```python
# packages/stemcraft_worker/src/stemcraft_worker/registry.py
"""Job kinds register themselves here. A kind is a function of a JobContext
returning a JSON-serializable result.

Every kind must be idempotent by re-derivation (§6): re-running it reproduces
its outputs from inputs that never change. Lease-based crash recovery re-runs
jobs from the start and relies on exactly that.
"""

from __future__ import annotations

import sqlite3
from collections.abc import Callable
from dataclasses import dataclass

from stemcraft_lib import jobs as jobs_db


class JobCancelled(Exception):
    """Raised by a kind when it notices ctx.cancelled() at a checkpoint."""


@dataclass
class JobContext:
    conn: sqlite3.Connection
    job_id: int
    payload: dict
    device: str

    def progress(self, fraction: float) -> None:
        jobs_db.set_progress(self.conn, self.job_id, fraction)

    def cancelled(self) -> bool:
        return jobs_db.is_cancel_requested(self.conn, self.job_id)


JobFn = Callable[[JobContext], dict | None]
KINDS: dict[str, JobFn] = {}


def register(name: str, fn: JobFn) -> None:
    KINDS[name] = fn


def get_kind(name: str) -> JobFn:
    try:
        return KINDS[name]
    except KeyError as exc:
        raise KeyError(f"no registered job kind named {name!r}") from exc
```

- [ ] **Step 5: Write the probe kind**

```python
# packages/stemcraft_worker/src/stemcraft_worker/kinds/probe.py
"""A job that does nothing but be observable.

It exists so the queue, leases, progress, cancellation and the WebSocket can be
exercised end to end with no audio, no ffmpeg and no GPU — which is the whole
point of Phase 1.
"""

from __future__ import annotations

import time

from ..registry import JobCancelled, JobContext, register


def run(ctx: JobContext) -> dict:
    steps = int(ctx.payload.get("steps", 10))
    step_seconds = float(ctx.payload.get("step_seconds", 0.5))
    for index in range(steps):
        if ctx.cancelled():
            raise JobCancelled
        time.sleep(step_seconds)
        ctx.progress((index + 1) / steps)
    return {"steps": steps}


register("probe", run)
```

Create empty `packages/stemcraft_worker/src/stemcraft_worker/__init__.py`, and make the
`kinds` package register its built-ins on import:

```python
# packages/stemcraft_worker/src/stemcraft_worker/kinds/__init__.py
"""Importing this package registers every built-in job kind."""

from . import probe  # noqa: F401
```

- [ ] **Step 6: Write the loop**

```python
# packages/stemcraft_worker/src/stemcraft_worker/main.py
"""The worker: poll, claim, run, finish. Never called by the API.

It owns all GPU work and everything under a Song folder except song.json.
"""

from __future__ import annotations

import logging
import sqlite3
import threading
import time
import traceback

from stemcraft_lib import jobs as jobs_db
from stemcraft_lib.config import settings
from stemcraft_lib.deps import DependencyError, assert_ready

from . import kinds  # noqa: F401  (importing registers the built-in kinds)
from .registry import JobCancelled, JobContext, get_kind

log = logging.getLogger("stemcraft.worker")
POLL_SECONDS = 0.5


def _renew_until(stop: threading.Event, db_path, job_id: int) -> None:
    """A sqlite3.Connection belongs to its creating thread, so the renewer opens
    its own. WAL makes the second writer safe."""
    conn = jobs_db.connect(db_path)
    try:
        while not stop.wait(jobs_db.LEASE_SECONDS / 3):
            jobs_db.renew(conn, job_id)
    finally:
        conn.close()


def run_one(conn: sqlite3.Connection, *, device: str) -> int | None:
    jobs_db.reclaim_expired(conn)
    job = jobs_db.claim_next(conn, device=device)
    if job is None:
        return None

    stop = threading.Event()
    renewer = threading.Thread(
        target=_renew_until, args=(stop, settings().jobs_db, job.id), daemon=True
    )
    renewer.start()
    try:
        fn = get_kind(job.kind)
        result = fn(JobContext(conn=conn, job_id=job.id, payload=job.payload, device=device))
        jobs_db.finish(conn, job.id, result)
        log.info("job %s (%s) done", job.id, job.kind)
    except JobCancelled:
        jobs_db.cancelled(conn, job.id)
        log.info("job %s (%s) cancelled at a checkpoint", job.id, job.kind)
    except BaseException:
        # N-08: the real traceback, verbatim, into the row the UI renders.
        jobs_db.fail(conn, job.id, traceback.format_exc())
        log.exception("job %s (%s) failed", job.id, job.kind)
    finally:
        stop.set()
        renewer.join(timeout=5)
    return job.id


def select_device() -> str:
    """Phase 4 replaces this with a CUDA attempt plus a proof-of-work op. The
    API must never learn how this is decided — it only reads the job row."""
    return "cpu"


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    try:
        checks = assert_ready()
    except DependencyError as exc:
        log.error("%s", exc)
        raise SystemExit(1) from exc
    for check in checks:
        log.info("dependency ok: %s (%s)", check.name, check.detail)

    device = select_device()
    conn = jobs_db.connect(settings().jobs_db)
    log.info("worker ready on device=%s, polling %s", device, settings().jobs_db)
    while True:
        if run_one(conn, device=device) is None:
            time.sleep(POLL_SECONDS)
```

- [ ] **Step 7: Run tests**

Run: `uv sync && uv run pytest packages/stemcraft_worker -v`
Expected: 7 passed.

- [ ] **Step 8: Commit**

```bash
git add packages/stemcraft_worker
git commit -m "feat(worker): job registry, probe kind and the poll loop"
```

---

## Task 9: API — app, health, songs, jobs, and the torch-free guard

**Files:**
- Create: `packages/stemcraft_api/pyproject.toml`, `packages/stemcraft_api/src/stemcraft_api/__init__.py`, `app.py`, `deps.py`, `routes/__init__.py`, `routes/health.py`, `routes/songs.py`, `routes/jobs.py`
- Test: `packages/stemcraft_api/tests/test_api.py`

**Interfaces:**
- Consumes: `stemcraft_lib` (Tasks 1–7).
- Produces: `create_app() -> FastAPI`; `get_conn()` FastAPI dependency yielding a per-request `sqlite3.Connection`; routes `GET /api/health`, `GET /api/songs`, `GET /api/songs/{song_id}`, `DELETE /api/songs/{song_id}`, `GET /api/jobs`, `POST /api/jobs`, `POST /api/jobs/{job_id}/cancel`.

Response shapes later tasks depend on:
- `GET /api/health` → `{"deps": [{"name": str, "ok": bool, "detail": str}], "device": str | null, "sample_rate": 48000}`
- `GET /api/songs` → `{"songs": [{"dir": str, "song": Song | null, "state": str | null, "unreadable": str | null, "files": {"has_audio": bool, "has_peaks": bool, "has_stems": bool, "has_analysis": bool} | null}]}`
- `GET /api/jobs` → `{"jobs": [Job]}` with `Job` carrying every column from Task 6
- `POST /api/jobs` body `{"kind": str, "song_id": str | null, "payload": object}` → `{"id": int}`

- [ ] **Step 1: Write the failing test**

```python
# packages/stemcraft_api/tests/test_api.py
import json
import sys

import pytest
from fastapi.testclient import TestClient

from stemcraft_api.app import create_app
from stemcraft_lib.song import new_song, write_song


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("STEMCRAFT_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("STEMCRAFT_SONGS_DIR", str(tmp_path / "songs"))
    monkeypatch.setenv("STEMCRAFT_DIST_DIR", str(tmp_path / "nodist"))
    monkeypatch.setenv("STEMCRAFT_SKIP_BOOT_CHECKS", "1")
    return TestClient(create_app())


def test_the_api_never_imports_torch(client):
    # Invariant §4: a broken CUDA install must not take the UI down. Enforced by
    # the dependency graph (stemcraft-api does not depend on torch) and asserted
    # here so an accidental import cannot slip in.
    client.get("/api/health")
    assert "torch" not in sys.modules


def test_health_reports_every_dependency_and_the_sample_rate(client):
    body = client.get("/api/health").json()
    assert {c["name"] for c in body["deps"]} == {"ffmpeg", "yt-dlp", "data_dirs", "sqlite_wal"}
    assert body["sample_rate"] == 48000
    assert "device" in body


def test_songs_is_empty_before_anything_is_imported(client):
    assert client.get("/api/songs").json() == {"songs": []}


def test_songs_lists_a_good_song_with_derived_state(client, tmp_path):
    song = new_song(title="T", artist="A", source_kind="upload", source_value="original.mp3")
    write_song(tmp_path / "songs" / f"{song.id}-t", song)

    entry = client.get("/api/songs").json()["songs"][0]
    assert entry["song"]["title"] == "T"
    assert entry["state"] == "imported"
    assert entry["unreadable"] is None
    assert entry["files"]["has_stems"] is False


def test_one_corrupt_song_does_not_break_the_library(client, tmp_path):
    good = new_song(title="Good", artist="A", source_kind="upload", source_value="o.mp3")
    write_song(tmp_path / "songs" / f"{good.id}-good", good)
    bad_dir = tmp_path / "songs" / "01BROKEN-bad"
    bad_dir.mkdir(parents=True)
    (bad_dir / "song.json").write_text("{not json")

    entries = {e["dir"]: e for e in client.get("/api/songs").json()["songs"]}
    assert entries[f"{good.id}-good"]["song"]["title"] == "Good"
    broken = entries["01BROKEN-bad"]
    assert broken["song"] is None
    assert "invalid JSON" in broken["unreadable"]


def test_enqueue_list_and_cancel_a_job(client):
    job_id = client.post("/api/jobs", json={"kind": "probe", "payload": {"steps": 2}}).json()["id"]
    listed = client.get("/api/jobs").json()["jobs"]
    assert [j["id"] for j in listed] == [job_id]
    assert listed[0]["state"] == "queued"
    assert listed[0]["payload"] == {"steps": 2}

    assert client.post(f"/api/jobs/{job_id}/cancel").json()["state"] == "cancelled"
    assert client.get("/api/jobs").json()["jobs"][0]["state"] == "cancelled"


def test_cancelling_an_unknown_job_is_a_404(client):
    assert client.post("/api/jobs/9999/cancel").status_code == 404


def test_delete_removes_the_song_folder(client, tmp_path):
    song = new_song(title="T", artist="A", source_kind="upload", source_value="o.mp3")
    song_dir = tmp_path / "songs" / f"{song.id}-t"
    write_song(song_dir, song)
    (song_dir / "original.mp3").write_bytes(b"x")

    assert client.delete(f"/api/songs/{song.id}").status_code == 204
    assert not song_dir.exists()


def test_boot_refuses_to_start_when_dependencies_are_unmet(tmp_path, monkeypatch):
    monkeypatch.setenv("STEMCRAFT_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("STEMCRAFT_SONGS_DIR", str(tmp_path / "songs"))
    monkeypatch.delenv("STEMCRAFT_SKIP_BOOT_CHECKS", raising=False)
    monkeypatch.setenv("PATH", str(tmp_path / "empty"))

    # N-08: loud at startup, not at first use.
    with pytest.raises(Exception) as err:  # noqa: B017 - lifespan re-raises
        with TestClient(create_app()):
            pass
    assert "ffmpeg" in str(err.value)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest packages/stemcraft_api -v`
Expected: FAIL — no module `stemcraft_api`

- [ ] **Step 3: Create the package**

```toml
# packages/stemcraft_api/pyproject.toml
[project]
name = "stemcraft-api"
version = "0.1.0"
requires-python = ">=3.12,<3.13"
# NOTE: torch must never appear here, directly or transitively (§4).
dependencies = ["stemcraft-lib", "fastapi>=0.115", "uvicorn[standard]>=0.30"]

[project.scripts]
stemcraft-api = "stemcraft_api.app:run"

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["src/stemcraft_api"]

[tool.uv.sources]
stemcraft-lib = { workspace = true }
```

Register it with the root workspace, same as Task 8 did for the worker. Edit
the root `pyproject.toml`:

```toml
# pyproject.toml — [project] dependencies, now all three
dependencies = [
    "stemcraft-lib",
    "stemcraft-worker",
    "stemcraft-api",
]
```

```toml
# pyproject.toml — [tool.uv.sources], now all three
[tool.uv.sources]
stemcraft-lib = { workspace = true }
stemcraft-worker = { workspace = true }
stemcraft-api = { workspace = true }
```

- [ ] **Step 4: Write the request dependency**

```python
# packages/stemcraft_api/src/stemcraft_api/deps.py
"""Per-request SQLite connection. Connections are cheap and thread-bound, so a
fresh one per request is simpler and safer than sharing."""

from __future__ import annotations

from collections.abc import Iterator

from stemcraft_lib import jobs as jobs_db
from stemcraft_lib.config import settings


def get_conn() -> Iterator:
    conn = jobs_db.connect(settings().jobs_db)
    try:
        yield conn
    finally:
        conn.close()
```

- [ ] **Step 5: Write the routes**

```python
# packages/stemcraft_api/src/stemcraft_api/routes/health.py
from __future__ import annotations

from fastapi import APIRouter

from stemcraft_lib.config import SAMPLE_RATE
from stemcraft_lib.deps import check_all

router = APIRouter()


@router.get("/api/health")
def health() -> dict:
    """Reports; never refuses. Boot refusal happens in the lifespan (N-08), but
    the UI still needs to render a banner naming what is wrong."""
    return {
        "deps": [{"name": c.name, "ok": c.ok, "detail": c.detail} for c in check_all()],
        # Phase 4 fills this from the worker's latest job row. Until then the
        # API has no way to know, and must not guess.
        "device": None,
        "sample_rate": SAMPLE_RATE,
    }
```

```python
# packages/stemcraft_api/src/stemcraft_api/routes/songs.py
from __future__ import annotations

import shutil
from pathlib import Path

from fastapi import APIRouter, HTTPException, Response

from stemcraft_lib.config import settings
from stemcraft_lib.song import SongUnreadable, derive_files, read_song

router = APIRouter()


def _entry(song_dir: Path) -> dict:
    try:
        song = read_song(song_dir)
    except SongUnreadable as exc:
        # §9: one bad file never breaks the library.
        return {"dir": song_dir.name, "song": None, "state": None, "files": None,
                "unreadable": str(exc)}
    files = derive_files(song_dir)
    return {
        "dir": song_dir.name,
        "song": song.model_dump(mode="json"),
        "state": files.state,
        "files": {
            "has_audio": files.has_audio,
            "has_peaks": files.has_peaks,
            "has_stems": files.has_stems,
            "has_analysis": files.has_analysis,
        },
        "unreadable": None,
    }


def _song_dirs() -> list[Path]:
    songs_dir = settings().songs_dir
    if not songs_dir.is_dir():
        return []
    # D-01: the song list is a scan. At N-07 scale there is no index to desync.
    return sorted(p for p in songs_dir.iterdir() if (p / "song.json").is_file())


def _find_dir(song_id: str) -> Path:
    for candidate in _song_dirs():
        if candidate.name.split("-", 1)[0] == song_id:
            return candidate
    raise HTTPException(status_code=404, detail=f"no song with id {song_id}")


@router.get("/api/songs")
def list_songs() -> dict:
    return {"songs": [_entry(d) for d in _song_dirs()]}


@router.get("/api/songs/{song_id}")
def get_song(song_id: str) -> dict:
    return _entry(_find_dir(song_id))


@router.delete("/api/songs/{song_id}", status_code=204)
def delete_song(song_id: str) -> Response:
    shutil.rmtree(_find_dir(song_id))
    return Response(status_code=204)
```

```python
# packages/stemcraft_api/src/stemcraft_api/routes/jobs.py
from __future__ import annotations

import sqlite3
from dataclasses import asdict
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from stemcraft_lib import jobs as jobs_db

from ..deps import get_conn

router = APIRouter()
Conn = Annotated[sqlite3.Connection, Depends(get_conn)]


class EnqueueRequest(BaseModel):
    kind: str
    song_id: str | None = None
    payload: dict = {}


@router.get("/api/jobs")
def list_jobs(conn: Conn, active: bool = False, limit: int = 200) -> dict:
    states = ("queued", "running") if active else None
    return {"jobs": [asdict(j) for j in jobs_db.list_jobs(conn, states=states, limit=limit)]}


@router.post("/api/jobs", status_code=201)
def enqueue_job(body: EnqueueRequest, conn: Conn) -> dict:
    job_id = jobs_db.enqueue(conn, kind=body.kind, song_id=body.song_id, payload=body.payload)
    return {"id": job_id}


@router.post("/api/jobs/{job_id}/cancel")
def cancel_job(job_id: int, conn: Conn) -> dict:
    try:
        state = jobs_db.request_cancel(conn, job_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=f"no job {job_id}") from exc
    return {"id": job_id, "state": state}
```

Create empty `routes/__init__.py`.

- [ ] **Step 6: Write the app factory**

```python
# packages/stemcraft_api/src/stemcraft_api/app.py
"""The API. Owns song.json, serves the SPA, enqueues jobs.

It never imports torch (§4) and it has no CORS middleware (D-15): dev is one
origin through the Vite proxy, prod is one origin through the static mount.
"""

from __future__ import annotations

import logging
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from stemcraft_lib.config import settings
from stemcraft_lib.deps import assert_ready

from .routes import health, jobs, songs

log = logging.getLogger("stemcraft.api")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    if not os.environ.get("STEMCRAFT_SKIP_BOOT_CHECKS"):
        # Raises DependencyError, which uvicorn surfaces and exits on (N-08).
        for check in assert_ready():
            log.info("dependency ok: %s (%s)", check.name, check.detail)
    yield


def create_app() -> FastAPI:
    app = FastAPI(title="Stemcraft", lifespan=lifespan)
    app.include_router(health.router)
    app.include_router(songs.router)
    app.include_router(jobs.router)
    return app


def run() -> None:
    import uvicorn

    cfg = settings()
    logging.basicConfig(level=logging.INFO)
    uvicorn.run(create_app(), host=cfg.host, port=cfg.port)
```

- [ ] **Step 7: Run tests**

Run: `uv sync && uv run pytest packages/stemcraft_api -v`
Expected: 9 passed.

- [ ] **Step 8: Commit**

```bash
git add packages/stemcraft_api
git commit -m "feat(api): health, songs scan, job endpoints and the torch-free guard"
```

---

## Task 10: WebSocket job push

**Files:**
- Create: `packages/stemcraft_api/src/stemcraft_api/ws.py`
- Modify: `packages/stemcraft_api/src/stemcraft_api/app.py` (include the router)
- Test: `packages/stemcraft_api/tests/test_ws.py`

**Interfaces:**
- Consumes: `stemcraft_lib.jobs.data_version`, `list_jobs` (Task 6).
- Produces: `router` with `WS /api/ws`. Message shape `{"type": "jobs", "jobs": [Job]}`. `POLL_SECONDS = 0.25`.

The socket is advisory (§6): it carries data already durable in `jobs.sqlite`, and the client treats every message as "refetch", not as state (D-13). `PRAGMA data_version` changes whenever another connection commits, so the poll does no query at all while the system is idle.

- [ ] **Step 1: Write the failing test**

```python
# packages/stemcraft_api/tests/test_ws.py
import pytest
from fastapi.testclient import TestClient

from stemcraft_api.app import create_app


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("STEMCRAFT_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("STEMCRAFT_SONGS_DIR", str(tmp_path / "songs"))
    monkeypatch.setenv("STEMCRAFT_SKIP_BOOT_CHECKS", "1")
    return TestClient(create_app())


def test_sends_a_snapshot_on_connect(client):
    with client.websocket_connect("/api/ws") as ws:
        first = ws.receive_json()
        assert first["type"] == "jobs"
        assert first["jobs"] == []


def test_pushes_after_a_job_is_enqueued(client):
    with client.websocket_connect("/api/ws") as ws:
        ws.receive_json()
        job_id = client.post("/api/jobs", json={"kind": "probe"}).json()["id"]
        message = ws.receive_json()
        assert [j["id"] for j in message["jobs"]] == [job_id]
        assert message["jobs"][0]["state"] == "queued"


def test_pushes_again_when_state_changes(client):
    with client.websocket_connect("/api/ws") as ws:
        ws.receive_json()
        job_id = client.post("/api/jobs", json={"kind": "probe"}).json()["id"]
        ws.receive_json()
        client.post(f"/api/jobs/{job_id}/cancel")
        assert ws.receive_json()["jobs"][0]["state"] == "cancelled"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest packages/stemcraft_api/tests/test_ws.py -v`
Expected: FAIL — 403/404 on `/api/ws`, route not registered

- [ ] **Step 3: Write the implementation**

```python
# packages/stemcraft_api/src/stemcraft_api/ws.py
"""Job progress push. Strictly a liveness channel (§6).

Dropping the socket loses liveness, never data: every message is a nudge to
refetch, and the client recovers by refetching on reconnect.
"""

from __future__ import annotations

import asyncio
from dataclasses import asdict

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from stemcraft_lib import jobs as jobs_db
from stemcraft_lib.config import settings

router = APIRouter()
POLL_SECONDS = 0.25
RECENT_LIMIT = 100


def _snapshot(conn) -> dict:
    return {"type": "jobs", "jobs": [asdict(j) for j in jobs_db.list_jobs(conn, limit=RECENT_LIMIT)]}


@router.websocket("/api/ws")
async def job_stream(websocket: WebSocket) -> None:
    await websocket.accept()
    conn = jobs_db.connect(settings().jobs_db)
    try:
        last_version = jobs_db.data_version(conn)
        await websocket.send_json(_snapshot(conn))
        while True:
            await asyncio.sleep(POLL_SECONDS)
            version = jobs_db.data_version(conn)
            if version == last_version:
                continue  # idle: no query, no message
            last_version = version
            await websocket.send_json(_snapshot(conn))
    except WebSocketDisconnect:
        pass
    finally:
        conn.close()
```

- [ ] **Step 4: Register the router**

In `app.py`, add `ws` to the import and `app.include_router(ws.router)` after the jobs router.

- [ ] **Step 5: Run tests**

Run: `uv run pytest packages/stemcraft_api -v`
Expected: 12 passed.

- [ ] **Step 6: Commit**

```bash
git add packages/stemcraft_api
git commit -m "feat(api): websocket job push driven by sqlite data_version"
```

---

## Task 11: Serve the built bundle with SPA fallback

**Files:**
- Create: `packages/stemcraft_api/src/stemcraft_api/static.py`
- Modify: `packages/stemcraft_api/src/stemcraft_api/app.py`
- Test: `packages/stemcraft_api/tests/test_static.py`

**Interfaces:**
- Consumes: `settings().dist_dir` (Task 1).
- Produces: `mount_spa(app: FastAPI, dist_dir: Path) -> None`. Must be called **after** every API router so `/api/*` always wins, and must never serve `index.html` for an unknown `/api/*` path — a 404 that returns HTML is how a typo becomes a silent bug.

- [ ] **Step 1: Write the failing test**

```python
# packages/stemcraft_api/tests/test_static.py
import pytest
from fastapi.testclient import TestClient

from stemcraft_api.app import create_app


@pytest.fixture
def client(tmp_path, monkeypatch):
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<!doctype html><title>Stemcraft</title>")
    (dist / "assets" / "app.js").write_text("console.log('hi')")
    monkeypatch.setenv("STEMCRAFT_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("STEMCRAFT_SONGS_DIR", str(tmp_path / "songs"))
    monkeypatch.setenv("STEMCRAFT_DIST_DIR", str(dist))
    monkeypatch.setenv("STEMCRAFT_SKIP_BOOT_CHECKS", "1")
    return TestClient(create_app())


def test_root_serves_the_bundle(client):
    response = client.get("/")
    assert response.status_code == 200
    assert "Stemcraft" in response.text


def test_deep_link_serves_index_so_the_router_can_take_over(client):
    # D-14: a phone on the LAN bookmarks /songs/<id>; a hard reload must work.
    assert "Stemcraft" in client.get("/songs/01ABC").text


def test_assets_are_served_as_files(client):
    response = client.get("/assets/app.js")
    assert response.status_code == 200
    assert "console.log" in response.text


def test_api_routes_still_win(client):
    assert client.get("/api/health").json()["sample_rate"] == 48000


def test_unknown_api_path_is_a_json_404_not_the_spa(client):
    response = client.get("/api/nope")
    assert response.status_code == 404
    assert "html" not in response.headers["content-type"]


def test_missing_dist_leaves_the_api_working(tmp_path, monkeypatch):
    monkeypatch.setenv("STEMCRAFT_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("STEMCRAFT_SONGS_DIR", str(tmp_path / "songs"))
    monkeypatch.setenv("STEMCRAFT_DIST_DIR", str(tmp_path / "nothing-here"))
    monkeypatch.setenv("STEMCRAFT_SKIP_BOOT_CHECKS", "1")
    with TestClient(create_app()) as client:
        assert client.get("/api/health").status_code == 200
        assert client.get("/").status_code == 404
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest packages/stemcraft_api/tests/test_static.py -v`
Expected: FAIL — `/` returns 404, no module `stemcraft_api.static`

- [ ] **Step 3: Write the implementation**

```python
# packages/stemcraft_api/src/stemcraft_api/static.py
"""Production serving (D-15): FastAPI hands out the built bundle, so the SPA and
the API are genuinely one origin and a stale bundle is impossible."""

from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles


def mount_spa(app: FastAPI, dist_dir: Path) -> None:
    index = dist_dir / "index.html"
    app.mount("/assets", StaticFiles(directory=dist_dir / "assets"), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa(full_path: str) -> FileResponse:
        # An unknown /api path is a bug, not a route for the client router to
        # handle. Returning index.html here would hide it behind a blank screen.
        if full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail=f"no API route /{full_path}")
        direct = dist_dir / full_path
        if full_path and direct.is_file():
            return FileResponse(direct)
        return FileResponse(index)
```

- [ ] **Step 4: Wire it in `create_app`**

Append inside `create_app()`, after every `include_router` call:

```python
    cfg = settings()
    if cfg.dist_dir is not None:
        from .static import mount_spa

        mount_spa(app, cfg.dist_dir)
    return app
```

- [ ] **Step 5: Run the full Python suite**

Run: `uv run pytest -v && uv run ruff check .`
Expected: all tests pass, ruff clean.

- [ ] **Step 6: Commit**

```bash
git add packages/stemcraft_api
git commit -m "feat(api): serve the built bundle with an SPA fallback"
```

---

## Task 12: Frontend scaffold — Vite, routes, Query, tokens

**Files:**
- Create: `frontend/package.json`, `frontend/tsconfig.json`, `frontend/vite.config.ts`, `frontend/index.html`, `frontend/src/main.tsx`, `frontend/src/app/AppShell.tsx`, `frontend/src/app/AppShell.module.css`, `frontend/src/app/routes.tsx`, `frontend/src/api/client.ts`, `frontend/src/api/queries.ts`, `frontend/src/screens/{Library,SongView,Import,AlbumSplitter,JobQueue,ScaleSheet,Export}.tsx`, `frontend/src/styles/tokens.css`, `frontend/src/setupTests.ts`
- Test: `frontend/src/app/routes.test.tsx`

**Interfaces:**
- Produces: `api.get<T>(path: string): Promise<T>`, `api.post<T>(path: string, body?: unknown): Promise<T>`, `api.del(path: string): Promise<void>`; `queryKeys = { health: ['health'], songs: ['songs'], jobs: (active: boolean) => ['jobs', active] }`; `useHealth()`, `useJobs(active?: boolean)`, `useCancelJob()`; types `Health`, `Job`, `SongEntry` mirroring Task 9's response shapes.

- [ ] **Step 1: Scaffold the project**

```bash
mkdir -p frontend/src/{app,api,screens,styles}
cp design/ui/src/tokens.css frontend/src/styles/tokens.css
```

```json
// frontend/package.json
{
  "name": "stemcraft-frontend",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@tanstack/react-query": "^5.59.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "react-router-dom": "^7.0.0"
  },
  "devDependencies": {
    "@testing-library/dom": "^10.4.0",
    "@testing-library/jest-dom": "^6.5.0",
    "@testing-library/react": "^16.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.0",
    "jsdom": "^25.0.0",
    "typescript": "^5.6.0",
    "vite": "^6.0.0",
    "vitest": "^2.1.0"
  }
}
```

```json
// frontend/tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noFallthroughCasesInSwitch": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["vite/client", "vitest/globals", "@testing-library/jest-dom"]
  },
  "include": ["src"]
}
```

```typescript
// frontend/vite.config.ts
import react from '@vitejs/plugin-react';
// vitest/config, not vite: the `test` key below is not part of Vite's own config type.
import { defineConfig } from 'vitest/config';

// D-15: the dev server proxies /api so development is one origin, exactly like
// production. Without `ws: true` the proxy drops the upgrade and job progress
// fails in dev only — a class of bug that never reaches production.
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0', // C-05: reachable from other machines on the LAN
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:8000', changeOrigin: true, ws: true },
    },
  },
  build: { outDir: 'dist', sourcemap: true },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/setupTests.ts'],
  },
});
```

```typescript
// frontend/src/setupTests.ts
import '@testing-library/jest-dom/vitest';
```

```html
<!-- frontend/index.html -->
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Stemcraft</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 2: Write the failing test**

```tsx
// frontend/src/app/routes.test.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';

import { AppRoutes } from './routes';

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ deps: [], device: null, sample_rate: 48000 }))),
  );
});

test('the library is the index route', async () => {
  renderAt('/');
  expect(await screen.findByRole('heading', { name: /library/i })).toBeInTheDocument();
});

test.each([
  ['/import', /import/i],
  ['/jobs', /job queue/i],
  ['/splitter', /album splitter/i],
  ['/songs/01ABC', /song/i],
  ['/songs/01ABC/scale', /scale/i],
  ['/songs/01ABC/export', /export/i],
])('%s renders its screen', async (path, heading) => {
  renderAt(path);
  expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument();
});

test('an unknown path shows a not-found screen rather than a blank page', async () => {
  renderAt('/nope');
  expect(await screen.findByText(/not found/i)).toBeInTheDocument();
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd frontend && npm install && npm test`
Expected: FAIL — cannot resolve `./routes`

- [ ] **Step 4: Write the API client and queries**

```typescript
// frontend/src/api/client.ts
// Same-origin by construction (D-15): relative paths only, so dev goes through
// the Vite proxy and prod hits the static mount. No base URL, no CORS.
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  });
  if (!response.ok) {
    // N-08: carry the server's real message to the UI, never a generic one.
    const detail = await response.text();
    throw new Error(`${init?.method ?? 'GET'} ${path} → ${response.status}: ${detail}`);
  }
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) }),
  del: (path: string) => request<void>(path, { method: 'DELETE' }),
};

export interface DepCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface Health {
  deps: DepCheck[];
  device: string | null;
  sample_rate: number;
}

export type JobState = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

export interface Job {
  id: number;
  song_id: string | null;
  kind: string;
  payload: Record<string, unknown>;
  state: JobState;
  cancel_requested: boolean;
  progress: number;
  device: string | null;
  lease_until: number | null;
  created_at: number | null;
  started_at: number | null;
  finished_at: number | null;
  error: string | null;
  result: Record<string, unknown> | null;
}
```

```typescript
// frontend/src/api/queries.ts
// D-13: the server owns this state; the client only caches it. No store.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api, type Health, type Job } from './client';

export const queryKeys = {
  health: ['health'] as const,
  songs: ['songs'] as const,
  jobs: (active: boolean) => ['jobs', active] as const,
};

export function useHealth() {
  return useQuery({ queryKey: queryKeys.health, queryFn: () => api.get<Health>('/api/health') });
}

export function useJobs(active = false) {
  return useQuery({
    queryKey: queryKeys.jobs(active),
    queryFn: () => api.get<{ jobs: Job[] }>(`/api/jobs${active ? '?active=true' : ''}`),
    select: (data) => data.jobs,
  });
}

export function useEnqueueProbe() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ id: number }>('/api/jobs', { kind: 'probe', payload: {} }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['jobs'] }),
  });
}

export function useCancelJob() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (jobId: number) => api.post(`/api/jobs/${jobId}/cancel`),
    onSuccess: () => client.invalidateQueries({ queryKey: ['jobs'] }),
  });
}
```

- [ ] **Step 5: Write the shell and routes**

```tsx
// frontend/src/app/AppShell.tsx
import { NavLink, Outlet } from 'react-router-dom';

import { useHealth } from '../api/queries';
import styles from './AppShell.module.css';

const NAV = [
  { to: '/', label: 'Library' },
  { to: '/import', label: 'Import' },
  { to: '/splitter', label: 'Album splitter' },
  { to: '/jobs', label: 'Job queue' },
];

export function AppShell() {
  const health = useHealth();
  const broken = health.data?.deps.filter((d) => !d.ok) ?? [];

  return (
    <div className={styles.shell}>
      <nav className={styles.nav}>
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) => (isActive ? styles.active : styles.link)}
          >
            {item.label}
          </NavLink>
        ))}
      </nav>

      {/* N-08: a missing dependency is visible, named, and quotes the real error. */}
      {broken.length > 0 && (
        <div className={styles.banner} role="alert">
          {broken.map((dep) => (
            <div key={dep.name}>
              <strong>{dep.name}</strong>: {dep.detail}
            </div>
          ))}
        </div>
      )}

      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  );
}
```

```css
/* frontend/src/app/AppShell.module.css */
/* D-16: CSS modules consuming tokens.css, which stays the authority (U-02). */
.shell {
  min-height: 100vh;
  background: var(--ds-ground);
  color: var(--ds-text);
  font: 400 var(--ds-t-md) / 1.5 var(--ds-font);
}

.nav {
  display: flex;
  gap: var(--ds-3);
  align-items: center;
  padding: var(--ds-3) var(--ds-4);
  background: var(--ds-surface);
  border-bottom: 1px solid var(--ds-border);
}

.link,
.active {
  display: flex;
  align-items: center;
  min-height: var(--ds-hit-setup);
  padding: 0 var(--ds-3);
  border-radius: var(--ds-r-input);
  color: var(--ds-text-2);
  text-decoration: none;
}

.active {
  color: var(--ds-text);
  background: var(--ds-raised);
}

.banner {
  padding: var(--ds-3) var(--ds-4);
  background: var(--ds-raised);
  border-bottom: 1px solid var(--ds-error);
  color: var(--ds-error);
  font: 400 var(--ds-t-sm) / 1.5 var(--ds-mono);
}

.main {
  padding: var(--ds-4);
}
```

```tsx
// frontend/src/app/routes.tsx
// D-14: one route per screen, song id in the path.
import { Route, Routes } from 'react-router-dom';

import { AlbumSplitter } from '../screens/AlbumSplitter';
import { Export } from '../screens/Export';
import { Import } from '../screens/Import';
import { JobQueue } from '../screens/JobQueue';
import { Library } from '../screens/Library';
import { ScaleSheet } from '../screens/ScaleSheet';
import { SongView } from '../screens/SongView';
import { AppShell } from './AppShell';

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Library />} />
        <Route path="import" element={<Import />} />
        <Route path="splitter" element={<AlbumSplitter />} />
        <Route path="jobs" element={<JobQueue />} />
        <Route path="songs/:songId" element={<SongView />} />
        <Route path="songs/:songId/scale" element={<ScaleSheet />} />
        <Route path="songs/:songId/export" element={<Export />} />
        <Route path="*" element={<p>Not found</p>} />
      </Route>
    </Routes>
  );
}
```

```tsx
// frontend/src/main.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import { AppRoutes } from './app/routes';
import './styles/tokens.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 5_000, refetchOnWindowFocus: false } },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
```

- [ ] **Step 6: Write the seven screens**

Six are placeholders carrying only their heading; `JobQueue` becomes real in Task 13.

```tsx
// frontend/src/screens/Library.tsx
export function Library() {
  return <h1>Library</h1>;
}
```

```tsx
// frontend/src/screens/SongView.tsx
import { useParams } from 'react-router-dom';

export function SongView() {
  const { songId } = useParams();
  return <h1>Song {songId}</h1>;
}
```

```tsx
// frontend/src/screens/Import.tsx
export function Import() {
  return <h1>Import</h1>;
}
```

```tsx
// frontend/src/screens/AlbumSplitter.tsx
export function AlbumSplitter() {
  return <h1>Album splitter</h1>;
}
```

```tsx
// frontend/src/screens/ScaleSheet.tsx
export function ScaleSheet() {
  return <h1>Scale sheet</h1>;
}
```

```tsx
// frontend/src/screens/Export.tsx
export function Export() {
  return <h1>Export</h1>;
}
```

```tsx
// frontend/src/screens/JobQueue.tsx
// Replaced with the real screen in Task 13.
export function JobQueue() {
  return <h1>Job queue</h1>;
}
```

- [ ] **Step 7: Run tests and typecheck**

Run: `cd frontend && npm test && npm run typecheck`
Expected: 8 passed, no type errors.

- [ ] **Step 8: Commit**

```bash
git add frontend
git commit -m "feat(frontend): Vite/TS scaffold, seven routes, Query client, design tokens"
```

---

## Task 13: Job Queue screen and the live WebSocket invalidation

**Files:**
- Create: `frontend/src/api/useJobStream.ts`, `frontend/src/screens/JobQueue.module.css`
- Modify: `frontend/src/screens/JobQueue.tsx`, `frontend/src/app/AppShell.tsx` (mount the stream once)
- Test: `frontend/src/screens/JobQueue.test.tsx`, `frontend/src/api/useJobStream.test.ts`

**Interfaces:**
- Consumes: `useJobs`, `useCancelJob`, `useEnqueueProbe`, `queryKeys` (Task 12); `WS /api/ws` (Task 10).
- Produces: `useJobStream(): void` — opens the socket, invalidates `['jobs']` on every message, reconnects after 1 s. It never stores the payload: the message is a signal, the cache is the truth (D-13).

- [ ] **Step 1: Write the failing tests**

```typescript
// frontend/src/api/useJobStream.test.ts
import { QueryClient } from '@tanstack/react-query';
import { expect, test, vi } from 'vitest';

import { attachJobStream } from './useJobStream';

class FakeSocket {
  static last: FakeSocket | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: (() => void) | null = null;
  close = vi.fn();
  constructor(public url: string) {
    FakeSocket.last = this;
  }
}

test('a message invalidates the jobs cache and nothing else', () => {
  const client = new QueryClient();
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  vi.stubGlobal('WebSocket', FakeSocket);

  const detach = attachJobStream(client);
  FakeSocket.last!.onmessage!({ data: '{"type":"jobs","jobs":[]}' } as MessageEvent);

  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['jobs'] });
  expect(invalidate).toHaveBeenCalledTimes(1);
  detach();
});

test('connects same-origin over the right scheme', () => {
  vi.stubGlobal('WebSocket', FakeSocket);
  const detach = attachJobStream(new QueryClient());
  expect(FakeSocket.last!.url).toBe(`ws://${location.host}/api/ws`);
  detach();
});
```

```tsx
// frontend/src/screens/JobQueue.test.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';

import { JobQueue } from './JobQueue';

const job = {
  id: 7,
  song_id: null,
  kind: 'probe',
  payload: {},
  state: 'running',
  cancel_requested: false,
  progress: 0.42,
  device: 'cpu',
  lease_until: null,
  created_at: 1,
  started_at: 2,
  finished_at: null,
  error: null,
  result: null,
};

function renderQueue(jobs: unknown[]) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ jobs })));
  vi.stubGlobal('fetch', fetchMock);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <JobQueue />
    </QueryClientProvider>,
  );
  return fetchMock;
}

test('renders kind, state, device and progress', async () => {
  renderQueue([job]);
  expect(await screen.findByText('probe')).toBeInTheDocument();
  expect(screen.getByText('running')).toBeInTheDocument();
  expect(screen.getByText('cpu')).toBeInTheDocument();
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '42');
});

test('shows the real error text for a failed job', async () => {
  renderQueue([{ ...job, state: 'failed', error: 'Traceback...\nRuntimeError: boom' }]);
  // N-08: the traceback is the point of the screen, not a detail to hide.
  expect(await screen.findByText(/RuntimeError: boom/)).toBeInTheDocument();
});

test('cancel posts to the job endpoint', async () => {
  const fetchMock = renderQueue([job]);
  await screen.findByText('probe');
  await userEvent.click(screen.getByRole('button', { name: /cancel/i }));
  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith('/api/jobs/7/cancel', expect.objectContaining({ method: 'POST' })),
  );
});

test('an empty queue says so instead of rendering an empty table', async () => {
  renderQueue([]);
  expect(await screen.findByText(/no jobs yet/i)).toBeInTheDocument();
});
```

Add `@testing-library/user-event` to devDependencies.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npm install -D @testing-library/user-event && npm test`
Expected: FAIL — cannot resolve `./useJobStream`; JobQueue renders only a heading.

- [ ] **Step 3: Write the stream hook**

```typescript
// frontend/src/api/useJobStream.ts
// §6: the socket carries liveness, never data. Every message means "refetch".
// Dropping it costs nothing but freshness, and the cache recovers on reconnect.
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

const RECONNECT_MS = 1000;

export function attachJobStream(client: QueryClient): () => void {
  let socket: WebSocket | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;

  const connect = () => {
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    socket = new WebSocket(`${scheme}://${location.host}/api/ws`);
    socket.onmessage = () => {
      void client.invalidateQueries({ queryKey: ['jobs'] });
    };
    socket.onclose = () => {
      if (!closed) timer = setTimeout(connect, RECONNECT_MS);
    };
  };

  connect();
  return () => {
    closed = true;
    clearTimeout(timer);
    socket?.close();
  };
}

export function useJobStream(): void {
  const client = useQueryClient();
  useEffect(() => attachJobStream(client), [client]);
}
```

- [ ] **Step 4: Write the Job Queue screen**

```tsx
// frontend/src/screens/JobQueue.tsx
// §10: this is the real operational dashboard. Everything the spec asks the
// queue to expose — state, duration, device, error, traceback — is here.
import { useCancelJob, useEnqueueProbe, useJobs } from '../api/queries';
import type { Job } from '../api/client';
import styles from './JobQueue.module.css';

function duration(job: Job): string {
  if (job.started_at === null) return '—';
  const end = job.finished_at ?? Date.now() / 1000;
  return `${(end - job.started_at).toFixed(1)} s`;
}

export function JobQueue() {
  const jobs = useJobs();
  const cancel = useCancelJob();
  const probe = useEnqueueProbe();

  return (
    <section>
      <h1>Job queue</h1>
      <button className={styles.action} onClick={() => probe.mutate()}>
        Enqueue probe job
      </button>

      {jobs.isError && <p className={styles.error}>{String(jobs.error)}</p>}
      {jobs.data?.length === 0 && <p>No jobs yet.</p>}

      <ul className={styles.list}>
        {jobs.data?.map((job) => (
          <li key={job.id} className={styles.row}>
            <span className={styles.kind}>{job.kind}</span>
            <span className={styles.state} data-state={job.state}>
              {job.state}
            </span>
            <span className={styles.device}>{job.device ?? '—'}</span>
            <span className={styles.duration}>{duration(job)}</span>
            <div
              className={styles.progress}
              role="progressbar"
              aria-valuenow={Math.round(job.progress * 100)}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <i style={{ inlineSize: `${job.progress * 100}%` }} />
            </div>
            {(job.state === 'queued' || job.state === 'running') && (
              <button onClick={() => cancel.mutate(job.id)}>Cancel</button>
            )}
            {job.error && <pre className={styles.error}>{job.error}</pre>}
          </li>
        ))}
      </ul>
    </section>
  );
}
```

```css
/* frontend/src/screens/JobQueue.module.css */
.list {
  display: flex;
  flex-direction: column;
  gap: var(--ds-2);
  margin: var(--ds-4) 0 0;
  padding: 0;
  list-style: none;
}

.row {
  display: grid;
  grid-template-columns: 8rem 6rem 4rem 5rem 1fr auto;
  gap: var(--ds-3);
  align-items: center;
  min-height: var(--ds-hit-setup);
  padding: var(--ds-2) var(--ds-3);
  background: var(--ds-surface);
  border: 1px solid var(--ds-border);
  border-radius: var(--ds-r-input);
}

.state[data-state='queued'] { color: var(--ds-queued); }
.state[data-state='running'] { color: var(--ds-accent); }
.state[data-state='done'] { color: var(--ds-ok); }
.state[data-state='failed'] { color: var(--ds-error); }
.state[data-state='cancelled'] { color: var(--ds-text-3); }

/* U-04: every numeral is mono and tabular, so a ticking duration cannot jitter. */
.device,
.duration {
  font: 400 var(--ds-t-sm) / 1 var(--ds-mono);
  font-variant-numeric: tabular-nums;
  color: var(--ds-text-2);
}

.progress {
  block-size: 6px;
  background: var(--ds-raised);
  border-radius: 3px;
  overflow: hidden;
}

.progress i {
  display: block;
  block-size: 100%;
  background: var(--ds-accent);
}

.error {
  grid-column: 1 / -1;
  margin: 0;
  white-space: pre-wrap;
  font: 400 var(--ds-t-xs) / 1.4 var(--ds-mono);
  color: var(--ds-error);
}

.action {
  min-height: var(--ds-hit-setup);
}
```

- [ ] **Step 5: Mount the stream once, in the shell**

In `AppShell.tsx`, add `import { useJobStream } from '../api/useJobStream';` and call `useJobStream();` as the first line of the component — one socket for the whole app, not one per screen.

- [ ] **Step 6: Run tests and typecheck**

Run: `cd frontend && npm test && npm run typecheck`
Expected: 14 passed, no type errors.

- [ ] **Step 7: Commit**

```bash
git add frontend
git commit -m "feat(frontend): job queue screen with websocket-driven invalidation"
```

---

## Task 14: Dev and production serving, units, and the end-to-end proof

**Files:**
- Modify: `.claude/launch.json`
- Create: `ops/systemd/stemcraft-api.service`, `ops/systemd/stemcraft-worker.service`, `docs/running.md`
- Test: manual verification steps below, recorded in `docs/running.md`

**Interfaces:**
- Consumes: everything above.
- Produces: no code interfaces. This task proves D-15 in both directions and the §9 crash-recovery path against the real processes.

- [ ] **Step 1: Add launch configurations**

```json
{
  "version": "0.0.1",
  "configurations": [
    {
      "name": "api",
      "runtimeExecutable": "uv",
      "runtimeArgs": ["run", "uvicorn", "stemcraft_api.app:create_app", "--factory", "--reload", "--host", "0.0.0.0", "--port", "8000"],
      "port": 8000
    },
    {
      "name": "frontend",
      "runtimeExecutable": "npm",
      "runtimeArgs": ["--prefix", "frontend", "run", "dev"],
      "port": 5173
    },
    {
      "name": "ui-preview",
      "runtimeExecutable": "python3",
      "runtimeArgs": ["-m", "http.server", "8777", "--directory", "design/ui/dist"],
      "port": 8777
    }
  ]
}
```

The worker has no port, so it is not a launch configuration. Run it with `uv run stemcraft-worker`.

- [ ] **Step 2: Write the systemd units**

```ini
# ops/systemd/stemcraft-api.service
[Unit]
Description=Stemcraft API
After=network.target

[Service]
Type=simple
WorkingDirectory=%h/dev/stemcraft
Environment=STEMCRAFT_DIST_DIR=%h/dev/stemcraft/frontend/dist
ExecStart=/usr/bin/env uv run stemcraft-api
Restart=on-failure
RestartSec=2

[Install]
WantedBy=default.target
```

```ini
# ops/systemd/stemcraft-worker.service
[Unit]
Description=Stemcraft worker
After=network.target

[Service]
Type=simple
WorkingDirectory=%h/dev/stemcraft
ExecStart=/usr/bin/env uv run stemcraft-worker
Restart=on-failure
RestartSec=2

[Install]
WantedBy=default.target
```

- [ ] **Step 3: Verify the dev path (D-15, dev half)**

```bash
uv run stemcraft-worker
```

In another shell, start the API and the Vite dev server (launch configs `api` and `frontend`), then:

```bash
curl -s localhost:5173/api/health | head -c 200
```

Expected: the health JSON, served through the Vite proxy on `:5173`. Then confirm in the browser at `http://localhost:5173/jobs`: "Enqueue probe job" creates a job, its progress bar advances without any page interaction (the WebSocket invalidation is working through the proxy), and Cancel stops it.

Check for a CORS header, which must not exist:

```bash
curl -sI -H 'Origin: http://example.com' localhost:8000/api/health | grep -i access-control || echo "no CORS header, as intended"
```

- [ ] **Step 4: Verify crash recovery (§9) against the real processes**

```bash
curl -s -X POST localhost:8000/api/jobs -H 'content-type: application/json' -d '{"kind":"probe","payload":{"steps":60,"step_seconds":1}}'
```

While it runs, `kill -9` the worker. Restart it. Expected: the restarted worker logs a reclaim, the job returns to `queued` with progress reset to 0, and it runs again from the start. The Job Queue screen shows this happening without a reload.

- [ ] **Step 5: Verify the production path (D-15, prod half)**

```bash
npm --prefix frontend run build && STEMCRAFT_DIST_DIR=frontend/dist uv run stemcraft-api
```

Expected, on `:8000` with no Vite running: `/` serves the app, `/jobs` hard-reloads correctly (SPA fallback), the Job Queue is live over the same-origin WebSocket, and `curl -s localhost:8000/api/nope` returns JSON, not HTML.

- [ ] **Step 6: Verify the refuse-to-start path (N-08)**

```bash
PATH=/nonexistent uv run stemcraft-api; echo "exit: $?"
```

Expected: a non-zero exit and a log naming every unmet dependency — ffmpeg and yt-dlp — not just the first.

- [ ] **Step 7: Record it in `docs/running.md`**

Write up exactly the commands used above: the three processes, which ports, the dev-versus-prod difference, and the four verification checks. This file is the raw material for the dev-setup skill in Phase 9 — written from commands that have actually run, not intended ones.

- [ ] **Step 8: Commit**

```bash
git add .claude/launch.json ops docs/running.md
git commit -m "feat(ops): launch configs, systemd units and the running guide"
```

---

## Phase 1 Exit Criteria

Every one of these is verified by a test or by a step in Task 14:

- [ ] `uv run pytest` green; `uv run ruff check .` clean; `npm test` and `npm run typecheck` green.
- [ ] `torch` is not in `sys.modules` after the API handles a request (Task 9).
- [ ] A `probe` job enqueued from the UI advances over the WebSocket and cancels.
- [ ] `kill -9` on the worker mid-job reclaims the lease and re-runs from the start.
- [ ] Both processes refuse to start on a missing dependency, naming all failures.
- [ ] A corrupt `song.json` lists that song as unreadable and leaves the others alone.
- [ ] Dev serves through the Vite proxy on `:5173`; prod serves the built bundle from
      FastAPI on `:8000`; no CORS header exists in either.
- [ ] No status field anywhere in `song.json`; state is derived from files present.
- [ ] `SAMPLE_RATE` is 48000 and nothing in the codebase mentions 44100.

## What Phase 1 deliberately does not do

No ffmpeg calls, no audio files, no torch, no GPU, no separation, no playback engine,
no real job kinds beyond `probe`. The Library, Import, Song view, Scale sheet, Album
splitter and Export screens are headings only. Phase 2 starts at the ffmpeg wrapper.
