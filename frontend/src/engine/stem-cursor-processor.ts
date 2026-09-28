/// <reference types="audioworklet" />
import { renderBlock, type CursorState, type FourStems, type MixParams } from './loopCursor';

// `@types/audioworklet` (Task 4) covers the AudioWorkletGlobalScope surface but does
// not define `AudioParamDescriptor` — it's normally a main-thread-adjacent type that
// TypeScript's DOM lib omits entirely. Declared locally to match the Web Audio spec
// shape; `AutomationRate` itself does come from lib.dom.d.ts, which is in scope here.
interface AudioParamDescriptor {
  name: string;
  automationRate?: AutomationRate;
  minValue?: number;
  maxValue?: number;
  defaultValue?: number;
}

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

    const gains = [0, 1, 2, 3].map((i) => parameters[`gain${i}`]![0]!) as unknown as MixParams['gains'];
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
