# Practice, Phase B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a **chord pad** (bass mode) and **drum grooves** (both instruments) to the Practice tab, so a warm-up feels like playing with a band rather than a click.

**Architecture:**
- Both parts are more of what Phase A built: pure TypeScript voices into `Float32Array`s at 48 kHz, rendered into the engine slots Phase A left silent. The chord pad goes in `other` (bass mode only; in guitar mode the reference guitar already plays the chords), and drums go in `drums`.
- Each bar of a loop names its harmony (`PracticeBar.chord`), so the pad knows what to play. Grooves and arpeggios name their chords, scales a drone on the scale's tonic triad, and drills nothing.
- `practice.json` goes to schema v2. The change is additive: new levels and two pickers, all with defaults.
- No engine change.

**Tech Stack:** as Phase A.

**Spec:** `docs/superpowers/specs/2026-10-02-practice-design.md` ("Phase B")
**Depends on:** `docs/superpowers/plans/2026-10-02-practice-phase-a.md`, all tasks done and pushed.
**Mockup:** canvas "Stemcraft Practice", artboard *PhaseB* (https://claude.ai/artifact/WZRW3xFbrQUiktmMQ3H4GE)

## Global Constraints

Everything in Phase A's Global Constraints still holds. In addition:

- Slots: `bass` = reference bass (bass mode) or backing bass (guitar mode); `other` = chord pad (bass mode) or reference guitar (guitar mode); `drums` = drums (both); `vocals` = silent.
- The count-in silences every stem and keeps the click (the engine already does this), so drums never play during the count-in.
- Drums follow the loop's bars exactly, one pattern per bar, and fill the whole loop. A loop of 2, 3 or 16 bars gets 2, 3 or 16 bars of groove.
- The pad never invents harmony. A bar without a chord (`chord: null`, as in drills) is silent in the pad, and the panel says why when the whole loop has none.
- Schema: `practice.json` v2. A v1 file is read and upgraded in memory (the new fields take their defaults), and the next save writes v2. Unknown values are still rejected.
- Defaults: `chords: 0.5`, `chords_muted: false`, `drums: 0.6`, `drums_muted: false`, `chord_sound: "pad"`, `drum_groove: "rock"`.
- Work on `main`. Commit after each task. Push only at the end of Task 7, after README upkeep.

## File map

| File | Change |
|---|---|
| `packages/stemcraft_lib/src/stemcraft_lib/practice.py` (+ tests) | v2: `Levels` and `InstrumentSettings.backing` |
| `frontend/src/api/client.ts` | mirror v2, defaults |
| `frontend/src/music/practice/types.ts` | `PracticeBar.chord` |
| `frontend/src/music/practice/{groove,scale,arpeggio,drill}.ts` (+ tests) | set `chord` |
| `frontend/src/practice/audio/drums.ts` (+ test) | **new**: kick, snare, hat voices; five grooves |
| `frontend/src/practice/audio/pad.ts` (+ test) | **new**: voicing, pad and keys voices |
| `frontend/src/practice/audio/render.ts` (+ test) | render chords and drums |
| `frontend/src/practice/usePracticeSession.ts` (+ test) | `gainsFor` covers the new slots; re-render on backing change |
| `frontend/src/practice/SoundPanel.tsx` (+ test) | enable Chords and Drums |
| `design/*`, `README.md`, `docs/screenshots/practice.png` | D-22 amended, README, screenshot |

---

### Task 1: `practice.json` v2

**Files:**
- Modify: `packages/stemcraft_lib/src/stemcraft_lib/practice.py`
- Test: `packages/stemcraft_lib/tests/test_practice.py`, `packages/stemcraft_api/tests/test_practice_routes.py`
- Modify: `frontend/src/api/client.ts`

**Interfaces:**
- Produces (Python and TS): `Levels` gains `chords`, `chords_muted`, `drums`, `drums_muted`. `InstrumentSettings` gains `backing: { chord_sound: 'pad' | 'keys'; drum_groove: 'rock' | 'shuffle' | 'half_time' | 'funk' | 'four_floor' }`. `Practice.version` is `2`. TS: `PracticeBacking`, `DrumGroove`, `ChordSound`, and the updated `DEFAULT_INSTRUMENT_SETTINGS`/`DEFAULT_PRACTICE`.

- [ ] **Step 1: Write the failing tests** (append to `test_practice.py`)

```python
def test_v1_file_reads_as_v2_with_defaults(tmp_path):
    practice_path(tmp_path).write_text(json.dumps({"version": 1, "bass": {"bpm": 90}}))
    doc = read_practice(tmp_path)
    assert doc.version == 2
    assert doc.bass.bpm == 90
    assert doc.bass.levels.drums == 0.6
    assert doc.bass.backing.drum_groove == "rock"
    assert doc.guitar.backing.chord_sound == "pad"


def test_unknown_groove_is_rejected():
    with pytest.raises(ValidationError):
        Practice.model_validate({"bass": {"backing": {"drum_groove": "polka"}}})
```

In `test_practice_routes.py`, change `assert body["version"] == 1` to `assert body["version"] == 2`.

- [ ] **Step 2: Run them to see them fail**

Run: `uv run pytest packages/stemcraft_lib/tests/test_practice.py packages/stemcraft_api/tests/test_practice_routes.py -q`
Expected: FAIL (`version` is 1; there is no `backing`).

- [ ] **Step 3: Change `practice.py`**

```python
SCHEMA_VERSION = 2
```

Add to `Levels`:

```python
    # Phase B (v2): the band. Chords play in bass mode only (in guitar mode the
    # reference guitar is the chords); drums in both.
    chords: float = Field(0.5, ge=0, le=1)
    chords_muted: bool = False
    drums: float = Field(0.6, ge=0, le=1)
    drums_muted: bool = False
```

New model before `InstrumentSettings`:

```python
class Backing(_Strict):
    chord_sound: Literal["pad", "keys"] = "pad"
    drum_groove: Literal["rock", "shuffle", "half_time", "funk", "four_floor"] = "rock"
```

In `InstrumentSettings`: `backing: Backing = Field(default_factory=Backing)`.

In `Practice`, replace the `version` field and add an upgrade step:

```python
    version: Literal[2] = SCHEMA_VERSION

    @model_validator(mode="before")
    @classmethod
    def _upgrade(cls, raw: object) -> object:
        # v1 -> v2 is additive: the new fields take their defaults.
        if isinstance(raw, dict) and raw.get("version") == 1:
            return {**raw, "version": 2}
        return raw
```

- [ ] **Step 4: Mirror it in `client.ts`**

```ts
export type ChordSound = 'pad' | 'keys';
export type DrumGroove = 'rock' | 'shuffle' | 'half_time' | 'funk' | 'four_floor';
export interface PracticeBacking { chord_sound: ChordSound; drum_groove: DrumGroove }
```

- `PracticeLevels` gains `chords: number; chords_muted: boolean; drums: number; drums_muted: boolean`.
- `InstrumentSettings` gains `backing: PracticeBacking`.
- `PracticeDoc.version` becomes `2`.
- In `DEFAULT_INSTRUMENT_SETTINGS`, set `levels` to `{ click: 0.7, ref: 0.8, ref_muted: false, backing: 0.6, backing_muted: false, chords: 0.5, chords_muted: false, drums: 0.6, drums_muted: false }` and add `backing: { chord_sound: 'pad', drum_groove: 'rock' }`.
- In `DEFAULT_PRACTICE`, set `version: 2`.

- [ ] **Step 5: Run everything**

Run: `uv run pytest -q -p no:warnings && uv run ruff check packages ops && npm --prefix frontend test -- --run && npm --prefix frontend run typecheck`
Expected: all pass. Tests that spread `DEFAULT_INSTRUMENT_SETTINGS.levels` pick up the new fields. A `SoundPanel` test asserting an exact `onChange` object still passes, because it spreads `levels`.

- [ ] **Step 6: Commit**

```bash
git add packages frontend/src/api/client.ts
git commit -m "feat(practice): practice.json v2, chord and drum levels and pickers (D-22 Phase B)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Every bar names its harmony

**Files:**
- Modify: `frontend/src/music/practice/types.ts`, `groove.ts`, `scale.ts`, `arpeggio.ts`, `drill.ts`
- Test: the four generator test files (append one test each)

**Interfaces:**
- Produces: `PracticeBar.chord: string | null`, a BTC label (`"G"`, `"E:min"`, `"Gb:min7"`) that `parseChord` reads, or null for no harmony.

- [ ] **Step 1: Write the failing tests**

Append to `groove.test.ts`:

```ts
test('every groove bar names its chord for the pad', () => {
  const loop = loopOrThrow(bassGroove(withGroove({ bars_per_chord: 2 })));
  expect(loop.bars.map((b) => b.chord)).toEqual(['G', 'G', 'D', 'D', 'E:min', 'E:min', 'C', 'C']);
});
```

Append to `scale.test.ts`:

```ts
test('a scale drones its tonic triad', () => {
  const r = scaleLine(withScale({}), 'bass');
  if (!r.ok) throw new Error(r.error);
  expect(r.loop.bars.map((b) => b.chord)).toEqual(['A:min', 'A:min']);
  const major = scaleLine(withScale({ scale: 'lydian' }, { key: 0 }), 'bass');
  if (!major.ok) throw new Error(major.error);
  expect(major.loop.bars[0]!.chord).toBe('C');
});
```

Append to `arpeggio.test.ts`:

```ts
test('arpeggio bars name their chords', () => {
  const r = arpeggioLine(withArp({}), 'bass');
  if (!r.ok) throw new Error(r.error);
  expect(r.loop.bars.map((b) => b.chord)).toEqual(['D:min7', 'G:7', 'C:maj7']);
});
```

Append to `drill.test.ts`:

```ts
test('drills have no harmony', () => {
  const r = drillLine(withDrill({}), 'bass');
  if (!r.ok) throw new Error(r.error);
  expect(r.loop.bars.every((b) => b.chord === null)).toBe(true);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npm --prefix frontend test -- --run src/music/practice`
Expected: FAIL (`chord` is undefined).

- [ ] **Step 3: Add the field and set it**

`types.ts`, in `PracticeBar`:

```ts
  /** The bar's harmony for the chord pad, as a BTC label parseChord reads; null for none (drills). */
  chord: string | null;
```

- `groove.ts` `chordRow()`: `({ label: pretty(b.symbol), repeat: b.repeat, note: notes[i] ?? null, chord: b.label })`.
- `arpeggio.ts`: `chordBars.map((b, i) => ({ label: pretty(b.symbol), repeat: b.repeat, note: barNotes[i] ?? null, chord: b.label }))`.
- `scale.ts`: compute once `const drone = def.mode === 'minor' ? `${btcRoot}:min` : btcRoot`, where `btcRoot` is `toBtcLabel(rootName(settings.key, def.mode))` (import `toBtcLabel` from `./chords`). Give every bar `chord: drone`.
- `drill.ts`: `chord: null` on every bar.

`toBtcLabel('A')` is `'A'`, so the minor drone is `'A:min'`, and C lydian (major mode) is `'C'`.

- [ ] **Step 4: Run all frontend tests and typecheck**

Run: `npm --prefix frontend test -- --run && npm --prefix frontend run typecheck`
Expected: all pass. Hand-built `PracticeBar`s in tests (for example in `PracticeTransport.test.tsx`) need `chord: null` added. The typecheck lists every place.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/music/practice frontend/src/practice
git commit -m "feat(practice): every bar names its harmony for the chord pad (D-22 Phase B)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Drum voices and grooves

**Files:**
- Create: `frontend/src/practice/audio/drums.ts`
- Test: `frontend/src/practice/audio/drums.test.ts`

**Interfaces:**
- Consumes: `SAMPLE_RATE`; `rng` (Phase A Task 3).
- Produces:

```ts
export type DrumVoice = 'kick' | 'snare' | 'hat';
export interface DrumPattern { steps: 12 | 16; kick: number[]; snare: number[]; hat: number[] }
export const GROOVES: Record<DrumGroove, DrumPattern>;
export function drumHit(voice: DrumVoice, seed: number): Float32Array;
/** Onsets in beats from the loop start, for `bars` bars of `groove`. */
export function drumHits(groove: DrumGroove, bars: number): { voice: DrumVoice; beat: number }[];
```

- [ ] **Step 1: Write the failing tests**

`frontend/src/practice/audio/drums.test.ts`:

```ts
import { describe, expect, test } from 'vitest';

import { SAMPLE_RATE } from '../../engine/types';
import { drumHit, drumHits, GROOVES } from './drums';

const peak = (xs: Float32Array) => xs.reduce((m, x) => Math.max(m, Math.abs(x)), 0);

describe('drumHit', () => {
  test('each voice is short, loud enough, below clipping, and ends silent', () => {
    for (const voice of ['kick', 'snare', 'hat'] as const) {
      const xs = drumHit(voice, 1);
      expect(xs.length).toBeLessThanOrEqual(0.4 * SAMPLE_RATE);
      expect(peak(xs)).toBeGreaterThan(0.2);
      expect(peak(xs)).toBeLessThan(1);
      expect(Math.abs(xs.at(-1)!)).toBeLessThan(1e-3);
    }
  });
  test('deterministic for a seed', () => {
    expect(drumHit('snare', 4)).toEqual(drumHit('snare', 4));
  });
});

describe('drumHits', () => {
  test('rock: kick on 1 and 3, snare on 2 and 4, hats on eighths, every bar', () => {
    const hits = drumHits('rock', 2);
    expect(hits.filter((h) => h.voice === 'kick').map((h) => h.beat)).toEqual([0, 2, 4, 6]);
    expect(hits.filter((h) => h.voice === 'snare').map((h) => h.beat)).toEqual([1, 3, 5, 7]);
    expect(hits.filter((h) => h.voice === 'hat')).toHaveLength(16);
  });
  test('shuffle is in triplets', () => {
    const hats = drumHits('shuffle', 1).filter((h) => h.voice === 'hat').map((h) => h.beat);
    expect(hats).toEqual([0, 2 / 3, 1, 5 / 3, 2, 8 / 3, 3, 11 / 3]);
  });
  test('every groove has a kick on the downbeat and stays inside its bars', () => {
    for (const [name, p] of Object.entries(GROOVES)) {
      expect(p.kick[0], name).toBe(0);
      for (const h of drumHits(name as never, 3)) expect(h.beat).toBeLessThan(12);
    }
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npm --prefix frontend test -- --run src/practice/audio/drums.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write `drums.ts`**

```ts
// The Practice drum grooves (D-22 Phase B): three synthesized voices and five
// one-bar patterns on a step grid (sixteenths, or triplet eighths for the
// shuffle). Plain DSP at 48 kHz, deterministic for a seed, like voices.ts.
import type { DrumGroove } from '../../api/client';
import { SAMPLE_RATE } from '../../engine/types';
import { rng } from '../../music/practice/random';

export type DrumVoice = 'kick' | 'snare' | 'hat';

export interface DrumPattern {
  /** Steps per bar of 4/4: 16 sixteenths, or 12 triplet eighths. */
  steps: 12 | 16;
  kick: number[];
  snare: number[];
  hat: number[];
}

const EIGHTHS = [0, 2, 4, 6, 8, 10, 12, 14];
export const GROOVES: Record<DrumGroove, DrumPattern> = {
  rock: { steps: 16, kick: [0, 8], snare: [4, 12], hat: EIGHTHS },
  half_time: { steps: 16, kick: [0, 6], snare: [8], hat: EIGHTHS },
  funk: { steps: 16, kick: [0, 3, 10], snare: [4, 12], hat: [...Array(16).keys()] },
  four_floor: { steps: 16, kick: [0, 4, 8, 12], snare: [4, 12], hat: [2, 6, 10, 14] },
  shuffle: { steps: 12, kick: [0, 6], snare: [3, 9], hat: [0, 2, 3, 5, 6, 8, 9, 11] },
};

export function drumHits(groove: DrumGroove, bars: number): { voice: DrumVoice; beat: number }[] {
  const p = GROOVES[groove];
  const beatOf = (step: number) => (step * 4) / p.steps;
  const out: { voice: DrumVoice; beat: number }[] = [];
  for (let bar = 0; bar < bars; bar++) {
    for (const voice of ['kick', 'snare', 'hat'] as const) {
      for (const step of p[voice]) out.push({ voice, beat: bar * 4 + beatOf(step) });
    }
  }
  return out.sort((a, b) => a.beat - b.beat);
}

const LENGTH: Record<DrumVoice, number> = { kick: 0.35, snare: 0.22, hat: 0.06 };

export function drumHit(voice: DrumVoice, seed: number): Float32Array {
  const n = Math.round(LENGTH[voice] * SAMPLE_RATE);
  const out = new Float32Array(n);
  const noise = rng(seed);
  let phase = 0;
  let previous = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    const fade = 1 - i / n; // reaches 0 at the end: no click
    if (voice === 'kick') {
      // A sine whose pitch falls fast from 120 Hz to 45 Hz: the thump.
      const hz = 45 + 75 * Math.exp(-t / 0.03);
      phase += (2 * Math.PI * hz) / SAMPLE_RATE;
      out[i] = 0.9 * Math.sin(phase) * Math.exp(-t / 0.12) * fade;
    } else if (voice === 'snare') {
      // A short 185 Hz body under a longer noise burst: the wires.
      const body = Math.sin((2 * Math.PI * 185 * i) / SAMPLE_RATE) * Math.exp(-t / 0.04);
      const wires = (noise() * 2 - 1) * Math.exp(-t / 0.07);
      out[i] = (0.35 * body + 0.45 * wires) * fade;
    } else {
      // Noise through a first difference (a crude high-pass): the tick.
      const x = noise() * 2 - 1;
      out[i] = 0.5 * (x - previous) * Math.exp(-t / 0.015) * fade;
      previous = x;
    }
  }
  return out;
}
```

- [ ] **Step 4: Run the tests**

Run: `npm --prefix frontend test -- --run src/practice/audio/drums.test.ts`
Expected: all pass. The hat's peak is around 0.5–0.9 (a first difference of noise in [−1, 1] reaches 2, times 0.5). If the 0.2 floor or the 1.0 ceiling fails for a voice, adjust that voice's gain constant, not the test.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/practice/audio/drums.ts frontend/src/practice/audio/drums.test.ts
git commit -m "feat(practice): drum voices and five grooves (D-22 Phase B)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Chord voicing, pad and keys

**Files:**
- Create: `frontend/src/practice/audio/pad.ts`
- Test: `frontend/src/practice/audio/pad.test.ts`

**Interfaces:**
- Consumes: `parseChord` (`music/chordTones.ts`); `midiHz`, `RELEASE_FRAMES` (Phase A Task 10); `SAMPLE_RATE`.
- Produces:

```ts
/** Close-position voicing between C3 (48) and C5 (72): root, 3rd, 5th, 7th if any. */
export function voicing(label: string): number[] | null;
export function padNote(midi: number, frames: number): Float32Array;   // slow swell, sustains, frames + release
export function keysNote(midi: number, frames: number): Float32Array;  // struck, decays, frames + release
/** When the chord sounds in a bar, in beats from the bar start: pad = the whole bar; keys = beats 1 and 3, two beats each. */
export function chordHits(sound: ChordSound): { beat: number; dur: number }[];
```

- [ ] **Step 1: Write the failing tests**

`frontend/src/practice/audio/pad.test.ts`:

```ts
import { describe, expect, test } from 'vitest';

import { SAMPLE_RATE } from '../../engine/types';
import { chordHits, keysNote, padNote, voicing } from './pad';
import { RELEASE_FRAMES } from './voices';

const peak = (xs: Float32Array, from = 0, to = xs.length) => {
  let m = 0;
  for (let i = from; i < to; i++) m = Math.max(m, Math.abs(xs[i]!));
  return m;
};

describe('voicing', () => {
  test('close position from the root, inside C3–C5', () => {
    expect(voicing('G')).toEqual([55, 59, 62]);
    expect(voicing('E:min')).toEqual([52, 55, 59]);
    expect(voicing('Gb:min7')).toEqual([54, 57, 61, 64]);
    expect(voicing('B:hdim7')).toEqual([59, 62, 65, 69]);
  });
  test('null for no chord or an unreadable one', () => {
    expect(voicing('N')).toBeNull();
    expect(voicing('Q:wat')).toBeNull();
  });
});

test('the pad swells in; keys strike at once; both end silent and below clipping', () => {
  const pad = padNote(60, SAMPLE_RATE);
  const keys = keysNote(60, SAMPLE_RATE);
  expect(pad).toHaveLength(SAMPLE_RATE + RELEASE_FRAMES);
  expect(peak(pad, 0, 480)).toBeLessThan(peak(pad, 9600, 14400) / 4);
  expect(peak(keys, 0, 480)).toBeGreaterThan(peak(keys, 9600, 14400));
  for (const xs of [pad, keys]) {
    expect(peak(xs)).toBeLessThan(0.5);
    expect(Math.abs(xs.at(-1)!)).toBeLessThan(1e-3);
  }
});

test('chordHits', () => {
  expect(chordHits('pad')).toEqual([{ beat: 0, dur: 4 }]);
  expect(chordHits('keys')).toEqual([{ beat: 0, dur: 2 }, { beat: 2, dur: 2 }]);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npm --prefix frontend test -- --run src/practice/audio/pad.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write `pad.ts`**

```ts
// The Practice chord part (D-22 Phase B): each bar's chord voiced in close
// position in the middle of the keyboard, out of the bass's register, played
// as a soft pad (held) or keys (struck on 1 and 3). Several notes sound at
// once, so each is quiet: peaks stay well under 1 when a 7th chord stacks up.
import type { ChordSound } from '../../api/client';
import { SAMPLE_RATE } from '../../engine/types';
import { mod12, parseChord } from '../../music/chordTones';
import { midiHz, RELEASE_FRAMES } from './voices';

const LOW = 48; // C3

export function voicing(label: string): number[] | null {
  const parsed = parseChord(label, 0);
  if (parsed.kind !== 'chord') return null;
  const t = parsed.tones;
  const root = LOW + mod12(t.rootPc - LOW);
  const tones = [0, t.third, t.fifth, ...(t.seventh === null ? [] : [t.seventh])];
  return tones.map((s) => root + s);
}

function release(i: number, frames: number): number {
  return i < frames ? 1 : Math.max(0, 1 - (i - frames) / RELEASE_FRAMES);
}

/** Two slightly detuned voices with a few soft harmonics, swelling in over 120 ms. */
export function padNote(midi: number, frames: number): Float32Array {
  const out = new Float32Array(frames + RELEASE_FRAMES);
  const f = midiHz(midi);
  const attack = 0.12 * SAMPLE_RATE;
  for (let i = 0; i < out.length; i++) {
    const env = Math.min(1, i / attack) * release(i, frames);
    let s = 0;
    for (const detune of [-0.002, 0.002]) {
      const w = (2 * Math.PI * f * (1 + detune) * i) / SAMPLE_RATE;
      s += Math.sin(w) + 0.3 * Math.sin(2 * w) + 0.12 * Math.sin(3 * w);
    }
    out[i] = 0.06 * env * s;
  }
  return out;
}

/** A struck electric-piano-ish tone: the fundamental and a bell-like 4th harmonic, decaying. */
export function keysNote(midi: number, frames: number): Float32Array {
  const out = new Float32Array(frames + RELEASE_FRAMES);
  const w = (2 * Math.PI * midiHz(midi)) / SAMPLE_RATE;
  const attack = 0.003 * SAMPLE_RATE;
  for (let i = 0; i < out.length; i++) {
    const t = i / SAMPLE_RATE;
    const env = Math.min(1, i / attack) * Math.exp(-t / 0.8) * release(i, frames);
    out[i] = 0.12 * env * (Math.sin(w * i) + 0.25 * Math.exp(-t / 0.1) * Math.sin(4 * w * i));
  }
  return out;
}

export function chordHits(sound: ChordSound): { beat: number; dur: number }[] {
  return sound === 'pad' ? [{ beat: 0, dur: 4 }] : [{ beat: 0, dur: 2 }, { beat: 2, dur: 2 }];
}
```

`voicing('Gb:min7')`: the root is 48 + mod12(6 − 48) = 48 + 6 = 54 (F♯3), then +3, +7, +10 = 54, 57, 61, 64. `B:hdim7`: 48 + 11 = 59, then 62, 65, 69.

- [ ] **Step 4: Run the tests**

Run: `npm --prefix frontend test -- --run src/practice/audio/pad.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/practice/audio/pad.ts frontend/src/practice/audio/pad.test.ts
git commit -m "feat(practice): chord voicing, pad and keys voices (D-22 Phase B)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Render the band; gains for the new slots

**Files:**
- Modify: `frontend/src/practice/audio/render.ts` (+ test)
- Modify: `frontend/src/practice/usePracticeSession.ts` (+ test)

**Interfaces:**
- Produces: `renderPractice(loop, bpm, backing: PracticeBacking = DEFAULT_INSTRUMENT_SETTINGS.backing)`. Phase A callers stay valid. `gainsFor(instrument, levels)` now returns `drums` (and `other` in bass mode) from the levels. The session re-renders when `settings.backing` changes.

- [ ] **Step 1: Write the failing tests**

Append to `render.test.ts`:

```ts
describe('the band', () => {
  const bass = loopFor('bass');
  test('drums in the drums slot on every bar; the pad in other, in bass mode', () => {
    const r = renderPractice(bass, 120, { chord_sound: 'pad', drum_groove: 'rock' });
    const drums = r.stems[slot('drums')]!.left;
    for (let bar = 0; bar < 4; bar++) {
      const at = r.loopStart + beatFrames(bar * 4, 120);
      expect(energy(drums, at, at + 480)).toBeGreaterThan(1);
    }
    expect(energy(drums, 0, r.loopStart)).toBe(0);
    expect(energy(r.stems[slot('other')]!.left, r.loopStart, r.loopEnd)).toBeGreaterThan(1);
  });

  test('guitar mode keeps other for the reference guitar: no pad mixed in', () => {
    const g = loopFor('guitar');
    const withBand = renderPractice(g, 120, { chord_sound: 'pad', drum_groove: 'rock' });
    const plain = renderPractice(g, 120);
    expect(withBand.stems[slot('other')]!.left).toEqual(plain.stems[slot('other')]!.left);
  });

  test('a drill has no harmony: the pad slot is silent', () => {
    const r = generate('bass', { ...DEFAULT_INSTRUMENT_SETTINGS, exercise: 'drill' });
    if (!r.ok) throw new Error(r.error);
    const out = renderPractice(r.loop, 120, { chord_sound: 'keys', drum_groove: 'funk' });
    expect(energy(out.stems[slot('other')]!.left, 0, out.loopEnd)).toBe(0);
  });
});
```

Replace the `gainsFor` test in `usePracticeSession.test.tsx`:

```ts
test('gainsFor: each part in its slot, mutes as zero', () => {
  const levels = { click: 0.7, ref: 0.8, ref_muted: false, backing: 0.6, backing_muted: true, chords: 0.5, chords_muted: false, drums: 0.4, drums_muted: false };
  expect(gainsFor('bass', levels)).toEqual({ vocals: 0, drums: 0.4, bass: 0.8, other: 0.5 });
  expect(gainsFor('guitar', levels)).toEqual({ vocals: 0, drums: 0.4, bass: 0, other: 0.8 });
  expect(gainsFor('bass', { ...levels, drums_muted: true, chords_muted: true }).drums).toBe(0);
});
```

And add:

```ts
test('changing the groove re-renders; changing a level does not', async () => {
  const { engine, hook, loop } = setup();
  await waitFor(() => expect(hook.result.current.rendered).not.toBeNull());
  hook.rerender({ settings: { ...DEFAULT_INSTRUMENT_SETTINGS, levels: { ...DEFAULT_INSTRUMENT_SETTINGS.levels, drums: 0.1 } }, loop });
  await new Promise((r) => setTimeout(r, 0));
  expect(engine.replaceStems).not.toHaveBeenCalled();
  hook.rerender({ settings: { ...DEFAULT_INSTRUMENT_SETTINGS, backing: { chord_sound: 'pad', drum_groove: 'funk' } }, loop });
  await waitFor(() => expect(engine.replaceStems).toHaveBeenCalledTimes(1));
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npm --prefix frontend test -- --run src/practice`
Expected: FAIL (drums silent, gains old, no re-render).

- [ ] **Step 3: Change `render.ts`**

Add the parameter and two mixing passes before the headroom step:

```ts
import { DEFAULT_INSTRUMENT_SETTINGS, type PracticeBacking } from '../../api/client';
import { drumHit, drumHits } from './drums';
import { chordHits, keysNote, padNote, voicing } from './pad';

export function renderPractice(
  loop: PracticeLoop,
  bpm: number,
  backing: PracticeBacking = DEFAULT_INSTRUMENT_SETTINGS.backing,
): RenderedPractice {
  // … Phase A body up to the headroom step …

  // Drums, both instruments: one pattern per bar for the whole loop.
  drumHits(backing.drum_groove, loopBars).forEach((hit, k) => {
    mix(mono.drums, drumHit(hit.voice, k + 1), loopStart + beatFrames(hit.beat, bpm));
  });

  // The chord part, bass mode only: in guitar mode `other` is the reference guitar.
  if (loop.instrument === 'bass') {
    const voice = backing.chord_sound === 'pad' ? padNote : keysNote;
    loop.bars.forEach((bar, b) => {
      const notes = bar.chord ? voicing(bar.chord) : null;
      if (!notes) return;
      for (const hit of chordHits(backing.chord_sound)) {
        const { at, frames } = span(b * BEATS_PER_BAR + hit.beat, hit.dur);
        for (const midi of notes) mix(mono.other, voice(midi, frames), at);
      }
    });
  }

  // … headroom step and return, unchanged …
}
```

The first test of Phase A's render file ("vocals and drums are silent") now runs with the default backing, which is rock drums. Change that test to assert only `vocals` is silent, and keep "drums silent" out of Phase A's expectation.

- [ ] **Step 4: Change `usePracticeSession.ts`**

```ts
export function gainsFor(instrument: PracticeInstrument, levels: PracticeLevels): Record<StemName, number> {
  const on = (level: number, muted: boolean) => (muted ? 0 : level);
  const ref = on(levels.ref, levels.ref_muted);
  const drums = on(levels.drums, levels.drums_muted);
  return instrument === 'bass'
    ? { vocals: 0, drums, bass: ref, other: on(levels.chords, levels.chords_muted) }
    : { vocals: 0, drums, bass: on(levels.backing, levels.backing_muted), other: ref };
}
```

In the render effect, pass `settings.backing` to `renderPractice(loop, renderBpm, backing)`. Add a dependency `backingKey = settings.backing.chord_sound + settings.backing.drum_groove`, so a new object with the same values does not re-render.

- [ ] **Step 5: Run all frontend tests and typecheck**

Run: `npm --prefix frontend test -- --run && npm --prefix frontend run typecheck`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/practice
git commit -m "feat(practice): render drums and the chord part into their slots (D-22 Phase B)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Sound panel: chords and drums switched on

**Files:**
- Modify: `frontend/src/practice/SoundPanel.tsx` (+ test)
- Modify: `frontend/src/screens/Practice.tsx` (pass `backing` and its setter)

**Interfaces:**
- Produces: `SoundPanel({ instrument, levels, backing, hasHarmony, onChange(levels), onBacking(backing) })`.

- [ ] **Step 1: Write the failing tests** (replace `SoundPanel.test.tsx`)

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';

import { DEFAULT_INSTRUMENT_SETTINGS } from '../api/client';
import { SoundPanel } from './SoundPanel';

const { levels, backing } = DEFAULT_INSTRUMENT_SETTINGS;

function mount(instrument: 'bass' | 'guitar', hasHarmony = true) {
  const onChange = vi.fn();
  const onBacking = vi.fn();
  render(<SoundPanel instrument={instrument} levels={levels} backing={backing} hasHarmony={hasHarmony} onChange={onChange} onBacking={onBacking} />);
  return { onChange, onBacking };
}

test('bass: chords with pad or keys, drums with a groove, each mutable', async () => {
  const { onChange, onBacking } = mount('bass');
  await userEvent.click(screen.getByRole('button', { name: 'Keys' }));
  expect(onBacking).toHaveBeenCalledWith({ ...backing, chord_sound: 'keys' });
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Drum groove' }), 'shuffle');
  expect(onBacking).toHaveBeenLastCalledWith({ ...backing, drum_groove: 'shuffle' });
  await userEvent.click(screen.getByRole('button', { name: 'Mute Drums' }));
  expect(onChange).toHaveBeenCalledWith({ ...levels, drums_muted: true });
  expect(screen.queryByText('Phase B')).toBeNull();
});

test('guitar: no chord part (the reference guitar is the chords); drums yes', () => {
  mount('guitar');
  expect(screen.queryByRole('slider', { name: 'Chords level' })).toBeNull();
  expect(screen.getByRole('slider', { name: 'Drums level' })).toBeInTheDocument();
});

test('a loop with no harmony says why the chords are silent', () => {
  mount('bass', false);
  expect(screen.getByText('Drills have no chords.')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npm --prefix frontend test -- --run src/practice/SoundPanel.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Change `SoundPanel.tsx`**

- Remove `Later`.
- Extend `LevelKey` with `'chords' | 'drums'` and `MuteKey` with `'chords_muted' | 'drums_muted'`.
- Add the props `backing: PracticeBacking`, `hasHarmony: boolean` and `onBacking(next: PracticeBacking): void`.
- In bass mode, replace the `<Later label="Chords" …/>` with:

```tsx
<div className={styles.channelWide}>
  <Channel label="Chords" hue="var(--ds-other)" level={levels.chords} muted={levels.chords_muted} onLevel={level('chords')} onMute={mute('chords_muted')} />
  <Segmented
    label="Chord sound"
    value={backing.chord_sound}
    onChange={(chord_sound) => onBacking({ ...backing, chord_sound })}
    options={[
      { value: 'pad', label: 'Pad' },
      { value: 'keys', label: 'Keys' },
    ]}
  />
  {!hasHarmony && <span className={styles.dim}>Drills have no chords.</span>}
</div>
```

- Replace `<Later label="Drums" …/>` (both modes) with:

```tsx
<div className={styles.channelWide}>
  <Channel label="Drums" hue="var(--ds-drums)" level={levels.drums} muted={levels.drums_muted} onLevel={level('drums')} onMute={mute('drums_muted')} />
  <select className={styles.select} aria-label="Drum groove" value={backing.drum_groove} onChange={(e) => onBacking({ ...backing, drum_groove: e.target.value as DrumGroove })}>
    <option value="rock">Rock</option>
    <option value="shuffle">Shuffle</option>
    <option value="half_time">Half-time</option>
    <option value="funk">Funk</option>
    <option value="four_floor">Four on the floor</option>
  </select>
</div>
```

- Append `.channelWide { display: flex; align-items: center; gap: var(--ds-3); min-width: 480px; flex-wrap: wrap; }` to `Practice.module.css`. Remove `.later` if nothing else uses it.

In `screens/Practice.tsx`, pass the new props:

```tsx
<SoundPanel
  instrument={instrument}
  levels={settings.levels}
  backing={settings.backing}
  hasHarmony={loop?.bars.some((b) => b.chord !== null) ?? true}
  onChange={(levels) => change({ ...settings, levels })}
  onBacking={(backing) => change({ ...settings, backing })}
/>
```

`backing` is not in the screen's `noteKey`, so a groove change re-renders audio (Task 5) without regenerating notes.

- [ ] **Step 4: Run all frontend tests, typecheck, build**

Run: `npm --prefix frontend test -- --run && npm --prefix frontend run typecheck && npm --prefix frontend run build`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/practice frontend/src/screens/Practice.tsx
git commit -m "feat(practice): chord and drum controls in the sound panel (D-22 Phase B)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Verify by ear, docs, README, push

- [ ] **Step 1: Listen** (app running via the `dev-setup` skill)
  - For each of the five grooves at 90 and 160 bpm, over 8 loops: the groove is steady across the wrap, and the kick lands with the click's downbeat.
  - During a count-in only the click plays. The drums and chords come in on bar 1.
  - Pad and keys over I–V–vi–IV, 12-bar blues and ii–V–I: the chords change on the bar line and sit above the bass, not muddying it.
  - A scale drones its tonic triad. A drill's chords are silent and the panel says why.
  - Guitar mode: drums under the strum and the backing bass, with no pad.
  - Mixed: nothing clips at all levels on full (the per-stem headroom), and the engine sums four stems, so check the sum by ear at full levels too.
- [ ] **Step 2: Docs.** Amend D-22 in `design/tech-spec-stemcraft.md` with "*Amended (Phase B):* chord pad and drum grooves rendered into `other`/`drums`; `practice.json` v2; `PracticeBar.chord`." Update the UI-spec entry's sound panel. Update the design card's sound row from the canvas *PhaseB* artboard.
- [ ] **Step 3: README.** Extend the Practice bullet ("…with drums and a chord pad, a tempo ramp…") and re-capture: `node scripts/capture-screens.mjs practice=/practice`.
- [ ] **Step 4: Full check, commit, push**

Run: `uv run pytest -q -p no:warnings && uv run ruff check packages ops && npm --prefix frontend test -- --run && npm --prefix frontend run typecheck && npm --prefix frontend run build`

```bash
git add design docs README.md
git commit -m "docs: Practice Phase B, drums and chord pad (D-22), README and screenshot

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin main
```
