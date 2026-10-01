// Handing the decoded stems from the main thread to the stem-cursor worklet.
//
// Firefox routes every worklet MessagePort message through IPC and copies it, transfer
// list or not, and aborts the whole tab on a message over 4 GB
// ("JSStructuredCloneData over 4Gb in size"). Four stereo float stems reach that at
// ~46 min of audio, so the stems go over in fixed-size chunks: no message grows with
// the song. The worklet assembles them into arrays allocated up front.
import type { FourStems, StemChannels } from './loopCursor';

/** Frames per chunk: 16 MB of float samples, ~87 s at 48 kHz. */
export const CHUNK_FRAMES = 1 << 22;

export type StemLoadMessage =
  | { type: 'load-begin'; frames: number[] } // per stem, fixed order
  | { type: 'load-chunk'; stem: number; channel: 0 | 1; offset: number; samples: ArrayBuffer }
  | { type: 'load-end' };

export interface OutgoingMessage {
  message: StemLoadMessage;
  transfer: ArrayBuffer[];
}

/**
 * The messages that load `stems`, in order. Each chunk is a fresh copy for the transfer
 * list; lazily, so a sender that posts as it goes never holds more than one at a time.
 */
export function* stemLoadMessages(
  stems: readonly StemChannels[],
  chunkFrames = CHUNK_FRAMES,
): Generator<OutgoingMessage> {
  yield { message: { type: 'load-begin', frames: stems.map((s) => s.left.length) }, transfer: [] };
  for (const [s, stem] of stems.entries()) {
    for (const [channel, data] of [stem.left, stem.right].entries()) {
      for (let offset = 0; offset < data.length; offset += chunkFrames) {
        const samples = data.slice(offset, offset + chunkFrames).buffer;
        yield { message: { type: 'load-chunk', stem: s, channel: channel as 0 | 1, offset, samples }, transfer: [samples] };
      }
    }
  }
  yield { message: { type: 'load-end' }, transfer: [] };
}

/** The worklet side: fills preallocated channels, and yields the stems on load-end. */
export class StemAssembler {
  private pending: StemChannels[] | null = null;

  /** The finished stems on `load-end`, otherwise null. */
  receive(message: StemLoadMessage): FourStems | null {
    if (message.type === 'load-begin') {
      this.pending = message.frames.map((frames) => ({ left: new Float32Array(frames), right: new Float32Array(frames) }));
      return null;
    }
    if (!this.pending) throw new Error(`stem-cursor-processor: ${message.type} with no stem load in progress`);
    if (message.type === 'load-chunk') {
      const stem = this.pending[message.stem]!;
      (message.channel === 0 ? stem.left : stem.right).set(new Float32Array(message.samples), message.offset);
      return null;
    }
    const stems = this.pending as unknown as FourStems;
    this.pending = null;
    return stems;
  }
}
