import { describe, expect, test } from 'vitest';

import { SAMPLE_RATE, STEM_ORDER } from '../../engine/types';
import { RELEASE_FRAMES } from '../../practice/audio/voices';
import { REFERENCE_FRAMES, renderGuess, TARGET_AT, TARGET_FRAMES, VOICE_SLOT } from './guessRender';

const peak = (xs: Float32Array, from = 0, to = xs.length) => {
  let m = 0;
  for (let i = from; i < to; i++) m = Math.max(m, Math.abs(xs[i]!));
  return m;
};

/** Amplitude of one frequency in a span of samples (Goertzel). */
function amplitudeAt(xs: Float32Array, hz: number, from: number, to: number): number {
  const w = (2 * Math.PI * hz) / SAMPLE_RATE;
  let re = 0;
  let im = 0;
  for (let i = from; i < to; i++) {
    re += xs[i]! * Math.cos(w * i);
    im += xs[i]! * Math.sin(w * i);
  }
  return (2 * Math.hypot(re, im)) / (to - from);
}

describe('renderGuess', () => {
  test('a low bass note keeps overtones through its sustain, so small speakers that cannot play 40-100 Hz still carry its pitch', () => {
    const midi = 28; // E1, 41 Hz
    const hz = 440 * 2 ** ((midi - 69) / 12);
    const voice = renderGuess('bass', midi, null)[STEM_ORDER.indexOf('bass')]!.left;
    const from = Math.round(0.4 * SAMPLE_RATE);
    const to = Math.round(0.9 * SAMPLE_RATE);
    const fundamental = amplitudeAt(voice, hz, from, to);
    const overtones = [2, 3, 4, 5].map((n) => amplitudeAt(voice, n * hz, from, to));
    expect(overtones[0]).toBeGreaterThan(fundamental * 0.4);
    expect(overtones[1]).toBeGreaterThan(fundamental * 0.3);
    expect(overtones[2]! + overtones[3]!).toBeGreaterThan(fundamental * 0.3);
  });

  test.each(['bass', 'guitar'] as const)('%s: the voice is in its slot, the other slots are silent, nothing clips', (kind) => {
    const stems = renderGuess(kind, 43, 45);
    expect(stems).toHaveLength(STEM_ORDER.length);
    const slot = STEM_ORDER.indexOf(VOICE_SLOT[kind]);
    stems.forEach((s, i) => {
      expect(s.left.length).toBe(stems[0]!.left.length);
      expect(s.right.length).toBe(s.left.length);
      if (i === slot) {
        expect(peak(s.left)).toBeGreaterThan(0.1);
        expect(peak(s.left)).toBeLessThan(1);
        expect(s.right).toEqual(s.left);
        expect(s.right.buffer).not.toBe(s.left.buffer); // the engine transfers each channel's buffer
      } else expect(peak(s.left) + peak(s.right)).toBe(0);
    });
  });

  test('with a reference: the A from frame 0, a gap of silence, then the target at TARGET_AT', () => {
    const voice = renderGuess('bass', 43, 45)[STEM_ORDER.indexOf('bass')]!.left;
    expect(voice.length).toBe(TARGET_AT + TARGET_FRAMES + RELEASE_FRAMES);
    expect(peak(voice, 0, SAMPLE_RATE / 10)).toBeGreaterThan(0.1);
    expect(peak(voice, REFERENCE_FRAMES + RELEASE_FRAMES, TARGET_AT)).toBe(0);
    expect(peak(voice, TARGET_AT, TARGET_AT + SAMPLE_RATE / 10)).toBeGreaterThan(0.1);
  });

  test('without a reference: only the target, from frame 0', () => {
    const voice = renderGuess('guitar', 55, null)[STEM_ORDER.indexOf('other')]!.left;
    expect(voice.length).toBe(TARGET_FRAMES + RELEASE_FRAMES);
    expect(peak(voice, 0, SAMPLE_RATE / 10)).toBeGreaterThan(0.05);
  });

  test.each(['bass', 'guitar'] as const)('%s: each note dies away before it ends, so it is not chopped off while ringing', (kind) => {
    const voice = renderGuess(kind, 43, 45)[STEM_ORDER.indexOf(VOICE_SLOT[kind])]!.left;
    const loudest = peak(voice);
    const end = voice.length;
    expect(peak(voice, end - SAMPLE_RATE / 20, end)).toBeLessThan(loudest * 0.05);
    const refEnd = REFERENCE_FRAMES + RELEASE_FRAMES;
    expect(peak(voice, refEnd - SAMPLE_RATE / 20, refEnd)).toBeLessThan(loudest * 0.05);
  });

  test('is deterministic', () => {
    expect(renderGuess('guitar', 55, 57)[3]!.left).toEqual(renderGuess('guitar', 55, 57)[3]!.left);
  });
});
