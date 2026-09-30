# Stemcraft

Self-hosted, single-user web app that splits songs into stems so you can mute your own
instrument and play along.

- Add a song from a file or a link (YouTube and direct media) in one dialog; any format
  ffmpeg can decode is accepted. The dialog then follows the import, separation and
  analysis live, step by step
- GPU stem separation into vocals, drums, bass and other
- Live mixer: mute, solo and volume per stem
- Song view time axis: the wheel zooms at the pointer, dragging across the lanes zooms to
  that range, Shift+wheel or the scrollbar pans, and a click on the ruler seeks
- Tempo and pitch change without re-separating; stems are never modified
- Sample-accurate seamless loops on the beat grid, with optional count-in
- Beat, key and chord analysis, plus a fretboard view
- Play along screen for bass: a live neck shows what to play in the current and the next
  bar, with a beat lane underneath showing when. The notes are generated from the chord
  chart by a pattern you pick (root, root–5th, root–5th–octave, octave, chord or diatonic triad, 7th; whole
  to eighth notes; optional chromatic, scale or fifth approach into the next bar), in the
  detected key or another candidate, and follow the pitch shift. Loop by bar numbers or
  from the chord ribbon; playback carries on when you switch back to the Song view
- Theory tab for 4- and 5-string bass and 6-string guitar in any tuning, left-handed too:
  scale, chord and note finders, name a chord from notes you tap, scale positions
  (pentatonic boxes, 3-notes-per-string, CAGED, position boxes), triads and inversions,
  arpeggios, guitar voicings and bass arpeggio shapes, chords in a key, a circle of
  fifths, 15 progressions in any key and scales that fit a chord. Pick an analysed song
  and one of its key candidates to load its key and chords: they show as chips in the
  chord tools, and Progressions charts the song with numerals, borrowed chords labelled.
  Two quizzes ask about your weak spots more often: a fretboard quiz (name the note, find
  the note, find the interval, spell the chord) shows them on a heatmap of the neck, kept
  per tuning, and a theory quiz (keys, chords, intervals) lists your weakest facts; the
  history is kept in `data/theory.json`
- Album splitter: cut a full album rip into tagged MP3s. Silence detection proposes cuts;
  on a full-length waveform you play, zoom with the wheel or by dragging across a range,
  drag, add and delete cuts, or type exact start and end times to the millisecond, then
  download a zip
- Export the current mix
- Job queue screen: every job expands to its named steps, live, with a duration each and a
  failure's real traceback under the step that failed; all-time stats with passed and
  failed counts and the average duration per job kind and device
- Failures and CPU fallbacks are shown in the UI with the real error message

## Screens

![Library](docs/screenshots/library.png)
![Add song](docs/screenshots/import.png)
![Song view](docs/screenshots/song-view.png)
![Play along](docs/screenshots/play-along.png)
![Theory](docs/screenshots/theory.png)
![Theory: scale positions](docs/screenshots/theory-shapes.png)
![Theory: fretboard quiz](docs/screenshots/theory-quiz.png)
![Album splitter](docs/screenshots/album-splitter.png)
![Job queue](docs/screenshots/job-queue.png)

All nine are captures of the running app, made with
`node scripts/capture-screens.mjs library=/ import=/import song-view=/songs/<id> play-along=/songs/<id>/play "theory=/theory/scale-finder?root=A&scale=minor-pentatonic" "theory-shapes=/theory/scale-positions?root=A&scale=minor-pentatonic" theory-quiz=/theory/fretboard-quiz album-splitter=/splitter/<id> job-queue=/jobs`
(API and dev server running; it loads the pages, and for Play along it presses Space to play a few bars and pause again). The design system these follow —
tokens, components and screen mockups — is in [design/ui](design/ui) (build it with
`python3 design/ui/build.py`), with its rules in [design/ui-spec.md](design/ui-spec.md).

## Run locally

Requirements: Linux, Python 3.12 with [uv](https://docs.astral.sh/uv/), Node.js with npm,
`ffmpeg` and `yt-dlp` on `PATH`, and an NVIDIA GPU with CUDA 12.8 or newer. The RTX 5080
(sm_120) needs the cu128 PyTorch wheels. Both processes refuse to start if a dependency
is missing.

```bash
uv sync
```

```bash
npm --prefix frontend install
```

To do all of that in one go, `scripts/dev.sh up` checks the tools on `PATH`, runs both installs,
frees ports 8000 and 5173 (it kills whatever is listening there), and starts the worker, API and
Vite in the background with logs in `.logs/dev/`. `scripts/dev.sh down` stops them.

Or start the three processes by hand, each in its own terminal.

Worker (all GPU work; it has no port):

```bash
uv run stemcraft-worker
```

API on port 8000:

```bash
uv run uvicorn stemcraft_api.app:create_app --factory --reload --host 0.0.0.0 --port 8000
```

Frontend dev server on port 5173, which proxies `/api` to the API:

```bash
npm --prefix frontend run dev
```

Open <http://localhost:5173>.

`data/theory.json` holds the Theory tab's instrument and quiz history; the API is its only writer.

### Single-origin build

The API serves the built frontend itself, so no Vite process is needed. Run the worker as
above, then:

```bash
npm --prefix frontend run build
```

```bash
STEMCRAFT_DIST_DIR=frontend/dist uv run stemcraft-api
```

Open <http://localhost:8000>.

## Deploy

`ops/install.sh` installs two systemd user units, `stemcraft-api` and `stemcraft-worker`, that
start at boot and restart on failure. `git pull && ops/install.sh` redeploys. Start with
`ops/install.sh --dry-run`, which changes nothing. See [docs/deploy.md](docs/deploy.md) for
requirements, rollback, logs and what has been verified.

## More

- [docs/deploy.md](docs/deploy.md): install, deploy and rollback runbook
- [docs/running.md](docs/running.md): verified transcript of running the whole system
- [design/domain-spec.md](design/domain-spec.md): what the product is
- [design/tech-spec-stemcraft.md](design/tech-spec-stemcraft.md): architecture and decisions
- [CLAUDE.md](CLAUDE.md): invariants for contributors
