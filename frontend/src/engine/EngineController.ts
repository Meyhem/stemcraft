import stemCursorProcessorUrl from './stem-cursor-processor.ts?url';
import processorUrl from '@soundtouchjs/audio-worklet/processor?url';
import { ProcessorMetrics, SoundTouchNode } from '@soundtouchjs/audio-worklet';
import { computeSoundTouchParams } from './soundtouch';
import { EngineClock } from './clock';
import { SAMPLE_RATE, SampleIndex, clampTempo, sampleIndex, toDeviceDomain, toStemDomain, STEM_ORDER, type StemName } from './types';
import { stemLoadMessages } from './stemLoad';
import { summariseStem } from './stemPeaks';
import type { StemSummary } from './stemPeaks';
import type { StemChannels } from './loopCursor';

/** Waveform summaries from raw channels: summariseStem only needs an AudioBuffer's shape. */
function summariesOf(stems: readonly StemChannels[], sampleRate: number): StemSummary[] {
  return STEM_ORDER.map((name, i) => {
    const stem = stems[i]!;
    return summariseStem(
      { length: stem.left.length, sampleRate, numberOfChannels: 2, getChannelData: (c) => (c === 0 ? stem.left : stem.right) },
      name,
    );
  });
}

export { STEM_ORDER, type StemName } from './types';

const CROSSFADE_SAMPLES = Math.round(0.005 * SAMPLE_RATE); // 5 ms, A-05

export interface EngineLoop {
  startFrame: SampleIndex;
  endFrame: SampleIndex;
}

export class EngineController {
  private readonly endedListeners = new Set<() => void>();
  // A generation counter for count-in cancellation: pause(), seek(), or a
  // superseding countInAndPlay() can all interrupt a pending count-in's poll
  // loop. Bumping the generation is how the stale poll below learns someone
  // else already ran (or is about to run) the restore, so it bails out
  // without touching gains or resolving twice.
  private countInGeneration = 0;
  private pendingCountIn: { generation: number; restore: () => void } | null = null;
  // Set when the worklet reports the stems ended, cleared by any seek that lands before the end. The
  // worklet reports `ended` once per arrival, so a play() that left the cursor
  // parked there would run forever without a second report: the clock would
  // extrapolate past the end and every position report would snap it back.
  private atEnd = false;
  // The gain last handed to the worklet per stem, STEM_ORDER-indexed. An
  // AudioParam mid-ramp reports a value on its way somewhere; this is where it
  // is going, which is what "is this stem audible" means to a reader.
  private readonly stemGains: number[] = STEM_ORDER.map(() => 1);
  // The click's level (0..1) and whether it is on. The worklet's metronomeGain
  // is one number; these are what it is set from.
  private metronomeLevel = 1;
  private metronomeOn = false;

  private constructor(
    private readonly context: AudioContext,
    private readonly cursorNode: AudioWorkletNode,
    private readonly stNode: SoundTouchNode,
    private readonly clock: EngineClock,
    // A mutable box, not a plain field: `create()` is static, so the `port.onmessage`
    // closure it sets up can't see instance fields through `this`. Both the closure
    // and the instance methods below share this one object instead.
    private readonly tempoState: { ratio: number },
    // Same pattern as tempoState: create()'s port.onmessage closure fires this box,
    // and the constructor below wires the box to the real instance-level handling
    // (pause the transport, notify subscribers) that only the instance can do.
    private readonly endedBox: { fire: () => void },
    // Same pattern again: whether the transport is running. The clock
    // extrapolates from its last anchor, so it has to be told to stop
    // advancing when the cursor does -- otherwise a paused position sawtooths
    // forward between worklet reports and "set A exactly where I stopped"
    // stops being exact. create()'s port.onmessage reads this box too, so the
    // next report after a pause does not undo the stop.
    private readonly playingState: { playing: boolean },
    private durationFrames: number,
    private summaries: readonly StemSummary[],
    private readonly stretching: boolean,
  ) {
    this.endedBox.fire = () => {
      this.pause();
      this.atEnd = true;
      // pause() froze the clock wherever its extrapolation had reached, which is
      // a few ms either side of the true end. The cursor is exactly on the end.
      this.clock.resync({
        contextTime: this.context.currentTime,
        position: this.durationSamples,
        samplesPerSecond: 0,
      });
      this.endedListeners.forEach((cb) => cb());
    };
  }

  /** Length of the stems, 48 kHz domain. The transport's right-hand edge. */
  get durationSamples(): SampleIndex {
    return toStemDomain(this.durationFrames, this.context.sampleRate);
  }

  /** One per stem in STEM_ORDER. Waveform data and U-10's near-silent flag. */
  get stemSummaries(): readonly StemSummary[] {
    return this.summaries;
  }

  get durationSeconds(): number {
    return this.durationFrames / this.context.sampleRate;
  }

  static async create(stemUrls: Record<StemName, string>): Promise<EngineController> {
    const context = await EngineController.openContext();
    const buffers = await Promise.all(
      STEM_ORDER.map(async (name) => {
        const response = await fetch(stemUrls[name]);
        const bytes = await response.arrayBuffer();
        return context.decodeAudioData(bytes);
      }),
    );
    const stems = buffers.map((buffer) => {
      const left = buffer.getChannelData(0);
      return { left, right: buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left };
    });
    return EngineController.build(context, stems, true);
  }

  /**
   * An engine over stems already in memory, at 48 kHz (the Practice tab, D-22). They
   * cannot be resampled the way decodeAudioData resamples a file, so a context that
   * refuses 48 kHz is an error, not a warning (N-08).
   *
   * `stretch: false` plays the stems straight to the output, with no time-stretcher: a
   * player that never changes tempo or pitch (Guess the note) has no use for its ~135 ms
   * of latency, and its first pass over a fresh stream drops 96 frames mid-note, a pop.
   * Such an engine refuses setTempo and setPitchSemitones rather than ignore them (N-08).
   */
  static async createFromStems(stems: readonly StemChannels[], options: { stretch?: boolean } = {}): Promise<EngineController> {
    const context = await EngineController.openContext();
    if (context.sampleRate !== SAMPLE_RATE) {
      await context.close();
      throw new Error(
        `The browser's audio runs at ${context.sampleRate} Hz and would not switch to ${SAMPLE_RATE} Hz; ` +
          'Practice renders at 48 kHz and cannot play at another rate.',
      );
    }
    return EngineController.build(context, stems, options.stretch ?? true);
  }

  private static async openContext(): Promise<AudioContext> {
    const context = new AudioContext({ sampleRate: SAMPLE_RATE });
    if (context.sampleRate !== SAMPLE_RATE) {
      console.warn(
        `AudioContext ignored the requested ${SAMPLE_RATE} Hz and runs at ${context.sampleRate} Hz; ` +
          'loop bounds will be scaled at the domain boundary (types.ts:toDeviceDomain).',
      );
    }
    await context.audioWorklet.addModule(stemCursorProcessorUrl);
    await SoundTouchNode.register(context, processorUrl);
    return context;
  }

  private static build(context: AudioContext, stems: readonly StemChannels[], stretching: boolean): EngineController {
    const cursorNode = new AudioWorkletNode(context, 'stem-cursor-processor', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });
    // In chunks, never one message: Firefox aborts the tab on a worklet message over 4 GB (stemLoad.ts).
    for (const { message, transfer } of stemLoadMessages(stems)) cursorNode.port.postMessage(message, transfer);

    const stNode = new SoundTouchNode({ context });
    if (stretching) {
      cursorNode.connect(stNode);
      stNode.connect(context.destination);
    } else {
      cursorNode.connect(context.destination);
    }

    const tempoState = { ratio: 1.0 };
    const endedBox: { fire: () => void } = { fire: () => {} };
    // Nothing plays until play() is called, so the clock starts stopped.
    const playingState = { playing: false };
    const clock = new EngineClock({ contextTime: context.currentTime, position: sampleIndex(0), samplesPerSecond: 0 });
    cursorNode.port.onmessage = (event: MessageEvent) => {
      if (event.data.type === 'position') {
        clock.resync({
          contextTime: event.data.contextTime,
          // The worklet indexes directly into buffers decoded at context.sampleRate,
          // so its reported position is device-domain, not stem-domain (48 kHz) —
          // convert it back before handing it to the clock (D-03).
          position: toStemDomain(event.data.position, context.sampleRate),
          // Stem-domain samples advanced per real second is the tempo-scaled rate
          // (Task 2's clock test asserts exactly this), not the raw sample rate --
          // and zero while paused, because the cursor is not advancing at all.
          // The worklet keeps reporting while stopped, so without this flag the
          // first report after a pause would start the clock extrapolating again.
          samplesPerSecond: playingState.playing ? SAMPLE_RATE * tempoState.ratio : 0,
        });
      } else if (event.data.type === 'ended') {
        endedBox.fire();
      }
    };

    // Device-domain frame count; all four stems are the same length. Exposed in the
    // stem domain via durationSamples.
    const durationFrames = stems[0]!.left.length;

    return new EngineController(
      context,
      cursorNode,
      stNode,
      clock,
      tempoState,
      endedBox,
      playingState,
      durationFrames,
      summariesOf(stems, context.sampleRate),
      stretching,
    );
  }

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

  setTempo(ratio: number): void {
    this.requireStretcher('setTempo');
    const clamped = clampTempo(ratio); // N-04: 50-150%
    this.tempoState.ratio = clamped;
    this.cursorNode.parameters.get('readRate')!.setValueAtTime(clamped, this.context.currentTime);
    const stParams = computeSoundTouchParams(clamped, this.stNode.pitchSemitones.value);
    this.stNode.playbackRate.setValueAtTime(stParams.playbackRate, this.context.currentTime);
    this.stNode.pitch.setValueAtTime(stParams.pitch, this.context.currentTime);
  }

  private requireStretcher(what: string): void {
    if (!this.stretching) throw new Error(`${what}: this engine was created without the time-stretcher`);
  }

  setPitchSemitones(semitones: number): void {
    this.requireStretcher('setPitchSemitones');
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

  /**
   * Stem-domain samples the cursor advances per second of real time: the
   * tempo-scaled rate while running, and zero while stopped. Every resync this
   * class makes goes through here so a paused clock never extrapolates.
   */
  private get clockRate(): number {
    return this.playingState.playing ? SAMPLE_RATE * this.tempoState.ratio : 0;
  }

  seek(position: SampleIndex): void {
    this.cancelCountIn();
    this.atEnd = position >= this.durationSamples;
    this.cursorNode.port.postMessage({ type: 'seek', position: toDeviceDomain(position, this.context.sampleRate) });
    this.clock.resync({ contextTime: this.context.currentTime, position, samplesPerSecond: this.clockRate });
  }

  /**
   * Hands the worklet the beat grid, converted to device-domain frames. Called
   * once when analysis.json arrives; the grid does not change during playback.
   */
  setGrid(bars: SampleIndex[], beats: SampleIndex[]): void {
    const barSet = new Set(bars.map((b) => b as number));
    this.cursorNode.port.postMessage({
      type: 'set-grid',
      beats: beats.map((b) => toDeviceDomain(b, this.context.sampleRate)),
      downbeatFlags: beats.map((b) => (barSet.has(b as number) ? 1 : 0)),
    });
  }

  setMetronome(on: boolean): void {
    this.metronomeOn = on;
    this.cursorNode.parameters
      .get('metronomeGain')!
      .setValueAtTime(on ? this.metronomeLevel : 0, this.context.currentTime);
  }

  /** The click's level, 0..1. Takes effect at once if the click is on. */
  setMetronomeLevel(level: number): void {
    this.metronomeLevel = Math.min(1, Math.max(0, level));
    if (this.metronomeOn) this.setMetronome(true);
  }

  /**
   * New stems in the same engine (D-22: the Practice loop re-rendered). The worklet
   * takes a fresh load sequence in place of the old stems; nothing else is rebuilt.
   * Leaves the transport paused at the top; the caller sets grid and loop again.
   */
  replaceStems(stems: readonly StemChannels[]): void {
    this.pause();
    for (const { message, transfer } of stemLoadMessages(stems)) this.cursorNode.port.postMessage(message, transfer);
    this.durationFrames = stems[0]!.left.length;
    this.summaries = summariesOf(stems, this.context.sampleRate);
    this.seek(sampleIndex(0));
  }

  getPositionSamples(): SampleIndex {
    // Clamped: between two worklet reports the clock extrapolates, and in the
    // last ~100 ms of a song that would run the playhead past the end.
    const position = this.clock.positionAt(this.context.currentTime);
    const end = this.durationSamples;
    return position > end ? end : position;
  }

  /**
   * Starts the cursor. The AudioContext is resumed here rather than in
   * create(): browsers require a user gesture, and create() runs before the
   * user has pressed anything.
   */
  async play(): Promise<void> {
    if (this.context.state === 'suspended') await this.context.resume();
    // Play at the end means "again from the top", like every other player.
    if (this.atEnd) this.seek(sampleIndex(0));
    // Anchor the clock where the paused cursor stood, then let it run: the
    // position it reports has to start advancing from this instant, not from
    // whenever the worklet last reported.
    const position = this.getPositionSamples();
    this.playingState.playing = true;
    this.clock.resync({ contextTime: this.context.currentTime, position, samplesPerSecond: this.clockRate });
    this.cursorNode.parameters.get('playing')!.setValueAtTime(1, this.context.currentTime);
  }

  pause(): void {
    this.cancelCountIn();
    // Freeze the clock at the position it had reached. Without this it would
    // keep extrapolating through the pause, and every setting taken from "where
    // the cursor is" -- set A, set B, a bar nudge, the next play's start point
    // -- would be read from a position the cursor never had.
    const position = this.getPositionSamples();
    this.playingState.playing = false;
    this.clock.resync({ contextTime: this.context.currentTime, position, samplesPerSecond: this.clockRate });
    this.cursorNode.parameters.get('playing')!.setValueAtTime(0, this.context.currentTime);
  }

  /**
   * Interrupts a pending count-in, if any: restores the stem gains it zeroed
   * and clears it, so whoever interrupted it (pause, seek, a fresh
   * countInAndPlay, or the stems ending) is entitled to normal audio rather
   * than inheriting silenced stems. Bumping the generation also tells the
   * interrupted count-in's own poll loop (below) that it has already been
   * handled, so it can bail out without calling restore a second time.
   */
  private cancelCountIn(): void {
    if (this.pendingCountIn) {
      this.countInGeneration++;
      this.pendingCountIn.restore();
      this.pendingCountIn = null;
    }
  }

  /**
   * Plays `bars` bars of metronome before the music, by starting the cursor
   * that far back with the stems silenced. Resolves once the music has started.
   * `barStarts` is the grid's downbeats (48 kHz domain); `from` is where
   * playback should actually begin.
   *
   * Cancellable: pause(), seek(), or a second countInAndPlay() call can all
   * interrupt the wait below. Each such interruption goes through
   * cancelCountIn(), which restores gains itself and bumps the generation —
   * so `restoreGains` runs exactly once on every path, never zero times
   * (leaving stems stuck silent) and never twice.
   */
  async countInAndPlay(
    from: SampleIndex,
    bars: number,
    barStarts: SampleIndex[],
    restoreGains: () => void,
  ): Promise<void> {
    this.cancelCountIn();
    // Same rule as play(): at the end, `from` is the top. Without this the
    // cursor would be sent back to the end and play() would then rewind it,
    // leaving the stems silenced until the cursor reached `from` again.
    if (this.atEnd) from = sampleIndex(0);
    if (bars <= 0) {
      this.seek(from);
      await this.play();
      return;
    }
    // Known limitation, not a bug: findIndex returns 0 when `from` is at or
    // before the first downbeat, so `countFrom` falls back to `from` and no
    // count-in bars play -- including the commonest case of all, pressing play
    // at position 0. Counting over silence ahead of sample 0 would need the
    // worklet's cursor to run negative, which it does not support; fixing it is
    // a worklet change, not a change here. The UI says so next to the control.
    const startBar = barStarts.findIndex((b) => b >= from);
    const countFrom = startBar > 0 ? barStarts[Math.max(0, startBar - bars)]! : from;
    for (const stem of STEM_ORDER) this.setStemGain(stem, 0);
    this.setMetronome(true);
    this.seek(countFrom);
    await this.play();
    const generation = ++this.countInGeneration;
    this.pendingCountIn = { generation, restore: restoreGains };
    // Polling the clock rather than setTimeout: the clock is the only thing
    // that knows the real rate after a tempo change (U-05's rule, applied to
    // an engine-internal decision rather than to the playhead).
    await new Promise<void>((resolve) => {
      const tick = () => {
        if (this.countInGeneration !== generation) {
          // Someone else (pause/seek/a new count-in) already cancelled this
          // one and ran its restore via cancelCountIn(). Just stop polling.
          resolve();
          return;
        }
        if (this.getPositionSamples() >= from) {
          this.pendingCountIn = null;
          restoreGains();
          resolve();
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }

  /** Returns an unsubscribe function, so a React effect can clean up. */
  onEnded(cb: () => void): () => void {
    this.endedListeners.add(cb);
    return () => this.endedListeners.delete(cb);
  }

  /**
   * Latest render-thread metrics snapshot from the time-stretcher (underrun
   * count, buffered frames, RMS/peak), or `null` before the first snapshot
   * arrives. Exposed for the dev harness (Task 8) so an underrun is visible
   * on screen, not just audible; not used by production playback code.
   */
  getMetrics(): ProcessorMetrics | null {
    return this.stNode.metrics;
  }

  async dispose(): Promise<void> {
    this.cursorNode.disconnect();
    this.stNode.disconnect();
    await this.context.close();
  }
}
