# Navbar stem pulse bar: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** While a song plays, a 3px bar on the navbar's bottom border shows soft drifting glows in the stem colours, one pair per audible stem, each swelling with that stem's own level.

**Architecture:** Frontend-only, and nothing on the audio thread changes. Per-stem levels are *derived*: the engine already holds a 100 Hz peak envelope per stem (`stemSummaries`), so the bar looks each one up at the engine clock's position every animation frame. Audibility comes from a new main-thread getter, `EngineController.getStemGain`, so mute, solo, gain and the count-in's silencing are all reflected from one source. `AppShell` exposes an empty slot inside `<nav>` through a context; `SongScope` (which owns the session, below the shell) portals a canvas into it.

**Tech Stack:** React 19, TypeScript, CSS modules over `tokens.css`, Canvas 2D, Vitest + Testing Library, the custom Web Audio engine in `frontend/src/engine/`.

**Spec:** the chosen mockup, candidate C "Fluid blobs" (chat session of 2026-09-30; its formulas are copied verbatim into Task 3). Rules it must satisfy: [design/ui-spec.md](../../../design/ui-spec.md) (U-01, U-02, U-05), [design/tech-spec-stemcraft.md](../../../design/tech-spec-stemcraft.md) (D-07, D-13, D-18).

## Global Constraints

- No waveform renderer ever plays audio (D-07): the bar only draws, slaved to the engine clock.
- Nothing the engine owns goes through React state at 60 fps (D-13): the rAF loop writes straight to the canvas.
- `tokens.css` is the only place a colour is defined (U-02): stem colours reach the canvas through `resolveColor`, no hex in TSX or CSS modules. `src/styles/chrome.test.ts` enforces this and must stay green, so no CSS module may name `--ds-vocals|drums|bass|other`.
- The worklet (`stem-cursor-processor.ts`, `loopCursor.ts`) is not touched. R-01 is not re-opened for a decoration.
- The bar is decorative: `aria-hidden`, no pointer events, hidden under `prefers-reduced-motion: reduce`.
- Match the surrounding code's comment density and idiom.
- Work on `main`. After each task: tests and typecheck pass, commit, `git push origin main`. README upkeep happens in Task 5.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Commands run from the repo root. Frontend tests: `npm --prefix frontend test -- <file>`. Typecheck: `npm --prefix frontend run typecheck`.

## Decisions this plan makes

- **Levels are derived from the existing envelopes, not metered on the audio thread.** `summariseStem` already computes a 100-buckets-per-second absolute-peak envelope per stem at load. Reading it at `getPositionSamples()` follows loops, seeks and tempo changes for free, costs four array reads a frame, and adds no messages or allocations to the worklet. *Rejected:* per-stem RMS posted from the worklet (60 messages a second from the render thread, for a 3px ornament); four `AnalyserNode`s (the stems are mixed inside the worklet per D-05, so there is no per-stem node to tap).
- **The cursor position is pre-stretcher**, so the bar leads the speakers by SoundTouch's latency (tens of ms). Accepted: it is not a meter.
- **Each stem is normalised to its own peak**, so a quiet stem still pulses across its full range. A stem flagged `nearSilent` (U-10) gets level 0: normalising noise would make an empty stem pulse hardest.
- **Audibility is read from the engine, not re-derived from `song.mix` and `soloed`.** `getStemGain` returns the last value passed to `setStemGain`, so the count-in (which zeroes all four gains inside the engine) darkens the bar without the bar knowing count-ins exist. Gain above 1 is clamped to 1 for display.
- **Both glows of a stem share one level.** The mockup delayed the second glow by 60 ms; at 3px it is not visible, so it is dropped.
- **Pause fades by CSS opacity; the rAF loop simply stops.** This is not the playhead, so U-05 does not apply, and `AppShell`/`StemPulseBar` stylesheets are outside `chrome.test.ts`'s playhead-path list.
- **U-01 is extended, not broken.** Stem hues may appear in the navbar because the bar is the four stems being named, in a purely decorative, unlabelled form that carries no information the Song view's labelled lanes do not. Recorded as U-14 in Task 5.
- **Visible on both song screens** (Song view and Play along), since both live under `SongScope` (D-18). Everywhere else the slot is empty and the navbar's 1px border shows as today.

## File Structure

| File | Responsibility |
| --- | --- |
| `frontend/src/engine/EngineController.ts` (modify) | remember and expose the gain last set per stem |
| `frontend/src/engine/stemPeaks.ts` (modify) | export the envelope rate as a named constant |
| `frontend/src/pulse/levels.ts` (create) | envelope lookup at a position; attack/release follower. Pure. |
| `frontend/src/pulse/blobs.ts` (create) | levels + weights + drift time → glow geometry. Pure. |
| `frontend/src/pulse/paint.ts` (create) | glow geometry → canvas calls; hex → rgb |
| `frontend/src/app/pulseSlot.ts` (create) | context carrying the navbar slot element |
| `frontend/src/app/AppShell.tsx`, `AppShell.module.css` (modify) | render the slot in `<nav>`, provide the context |
| `frontend/src/pulse/StemPulseBar.tsx`, `StemPulseBar.module.css` (create) | the canvas, the rAF loop, the portal |
| `frontend/src/session/SongScope.tsx` (modify) | mount `<StemPulseBar />` inside the session |

---

### Task 1: The engine reports each stem's gain

**Files:**
- Modify: `frontend/src/engine/EngineController.ts:168-172`
- Test: `frontend/src/engine/EngineController.test.ts`

**Interfaces:**
- Produces: `EngineController.getStemGain(stem: StemName): number` — the linear gain last passed to `setStemGain` for that stem; `1` before any call (the worklet's `gainN` default).

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/engine/EngineController.test.ts` (it already defines `makeController`, `BAR_STARTS`, `waitForRaf` and imports `sampleIndex`, `vi`):

```ts
describe('EngineController stem gains', () => {
  it('reports the gain last set for a stem, and 1 before any is set', () => {
    const { controller } = makeController();
    expect(controller.getStemGain('bass')).toBe(1);
    controller.setStemGain('bass', 0.25);
    expect(controller.getStemGain('bass')).toBe(0.25);
    expect(controller.getStemGain('drums')).toBe(1);
  });

  it('reports zero for every stem during a count-in, and the restored gains after it is cancelled', async () => {
    const { controller } = makeController();
    const restore = vi.fn(() => controller.setStemGain('vocals', 0.5));
    void controller.countInAndPlay(sampleIndex(960), 1, BAR_STARTS, restore);
    await waitForRaf();
    expect(controller.getStemGain('vocals')).toBe(0);
    expect(controller.getStemGain('other')).toBe(0);
    controller.pause();
    expect(restore).toHaveBeenCalledTimes(1);
    expect(controller.getStemGain('vocals')).toBe(0.5);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm --prefix frontend test -- src/engine/EngineController.test.ts`
Expected: FAIL, `controller.getStemGain is not a function`.

- [ ] **Step 3: Implement**

In `frontend/src/engine/EngineController.ts`, add the field next to `atEnd` (after line 32):

```ts
  // The gain last handed to the worklet per stem, STEM_ORDER-indexed. An
  // AudioParam mid-ramp reports a value on its way somewhere; this is where it
  // is going, which is what "is this stem audible" means to a reader.
  private readonly stemGains: number[] = STEM_ORDER.map(() => 1);
```

Replace `setStemGain` and add the getter below it:

```ts
  setStemGain(stem: StemName, linearGain: number): void {
    const index = STEM_ORDER.indexOf(stem);
    this.stemGains[index] = linearGain;
    const param = this.cursorNode.parameters.get(`gain${index}`)!;
    param.setTargetAtTime(linearGain, this.context.currentTime, 0.01); // short declick ramp
  }

  /** The gain last set for a stem: 0 when muted, soloed out, or silenced by a count-in. */
  getStemGain(stem: StemName): number {
    return this.stemGains[STEM_ORDER.indexOf(stem)]!;
  }
```

- [ ] **Step 4: Run to verify they pass**

Run: `npm --prefix frontend test -- src/engine/EngineController.test.ts`
Expected: PASS, all tests in the file.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/engine/EngineController.ts frontend/src/engine/EngineController.test.ts
git commit -m "feat(engine): report the gain last set per stem

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin main
```

---

### Task 2: Stem level at a position

**Files:**
- Modify: `frontend/src/engine/stemPeaks.ts:37-41`
- Create: `frontend/src/pulse/levels.ts`
- Test: `frontend/src/pulse/levels.test.ts`

**Interfaces:**
- Consumes: `StemSummary { name, envelope: Float32Array, peak: number, nearSilent: boolean }` from `engine/stemPeaks`; `SAMPLE_RATE`, `SampleIndex`, `sampleIndex` from `engine/types`.
- Produces:
  - `ENVELOPE_BUCKETS_PER_SECOND = 100` exported from `engine/stemPeaks.ts`
  - `levelAt(summary: StemSummary, position: SampleIndex): number` — 0..1
  - `follow(previous: number, target: number, dtSeconds: number): number` — 0..1

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/pulse/levels.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import type { StemSummary } from '../engine/stemPeaks';
import { sampleIndex } from '../engine/types';
import { follow, levelAt } from './levels';

function summary(envelope: number[], overrides: Partial<StemSummary> = {}): StemSummary {
  return {
    name: 'bass',
    envelope: Float32Array.from(envelope),
    peak: Math.max(...envelope),
    nearSilent: false,
    ...overrides,
  };
}

describe('levelAt', () => {
  it('reads the envelope bucket under the cursor: 100 buckets a second at 48 kHz', () => {
    const s = summary([0.1, 0.4, 0.2]);
    expect(levelAt(s, sampleIndex(0))).toBeCloseTo(0.25);
    expect(levelAt(s, sampleIndex(479))).toBeCloseTo(0.25);
    expect(levelAt(s, sampleIndex(480))).toBeCloseTo(1);
    expect(levelAt(s, sampleIndex(960))).toBeCloseTo(0.5);
  });

  it('normalises to the stem peak, so a quiet stem still reaches 1', () => {
    expect(levelAt(summary([0.05, 0.1]), sampleIndex(480))).toBeCloseTo(1);
  });

  it('is zero past the end of the envelope', () => {
    expect(levelAt(summary([0.5]), sampleIndex(48_000))).toBe(0);
  });

  it('is zero for a near-silent stem: normalised noise must not pulse (U-10)', () => {
    const s = summary([0.004, 0.008], { nearSilent: true });
    expect(levelAt(s, sampleIndex(480))).toBe(0);
  });
});

describe('follow', () => {
  it('jumps up to a louder target at once', () => {
    expect(follow(0.2, 0.9, 0.016)).toBe(0.9);
  });

  it('falls towards a quieter target gradually', () => {
    const next = follow(1, 0, 0.016);
    expect(next).toBeGreaterThan(0.8);
    expect(next).toBeLessThan(1);
  });

  it('never falls below the target', () => {
    expect(follow(1, 0.6, 10)).toBe(0.6);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm --prefix frontend test -- src/pulse/levels.test.ts`
Expected: FAIL, cannot resolve `./levels`.

- [ ] **Step 3: Implement**

In `frontend/src/engine/stemPeaks.ts`, add above `summariseStem` and use it as the default:

```ts
/** Envelope resolution. Readers that index an envelope by time depend on it. */
export const ENVELOPE_BUCKETS_PER_SECOND = 100;

export function summariseStem(
  buffer: ChannelSource,
  name: StemName,
  bucketsPerSecond = ENVELOPE_BUCKETS_PER_SECOND,
): StemSummary {
```

Create `frontend/src/pulse/levels.ts`:

```ts
// How loud a stem is at the cursor, for the navbar pulse bar. Derived from the
// envelope the engine computed at load (stemPeaks.ts) rather than metered on
// the audio thread: the envelope indexed by the engine clock follows loops,
// seeks and tempo for free, and the worklet stays out of it.
import { ENVELOPE_BUCKETS_PER_SECOND, type StemSummary } from '../engine/stemPeaks';
import { SAMPLE_RATE, type SampleIndex } from '../engine/types';

/** How long a glow takes to fall to ~37% after a hit. Short enough to read as a beat. */
const RELEASE_SECONDS = 0.12;

/** 0..1, relative to the stem's own peak. `position` is in the 48 kHz stem domain (D-03). */
export function levelAt(summary: StemSummary, position: SampleIndex): number {
  // U-10: an empty stem normalised to its own peak would pulse hardest of all.
  if (summary.nearSilent) return 0;
  const bucket = Math.floor(((position as number) / SAMPLE_RATE) * ENVELOPE_BUCKETS_PER_SECOND);
  const raw = summary.envelope[bucket] ?? 0;
  return Math.min(1, raw / summary.peak);
}

/** Instant attack, exponential release: a hit lands on its frame and then decays. */
export function follow(previous: number, target: number, dtSeconds: number): number {
  const decayed = previous * Math.exp(-dtSeconds / RELEASE_SECONDS);
  return target > decayed ? target : decayed;
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npm --prefix frontend test -- src/pulse/levels.test.ts src/engine/stemPeaks.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pulse/levels.ts frontend/src/pulse/levels.test.ts frontend/src/engine/stemPeaks.ts
git commit -m "feat(pulse): stem level at the cursor, from the load-time envelope

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin main
```

---

### Task 3: Glow geometry and painting

**Files:**
- Create: `frontend/src/pulse/blobs.ts`, `frontend/src/pulse/paint.ts`
- Test: `frontend/src/pulse/blobs.test.ts`, `frontend/src/pulse/paint.test.ts`

**Interfaces:**
- Produces:
  - `interface Blob { stem: number; center: number; radius: number; alpha: number }` (`stem` is a `STEM_ORDER` index; `center`/`radius` in canvas pixels)
  - `blobsFor(levels: readonly number[], weights: readonly number[], driftSeconds: number, width: number): Blob[]`
  - `type Rgb = readonly [number, number, number]`
  - `parseHex(color: string): Rgb | null`
  - `paintBlobs(ctx: CanvasRenderingContext2D, blobs: readonly Blob[], colors: readonly Rgb[], width: number, height: number): void`

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/pulse/blobs.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { blobsFor } from './blobs';

describe('blobsFor', () => {
  it('draws two glows per audible stem and none for a silenced one', () => {
    const blobs = blobsFor([0.5, 0.5, 0.5, 0.5], [1, 0, 1, 1], 0, 1000);
    expect(blobs.map((b) => b.stem)).toEqual([0, 0, 2, 2, 3, 3]);
  });

  it('a louder stem is wider and brighter', () => {
    const [quiet] = blobsFor([0.1, 0, 0, 0], [1, 0, 0, 0], 0, 1000);
    const [loud] = blobsFor([0.9, 0, 0, 0], [1, 0, 0, 0], 0, 1000);
    expect(loud!.radius).toBeGreaterThan(quiet!.radius);
    expect(loud!.alpha).toBeGreaterThan(quiet!.alpha);
  });

  it('an audible stem glows faintly even in a silent passage', () => {
    const [blob] = blobsFor([0, 0, 0, 0], [1, 0, 0, 0], 0, 1000);
    expect(blob!.alpha).toBeCloseTo(0.25);
    expect(blob!.radius).toBeCloseTo(50);
  });

  it('brightness scales with the stem weight, so a mute fades rather than cuts', () => {
    const [full] = blobsFor([1, 0, 0, 0], [1, 0, 0, 0], 0, 1000);
    const [half] = blobsFor([1, 0, 0, 0], [0.5, 0, 0, 0], 0, 1000);
    expect(half!.alpha).toBeCloseTo(full!.alpha / 2);
  });

  it('glows drift with time and stay inside the bar', () => {
    const at = (t: number) => blobsFor([1, 1, 1, 1], [1, 1, 1, 1], t, 1000);
    expect(at(0)[0]!.center).not.toBeCloseTo(at(5)[0]!.center);
    for (const t of [0, 3, 17, 120]) {
      for (const blob of at(t)) {
        expect(blob.center).toBeGreaterThanOrEqual(80);
        expect(blob.center).toBeLessThanOrEqual(920);
      }
    }
  });
});
```

Create `frontend/src/pulse/paint.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import tokens from '../styles/tokens.css?source';
import { paintBlobs, parseHex } from './paint';

describe('parseHex', () => {
  it('reads #RRGGBB', () => {
    expect(parseHex('#E0A458')).toEqual([224, 164, 88]);
  });

  it('refuses anything else rather than guessing', () => {
    expect(parseHex('var(--ds-vocals)')).toBeNull();
    expect(parseHex('#fff')).toBeNull();
  });

  it('can read every stem token as tokens.css defines it', () => {
    for (const name of ['vocals', 'drums', 'bass', 'other']) {
      const value = new RegExp(`--ds-${name}:\\s*([^;]+);`).exec(tokens)?.[1] ?? '';
      expect(parseHex(value.trim()), `--ds-${name}`).not.toBeNull();
    }
  });
});

describe('paintBlobs', () => {
  it('clears, then adds each glow as a transparent-to-colour-to-transparent gradient', () => {
    const calls: string[] = [];
    const stops: [number, string][] = [];
    const ctx = {
      globalCompositeOperation: '',
      fillStyle: null as unknown,
      clearRect: () => calls.push(`clear:${ctx.globalCompositeOperation}`),
      createLinearGradient: (x0: number, _y0: number, x1: number) => {
        calls.push(`gradient:${x0}:${x1}`);
        return { addColorStop: (at: number, color: string) => stops.push([at, color]) };
      },
      fillRect: (x: number, _y: number, w: number, h: number) =>
        calls.push(`fill:${x}:${w}:${h}:${ctx.globalCompositeOperation}`),
    };
    paintBlobs(
      ctx as unknown as CanvasRenderingContext2D,
      [{ stem: 1, center: 100, radius: 40, alpha: 0.5 }],
      [[1, 2, 3], [217, 96, 95]],
      800,
      3,
    );
    expect(calls).toEqual(['clear:source-over', 'gradient:60:140', 'fill:60:80:3:lighter']);
    expect(stops).toEqual([
      [0, 'rgba(217,96,95,0)'],
      [0.5, 'rgba(217,96,95,0.500)'],
      [1, 'rgba(217,96,95,0)'],
    ]);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm --prefix frontend test -- src/pulse/blobs.test.ts src/pulse/paint.test.ts`
Expected: FAIL, cannot resolve `./blobs` and `./paint`.

- [ ] **Step 3: Implement**

Create `frontend/src/pulse/blobs.ts`:

```ts
// The navbar pulse bar's picture, as geometry: two soft glows per audible stem
// that wander along the bar and swell with that stem's level. Pure, so the
// look can be tested without a canvas.

export interface Blob {
  /** STEM_ORDER index. */
  stem: number;
  /** Canvas pixels. */
  center: number;
  radius: number;
  /** Peak opacity, at the centre. */
  alpha: number;
}

const BLOBS_PER_STEM = 2;
/** Below this a stem is as good as silenced and its glows are not drawn. */
const MIN_WEIGHT = 0.01;

/**
 * `levels` and `weights` are STEM_ORDER-indexed and 0..1: how loud the stem is
 * right now, and how audible it is in the mix (0 when muted). `driftSeconds`
 * only moves the glows; it is not the song position.
 */
export function blobsFor(
  levels: readonly number[],
  weights: readonly number[],
  driftSeconds: number,
  width: number,
): Blob[] {
  const blobs: Blob[] = [];
  for (let stem = 0; stem < levels.length; stem++) {
    const weight = weights[stem] ?? 0;
    if (weight < MIN_WEIGHT) continue;
    const level = levels[stem]!;
    for (let k = 0; k < BLOBS_PER_STEM; k++) {
      // Each stem drifts at its own slow rate and phase, so the glows cross
      // and blend instead of marching together.
      const phase = driftSeconds * (0.21 + 0.07 * stem) + stem * 1.7 + k * 3.1;
      blobs.push({
        stem,
        center: width * (0.5 + 0.42 * Math.sin(phase)),
        radius: width * (0.05 + 0.22 * level),
        alpha: (0.25 + 0.75 * level) * weight,
      });
    }
  }
  return blobs;
}
```

Create `frontend/src/pulse/paint.ts`:

```ts
import type { Blob } from './blobs';

export type Rgb = readonly [number, number, number];

/**
 * A gradient stop needs the stem colour at several opacities, which a resolved
 * token string cannot give. tokens.css defines the stem hues as #RRGGBB
 * (paint.test.ts holds it to that), so that is the only form read here.
 */
export function parseHex(color: string): Rgb | null {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color.trim());
  if (!match) return null;
  return [parseInt(match[1]!, 16), parseInt(match[2]!, 16), parseInt(match[3]!, 16)];
}

/** `colors` is STEM_ORDER-indexed. Glows add where they overlap, which is the blend. */
export function paintBlobs(
  ctx: CanvasRenderingContext2D,
  blobs: readonly Blob[],
  colors: readonly Rgb[],
  width: number,
  height: number,
): void {
  ctx.globalCompositeOperation = 'source-over';
  ctx.clearRect(0, 0, width, height);
  ctx.globalCompositeOperation = 'lighter';
  for (const blob of blobs) {
    const [r, g, b] = colors[blob.stem]!;
    const left = blob.center - blob.radius;
    const gradient = ctx.createLinearGradient(left, 0, blob.center + blob.radius, 0);
    gradient.addColorStop(0, `rgba(${r},${g},${b},0)`);
    gradient.addColorStop(0.5, `rgba(${r},${g},${b},${blob.alpha.toFixed(3)})`);
    gradient.addColorStop(1, `rgba(${r},${g},${b},0)`);
    ctx.fillStyle = gradient;
    ctx.fillRect(left, 0, blob.radius * 2, height);
  }
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npm --prefix frontend test -- src/pulse/blobs.test.ts src/pulse/paint.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pulse/blobs.ts frontend/src/pulse/blobs.test.ts frontend/src/pulse/paint.ts frontend/src/pulse/paint.test.ts
git commit -m "feat(pulse): glow geometry and canvas painter for the navbar bar

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin main
```

---

### Task 4: A slot in the navbar

**Files:**
- Create: `frontend/src/app/pulseSlot.ts`
- Modify: `frontend/src/app/AppShell.tsx`, `frontend/src/app/AppShell.module.css:9-16`
- Test: `frontend/src/app/AppShell.test.tsx`

**Interfaces:**
- Produces: `PulseSlotContext: React.Context<HTMLElement | null>` from `app/pulseSlot.ts`. Inside `AppShell` its value is a `<div>` that is a child of `<nav>`, 3px tall, spanning the navbar's bottom border; `null` on the first render and outside `AppShell`.

- [ ] **Step 1: Write the failing test**

In `frontend/src/app/AppShell.test.tsx`, add the imports:

```tsx
import { useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { PulseSlotContext } from './pulseSlot';
```

Give `renderShell` an optional page body (replace its signature and the index route):

```tsx
function renderShell(health: Health, body: ReactNode = <p>page body</p>) {
```

```tsx
            <Route index element={body} />
```

Append the test:

```tsx
test('a page can draw into a decorative slot on the navbar', async () => {
  function IntoSlot() {
    const slot = useContext(PulseSlotContext);
    return slot ? createPortal(<span>pulse</span>, slot) : null;
  }
  renderShell(healthy, <IntoSlot />);

  const drawn = await screen.findByText('pulse');
  const slot = drawn.parentElement!;
  expect(slot.parentElement).toBe(screen.getByRole('navigation'));
  // Decoration only: it must not be announced or reachable.
  expect(slot).toHaveAttribute('aria-hidden', 'true');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm --prefix frontend test -- src/app/AppShell.test.tsx`
Expected: FAIL, cannot resolve `./pulseSlot`.

- [ ] **Step 3: Implement**

Create `frontend/src/app/pulseSlot.ts`:

```ts
// The navbar is drawn by AppShell; the song session that knows what is playing
// lives below it, under SongScope (D-18). This carries the navbar's decorative
// slot down, so the session can portal the pulse bar up into it without the
// shell knowing anything about engines.
import { createContext } from 'react';

export const PulseSlotContext = createContext<HTMLElement | null>(null);
```

In `frontend/src/app/AppShell.tsx`:

```tsx
import { useState } from 'react';
```

```tsx
import { PulseSlotContext } from './pulseSlot';
```

Inside `AppShell`, after `const broken = ...`:

```tsx
  // State, not a ref: the consumer has to re-render once the element exists.
  const [pulseSlot, setPulseSlot] = useState<HTMLElement | null>(null);
```

Add the slot as the last child of `<nav>`, after the `NAV.map(...)` block:

```tsx
        <div ref={setPulseSlot} className={styles.pulseSlot} aria-hidden="true" />
```

Wrap the outlet:

```tsx
      <main className={styles.main}>
        <PulseSlotContext.Provider value={pulseSlot}>
          <Outlet />
        </PulseSlotContext.Provider>
      </main>
```

In `frontend/src/app/AppShell.module.css`, add `position: relative;` to `.nav` and append after the `.active` rule:

```css
/* Where a playing song draws its stem pulse (U-14). Laid over the nav's own
   bottom border and empty otherwise, so every other page looks as it did. */
.pulseSlot {
  position: absolute;
  right: 0;
  bottom: -1px;
  left: 0;
  height: 3px;
  pointer-events: none;
}

@media (prefers-reduced-motion: reduce) {
  .pulseSlot {
    display: none;
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm --prefix frontend test -- src/app/AppShell.test.tsx src/styles/chrome.test.ts`
Expected: PASS, including the four existing shell tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/pulseSlot.ts frontend/src/app/AppShell.tsx frontend/src/app/AppShell.module.css frontend/src/app/AppShell.test.tsx
git commit -m "feat(shell): a decorative slot on the navbar's bottom border

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin main
```

---

### Task 5: The pulse bar, mounted in the song session

**Files:**
- Create: `frontend/src/pulse/StemPulseBar.tsx`, `frontend/src/pulse/StemPulseBar.module.css`
- Modify: `frontend/src/session/SongScope.tsx`, `design/ui-spec.md` (after U-13), `README.md` (feature bullets)
- Test: `frontend/src/pulse/StemPulseBar.test.tsx`

**Interfaces:**
- Consumes:
  - `PulseSlotContext` (Task 4)
  - `useSongSession(): { engine: EngineController | null; playing: boolean; ... }` from `session/SongSession`
  - `engine.getStemGain(stem)` (Task 1), `engine.getPositionSamples(): SampleIndex`, `engine.stemSummaries: readonly StemSummary[]`
  - `levelAt`, `follow` (Task 2); `blobsFor`, `paintBlobs`, `parseHex`, `Rgb` (Task 3)
  - `resolveColor(cssVar: string): string` from `ui/resolveColor`
- Produces: `StemPulseBar(): JSX.Element | null`, no props.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/pulse/StemPulseBar.test.tsx`:

```tsx
import { render } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { PulseSlotContext } from '../app/pulseSlot';
import type { StemSummary } from '../engine/stemPeaks';
import { SongSessionContext, type SongSession } from '../session/SongSession';
import { StemPulseBar } from './StemPulseBar';

// jsdom loads no stylesheet, so no token resolves; the real values are held to
// #RRGGBB by paint.test.ts.
vi.mock('../ui/resolveColor', () => ({ resolveColor: () => '#E0A458' }));

const loud = (name: StemSummary['name']): StemSummary => ({
  name,
  envelope: new Float32Array(100).fill(0.5),
  peak: 0.5,
  nearSilent: false,
});

function fakeEngine(gains: Record<string, number>) {
  return {
    getPositionSamples: () => 0,
    getStemGain: (name: string) => gains[name] ?? 1,
    stemSummaries: (['vocals', 'drums', 'bass', 'other'] as const).map(loud),
  };
}

let frames: FrameRequestCallback[] = [];
let gradients = 0;
let realGetContext: typeof HTMLCanvasElement.prototype.getContext;

beforeEach(() => {
  frames = [];
  gradients = 0;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
  vi.stubGlobal('cancelAnimationFrame', () => {});
  realGetContext = HTMLCanvasElement.prototype.getContext;
  const ctx = {
    globalCompositeOperation: '',
    fillStyle: null as unknown,
    clearRect: () => {},
    fillRect: () => {},
    createLinearGradient: () => {
      gradients++;
      return { addColorStop: () => {} };
    },
  };
  HTMLCanvasElement.prototype.getContext = (() => ctx) as unknown as typeof realGetContext;
});

afterEach(() => {
  HTMLCanvasElement.prototype.getContext = realGetContext;
  vi.unstubAllGlobals();
});

function renderBar(session: Partial<SongSession>, slot: HTMLElement | null) {
  return render(
    <PulseSlotContext.Provider value={slot}>
      <SongSessionContext.Provider value={session as SongSession}>
        <StemPulseBar />
      </SongSessionContext.Provider>
    </PulseSlotContext.Provider>,
  );
}

function makeSlot() {
  const slot = document.createElement('div');
  Object.defineProperty(slot, 'clientWidth', { get: () => 800 });
  document.body.appendChild(slot);
  return slot;
}

test('while playing it paints two glows for each audible stem and none for a muted one', () => {
  const slot = makeSlot();
  const engine = fakeEngine({ drums: 0 });
  renderBar({ engine: engine as unknown as SongSession['engine'], playing: true }, slot);

  expect(slot.querySelector('canvas')).not.toBeNull();
  expect(frames).toHaveLength(1);
  frames[0]!(performance.now() + 50);

  expect(gradients).toBe(6);
  // And it keeps going: the frame asked for the next one.
  expect(frames).toHaveLength(2);
});

test('while paused it does not animate', () => {
  const slot = makeSlot();
  renderBar({ engine: fakeEngine({}) as unknown as SongSession['engine'], playing: false }, slot);
  expect(frames).toHaveLength(0);
  expect(gradients).toBe(0);
});

test('it is decoration: hidden from assistive tech', () => {
  const slot = makeSlot();
  renderBar({ engine: null, playing: false }, slot);
  expect(slot.querySelector('canvas')).toHaveAttribute('aria-hidden', 'true');
});

test('with no navbar slot it renders nothing', () => {
  const { container } = renderBar({ engine: null, playing: false }, null);
  expect(container).toBeEmptyDOMElement();
  expect(document.querySelector('canvas')).toBeNull();
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm --prefix frontend test -- src/pulse/StemPulseBar.test.tsx`
Expected: FAIL, cannot resolve `./StemPulseBar`.

- [ ] **Step 3: Implement the component**

Create `frontend/src/pulse/StemPulseBar.module.css`:

```css
/* The canvas keeps its last frame when playback stops; opacity is what fades it.
   Not the playhead, so a transition is allowed here (U-05 covers only that). */
.bar {
  display: block;
  width: 100%;
  height: 100%;
  opacity: 0;
  transition: opacity var(--ds-m-panel) var(--ds-ease);
}

.playing {
  opacity: 1;
}
```

Create `frontend/src/pulse/StemPulseBar.tsx`:

```tsx
// U-14: the navbar's bottom border glows with the stems you can hear. Two soft
// glows per audible stem drift along a 3px bar and swell with that stem's own
// level, so muting a stem takes its colour out of the bar.
//
// D-07: nothing here plays or meters audio. Levels are the load-time stem
// envelopes read at the engine clock's position; audibility is the gain the
// engine was last given (so a count-in, which silences the stems inside the
// engine, darkens the bar too). D-13: the loop paints straight to the canvas
// and never goes through React state.
import { useContext, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

import { PulseSlotContext } from '../app/pulseSlot';
import { STEM_ORDER } from '../engine/types';
import { useSongSession } from '../session/SongSession';
import { resolveColor } from '../ui/resolveColor';
import { blobsFor } from './blobs';
import { follow, levelAt } from './levels';
import { paintBlobs, parseHex, type Rgb } from './paint';
import styles from './StemPulseBar.module.css';

const BAR_PX = 3;
/** How fast a mute or solo fades its glows in and out, per second. */
const WEIGHT_RATE = 8;
/** A backgrounded tab resumes with one huge frame; do not let it fling the glows. */
const MAX_FRAME_SECONDS = 0.05;

export function StemPulseBar() {
  const slot = useContext(PulseSlotContext);
  const { engine, playing } = useSongSession();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Survives a pause, so the glows resume where they were instead of jumping.
  const drift = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!engine || !playing || !slot || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // A canvas cannot read var(--ds-*); resolved once per run (U-02).
    const colors: Rgb[] = [];
    for (const name of STEM_ORDER) {
      const resolved = resolveColor(`var(--ds-${name})`);
      const rgb = parseHex(resolved);
      if (!rgb) {
        // N-08: say why there is no bar rather than painting a wrong colour.
        console.error(`StemPulseBar: --ds-${name} resolved to "${resolved}", expected #RRGGBB`);
        return;
      }
      colors.push(rgb);
    }

    const levels = STEM_ORDER.map(() => 0);
    const weights = STEM_ORDER.map(() => 0);
    let last = performance.now();
    let handle = 0;

    const tick = (now: number) => {
      const dt = Math.min(MAX_FRAME_SECONDS, Math.max(0, (now - last) / 1000));
      last = now;
      drift.current += dt;

      const dpr = window.devicePixelRatio || 1;
      const width = Math.round(slot.clientWidth * dpr);
      const height = Math.round(BAR_PX * dpr);
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }

      const position = engine.getPositionSamples();
      STEM_ORDER.forEach((name, i) => {
        const summary = engine.stemSummaries[i];
        levels[i] = follow(levels[i]!, summary ? levelAt(summary, position) : 0, dt);
        // A boost above unity is still just "audible" here.
        const audible = Math.min(1, engine.getStemGain(name));
        weights[i] = weights[i]! + (audible - weights[i]!) * Math.min(1, dt * WEIGHT_RATE);
      });

      paintBlobs(ctx, blobsFor(levels, weights, drift.current, width), colors, width, height);
      handle = requestAnimationFrame(tick);
    };
    handle = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(handle);
  }, [engine, playing, slot]);

  if (!slot) return null;
  return createPortal(
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={playing ? `${styles.bar} ${styles.playing}` : styles.bar}
    />,
    slot,
  );
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npm --prefix frontend test -- src/pulse/StemPulseBar.test.tsx`
Expected: PASS, 4 tests.

- [ ] **Step 5: Mount it in the session**

Replace the body of `frontend/src/session/SongScope.tsx`'s component and add the import:

```tsx
import { StemPulseBar } from '../pulse/StemPulseBar';
```

```tsx
export function SongScope() {
  const { songId = '' } = useParams();
  const session = useSongSessionState(songId);
  return (
    <SongSessionContext.Provider value={session}>
      <StemPulseBar />
      <Outlet />
    </SongSessionContext.Provider>
  );
}
```

`SongScope.test.tsx` renders the scope without `AppShell`, so the slot is `null` and the bar renders nothing there; its mocked engine needs no change.

- [ ] **Step 6: Run the whole frontend suite and typecheck**

Run: `npm --prefix frontend test`
Expected: PASS, every file (in particular `src/session/SongScope.test.tsx`, `src/screens/SongView.test.tsx`, `src/screens/PlayAlong.test.tsx`, `src/styles/chrome.test.ts`).

Run: `npm --prefix frontend run typecheck`
Expected: no output, exit 0.

- [ ] **Step 7: Verify in the real app**

Start the API, worker and Vite dev server as the `dev-setup` skill describes, open a separated song at `http://localhost:5173/songs/<id>`, and check each of these by eye:

1. Before play: the navbar border looks exactly as it does on the Library page.
2. Press play: glows fade in on the navbar's bottom edge in the four stem colours and the drum glows hit on the beat.
3. Mute drums: the drum colour fades out within about half a second; unmute brings it back.
4. Solo bass: only the bass colour remains.
5. Pause: the bar fades out. Play again: the glows resume from where they were.
6. With a count-in of 1 bar set, start from bar 3: the bar stays dark for the count-in bar and lights when the music starts.
7. Switch to Play along while playing: the bar keeps running without a blink.
8. Go to the Library: the bar is gone.
9. Arm a loop over two bars: the pulse repeats with the loop and there is no click or stutter in the audio (nothing on the audio thread changed, so this is a regression check on R-01).

If the Play along or Song view screenshot in `docs/screenshots/` is captured mid-play and now shows the bar, recapture it with the procedure in the `dev-setup` skill.

- [ ] **Step 8: Record the rule and the feature**

In `design/ui-spec.md`, add after the U-13 entry, in the same format as its neighbours:

```markdown
- **U-14 — The navbar's bottom border may glow in stem hues while a song plays.**
  A 3px decorative bar: two soft glows per audible stem, each swelling with that stem's
  level; a muted, soloed-out or count-in-silenced stem contributes none.
  *Because:* it is the four stems being named (U-01), in a form that answers "what am I
  hearing" from across the room. It is `aria-hidden`, takes no input, and says nothing
  the labelled lanes of the Song view do not — so hue may be its only carrier here, the
  one place U-01's "never the sole carrier" is waived. Levels come from the load-time
  envelopes at the engine clock (D-07); nothing is metered on the audio thread.
  `prefers-reduced-motion` hides it.
  *Rejected:* a per-stem level meter in the navbar (a second, smaller mixer); metering in
  the worklet (render-thread messages for an ornament, against R-01).
  *Reversibility:* two-way, trivially.
```

In `README.md`, add to the feature bullets, after the "Live mixer" bullet:

```markdown
- A thin glow along the navbar pulses with each stem you can hear while a song plays
```

- [ ] **Step 9: Commit**

```bash
git add frontend/src/pulse/StemPulseBar.tsx frontend/src/pulse/StemPulseBar.module.css frontend/src/pulse/StemPulseBar.test.tsx frontend/src/session/SongScope.tsx design/ui-spec.md README.md
git commit -m "feat(pulse): navbar glows with the audible stems while a song plays (U-14)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin main
```
