# UI Spec: Stemcraft

*Drafted Sep 27, 2026. Status: draft.*
*References: [domain-spec.md](domain-spec.md), [tech-spec-stemcraft.md](tech-spec-stemcraft.md).*
*Rendered design system: Claude Design project **Stemcraft**. Source of truth for the
bundle is `design/ui/`; `python3 design/ui/build.py` regenerates `design/ui/dist/`.*

## 1. What this covers

The visual and interaction system for the SPA: tokens, components, and the seven
screens. It does not choose a React component library or a styling runtime — it
defines what those must produce. Tokens are CSS custom properties precisely so that
decision stays open (U-02).

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
  *Because:* D-07 makes wavesurfer a slave to the engine's clock. A CSS-animated
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
| Timeline | — | bar ruler, beat grid (faint) and downbeat grid (bright), A–B region with bar labels, playhead |
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
2. **Import** — modal. Upload or URL. Title and artist prefilled from the file's own
   tags, always editable; no online lookup anywhere (C-06). The pipeline is shown as
   five explicit steps ending in "analyze", so the wait is legible rather than a spinner.
3. **Song view** — the hard screen. Bar ruler, four full-height stem lanes with beat and
   downbeat grid, A–B region, chord strip aligned to bars, transport bar. A 320 px right
   rail holds key candidates, saved loops, tempo-ramp state and count-in — all setup
   tier, all out of the way. Every value auto-saves to `song.json`.
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
7. **Album splitter** — waveform with proposed and user-moved split points visually
   distinguished, album fields typed once and filled down, per-track title table with
   automatic track numbers.

## 7. Keyboard

Performance controls all have keys, because reaching for a mouse mid-song is what the
layout is trying to avoid. `Space` play/pause · `L` arm loop · `A`/`B` set loop points
at the current bar · `M` metronome · `1`–`4` mute stem by lane position · `↑`/`↓` tempo
±5 % · `←`/`→` jump one bar.

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
- **U-Q3** — Does the tempo-ramp ladder belong in the right rail (setup) or on the
  transport (performance)? It is configured rarely and watched often, which splits it.
