# Stemcraft Phase 3: The Playback Engine (R-01) — Implementation Plan

**Goal:** a browser engine that mixes four decoded stems live, time-stretches and
pitch-shifts the mix through one shared stretcher, and loops a region seamlessly
against sample-accurate bounds — proven against a click track with no UI around it,
per the roadmap's R-01 mitigation. No Song screen, no real stems, no beat grid exist
yet; this phase builds and validates the engine against synthetic fixtures only.

**Spec:** [design/tech-spec-stemcraft.md](../../../design/tech-spec-stemcraft.md) §4
("Playback engine"), §11 D-03/D-05/D-06/D-07/D-12, §13 R-01, §14 Q-03;
[design/domain-spec.md](../../../design/domain-spec.md) "Song view: play along"; phase
map: [2026-09-27-stemcraft-roadmap.md](2026-09-27-stemcraft-roadmap.md) Phase 3.

## Global constraints (repeated because every task inherits them)

- **48 kHz stereo end to end (D-03).** All loop bounds and cursor positions this
  engine's public API accepts are integer sample indices in the **48 kHz stem
  domain** — the same domain Phase 5's beat grid will use — regardless of what sample
  rate the browser's `AudioContext` actually runs at.
- **Mix to stereo before stretching, one stretcher instance (D-05).** Per-stem
  gain/mute and the stereo sum happen in one custom `AudioWorkletProcessor`; exactly
  one `SoundTouchNode` (wrapping one `SoundTouch` instance) sits downstream of it.
- **Never seek the time-stretcher (D-06).** Looping is implemented entirely inside
  the custom processor, by wrapping its own fractional read cursor over the raw stem
  buffers with a short crossfade. The stretcher downstream never sees a seek, a reset,
  or a discontinuity — only a continuous resampled stream.
- **Branded sample-index types (D-12).** A `SampleIndex` must never be assignable
  from a plain `number` or a `Seconds` without an explicit conversion — this is the
  one cheap compile-time guard against the class of bug this phase exists to prevent.
- **Fail loudly (N-08).** `AudioContext` construction failures, decode failures, and
  worklet-module registration failures throw with the real error, never swallow into
  a default state.
- **Dev-only harness, kept out of the production bundle** (roadmap, Phase 3): the
  harness route and its fixture assets must not appear in `npm run build`'s output.

## Why this order

`types.ts` has no dependencies and everything else needs it. `clock.ts` and
`loopCursor.ts` are both pure TypeScript — no `AudioContext`, no worklet — so they're
next and carry the bulk of the automated test coverage for R-01 before anything
touches a real audio graph. The worklet processor (Task 5) is a thin adapter over
`loopCursor.ts` and can't be unit-tested directly (`jsdom` has no Web Audio API), so
the DSP correctness has to already be proven in Task 3. `EngineController` (Task 6)
wires the processor, the third-party stretcher, and the fixtures together and is
verified by the manual harness (Task 8) and a real-browser soak (Task 9), not vitest.

```
types.ts ──┬─► clock.ts ──────────────────────────────────┐
           └─► loopCursor.ts (the R-01 core, tested hard) ─┼─► stem-cursor-processor.ts ─┐
                                                            │                              ├─► EngineController.ts ─► EngineHarness.tsx ─► manual soak (Task 9)
soundtouch.ts (pure param math) ───────────────────────────┘   SoundTouchNode (3rd party) ┘
                                                                                            ▲
                                            generate_engine_fixtures.py ───────────────────┘
```

## Task 1 — `frontend/src/engine/types.ts`: branded sample-index types

**Problem:** the engine's entire correctness case rests on never confusing a sample
count with a second count, or a 48 kHz-domain index with a device-rate buffer index.
Plain `number` catches none of that at compile time.

**Produces:**

```ts
export const SAMPLE_RATE = 48_000;

declare const sampleIndexBrand: unique symbol;
/** An integer sample offset in the 48 kHz stem domain (D-03). Never a float second. */
export type SampleIndex = number & { readonly [sampleIndexBrand]: true };

declare const secondsBrand: unique symbol;
export type Seconds = number & { readonly [secondsBrand]: true };

export function sampleIndex(n: number): SampleIndex {
  return Math.round(n) as SampleIndex;
}

export function seconds(n: number): Seconds {
  return n as Seconds;
}

export function samplesToSeconds(n: SampleIndex, sampleRate: number = SAMPLE_RATE): Seconds {
  return seconds(n / sampleRate);
}

export function secondsToSamples(n: Seconds, sampleRate: number = SAMPLE_RATE): SampleIndex {
  return sampleIndex(n * sampleRate);
}

/**
 * Converts a 48 kHz-domain sample index into an index on a buffer decoded at a
 * different AudioContext sample rate. 1.0 whenever the context runs at 48 kHz,
 * which is the requested rate (Task 6) and the expected case on desktop browsers.
 */
export function toDeviceDomain(n: SampleIndex, deviceSampleRate: number): number {
  return (n as number) * (deviceSampleRate / SAMPLE_RATE);
}
```

**Tests (`frontend/src/engine/types.test.ts`):**
- `secondsToSamples(samplesToSeconds(sampleIndex(48_000)))` round-trips to `48_000`
  exactly (whole seconds land on exact sample counts).
- `samplesToSeconds(sampleIndex(72_000))` is `1.5`.
- `toDeviceDomain(sampleIndex(48_000), 48_000)` is `48_000` (identity at matching
  rates); `toDeviceDomain(sampleIndex(48_000), 44_100)` is `44_100`.
- `sampleIndex(10.6)` rounds to `11`, not truncates — a fractional index is always a
  caller bug, and rounding is the least-surprising recovery.

## Task 2 — `frontend/src/engine/clock.ts`: engine position clock

**Problem:** Phase 6's waveform playhead needs the current playback position without
polling audio-rate state from React (D-13, U-05). The clock has to extrapolate
position from wall-clock time between the worklet's periodic position reports, and
account for the current tempo ratio, entirely outside React state.

**Produces:**

```ts
import { SampleIndex, sampleIndex } from './types';

export interface ClockSync {
  /** AudioContext.currentTime at the moment `position` was true. */
  contextTime: number;
  /** The cursor's position (48 kHz domain) at `contextTime`. */
  position: SampleIndex;
  /** Samples of stem time advanced per second of real time. */
  samplesPerSecond: number;
}

export class EngineClock {
  private sync: ClockSync;

  constructor(initial: ClockSync) {
    this.sync = initial;
  }

  /** Called whenever the worklet reports its true cursor position (Task 5's port messages). */
  resync(sync: ClockSync): void {
    this.sync = sync;
  }

  /** Extrapolated position at `contextTime`, using the most recent resync as the anchor. */
  positionAt(contextTime: number): SampleIndex {
    const elapsed = contextTime - this.sync.contextTime;
    return sampleIndex(this.sync.position + elapsed * this.sync.samplesPerSecond);
  }
}
```

**Tests (`frontend/src/engine/clock.test.ts`):**
- A clock synced at `{ contextTime: 10, position: 48_000, samplesPerSecond: 48_000 }`
  reports `96_000` at `contextTime = 11` (one second later, real-time tempo).
- At `samplesPerSecond: 24_000` (50 % tempo) the same one-second gap reports `72_000`,
  not `96_000` — the extrapolation must use the tempo-scaled rate, not the raw
  sample rate.
- `resync` moves the anchor: after resyncing to `{ contextTime: 11, position: 90_000,
  samplesPerSecond: 48_000 }`, `positionAt(12)` reports `138_000`, ignoring the
  pre-resync anchor entirely (a stale anchor must never leak into a later estimate).

## Task 3 — `frontend/src/engine/loopCursor.ts`: the R-01 core

**Problem:** this is the one piece of DSP the whole phase exists to get right — a
fractional-rate read across four stem buffers, gain-mixed to stereo, that wraps at a
loop boundary with a crossfade instead of a hard cut, and never drifts. It has to be
pure (no `AudioContext`) so it can be tested exhaustively offline before anything
touches a real worklet.

**The crossfade construction:** for a loop `[startFrame, endFrame)` and a crossfade
length `crossfadeFrames`, the last `crossfadeFrames` samples of the loop (the "tail
window") are never played alone — each is blended with the sample that many frames
into the loop's head (`startFrame + offset`), fading the tail out and the head in
linearly across the window. Once the cursor reaches `endFrame` it rebases to
`startFrame + crossfadeFrames`, i.e. **just past** the content already played during
the blend — so nothing repeats and nothing is skipped. The stretcher downstream never
sees this rebase; it only ever receives the blended, continuous output.

**Produces:**

```ts
import { SampleIndex } from './types';

export interface StemChannels {
  left: Float32Array;
  right: Float32Array;
}

export type FourStems = readonly [StemChannels, StemChannels, StemChannels, StemChannels];

export interface LoopBounds {
  startFrame: number; // device-domain frame index (already converted, Task 6)
  endFrame: number;
}

export interface MixParams {
  /** Linear gain per stem, fixed order [vocals, drums, bass, other]. */
  gains: readonly [number, number, number, number];
  /** Stem-domain samples advanced per output sample. 1.0 = original tempo. */
  readRate: number;
  loop: LoopBounds | null;
  crossfadeFrames: number;
}

export interface CursorState {
  position: number;
}

function readAt(channel: Float32Array, position: number): number {
  const i0 = Math.floor(position);
  const frac = position - i0;
  const s0 = channel[i0] ?? 0;
  const s1 = channel[i0 + 1] ?? s0;
  return s0 + (s1 - s0) * frac;
}

function readStereoMix(stems: FourStems, gains: MixParams['gains'], position: number): [number, number] {
  let left = 0;
  let right = 0;
  for (let i = 0; i < 4; i++) {
    const gain = gains[i];
    if (gain === 0) continue;
    const stem = stems[i];
    left += readAt(stem.left, position) * gain;
    right += readAt(stem.right, position) * gain;
  }
  return [left, right];
}

/**
 * Renders one block into outLeft/outRight, advancing `cursor` in place.
 * Pure function over plain arrays — no AudioContext, no worklet, fully testable.
 */
export function renderBlock(
  stems: FourStems,
  params: MixParams,
  cursor: CursorState,
  outLeft: Float32Array,
  outRight: Float32Array,
): void {
  const frameCount = outLeft.length;
  const loop = params.loop;

  for (let i = 0; i < frameCount; i++) {
    let pos = cursor.position;

    if (!loop) {
      const [l, r] = readStereoMix(stems, params.gains, pos);
      outLeft[i] = l;
      outRight[i] = r;
      cursor.position = pos + params.readRate;
      continue;
    }

    const { startFrame, endFrame } = loop;
    const tailStart = endFrame - params.crossfadeFrames;

    if (pos < tailStart || params.crossfadeFrames <= 0) {
      const [l, r] = readStereoMix(stems, params.gains, pos);
      outLeft[i] = l;
      outRight[i] = r;
    } else {
      const t = (pos - tailStart) / params.crossfadeFrames; // 0 -> 1 across the window
      const [tailL, tailR] = readStereoMix(stems, params.gains, pos);
      const [headL, headR] = readStereoMix(stems, params.gains, startFrame + (pos - tailStart));
      outLeft[i] = tailL * (1 - t) + headL * t;
      outRight[i] = tailR * (1 - t) + headR * t;
    }

    pos += params.readRate;
    if (pos >= endFrame) {
      pos = startFrame + params.crossfadeFrames + (pos - endFrame);
    }
    cursor.position = pos;
  }
}
```

**Tests (`frontend/src/engine/loopCursor.test.ts`):**
- **Interpolation sanity:** a single ramp stem (`left[i] = i`) read at `readRate = 1`
  with no loop reproduces the ramp exactly; at `readRate = 0.5` each output sample
  is the linear midpoint between consecutive ramp values.
- **Gain/mute mixing:** four constant-value stems (`1, 2, 4, 8`) with gains `[1, 0,
  0.5, 0]` produce a constant output of `1 + 2 = 3` on both channels — mute is gain
  `0`, nothing special-cased.
- **Click detection, the R-01 regression test.** Build four sine stems at
  deliberately loop-length-incommensurate frequencies (e.g. 437 Hz, 511 Hz, 663 Hz,
  829 Hz against a loop length that is not a whole number of periods at any of them,
  guaranteeing a phase mismatch at the seam). Render `2000` loop repetitions
  (`loopLength` short enough — e.g. `4800` samples / 100 ms — that this runs in
  well under a second, standing in for the roadmap's 30+ minute soak). For every
  adjacent output-sample pair, assert `|out[i+1] - out[i]|` never exceeds
  `maxExpectedDelta` (the largest per-sample delta the underlying continuous sines
  can produce, plus a small epsilon for the linear-interpolation and crossfade
  blend). **First assert this test's own sensitivity**: with `crossfadeFrames: 0`
  the same render *does* produce at least one delta far above that threshold at the
  loop boundary — proving the detector actually catches a real click before trusting
  it to certify the crossfaded path.
- **No drift:** after `N` loop repetitions at `readRate = 1`, `cursor.position` equals
  the closed-form prediction `startFrame + crossfadeFrames + N * loopLength` (mod
  floating-point epsilon) — the rebase arithmetic never accumulates error.
- **Non-integer `readRate` drift:** repeat the drift check at `readRate = 0.7` (70 %
  tempo) — position after `N` repetitions still matches `startFrame + crossfadeFrames
  + N * loopLength` exactly, because the loop period is defined in stem-domain
  samples regardless of `readRate`; only wall-clock time to complete a repetition
  changes.
- **No content repeats or is skipped across the wrap:** with a ramp stem, collect the
  sequence of *nominal* read positions (ignoring the blend) across one full
  repetition and assert the tail window's blended output lies strictly between the
  tail-only and head-only values at every sample (monotonic crossfade, no
  double-counted samples).

## Task 4 — Install the stretcher; `frontend/src/engine/soundtouch.ts`

**Problem:** `@soundtouchjs/audio-worklet` (`SoundTouchNode`, MPL-2.0, actively
published — verified installed at `2.1.1` with `@soundtouchjs/core` as its own
dependency) is downstream of Task 3's processor. Its own docs describe driving tempo
via a source node's `playbackRate` mirrored onto `stNode.playbackRate`; our upstream
is a custom cursor, not a source node, but the same param exists purely to tell the
processor's internal pitch compensation math the ratio to divide by — nothing about
it requires a real `AudioBufferSourceNode` upstream, only the numeric ratio.

**Produces:**

- `frontend/package.json` — add `"@soundtouchjs/audio-worklet": "^2.1.1"` to
  `dependencies` and `"@types/audioworklet": "^0.0.100"` to `devDependencies` (ambient
  types for `AudioWorkletProcessor`, `registerProcessor`, and the
  `AudioWorkletGlobalScope` globals `sampleRate`/`currentFrame`, used by Task 5).
- `frontend/tsconfig.json` — append `"@types/audioworklet"` to `compilerOptions.types`.
- `frontend/src/engine/soundtouch.ts`:

```ts
/**
 * Pure math for driving SoundTouchNode from a tempo ratio and a user pitch shift.
 * SoundTouchNode's own `playbackRate` param exists to tell its internal pitch
 * compensation the ratio to divide by (see its README) — it does not require a
 * literal upstream AudioBufferSourceNode, only this numeric value.
 */
export interface SoundTouchParams {
  playbackRate: number;
  pitch: number;
  pitchSemitones: number;
}

export function computeSoundTouchParams(tempoRatio: number, pitchSemitonesOffset: number): SoundTouchParams {
  return {
    playbackRate: tempoRatio,
    pitch: 1.0,
    pitchSemitones: pitchSemitonesOffset,
  };
}
```

**Tests (`frontend/src/engine/soundtouch.test.ts`):**
- `computeSoundTouchParams(0.7, 0)` returns `{ playbackRate: 0.7, pitch: 1.0,
  pitchSemitones: 0 }` — tempo-only change, no pitch shift requested.
- `computeSoundTouchParams(1.0, -3)` returns `{ playbackRate: 1.0, pitch: 1.0,
  pitchSemitones: -3 }` — pitch shift with no tempo change still routes through
  `pitchSemitones`, never folded into `pitch`.

**Manual check (no automated test possible — `npm install` behavior isn't unit-testable):**
`npm --prefix frontend install` pulls in `@soundtouchjs/core` transitively; confirm
with `npm ls @soundtouchjs/core --prefix frontend`.

## Task 5 — `frontend/src/engine/stem-cursor-processor.ts`: the AudioWorklet adapter

**Problem:** `AudioWorkletProcessor` runs in an isolated global scope with no access
to `frontend/src/engine/loopCursor.ts`'s module unless it's bundled into the worklet
file itself — Vite's `?url` asset pattern (D-12's noted "own entry" cost) handles
that. This task is deliberately thin: all the logic it calls is already proven by
Task 3's tests; this file only adapts it to the `AudioWorkletProcessor` lifecycle.

**Produces:**

```ts
/// <reference types="audioworklet" />
import { renderBlock, type CursorState, type FourStems, type MixParams } from './loopCursor';

interface LoadStemsMessage {
  type: 'load-stems';
  stems: { left: ArrayBuffer; right: ArrayBuffer }[]; // length 4, fixed order
}

interface SetLoopMessage {
  type: 'set-loop';
  loop: { startFrame: number; endFrame: number } | null;
  crossfadeFrames: number;
}

interface SeekMessage {
  type: 'seek';
  position: number;
}

type ControlMessage = LoadStemsMessage | SetLoopMessage | SeekMessage;

const STEM_COUNT = 4;
const POSITION_REPORT_INTERVAL_BLOCKS = 40; // ~107 ms at 128-sample blocks / 48 kHz

class StemCursorProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors(): AudioParamDescriptor[] {
    const gainParams: AudioParamDescriptor[] = [0, 1, 2, 3].map((i) => ({
      name: `gain${i}`,
      defaultValue: 1,
      minValue: 0,
      maxValue: 1,
      automationRate: 'k-rate',
    }));
    return [
      ...gainParams,
      { name: 'readRate', defaultValue: 1, minValue: 0.25, maxValue: 2, automationRate: 'k-rate' },
    ];
  }

  private stems: FourStems | null = null;
  private cursor: CursorState = { position: 0 };
  private loop: MixParams['loop'] = null;
  private crossfadeFrames = 0;
  private blockCount = 0;

  constructor() {
    super();
    this.port.onmessage = (event: MessageEvent<ControlMessage>) => {
      const msg = event.data;
      if (msg.type === 'load-stems') {
        this.stems = msg.stems.map((s) => ({
          left: new Float32Array(s.left),
          right: new Float32Array(s.right),
        })) as unknown as FourStems;
      } else if (msg.type === 'set-loop') {
        this.loop = msg.loop;
        this.crossfadeFrames = msg.crossfadeFrames;
      } else if (msg.type === 'seek') {
        this.cursor.position = msg.position;
      }
    };
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean {
    const output = outputs[0];
    if (!this.stems || !output || output.length < 2) return true;

    const gains = [0, 1, 2, 3].map((i) => parameters[`gain${i}`]![0]!) as MixParams['gains'];
    const readRate = parameters.readRate![0]!;

    renderBlock(
      this.stems,
      { gains, readRate, loop: this.loop, crossfadeFrames: this.crossfadeFrames },
      this.cursor,
      output[0]!,
      output[1]!,
    );

    this.blockCount++;
    if (this.blockCount % POSITION_REPORT_INTERVAL_BLOCKS === 0) {
      this.port.postMessage({ type: 'position', position: this.cursor.position, contextTime: currentTime });
    }

    return true;
  }
}

registerProcessor('stem-cursor-processor', StemCursorProcessor);
```

Registered under `numberOfInputs: 0` on the main-thread side (Task 6) since this
node's audio comes entirely from the stems handed over via `port`, not from a
connected input — it is a pure source node.

**Why `STEM_COUNT` is unused in the body:** kept as the named constant the four
`gain0..gain3` params and the fixed stem order are implicitly built around, so a
future change to stem count (never expected — HTDemucs is fixed at four, domain
spec) has exactly one place to start. Not referenced directly because
`parameterDescriptors` is a static getter evaluated before any instance exists.

**No automated test — `jsdom` has no `AudioWorkletGlobalScope`.** Correctness of the
logic this delegates to is Task 3's job; correctness of the wiring is Task 8/9's.

## Task 6 — `frontend/src/engine/EngineController.ts`: orchestration

**Problem:** ties the worklet (Task 5), the stretcher (Task 4), and stem decoding
together behind a transport API shaped for what Phases 6/7 will need, and does the
one conversion Task 1 flagged: loop bounds arrive in the 48 kHz stem domain and must
be converted to whatever domain the real `AudioContext` decodes into.

**Produces:**

```ts
import stemCursorProcessorUrl from './stem-cursor-processor.ts?url';
import processorUrl from '@soundtouchjs/audio-worklet/processor?url';
import { SoundTouchNode } from '@soundtouchjs/audio-worklet';
import { computeSoundTouchParams } from './soundtouch';
import { EngineClock } from './clock';
import { SAMPLE_RATE, SampleIndex, sampleIndex, toDeviceDomain } from './types';

export const STEM_ORDER = ['vocals', 'drums', 'bass', 'other'] as const;
export type StemName = (typeof STEM_ORDER)[number];

const CROSSFADE_SAMPLES = Math.round(0.005 * SAMPLE_RATE); // 5 ms, A-05

export interface EngineLoop {
  startFrame: SampleIndex;
  endFrame: SampleIndex;
}

export class EngineController {
  private constructor(
    private readonly context: AudioContext,
    private readonly cursorNode: AudioWorkletNode,
    private readonly stNode: SoundTouchNode,
    private readonly clock: EngineClock,
    // A mutable box, not a plain field: `create()` is static, so the `port.onmessage`
    // closure it sets up can't see instance fields through `this`. Both the closure
    // and the instance methods below share this one object instead.
    private readonly tempoState: { ratio: number },
  ) {}

  static async create(stemUrls: Record<StemName, string>): Promise<EngineController> {
    const context = new AudioContext({ sampleRate: SAMPLE_RATE });
    if (context.sampleRate !== SAMPLE_RATE) {
      console.warn(
        `AudioContext ignored the requested ${SAMPLE_RATE} Hz and runs at ${context.sampleRate} Hz; ` +
          'loop bounds will be scaled at the domain boundary (types.ts:toDeviceDomain).',
      );
    }

    await context.audioWorklet.addModule(stemCursorProcessorUrl);
    await SoundTouchNode.register(context, processorUrl);

    const buffers = await Promise.all(
      STEM_ORDER.map(async (name) => {
        const response = await fetch(stemUrls[name]);
        const bytes = await response.arrayBuffer();
        return context.decodeAudioData(bytes);
      }),
    );

    const cursorNode = new AudioWorkletNode(context, 'stem-cursor-processor', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });

    const transferList: ArrayBuffer[] = [];
    const stems = buffers.map((buffer) => {
      const left = buffer.getChannelData(0).slice();
      const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1).slice() : left.slice();
      transferList.push(left.buffer, right.buffer);
      return { left: left.buffer, right: right.buffer };
    });
    cursorNode.port.postMessage({ type: 'load-stems', stems }, transferList);

    const stNode = new SoundTouchNode({ context });
    cursorNode.connect(stNode);
    stNode.connect(context.destination);

    const tempoState = { ratio: 1.0 };
    const clock = new EngineClock({ contextTime: context.currentTime, position: sampleIndex(0), samplesPerSecond: SAMPLE_RATE });
    cursorNode.port.onmessage = (event: MessageEvent) => {
      if (event.data.type === 'position') {
        clock.resync({
          contextTime: event.data.contextTime,
          position: sampleIndex(event.data.position),
          // Stem-domain samples advanced per real second is the tempo-scaled rate
          // (Task 2's clock test asserts exactly this), not the raw sample rate.
          samplesPerSecond: SAMPLE_RATE * tempoState.ratio,
        });
      }
    };

    return new EngineController(context, cursorNode, stNode, clock, tempoState);
  }

  setStemGain(stem: StemName, linearGain: number): void {
    const index = STEM_ORDER.indexOf(stem);
    const param = this.cursorNode.parameters.get(`gain${index}`)!;
    param.setTargetAtTime(linearGain, this.context.currentTime, 0.01); // short declick ramp
  }

  setTempo(ratio: number): void {
    const clamped = Math.min(1.0, Math.max(0.5, ratio)); // N-04: 50-100%
    this.tempoState.ratio = clamped;
    this.cursorNode.parameters.get('readRate')!.setValueAtTime(clamped, this.context.currentTime);
    const stParams = computeSoundTouchParams(clamped, this.stNode.pitchSemitones.value);
    this.stNode.playbackRate.setValueAtTime(stParams.playbackRate, this.context.currentTime);
    this.stNode.pitch.setValueAtTime(stParams.pitch, this.context.currentTime);
  }

  setPitchSemitones(semitones: number): void {
    this.stNode.pitchSemitones.setValueAtTime(semitones, this.context.currentTime);
  }

  setLoop(loop: EngineLoop | null): void {
    const deviceLoop = loop && {
      startFrame: toDeviceDomain(loop.startFrame, this.context.sampleRate),
      endFrame: toDeviceDomain(loop.endFrame, this.context.sampleRate),
    };
    this.cursorNode.port.postMessage({
      type: 'set-loop',
      loop: deviceLoop,
      crossfadeFrames: toDeviceDomain(sampleIndex(CROSSFADE_SAMPLES), this.context.sampleRate),
    });
  }

  seek(position: SampleIndex): void {
    this.cursorNode.port.postMessage({ type: 'seek', position: toDeviceDomain(position, this.context.sampleRate) });
    this.clock.resync({ contextTime: this.context.currentTime, position, samplesPerSecond: SAMPLE_RATE * this.tempoState.ratio });
  }

  getPositionSamples(): SampleIndex {
    return this.clock.positionAt(this.context.currentTime);
  }

  async dispose(): Promise<void> {
    this.cursorNode.disconnect();
    this.stNode.disconnect();
    await this.context.close();
  }
}
```

**Tests:** none new here beyond Task 4's pure `computeSoundTouchParams` — this class
is a thin wire-up over real `AudioContext`/`AudioWorkletNode` objects `jsdom` doesn't
implement, and mocking the entire Web Audio graph would test the mock, not the
engine. It's verified for real by Task 8's harness and Task 9's browser soak, the
same split Phase 1/2 used for anything that needed a real process rather than a
vitest mock (`docs/running.md`).

## Task 7 — `scripts/generate_engine_fixtures.py`: click track and stem fixtures

**Problem:** the harness (Task 8) needs real, audible WAV files: a click track at a
known BPM, and four stand-in "stems" whose loop seam is unmistakable if the
crossfade is wrong. ffmpeg is the project's only audio I/O path (C-04) even for dev
fixtures — no separate synthesis library.

**Produces:**

```python
"""Generates dev-only fixtures for the Phase 3 engine harness. Not part of the
product; run once and the output is committed to frontend/src/dev/fixtures/.

Usage: uv run python scripts/generate_engine_fixtures.py
"""

import subprocess
from pathlib import Path

SAMPLE_RATE = 48_000
OUT_DIR = Path(__file__).parent.parent / "frontend" / "src" / "dev" / "fixtures"
BPM = 120
CLICK_DURATION_S = 16  # 8 bars at 120 BPM, 4/4

# Frequencies chosen so none divides evenly into CLICK_DURATION_S at BPM's period —
# a naive uncrossfaded loop at any of these produces an audible, unmistakable click.
STEM_FREQUENCIES = {"vocals": 437, "drums": 511, "bass": 663, "other": 829}


def run(*args: str) -> None:
    subprocess.run(["ffmpeg", "-y", *args], check=True, capture_output=True)


def generate_click_track() -> None:
    beat_period = 60 / BPM
    # A short gate pulse once per beat: 1 for 5 ms after each beat boundary, else 0.
    expr = f"if(lt(mod(t,{beat_period}),0.005),1,0)"
    run(
        "-f", "lavfi",
        "-i", f"aevalsrc={expr}:s={SAMPLE_RATE}:d={CLICK_DURATION_S}",
        "-ac", "2",
        str(OUT_DIR / "click.wav"),
    )


def generate_stem_fixtures() -> None:
    for name, freq in STEM_FREQUENCIES.items():
        run(
            "-f", "lavfi",
            "-i", f"sine=frequency={freq}:sample_rate={SAMPLE_RATE}:duration={CLICK_DURATION_S}",
            "-ac", "2",
            str(OUT_DIR / f"stem-{name}.wav"),
        )


if __name__ == "__main__":
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    generate_click_track()
    generate_stem_fixtures()
    print(f"wrote fixtures to {OUT_DIR}")
```

**Tests:** this is a one-off generator, not product code under `packages/`, so it has
no pytest coverage of its own — instead, running it is itself the test:

- `uv run python scripts/generate_engine_fixtures.py` exits `0` and produces
  `click.wav` plus four `stem-*.wav` files.
- `ffprobe` each output and assert `sample_rate=48000`, `channels=2`,
  `duration≈16.0` — the same assertion style `test_ffmpeg.py` already uses for real
  product code (Phase 2, Task 2), applied here as a manual check since this script
  lives outside the pytest tree.
- Listen to `click.wav` once by ear to confirm it's audibly a steady 120 BPM click,
  not silence or noise (ffmpeg filter-expression mistakes fail silently rather than
  erroring).

## Task 8 — `frontend/src/dev/EngineHarness.tsx`: manual verification page

**Problem:** the roadmap calls for "a dev-only harness page, kept out of the
production bundle" — this is the only way to actually listen to the engine before
any Song screen exists.

**Produces:**

- `frontend/src/dev/EngineHarness.tsx` — loads the five fixtures from Task 7 via
  `EngineController.create()`, with play/stop, four gain sliders (one per
  `STEM_ORDER` entry, doubling as mute at `0`), a tempo slider (0.5–1.0), a pitch
  slider (±12 semitones), and a loop-region form (start/end in seconds, converted to
  `SampleIndex` via Task 1's `secondsToSamples`) that calls `setLoop`. Renders
  `stNode`'s `metrics` (underrun count, from the installed package's own
  `SoundTouchNode.metrics` getter) so an underrun is visible on screen, not just
  audible.
- `frontend/src/app/routes.tsx` — dev-only route, using a dynamic import inside a
  condition on `import.meta.env.DEV` so the whole subtree — the harness component,
  `EngineController`, and every fixture asset it imports via `?url` — is dead-code
  eliminated from the production build (Vite/Rollup drop an `import()` expression
  entirely when the branch containing it constant-folds to `false` under the
  production `define`, which is different from, and safer than, statically importing
  the component and only guarding the JSX):

```tsx
import { lazy, Suspense } from 'react';

const EngineHarness = import.meta.env.DEV ? lazy(() => import('../dev/EngineHarness')) : null;

// inside <Routes>, alongside the other <Route> elements:
{import.meta.env.DEV && EngineHarness && (
  <Route
    path="dev/engine-harness"
    element={
      <Suspense fallback={null}>
        <EngineHarness />
      </Suspense>
    }
  />
)}
```

**Tests:** none automated — this page exists to be listened to, not asserted on.
Task 9 is its verification.

**Manual check for the exclusion claim itself:** `npm --prefix frontend run build`
then `grep -r "EngineHarness" frontend/dist/assets/*.js` and `ls frontend/dist/assets
| grep stem-` should both come back empty — recorded in `docs/running.md` (Task 9),
the same way Phase 1/2 verified `npm run build` output by inspection rather than by
a vitest assertion.

## Task 9 — Soak verification, Q-03, and the `docs/running.md` entry

Real-browser verification, since this is the one thing in the phase that a fast unit
test (Task 3) stands in for but cannot replace outright — Task 3's offline click/drift
test is the *proof of the algorithm*; this is the proof it holds up as actual audio
through real hardware.

1. `npm --prefix frontend run dev`, open `/dev/engine-harness`, set a loop over a
   few bars of `click.wav`'s beat grid (by ear/eye against the waveform), and let it
   run for 30+ minutes per the roadmap's exit criterion, listening for a tick at the
   wrap. Repeat at 50 %, 70 %, and 100 % tempo (N-04's range) and with a ±3 semitone
   shift layered on top.
2. Watch the metrics readout (Task 8) for `underrunCount` staying at `0` across the
   run — a non-zero count means the cursor processor isn't keeping the stretcher's
   input pipe fed, a real bug even if inaudible on this machine's hardware.
3. **Q-03 — decide SoundTouch vs. Rubber Band.** SoundTouchNode is already installed,
   MPL-2.0 (permissive, no licensing blocker unlike Rubber Band's GPL/commercial
   split), and free of the seam bug by construction (Task 3). Keep it unless step 1
   surfaces genuinely unacceptable quality at the low end of N-04's range (50–60 %) —
   record whichever outcome in this file's own header once decided, since tech-spec
   §14 treats Q-03 as open until an engine exists to test against.
4. Confirm the production-exclusion claim from Task 8 with the `grep`/`ls` check.
5. Append a "Verification 6 — Phase 3 engine" section to
   [docs/running.md](../../running.md) with the real commands run, their real
   output, the tempo/pitch combinations tried, and the Q-03 decision — following the
   existing transcript convention exactly (this is not aspirational documentation;
   every command in that file is one that was actually run).

## Exit criteria (from the roadmap)

- 30+ minutes of continuous looping on the click track with no audible tick and no
  measurable drift — Task 3's automated click/drift test plus Task 9's real-time
  listen.
- Tempo 50–100 % assessed against N-04 — Task 9, step 1.
- Mute/gain latency measured against N-06's 50–100 ms — the `setTargetAtTime(...,
  0.01)` ramp in `EngineController.setStemGain` plus manual confirmation in Task 9
  that a mute/unmute is audible within that window, not instant and not delayed
  further by stretcher buffering than N-06 already budgets for.

**Decides:** Q-03 (Task 9, step 3).

**Discharges:** D-05, D-06, D-12, and the engine half of D-07 (wavesurfer's absence
from this phase is itself the point — nothing here plays audio through it, leaving
Phase 6 free to slave a waveform to `EngineController.getPositionSamples()` exactly
as D-07 requires).

**Re-plan checkpoint** (roadmap): `EngineController`'s public API — `setStemGain`,
`setTempo`, `setPitchSemitones`, `setLoop`, `seek`, `getPositionSamples` — is what
Phase 6 (Song view) and Phase 7 (export parity discussion) get planned against next.
