import { beforeAll, describe, expect, it } from 'vitest';

// The processor module calls `registerProcessor` and extends
// `AudioWorkletProcessor` at import time — neither exists in jsdom, since both
// are normally only defined inside the real AudioWorkletGlobalScope (a
// separate realm from the main thread / jsdom's window). Stub the minimal
// surface the module actually touches, install it on globalThis, then import
// the module dynamically so the stubs are in place before the class body and
// `registerProcessor(...)` call at the bottom of the file execute.
interface FakeMessagePort {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage: (data: unknown) => void;
}

let registered: (new () => InstanceType<typeof FakeAudioWorkletProcessorBase>) | undefined;
let posted: unknown[] = [];

// Base class stub: the real AudioWorkletProcessor sets up `this.port` itself:
// subclassing it and calling super() is how the real processor gets a working
// MessagePort. Mirror that here.
class FakeAudioWorkletProcessorBase {
  port: FakeMessagePort;
  constructor() {
    this.port = {
      onmessage: null,
      postMessage: (data: unknown) => posted.push(data),
    };
  }
}

beforeAll(async () => {
  (globalThis as unknown as { AudioWorkletProcessor: unknown }).AudioWorkletProcessor = FakeAudioWorkletProcessorBase;
  (globalThis as unknown as { registerProcessor: unknown }).registerProcessor = (
    _name: string,
    ctor: new () => InstanceType<typeof FakeAudioWorkletProcessorBase>,
  ) => {
    registered = ctor;
  };
  (globalThis as unknown as { sampleRate: number }).sampleRate = 48_000;
  (globalThis as unknown as { currentTime: number }).currentTime = 0;

  await import('./stem-cursor-processor');
});

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const BLOCK_SIZE = 128;

interface ProcessorHandle {
  process(parameters: Record<string, Float32Array>): void;
  postMessage(msg: unknown): void;
  endedMessages(): { type: 'ended'; position: number; contextTime: number }[];
}

function stemBuffers(lengthFrames: number): { left: ArrayBuffer; right: ArrayBuffer }[] {
  return [0, 1, 2, 3].map(() => {
    const left = new Float32Array(lengthFrames).fill(0.1);
    const right = new Float32Array(lengthFrames).fill(0.1);
    return { left: left.buffer, right: right.buffer };
  });
}

function defaultParameters(overrides: Partial<Record<string, number>> = {}): Record<string, Float32Array> {
  const base: Record<string, number> = {
    gain0: 1,
    gain1: 1,
    gain2: 1,
    gain3: 1,
    readRate: 1,
    playing: 1,
    ...overrides,
  };
  const out: Record<string, Float32Array> = {};
  for (const [key, value] of Object.entries(base)) {
    out[key] = new Float32Array([value]);
  }
  return out;
}

function makeProcessor(lengthFrames: number): ProcessorHandle {
  if (!registered) throw new Error('stem-cursor-processor module did not call registerProcessor');
  posted = [];
  // eslint-disable-next-line new-cap -- `registered` is a captured class constructor, not a factory function
  const instance = new registered() as InstanceType<typeof FakeAudioWorkletProcessorBase> & {
    process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean;
  };

  instance.port.onmessage?.({ data: { type: 'load-stems', stems: stemBuffers(lengthFrames) } } as MessageEvent);

  return {
    process(parameters: Record<string, Float32Array>) {
      const outLeft = new Float32Array(BLOCK_SIZE);
      const outRight = new Float32Array(BLOCK_SIZE);
      instance.process([], [[outLeft, outRight]], parameters);
    },
    postMessage(msg: unknown) {
      instance.port.onmessage?.({ data: msg } as MessageEvent);
    },
    endedMessages() {
      return posted.filter((m): m is { type: 'ended'; position: number; contextTime: number } => {
        return typeof m === 'object' && m !== null && (m as { type?: string }).type === 'ended';
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('StemCursorProcessor ended notification', () => {
  it('posts ended exactly once on reaching the end, not once per subsequent block', () => {
    const lengthFrames = 200; // less than two blocks (128 + 128)
    const processor = makeProcessor(lengthFrames);

    // First block: 0 -> 128, still inside the stems.
    processor.process(defaultParameters());
    expect(processor.endedMessages()).toHaveLength(0);

    // Second block: 128 -> reaches 200 partway through and clamps; ended fires here.
    processor.process(defaultParameters());
    expect(processor.endedMessages()).toHaveLength(1);

    // Further blocks while still past the end must not post again.
    processor.process(defaultParameters());
    processor.process(defaultParameters());
    processor.process(defaultParameters());
    expect(processor.endedMessages()).toHaveLength(1);
  });

  it('posts ended again after a seek back into the middle and playing to the end a second time', () => {
    const lengthFrames = 200;
    const processor = makeProcessor(lengthFrames);

    processor.process(defaultParameters());
    processor.process(defaultParameters());
    expect(processor.endedMessages()).toHaveLength(1);

    processor.postMessage({ type: 'seek', position: 50 });
    // 50 -> 178 in one block, still short of the end.
    processor.process(defaultParameters());
    expect(processor.endedMessages()).toHaveLength(1);
    // 178 -> reaches 200 and clamps partway through this block.
    processor.process(defaultParameters());
    expect(processor.endedMessages()).toHaveLength(2);
  });

  it('Finding 1 regression: a seek to a position at or past lengthFrames re-posts ended', () => {
    const lengthFrames = 200;
    const processor = makeProcessor(lengthFrames);

    processor.process(defaultParameters());
    processor.process(defaultParameters());
    expect(processor.endedMessages()).toHaveLength(1);

    // Seek to (or past) the end. Without clearing `endedReported` in the seek
    // handler, the very next process() re-clamps and sets `ended` back to
    // true within the same call, so the post-render "!ended -> reset" branch
    // never runs and this second `ended` message is silently dropped.
    processor.postMessage({ type: 'seek', position: 200 });
    processor.process(defaultParameters());
    expect(processor.endedMessages()).toHaveLength(2);
  });
});
