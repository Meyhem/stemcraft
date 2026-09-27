# Stemcraft Phase 2: Audio I/O and Import — Implementation Plan

**Goal:** the first real feature. A user can hand Stemcraft a file or a URL and get back
a Song with `original.*` kept untouched, `audio.wav` at 48 kHz stereo, and `peaks.json`
for the waveform — browsable from a real Library screen. Still no torch anywhere.

**Spec:** [design/tech-spec-stemcraft.md](../../../design/tech-spec-stemcraft.md) §4–6,
9; [design/domain-spec.md](../../../design/domain-spec.md) "Import"; phase map:
[2026-09-27-stemcraft-roadmap.md](2026-09-27-stemcraft-roadmap.md) Phase 2. Phase 1's
plan: [2026-09-27-phase-1-foundation.md](2026-09-27-phase-1-foundation.md).

## Global constraints (unchanged from Phase 1, repeated because every task inherits them)

- 48 kHz stereo end to end (D-03). `audio.wav` is asserted 48 kHz stereo in a test.
- The API never imports torch (§4). ffmpeg and yt-dlp are subprocesses, not torch, so
  they're fine in `stemcraft_lib` and `stemcraft_api`.
- One writer per file (§5): the API owns `song.json`; the worker owns `peaks.json` and
  everything else under a Song folder that isn't `song.json` or `original.*`.
- `original.*` is written once, by the API at creation time (upload) or by the worker's
  `import` job (URL — nothing to save until yt-dlp finishes), and is never modified or
  deleted afterward. Retried imports never re-download or re-upload it.
- All writes atomic — temp file in the same directory, then rename, including files an
  external process (ffmpeg, yt-dlp) writes directly, not just ones we serialize in
  Python.
- Fail loudly (N-08): ffmpeg's and yt-dlp's own stderr reach the job's `error` column
  and the UI verbatim, never a generic message.
- Every job kind idempotent by re-derivation (§6): re-running `import` from a crash
  reproduces the same `audio.wav` and `peaks.json` from the same `original.*` (or
  re-downloads if `original.*` itself never finished).

## Why this order

`ffmpeg.py` and the song-dir helpers are needed by both the API (upload route,
tag-prefill) and the worker (`import` kind), so they land in `stemcraft_lib` first.
`peaks.py` and the `import` kind are worker-only and depend on the above. The API routes
depend on the song-dir helpers and enqueue the job but never run ffmpeg themselves for
anything slow. The frontend is last because it depends on the routes' response shape.

```
lib: ffmpeg wrapper ──┬──► worker: peaks.py ──► worker: import kind ──┐
lib: song dir helpers ┘                                               │
lib: ytdlp wrapper ────────────────────────────────────────────────────┤
                                                                        ▼
                                              api: upload/url routes ──► frontend: Library + Import
```

## Task 1 — `stemcraft_lib.atomic`: atomic writes for subprocess output

**Problem:** `atomic_write_bytes` takes a `bytes` object we already hold in memory.
ffmpeg and yt-dlp write their own output file directly to a path we give them — we
can't buffer a WAV or a downloaded video in memory first. Need the same
temp-file-in-same-dir-then-`os.replace`-then-fsync-dir discipline, but where the
*writer* is an external process instead of `fh.write(data)`.

**Produces:** `atomic_output_path(final_path: Path) -> Path` returning a temp path in
`final_path.parent` the caller's subprocess writes to; `finalize_atomic_output(tmp: Path,
final_path: Path) -> None` doing `os.replace` + fsync-dir, mirroring
`atomic_write_bytes`'s tail; a context manager `atomic_output(final_path: Path) ->
Iterator[Path]` wrapping both (yields the temp path, finalizes on clean exit, unlinks the
temp file on any exception — same shape as `atomic_write_bytes`'s `except BaseException`
branch).

**Tests:** temp path is a sibling of the final path (same filesystem, `os.replace` stays
atomic); a successful `with atomic_output(...)` leaves only the final file; an exception
inside the block leaves no temp file and doesn't touch a pre-existing final file (mirrors
`test_failed_write_leaves_previous_file_intact`).

## Task 2 — `stemcraft_lib.ffmpeg`: the one audio I/O path (C-04)

**Produces:**
- `FfmpegError(Exception)` — carries ffmpeg's/ffprobe's real stderr, tail-truncated like
  `deps.py` already does.
- `probe(path: Path) -> ProbeResult` — `dataclass(duration_seconds: float, title: str |
  None, artist: str | None)`, via `ffprobe -show_format -of json`. Used by the API to
  prefill title/artist from tags (domain spec, "Import"); best-effort, never raises for
  *missing* tags, only for a file ffprobe can't read at all.
- `decode_to_wav(src: Path, dst: Path, *, sample_rate: int = SAMPLE_RATE) -> None` — `-ac
  2 -ar <rate>`, PCM 16-bit, atomic via Task 1.
- `encode_mp3(src: Path, dst: Path, *, bitrate: str = "192k") -> None` — for export
  (Phase 7), built now since it's the same subprocess shape and the roadmap calls for it
  in Phase 2.
- `encode_opus(src: Path, dst: Path, *, bitrate: str = "128k") -> None` — for stem
  delivery copies (Phase 4, D-04).

No format whitelist anywhere in this module — every function hands ffmpeg whatever
extension the input has and lets it fail or succeed on its own terms.

**Tests (real ffmpeg, no mocks — same pattern as `test_deps.py`'s
`test_real_ffmpeg_can_decode_and_encode_mp3`, `skipif` ffmpeg is absent):**
- `decode_to_wav` on a synthetic sine produces a file that is exactly 48 kHz stereo
  (`wave.open` on the result, assert `getframerate() == 48000` and `getnchannels() ==
  2`) — this is the test the roadmap's exit criterion asks for.
- A corrupt/non-audio input file raises `FfmpegError` whose message contains ffmpeg's
  own text, and no output file is left behind (Task 1's cleanup).
- `encode_mp3` / `encode_opus` round-trip: encode then decode back, non-empty output,
  correct extension-implied codec (`ffprobe` codec name check).
- `probe` reads `title`/`artist` off a file tagged via `ffmpeg -metadata`; a file with no
  tags returns `None`s, not an error.

## Task 3 — `stemcraft_lib.song`: song directory helpers

**Problem:** `stemcraft_api/routes/songs.py` already has `_find_dir` (song id → path) and
inline directory-creation logic doesn't exist yet — every future writer of a new Song
(the upload and URL-import routes in Task 6) needs the same "allocate an id, compute
`song_dirname`, mkdir, write `song.json`" sequence, and the worker's `import` kind
(Task 5) needs the same id → path lookup the API already has. Duplicating either in two
packages invites drift.

**Produces (appended to `stemcraft_lib/song.py`):**
- `create_song_dir(songs_dir: Path, song: Song) -> Path` — `songs_dir /
  song_dirname(song.id, song.title)`, `mkdir(parents=True)` (fails loudly if it somehow
  already exists — ids are ULIDs, this should never collide), `write_song(dir, song)`,
  returns the dir.
- `find_song_dir(songs_dir: Path, song_id: str) -> Path | None` — same matching rule
  `_find_dir` already uses (`dirname.split("-", 1)[0] == song_id`), `None` instead of
  raising so each caller decides its own 404 vs. job-failure behavior.

**Refactor:** `stemcraft_api/routes/songs.py` keeps `_find_dir` as a thin wrapper
(`find_song_dir(...) or raise HTTPException(404)`) so its behavior doesn't change.

**Tests:** round-trip create → find; `find_song_dir` returns `None` for an unknown id
without touching the filesystem; `create_song_dir` produces a directory name matching
`song_dirname` exactly.

## Task 4 — `stemcraft_lib.ytdlp`: URL import

**Produces:** `YtdlpError(Exception)` (real stderr, verbatim per §9); `download(url: str,
dest_dir: Path) -> Path` — runs `yt-dlp -x --audio-format best -o
'<dest_dir>/original.%(ext)s' <url>` (audio-only extraction; video URLs still work,
domain spec's "for video the audio track is extracted"), reports whichever `original.*`
landed via yt-dlp's own filename-templating, and finalizes it atomically (Task 1: yt-dlp
writes to a `.part`-suffixed temp name of yt-dlp's own choosing, so wrap the *directory*
move — download into a fresh temp subdirectory of `dest_dir`, then move the one output
file into place with Task 1's primitive — rather than trying to hand yt-dlp our own temp
path, since its `-o` templating and `--audio-format` choose the final extension).

**Tests:** cannot hit the network in CI-like conditions, so these are the two things
that don't need one: `YtdlpError` message contains yt-dlp's stderr when given a
malformed/unreachable URL (`http://127.0.0.1:1` — connection refused, fast, deterministic,
no real network dependency); a successful download is asserted against a `file://` URL
pointing at a fixture audio file in `tmp_path` (yt-dlp supports local files as a generic
extractor input) so the "produces `original.<ext>` atomically" path is exercised for
real without hitting the internet.

## Task 5 — `stemcraft_worker.peaks`: waveform peaks, no numpy

**Produces:** `compute_peaks(wav_path: Path, *, buckets_per_second: int = 100) -> dict`
returning `{"version": 1, "sample_rate": int, "length": int, "channels": int,
"buckets_per_second": int, "peaks": [[min, max, min, max, ...], ...]}` — one
interleaved min/max array per channel, values as floats in `[-1, 1]`. Read via stdlib
`wave` + `array` (the wav is always 16-bit PCM from Task 2's `decode_to_wav`, so
`array('h', ...)` decodes it directly) — no numpy dependency added to the worker for
this.

**Why min/max pairs, not a single magnitude:** the file this reads is always
`audio.wav`, produced once by `decode_to_wav`; the format is internal and unversioned
(§6), so there is no compatibility surface to negotiate. Min/max at a fixed bucket rate
is the standard precomputed-peaks shape and gives an accurate waveform at any zoom level
below the bucket resolution, which a fixed single-magnitude-per-bucket format doesn't.

**Tests:** a hand-built stdlib `wave` file (no ffmpeg needed — this module never shells
out) with a known signal (e.g. a full-scale square wave) produces peaks whose min/max
hit ±1.0 in the expected buckets; a silent file produces all-zero peaks; `length` and
`sample_rate` match the input exactly; a 2-second file at 100 buckets/sec produces
exactly 200 buckets per channel (off-by-one boundary check on the last bucket).

## Task 6 — `stemcraft_worker` `import` job kind

**Produces:** `kinds/import_song.py`, registered as `"import"`.

```python
def run(ctx: JobContext) -> dict:
    song_dir = find_song_dir(settings().songs_dir, ctx.payload["song_id"])
    if song_dir is None:
        raise RuntimeError(f"no song directory for song_id={ctx.payload['song_id']!r}")
    song = read_song(song_dir)

    original = _existing_original(song_dir)
    if original is None:
        if song.source.kind != "url":
            raise RuntimeError(f"song {song.id} has no original.* and is not a url import")
        original = ytdlp.download(song.source.value, song_dir)
    ctx.progress(0.1)
    if ctx.cancelled(): raise JobCancelled

    audio_wav = song_dir / "audio.wav"
    ffmpeg.decode_to_wav(original, audio_wav, sample_rate=SAMPLE_RATE)
    ctx.progress(0.7)
    if ctx.cancelled(): raise JobCancelled

    atomic_write_json(song_dir / "peaks.json", peaks.compute_peaks(audio_wav))
    return {"duration_seconds": ffmpeg.probe(audio_wav).duration_seconds}
```

`_existing_original` globs `song_dir / "original.*"` — presence, not the job payload, is
the idempotency check: a crash after yt-dlp finished but before `decode_to_wav` re-runs
without re-downloading; a crash after `decode_to_wav` but before `peaks.json` re-runs
`decode_to_wav` again (cheap, deterministic, overwrites the same bytes) rather than
trying to skip it — no different than Phase 4's `separate` re-running fully on reclaim.

**Tests:** upload-shaped run (an `original.mp3` already on disk, `source.kind ==
"upload"`) produces `audio.wav` (48 kHz stereo) and `peaks.json`; url-shaped run with a
`file://` fixture (per Task 4) does the download step too; cancellation checkpoint
between download/decode and decode/peaks lands as `cancelled` with no partial
`audio.wav` left if cancelled before decode finishes (decode is atomic, so this is
automatic — assert the file is simply absent, not partial); a corrupt `original.*`
fails the job with ffmpeg's real message in `error` (roadmap's exit criterion) and
leaves `original.*` untouched on disk for retry; re-running the kind twice produces
byte-identical `audio.wav` (idempotent by re-derivation, §6).

## Task 7 — API: song creation routes

**Produces (`stemcraft_api/routes/songs.py`, appended):**
- `POST /api/songs/upload` (multipart: `file`, optional `title`, `artist`) — reads the
  upload into a fresh song id/dir (Task 3's `create_song_dir`), writes `original<ext>`
  from the upload atomically (Task 1 — the API is the writer here, per §5, since the
  bytes are already fully in hand; no job needed just to save them), best-effort
  `ffmpeg.probe`s it for title/artist when the caller left them blank, enqueues `kind:
  "import"` with `{"song_id": song.id}`, returns `{"song": ..., "job_id": ...}`.
- `POST /api/songs/from-url` (json: `url`, `title`, `artist` — title required, there's
  nothing to probe before downloading) — creates the song dir with `source: {kind:
  "url", value: url}`, no `original.*` yet, enqueues the same `import` job, same
  response shape.

Extension for the upload comes from the client-provided filename's suffix
(lowercased); an extensionless upload gets `.input` — ffmpeg sniffs content, not
extension, so this never blocks decoding.

**Tests (FastAPI `TestClient`, real ffmpeg for the probe path):** upload creates a
`song.json` with `state == "imported"`... no — `derive_files` only reports "imported"
once `audio.wav` exists, which the *job* writes, not the route; assert instead that the
route's response includes `job_id`, the song dir has `original.*` and `song.json` but
not yet `audio.wav`, and the enqueued job is `queued` with `kind == "import"` and the
right `song_id`. Blank title/artist on upload get filled from real tags (small MP3
fixture tagged via ffmpeg in the test). `from-url` with no `original.*` present yet is
accepted (nothing to validate synchronously). Missing `title` on `from-url` is a 422
(pydantic).

## Task 8 — Frontend: types, queries, Library screen

**Produces:**
- `client.ts`: `postUpload`/`postJson`-style helper for `multipart/form-data` (the
  existing `api.post` JSON-encodes everything, so this is a small addition, not a
  rewrite) — `api.upload<T>(path, formData) -> Promise<T>`.
- `queries.ts`: `useSongs()` (`GET /api/songs`), `useCreateSongFromUpload()`,
  `useCreateSongFromUrl()` (both invalidate `queryKeys.songs`), `useDeleteSong()`
  (invalidates `queryKeys.songs`, matches the existing `useCancelJob` shape).
- `screens/Library.tsx`: one card per `SongEntry` — title, artist, `state` (or
  `unreadable` in red if parsing failed, per §9's "one bad file never breaks the
  library"), delete button behind a confirm (`window.confirm` is enough here — no
  headless dialog library has been decided, Q-05 — a real modal is Phase 6's problem
  when other overlays exist too), a "New Song" control that opens the Import screen
  (route, not a modal — D-14 already gives Import its own route).

**Tests (vitest + RTL, mirrors `JobQueue.test.tsx`):** renders a card per song from a
mocked `/api/songs` response; an `unreadable` entry renders its error instead of a
title; delete calls `DELETE /api/songs/:id` only after the confirm is accepted (mock
`window.confirm`); the list re-fetches after a successful delete.

## Task 9 — Frontend: Import screen

**Produces:** `screens/Import.tsx` — two forms (file picker + title/artist, and URL +
title/artist), each posting to its route via Task 8's hooks, disabling submit while
in flight, and rendering the server's error text verbatim on failure (N-08 — this is
the client-side half of "ffmpeg's message reaches the UI", `client.ts`'s `request()`
already surfaces `response.text()` in the thrown `Error`). On success, navigate to
`/` (Library) — Song View doesn't exist until Phase 6, so there's nowhere else to land
that shows anything real yet.

**Tests:** submitting the file form calls the upload mutation with the picked file and
typed fields; submitting the URL form calls the url mutation; a rejected mutation
renders its error message on the page instead of navigating away.

## Exit criteria (from the roadmap, verified in Task 10)

- A file import and a URL import both produce a Song whose `audio.wav` is playable-later
  (48 kHz stereo, non-empty) with a `peaks.json` next to it.
- A deliberately corrupt file fails the `import` job with ffmpeg's own message in
  `error`, and `original.*` is still on disk afterward for retry.
- `audio.wav` is exactly 48 kHz stereo, asserted in a test (Task 2 and Task 6 both
  assert this at different layers).

**Discharges:** C-04, C-08, R-04 (yt-dlp now installed and exercised, not just checked
at boot), D-03 at the import boundary.
