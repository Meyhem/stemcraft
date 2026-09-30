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

- **U-13 — On a neck, the root is the bass hue, "act on this" is accent, and right/wrong
  are ok/error.** Every neck (Scale sheet, Play along, the Theory tab's `Neck`) draws the
  highest string on top, as a player looks down at it. The root dot takes `--ds-bass` on
  bass and guitar alike, carrying on from the Scale sheet. The dot to play now, a quiz
  question and every lit picker are accent. A quiz's right and wrong answers, and the
  weak-spot heatmap, use the vivid `--ds-ok` and `--ds-error`, since that is the job
  U-01 gives vivid hues. Dots outside a highlighted position drop to 28 % and keep a
  legible label. Open strings get their own column left of the nut.
  *Because:* one visual language across three screens, so the Theory tab teaches the
  shapes the Play along neck later shows mid-song.
  *Rejected:* a separate colour per scale degree (it spends the palette U-01 reserves,
  and the interval label already says which degree it is).
  *Reversibility:* two-way.

- **U-14 — The navbar's bottom border may glow in stem hues while a song plays.**
  A 3px decorative bar: two soft glows per audible stem, each swelling with that stem's
  level; a muted, soloed-out or count-in-silenced stem contributes none.
  *Because:* it is the four stems being named (U-01), in a form that answers "what am I
  hearing" from across the room. It is `aria-hidden`, takes no input, and says nothing
  the labelled lanes of the Song view do not, so hue may be its only carrier here, the
  one place U-01's "never the sole carrier" is waived. Levels come from the load-time
  envelopes at the engine clock (D-07); nothing is metered on the audio thread.
  `prefers-reduced-motion` hides it.
  *Rejected:* a per-stem level meter in the navbar (a second, smaller mixer); metering in
  the worklet (render-thread messages for an ornament, against R-01).
  *Reversibility:* two-way, trivially.

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
| Stepper | both | − value + for small whole-number ranges where a slider is overkill: pitch on the transport (performance), loop bars in the loop editor (setup). Value in mono, muted at its default; the button at a range end is disabled, never a silent clamp |
| Slider | both | tempo/pitch are performance (14 px track, 32 px knob); gain is setup. **Every slider mirrors its value as a mono readout** — a knob position is unreadable at 1.5 m. Gain fill takes the stem hue; tempo fill takes the accent |
| Stem strip | performance | the signature component. M/S are 56×44. A muted lane drops to 28 % opacity so the mute is visible across a room, not just as a toggle. A **near-silent** lane (U-10) dims its waveform to 16 %, carries an explanatory pill, and renders M/S inert |
| Timeline | — | seek ruler as a tinted band (U-11), beat grid (faint) and downbeat grid (bright), A–B region with bar labels, playhead; lanes painted from envelopes on a viewport-sized canvas |
| Zoom controls | setup | `−` / readout of what is in view / `+` / `Fit`, identical on the Stems view tools and the splitter toolbar (U-12) |
| Cut marker | — | Album splitter. One 2 px amber line plus a numbered tag (cut N ends track N). A press within 8 px grabs it; the tag grabs exactly that cut; overlapping cuts resolve by drag direction. Selected: line turns accent, tag gets the focus ring |
| Cut list | setup | per track: ▶ (play from its first sample), title, **Start** and **End** typed as `m:ss.mmm`, length, the exact filename the split will write, and × (remove the cut after it). A time that crosses a neighbour is refused with the allowed range — never clamped |
| Transport bar | performance | two rows, identical over Stems and Tabs. **Row 1 — what you press:** play, bar number and chord (now → next) in mono, a loop split button (body arms the loop and shows its bars; the chevron opens the loop editor: start/end bar steppers and saved loops) and **Practice** (a popover: metronome, count-in). **Row 2 — what you adjust:** tempo (50–150 %) as a wide centre-zero slider with a tick at 100 %, and pitch (±12 st) as a performance-tier stepper; both 56 px, untouched values render muted. Nothing set once per session sits on the bar itself |
| View switch | setup (48 px) | Stems / Tabs, two links styled as a segmented control; the chosen view's own tools sit to its right |
| Banner | — | warn and error; carries the verbatim trace (U-09) |
| Progress bar, job row | setup | estimate derives from the job's recorded device and N-01 |
| Table | setup | the only place 13 px is permitted |
| Empty state | — | |
| Neck | setup | the Theory tab's fretboard (D-19): any instrument and tuning, fret window with an open-string column, labels by note / interval / degree / none, a position window, markers (root, note, accent, question, coming next, correct, wrong ✕, play-order number, muted ✕), a weak-spot heatmap, click targets, left-handed flip. Colours per U-13. Reference: `components/neck.html` |
| Note picker | setup | 12 buttons C … B with both spellings on the black keys; one lit in accent. Shared by every Theory tool, and the selection carries across tools |
| Scale / quality chips | setup | `button.chip` with `aria-pressed`; lit is accent, never a stem hue. Grouped under a small caps label (Common / Modes / More) |
| Note chips | setup | a scale's or chord's notes, each with its interval in small type; the root filled in the bass hue |
| Help box | — | one plain-language paragraph on what is shown and what it is for, with an accent left rule. Never hides an error |
| Tool rail | setup | Theory tab only: "from a song" card on top, grouped tool links (`aria-current=page`), instrument footer pinned to the bottom |

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
3. **Song screen** — the hard screen, and the only one a song is played on. Top to
   bottom: a header (back to library, title and artist with in-place **Rename**, Export);
   the transport, pinned (play, bar, chord → next, tempo 50–150 % with a tick at 100 %,
   pitch, loop, loop bars, saved loops, metronome, count-in); a **Stems / Tabs** switch
   with the chosen view's tools beside it; then the content. **Stems** is one
   horizontally scrolling time axis holding the seek ruler, the chord row aligned to
   bars, and four full-height stem lanes with beat and downbeat grid, loop region and
   playhead; the 200 px lane heads stay put while it scrolls; its tools are zoom and
   Follow playhead (U-12). **Tabs** is the play-along content: key and pattern pickers,
   the neck, the beat lane and the chord ribbon; its tool is the Scale & fretboard link.
   There is no right rail: key candidates live only in the Tabs key picker. Switching
   content never stops playback and never moves a control (D-18). Every value auto-saves
   to `song.json`; zoom and scroll are view state and never do. Mockup:
   `docs/superpowers/specs/2026-09-30-unified-song-screen-mockup.html`.
4. **Scale & fretboard** — bass or guitar, generated from the selected key candidate.
   Pure arithmetic; no model, no failure mode. The page says so, because the chips above
   it are probabilistic and the board below it is not (R-05).
5. **Export** — stem picker prefilled from the current mix, and an explicit choice
   between "as practiced" and "original". States plainly that the export will **not**
   sound identical to the preview (D-10) — better, never worse — so nobody later files
   it as a bug.
6. **Job queue** — the real operational dashboard (§10). Live queue with cancel, failed
   jobs with full tracebacks, each row stamped with when it started (or was queued), and full
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

8. **Theory** (`/theory/:tool`, D-19): a 232 px tool rail with 13 tools in four groups
   (Find, Shapes, Harmony, Practice). A "from a song" card on top loads an analysed song's
   key and chords; the instrument, tuning and left-handed footer at the bottom applies to
   every tool. Each tool page has, top to bottom: a title with the label toggle, the note
   picker, that tool's own pickers, one `Neck`, the note chips, and a help box. Scale finder
   highlights one position at a time; Chord finder adds voicing cards (5-fret zoomed necks)
   on guitar; Chords in a key has seven numeral cards with their function, progressions and
   a circle of fifths. The Fretboard quiz shows the question large, first-try score / streak /
   average time as mono stats (U-04), feedback in an error chip that explains the mistake,
   focus settings, and the weak-spot heatmap. `theory.json` failures are an error banner
   with the verbatim validation error and a confirmed **Reset to defaults** (U-09). A failed
   save is a warn banner with **Retry**, and unsaved answers are never dropped. References:
   `screens/theory-*.html`.

## 7. Keyboard

Performance controls all have keys, because reaching for a mouse mid-song is what the
layout is trying to avoid. `Space` play/pause · `L` arm loop · `A`/`B` set the loop's
start / end to the current bar (the transport's bar steppers set them by number) · `M` metronome · `1`–`4` mute stem by lane position · `↑`/`↓` tempo
±5 % · `←`/`→` jump one bar. All of these work in both Stems and Tabs.

Album splitter, on a selected cut (click its number): `←`/`→` nudge 0.1 s, with `Shift`
1 s · `Home`/`End` jump to the limits its neighbours allow · `Delete` or `Backspace`
removes it. In a Start/End field, `Enter` commits and `Escape` abandons the edit.

Theory quizzes: *Name the note* answers with `1`–`9`, `0`, `-`, `=` for C … B in
note-picker order; the Theory quiz answers with `1`–`4`. `Enter` starts the next round
from the summary.

## 8. Deferred

- **Transcribed tabs (alphaTab).** Deferred with the pipeline itself (§12, R-06).
- **Light theme.** No need identified; the app is used in a practice room.

## 9. Open questions

- **U-Q1** — Is the 28 % opacity drop on a muted lane strong enough at 1.5 m, or should
  a muted lane collapse to a thin strip and give its height to the others? The second is
  better feedback and worse for tracking where you are in the song.
- **U-Q2** — Should the chord strip show the *next* chord as well as the current one?
  Useful while learning, and it costs vertical space the waveform wants.
