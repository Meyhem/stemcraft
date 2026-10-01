import { describe, expect, it } from 'vitest';

import { StemAssembler, stemLoadMessages, type StemLoadMessage } from './stemLoad';

const CHUNK = 16;
const ramp = (frames: number, base: number) => Float32Array.from({ length: frames }, (_, i) => base + i);

const fourStems = (frames: number) =>
  [0, 1, 2, 3].map((s) => ({ left: ramp(frames, s * 1e6), right: ramp(frames, s * 1e6 + 5e5) }));

function deliver(messages: Iterable<{ message: StemLoadMessage }>) {
  const assembler = new StemAssembler();
  let stems = null;
  for (const { message } of messages) stems = assembler.receive(message) ?? stems;
  return stems;
}

describe('stemLoadMessages', () => {
  it('never puts more than one chunk of samples in a message', () => {
    // Firefox copies every worklet message through IPC and aborts the tab past 4 GB:
    // a song is only safe if no single message grows with its length.
    const messages = [...stemLoadMessages(fourStems(CHUNK * 2 + 7), CHUNK)];
    for (const { message, transfer } of messages) {
      if (message.type !== 'load-chunk') continue;
      expect(message.samples.byteLength).toBeLessThanOrEqual(CHUNK * 4);
      expect(transfer).toEqual([message.samples]);
    }
    expect(messages.filter((m) => m.message.type === 'load-chunk')).toHaveLength(4 * 2 * 3);
  });

  it('round-trips every sample of every channel through the assembler', () => {
    const source = fourStems(CHUNK + 3);
    const stems = deliver(stemLoadMessages(source, CHUNK))!;
    expect(stems).toHaveLength(4);
    stems.forEach((stem, s) => {
      expect(stem.left).toEqual(source[s]!.left);
      expect(stem.right).toEqual(source[s]!.right);
    });
  });

  it('leaves the source channels intact: the chunks are copies, transferred away', () => {
    const source = fourStems(10);
    const messages = stemLoadMessages(source);
    for (const { transfer } of messages) for (const buffer of transfer) expect(buffer).not.toBe(source[0]!.left.buffer);
    expect(source[0]!.left.length).toBe(10);
  });
});

describe('StemAssembler', () => {
  it('yields nothing until the load ends', () => {
    const assembler = new StemAssembler();
    const messages = [...stemLoadMessages(fourStems(4))];
    for (const { message } of messages.slice(0, -1)) expect(assembler.receive(message)).toBeNull();
    expect(assembler.receive(messages.at(-1)!.message)).not.toBeNull();
  });

  it('fails loudly on a chunk that arrives without a load in progress', () => {
    const assembler = new StemAssembler();
    const chunk = [...stemLoadMessages(fourStems(4))].find((m) => m.message.type === 'load-chunk')!.message;
    expect(() => assembler.receive(chunk)).toThrow(/no stem load in progress/);
  });
});
