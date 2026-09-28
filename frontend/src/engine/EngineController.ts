import stemCursorProcessorUrl from './stem-cursor-processor.ts?url';
import processorUrl from '@soundtouchjs/audio-worklet/processor?url';
import { ProcessorMetrics, SoundTouchNode } from '@soundtouchjs/audio-worklet';
import { computeSoundTouchParams } from './soundtouch';
import { EngineClock } from './clock';
import { SAMPLE_RATE, SampleIndex, sampleIndex, toDeviceDomain, toStemDomain } from './types';

export const STEM_ORDER = ['vocals', 'drums', 'bass', 'other'] as const;
export type StemName = (typeof STEM_ORDER)[number];

const CROSSFADE_SAMPLES = Math.round(0.005 * SAMPLE_RATE); // 5 ms, A-05

export interface EngineLoop {
  startFrame: SampleIndex;
  endFrame: SampleIndex;
}

export class EngineController {
  private readonly endedListeners = new Set<() => void>();
  private countInBarsDefault = 0;

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
    private readonly durationFrames: number,
  ) {
    this.endedBox.fire = () => {
      this.pause();
      this.endedListeners.forEach((cb) => cb());
    };
  }

  /** Length of the stems, 48 kHz domain. The transport's right-hand edge. */
  get durationSamples(): SampleIndex {
    return toStemDomain(this.durationFrames, this.context.sampleRate);
  }

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
    const endedBox: { fire: () => void } = { fire: () => {} };
    const clock = new EngineClock({ contextTime: context.currentTime, position: sampleIndex(0), samplesPerSecond: SAMPLE_RATE });
    cursorNode.port.onmessage = (event: MessageEvent) => {
      if (event.data.type === 'position') {
        clock.resync({
          contextTime: event.data.contextTime,
          // The worklet indexes directly into buffers decoded at context.sampleRate,
          // so its reported position is device-domain, not stem-domain (48 kHz) —
          // convert it back before handing it to the clock (D-03).
          position: toStemDomain(event.data.position, context.sampleRate),
          // Stem-domain samples advanced per real second is the tempo-scaled rate
          // (Task 2's clock test asserts exactly this), not the raw sample rate.
          samplesPerSecond: SAMPLE_RATE * tempoState.ratio,
        });
      } else if (event.data.type === 'ended') {
        endedBox.fire();
      }
    };

    // Device-domain frame count; all four stems are decoded from the same source
    // and are the same length. Exposed in the stem domain via durationSamples.
    const durationFrames = buffers[0]!.length;

    return new EngineController(context, cursorNode, stNode, clock, tempoState, endedBox, durationFrames);
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
    this.cursorNode.parameters
      .get('metronomeGain')!
      .setValueAtTime(on ? 1 : 0, this.context.currentTime);
  }

  /**
   * Stores the count-in length as a preference. `countInAndPlay` below takes
   * `bars` explicitly per call rather than reading this field internally, so a
   * single call site can override the default without a prior setter call;
   * this setter exists for Task 13's settings UI to persist the user's choice
   * across calls.
   */
  setCountInBars(bars: number): void {
    this.countInBarsDefault = bars;
  }

  getPositionSamples(): SampleIndex {
    return this.clock.positionAt(this.context.currentTime);
  }

  /**
   * Starts the cursor. The AudioContext is resumed here rather than in
   * create(): browsers require a user gesture, and create() runs before the
   * user has pressed anything.
   */
  async play(): Promise<void> {
    if (this.context.state === 'suspended') await this.context.resume();
    this.cursorNode.parameters.get('playing')!.setValueAtTime(1, this.context.currentTime);
  }

  pause(): void {
    this.cursorNode.parameters.get('playing')!.setValueAtTime(0, this.context.currentTime);
  }

  /**
   * Plays `bars` bars of metronome before the music, by starting the cursor
   * that far back with the stems silenced. Resolves once the music has started.
   * `barStarts` is the grid's downbeats (48 kHz domain); `from` is where
   * playback should actually begin.
   */
  async countInAndPlay(
    from: SampleIndex,
    bars: number,
    barStarts: SampleIndex[],
    restoreGains: () => void,
  ): Promise<void> {
    if (bars <= 0) {
      this.seek(from);
      await this.play();
      return;
    }
    const startBar = barStarts.findIndex((b) => b >= from);
    const countFrom = startBar > 0 ? barStarts[Math.max(0, startBar - bars)]! : from;
    for (const stem of STEM_ORDER) this.setStemGain(stem, 0);
    this.setMetronome(true);
    this.seek(countFrom);
    await this.play();
    // Polling the clock rather than setTimeout: the clock is the only thing
    // that knows the real rate after a tempo change (U-05's rule, applied to
    // an engine-internal decision rather than to the playhead).
    await new Promise<void>((resolve) => {
      const tick = () => {
        if (this.getPositionSamples() >= from) {
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
