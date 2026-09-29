# Stemcraft

Self-hosted, single-user web app that splits songs into stems so you can mute your own
instrument and play along.

- Import a file or a YouTube link; any format ffmpeg can decode is accepted
- GPU stem separation into vocals, drums, bass and other
- Live mixer: mute, solo and volume per stem
- Tempo and pitch change without re-separating; stems are never modified
- Sample-accurate seamless loops on the beat grid, with optional count-in
- Beat, key and chord analysis, plus a fretboard view
- Album splitter: cut a full album rip into tagged MP3s. Silence detection proposes cuts;
  you play, zoom and pan a full-length waveform, drag, add and delete cuts, or type exact
  start and end times to the millisecond, then download a zip
- Export the current mix
- Failures and CPU fallbacks are shown in the UI with the real error message

## Screens

![Library](docs/screenshots/library.png)
![Song view](docs/screenshots/song-view.png)
![Album splitter](docs/screenshots/album-splitter.png)

The Library and Song view images are design mockups from [design/ui](design/ui). The Album
splitter image is a capture of the running app.

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

Then start three processes, each in its own terminal.

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

## More

- [docs/running.md](docs/running.md): verified transcript of running the whole system
- [design/domain-spec.md](design/domain-spec.md): what the product is
- [design/tech-spec-stemcraft.md](design/tech-spec-stemcraft.md): architecture and decisions
- [CLAUDE.md](CLAUDE.md): invariants for contributors
