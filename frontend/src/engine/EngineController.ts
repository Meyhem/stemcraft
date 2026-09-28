import stemCursorProcessorUrl from './stem-cursor-processor.ts?url';
import processorUrl from '@soundtouchjs/audio-worklet/processor?url';
import { SoundTouchNode } from '@soundtouchjs/audio-worklet';
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
          // The worklet indexes directly into buffers decoded at context.sampleRate,
          // so its reported position is device-domain, not stem-domain (48 kHz) —
          // convert it back before handing it to the clock (D-03).
          position: toStemDomain(event.data.position, context.sampleRate),
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
