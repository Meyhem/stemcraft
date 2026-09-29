# UI Spec: Stemcraft

*Drafted Sep 27, 2026. Status: draft.*
*References: [domain-spec.md](domain-spec.md), [tech-spec-stemcraft.md](tech-spec-stemcraft.md).*
*Rendered design system: Claude Design project **Stemcraft**. Source of truth for the
bundle is `design/ui/`; `python3 design/ui/build.py` regenerates `design/ui/dist/`.*

## 1. What this covers

The visual and interaction system for the SPA: tokens, components, and the seven
screens. It does not choose a React component library — it defines what one must
produce. Tokens are CSS custom properties precisely so that decision stays open (U-02);
the styling runtime that consumes them is now settled as CSS modules (D-16), and the
component library remains open (Q-05).

## 2. The constraint that shapes everything

**U-C1 — The Song view is read from a music stand at roughly 1.5 m, by someone holding
an instrument.** Hands are busy, glances are short, and clicks are rare and imprecise.
This is stated nowhere in the other two specs; A-02 says only "desktop-class", which is
about compute, not ergonomics.

Everything below follows from it: the type scale is one step up from typical web,
numerals are tabular so a live readout does not wobble, and controls split into two
hit-target tiers rather than one.

## 3. Decisions

- **U-01 — Saturation carries meaning. Muted hues identify a stem; vivid hues are
  system signals.**
  *Because:* the app needs colour for two unrelated jobs — stem identity (four lanes)
  and job/device state (ok, warn, error) — and a naive palette collides: "drums" red
  and "failed" red are the same red. Splitting by saturation lets both live on one
  screen with no ambiguity, and the two sets never share a context.
  *Rejected:* one palette with different shapes (shape is weaker than colour at 1.5 m);
  greyscale stems with colour only for state (loses the lane identity the whole mixer
  leans on).
  *Reversibility:* two-way, but it is load-bearing for every component.

- **U-02 — Tokens are CSS custom properties, framework-agnostic.**
  *Because:* the React implementation is later work and the styling choice (Tailwind
  theme, CSS modules, vanilla-extract) should not be forced by the design system.
  Custom properties are consumable by all three.
  *Rejected:* a Tailwind config as source of truth (couples the design system to one
  styling runtime before it is chosen).
  *Reversibility:* two-way.
  *Since settled:* the styling runtime is CSS modules (D-16), chosen *over* these
  tokens rather than in place of them — `tokens.css` remains the authority, which is the
  point of U-02 and why D-16 was cheap to make.

- **U-03 — Two hit-target tiers: performance 56 px, setup 40 px, floor 32 px.**
  *Because:* U-C1. A single density either makes the transport too small to hit with a
  bass in hand, or makes the job-history table absurd.
  *Rejected:* one 44 px tier everywhere (splits the difference and serves neither).
  *Reversibility:* two-way.

- **U-04 — Every numeral is mono and `tabular-nums`.**
  *Because:* proportional digits change width as they change value, so a BPM or bar
  readout visibly jitters next to a moving playhead. Applies to bars, BPM, tempo %,
  semitones, timecode, durations and file sizes.
  *Reversibility:* two-way, trivially.

- **U-05 — The playhead is positioned by `requestAnimationFrame` from the engine clock;
  never by a CSS transition or animation.**
  *Because:* D-07 keeps every waveform a drawing with no clock of its own — each is painted
  from a precomputed envelope and never plays audio — so the engine's clock is the only one
  there is. A CSS-animated
  playhead is a second clock that interpolates smoothly through moments the engine did
  not have — including the loop wrap, where it would hide exactly the seam R-01 exists
  to catch. `prefers-reduced-motion` zeroes every other duration and changes nothing
  here.
  *Reversibility:* **one-way in practice** — it is the visual half of D-06/D-07.

- **U-06 — Scrubbing during an active loop disarms the loop first, visibly.**
  *Because:* D-06 forbids seeking the stretcher. Rather than let the UI offer an action
  the engine cannot honour, the loop button unlights and the region greys — the user
  sees the mode change they caused.
  *Rejected:* disabling scrub while looping (silently removes a reasonable action);
  seeking and re-arming (violates D-06).
  *Reversibility:* two-way.

- **U-07 — No webfont. System stacks only.**
  *Because:* served from a home machine over LAN (C-05). A blocked or slow font request
  must never delay first paint of a screen about to be played along to, and there is no
  brand requirement that a system stack fails to meet.
  *Reversibility:* two-way.

- **U-08 — Depth comes from surface steps plus 1 px borders, not drop shadows.** The
  single exception is the modal, which gets one large shadow to lift it off the scrim.
  *Because:* stacked shadows on a near-black ground read as mud at distance; a value
  step reads cleanly.
  *Reversibility:* two-way.

- **U-10 — A near-silent stem is marked, not left blank.**
  *Because:* the four stems are fixed at training time, so a song with no vocals still
  produces a `vocals.wav` of near-silence plus bleed (domain spec, "What the four stems
  can and cannot do"). An unexplained flat lane reads as breakage, which is the silent
  degradation N-08 exists to prevent. The threshold is derived by the worker from
  `peaks.json`, which it already writes — no new analysis, no new file, and nothing
  stored, consistent with deriving Song state from what exists on disk.
  *Rejected:* hiding the lane (breaks the fixed four-lane order that U-01 depends on for
  identity); showing it unmarked (the failure this decision exists to fix).
  *Reversibility:* two-way.

- **U-11 — The ruler is the one click-to-seek strip, and looks it.** On every time axis
  (Song view, Album splitter) the ruler is a tinted accent band with a pointer cursor that
  brightens on hover.
  *Because:* everywhere below it a press means something else — a zoom selection on the
  Song view's lanes, a new cut on the splitter's waveform. Two targets that look alike get
  confused, and a stray cut or a lost playback position is the result.
  *Reversibility:* two-way.

- **U-12 — One zoom-and-pan model for every time axis.** The wheel zooms around the
  pointer; a drag across the content zooms that range to fit; Shift+wheel, a trackpad swipe
  or the scrollbar pans; `−` / `+` step 2× and `Fit` shows everything. The readout says how
  much is in view (bars when analysed, otherwise time) — never px/s. Zoom is continuous from
  fit to a per-axis maximum set by its peak resolution (Song view 200 px/s at 100 buckets/s;
  splitter 100 px/s at 10 buckets/s, D8-12). A lane or waveform paints only its visible
  slice, so zooming in costs nothing extra.
  *Because:* the splitter and the Song view are the same problem — find a moment in a long
  timeline — and a user who learns one should already know the other.
  *Follow:* a manual zoom or pan while playing switches Follow off, visibly. While paused,
  Follow moves the view only when the playhead itself moves (a seek, or switching Follow
  on), never because the zoom changed — or an anchored zoom would snap straight back.
  *Reversibility:* two-way.

- **U-09 — Every failure surface shows the real message from the real tool.** ffmpeg
  stderr, yt-dlp stderr, the Python traceback, verbatim, in mono, copyable.
  *Because:* N-08. Also §9 — a retained `original.*` makes retry free, so an honest
  error is actionable rather than merely alarming.
  *Rejected:* friendly paraphrase with details behind a disclosure (the paraphrase is
  the part that is wrong when it matters).
  *Reversibility:* two-way, and should not be reversed.

## 4. Tokens

Defined in `design/ui/src/tokens.css`. Summary:

| Group | Values |
| --- | --- |
| Ground / surfaces | `#0B0C0E` · `#131519` · `#1A1D22` · `#22262D` |
| Borders | `#2A2F37` subtle · `#3A414B` strong |
| Text | `#EDEFF2` · `#9BA3AE` (7.4:1) · `#626A76` (non-text and 15 px+) |
| Stems (muted) | vocals `#E0A458` · drums `#D9605F` · bass `#4FC3B0` · other `#8E85E0` |
| Signals (vivid) | ok `#30D158` · warn `#FFB020` · error `#FF3B30` · accent `#4FA3FF` · queued `#626A76` |
| Type scale | 48 / 32 / 24 / **18 body** / 15 / 13 floor |
| Space | 4 8 12 16 24 32 48 64 96 |
| Radius | 4 input · 8 button, card · 12 panel · pill |
| Hit targets | 56 performance · 40 setup · 32 floor |
| Motion | 120 ms flip · 200 ms panel · 400 ms progress · `cubic-bezier(.2,.7,.3,1)` |

**Stem colour is never the sole carrier of identity.** Amber and coral are not
separable under deuteranopia. Identity is carried by fixed order (vocals, drums, bass,
other), a permanent text label, and a fixed lane position; hue is an accelerator.

## 5. Components

| Component | Tier | Notes |
| --- | --- | --- |
| Button, icon button | both | pressed state uses **accent**, never a stem hue — a lit control is chrome |
| State chip | setup | queued / running / done / failed / cancelled; device badge uses the same chip |
| Key candidate chip | setup | always plural, always with confidence (R-05) |
| Text field, drop zone, checkbox, segmented | setup | |
| Slider | both | tempo/pitch are performance (14 px track, 32 px knob); gain is setup. **Every slider mirrors its value as a mono readout** — a knob position is unreadable at 1.5 m. Gain fill takes the stem hue; tempo fill takes the accent |
| Stem strip | performance | the signature component. M/S are 56×44. A muted lane drops to 28 % opacity so the mute is visible across a room, not just as a toggle. A **near-silent** lane (U-10) dims its waveform to 16 %, carries an explanatory pill, and renders M/S inert |
| Timeline | — | seek ruler as a tinted band (U-11), beat grid (faint) and downbeat grid (bright), A–B region with bar labels, playhead; lanes painted from envelopes on a viewport-sized canvas |
| Zoom controls | setup | `−` / readout of what is in view / `+` / `Fit`, identical on the Song view transport and the splitter toolbar (U-12) |
| Cut marker | — | Album splitter. One 2 px amber line plus a numbered tag (cut N ends track N). A press within 8 px grabs it; the tag grabs exactly that cut; overlapping cuts resolve by drag direction. Selected: line turns accent, tag gets the focus ring |
| Cut list | setup | per track: ▶ (play from its first sample), title, **Start** and **End** typed as `m:ss.mmm`, length, the exact filename the split will write, and × (remove the cut after it). A time that crosses a neighbour is refused with the allowed range — never clamped |
| Transport bar | performance | bar number in display/48 mono; untouched tempo/pitch values render muted |
| Banner | — | warn and error; carries the verbatim trace (U-09) |
| Progress bar, job row | setup | estimate derives from the job's recorded device and N-01 |
| Table | setup | the only place 13 px is permitted |
| Empty state | — | |

**Implementation note for React:** the visual slider track is 8–14 px tall. The
interactive element must carry its own padded hit area meeting U-03; the track is
decoration inside it.

## 6. Screens

Stem count is **fixed at four** — `vocals`, `drums`, `bass`, `other` — and the palette,
the fixed lane order and the `1`–`4` mute shortcuts all depend on that. This is a
property of the separation model, not a configuration; see the domain spec before
assuming it can vary.

1. **Song library** — card grid sorted by last played. Each card shows a mix-waveform
   thumbnail, title, artist, key candidate, BPM, duration, and a one-line practice
   summary ("bass muted · loop Chorus"). In-flight songs show their job progress inline.
   State badges are **derived from which files exist** — there is no status field for
   them to disagree with. A song whose `song.json` is unreadable renders as an error
   card in place and does not affect its neighbours (§9).
2. **Import** — modal over the current page (`/import` with a background location,
   D-14), built on the native `<dialog>`. One form with one source zone: drop or choose
   a file, or paste a link. The last one given is the source. A chosen file collapses the
   zone to a row with Replace; a link stays editable in its field. Title and artist are shared fields, filled in from the file's own
   tags when left blank and always editable; no online lookup anywhere (C-06). Title is
   required for a link. After submit, the modal shows the song's `import`, `separate` and
   `analyze` jobs as three step groups (D-17), drawn with the same StepList as the Job
   queue, so the wait is legible rather than a spinner. A job not queued yet draws its
   declared steps as pending. Closing doesn't stop the work; "Open job queue" goes to
   `/jobs?song=<id>`.
3. **Song view** — the hard screen. The transport sits on top (play, bar, chord → next,
   tempo, pitch, metronome, loop, Set A/B, zoom, Follow playhead). Below it one horizontally
   scrolling time axis holds, in order, the seek ruler, the chord row aligned to bars, and
   four full-height stem lanes with beat and downbeat grid, A–B region and playhead; the
   200 px lane heads stay put while it scrolls. Zoom and pan per U-12. A 320 px right rail
   holds key candidates, saved loops and count-in — all setup tier, all out of the way.
   Every value auto-saves to `song.json`; zoom and scroll are view state and never do.
4. **Scale & fretboard** — bass or guitar, generated from the selected key candidate.
   Pure arithmetic; no model, no failure mode. The page says so, because the chips above
   it are probabilistic and the board below it is not (R-05).
5. **Export** — stem picker prefilled from the current mix, and an explicit choice
   between "as practiced" and "original". States plainly that the export will **not**
   sound identical to the preview (D-10) — better, never worse — so nobody later files
   it as a bug.
6. **Job queue** — the real operational dashboard (§10). Live queue with cancel, failed
   jobs with full tracebacks, all-time stats split by kind **and device**, and full
   history. Rows whose song was deleted keep their `song_id` and render without a link.
   One row per job with a disclosure: expanded, it shows the job's steps (D-17) with a
   mark (✓ done, numbered ring in the accent colour for the running step with live % and bar, plain numbered ring for pending, ! failed, dashed – skipped
   with reason, ■ cancelled with detail) and a duration each. The running job is
   expanded by default, and collapsed rows show a compact step strip. A failed job's
   traceback sits under the step that failed. `?song=<id>` filters to one song's jobs.
   Jobs from before step tracking say "No step record".
7. **Album splitter** — full window width. Album title and artist are typed once and
   written into every track's tags (there is nothing to fill down). A toolbar with play and
   the zoom controls sits over the album waveform (seek ruler, played part in the accent,
   numbered cut markers); below it, **Use proposed boundaries (N)** applies the detected
   silences only when pressed (D8-04) — after that, proposed and hand-placed cuts are the
   same thing and look the same. Then the cut list (automatic track numbers, millisecond
   start/end, play, remove) and **Split into N tracks**.

## 7. Keyboard

Performance controls all have keys, because reaching for a mouse mid-song is what the
layout is trying to avoid. `Space` play/pause · `L` arm loop · `A`/`B` set loop points
at the current bar · `M` metronome · `1`–`4` mute stem by lane position · `↑`/`↓` tempo
±5 % · `←`/`→` jump one bar.

Album splitter, on a selected cut (click its number): `←`/`→` nudge 0.1 s, with `Shift`
1 s · `Home`/`End` jump to the limits its neighbours allow · `Delete` or `Backspace`
removes it. In a Start/End field, `Enter` commits and `Escape` abandons the edit.

## 8. Deferred

- **Tabs / alphaTab view.** Deferred with the pipeline itself (§12, R-06).
- **Practice mode** — a stripped Song view that drops the right rail and scales the
  transport further. Worth building only after real use shows which rail items are
  actually touched mid-song.
- **Light theme.** No need identified; the app is used in a practice room.

## 9. Open questions

- **U-Q1** — Is the 28 % opacity drop on a muted lane strong enough at 1.5 m, or should
  a muted lane collapse to a thin strip and give its height to the others? The second is
  better feedback and worse for tracking where you are in the song.
- **U-Q2** — Should the chord strip show the *next* chord as well as the current one?
  Useful while learning, and it costs vertical space the waveform wants.
