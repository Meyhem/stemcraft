// The Practice tab's reference sounds (D-22), as plain DSP into Float32Arrays at
// 48 kHz: deterministic, and testable without Web Audio. A note is its length
// plus a 30 ms release, so it never ends on a click. Mono; the renderer puts
// the same samples on both channels.
import { SAMPLE_RATE } from '../../engine/types';
import { rng } from '../../music/practice/random';

export const RELEASE_FRAMES = Math.round(0.03 * SAMPLE_RATE);
const ATTACK_FRAMES = Math.round(0.004 * SAMPLE_RATE);

export function midiHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

/** 1 for the note's length, then a linear fade over the release. */
function release(i: number, frames: number): number {
  return i < frames ? 1 : Math.max(0, 1 - (i - frames) / RELEASE_FRAMES);
}

/** A round electric-bass tone: the fundamental, with a 2nd and 3rd harmonic that fade fast like a pick's attack. */
export function bassNote(midi: number, frames: number): Float32Array {
  const out = new Float32Array(frames + RELEASE_FRAMES);
  const w = (2 * Math.PI * midiHz(midi)) / SAMPLE_RATE;
  // exp(-t/tau) is a geometric sequence: one multiply per sample instead of an exp.
  const decay = (tau: number) => Math.exp(-1 / (tau * SAMPLE_RATE));
  const [dBody, dSecond, dThird] = [decay(0.9), decay(0.12), decay(0.05)];
  let body = 1;
  let second = 1;
  let third = 1;
  for (let i = 0; i < out.length; i++) {
    const env = Math.min(1, i / ATTACK_FRAMES) * body * release(i, frames);
    const s = Math.sin(w * i) + 0.35 * second * Math.sin(2 * w * i) + 0.15 * third * Math.sin(3 * w * i);
    out[i] = 0.45 * env * s;
    body *= dBody;
    second *= dSecond;
    third *= dThird;
  }
  return out;
}

/** A plucked string (Karplus-Strong): a burst of seeded noise round a delay line one period long, averaged as it decays. */
export function pluckNote(midi: number, frames: number, seed: number): Float32Array {
  const out = new Float32Array(frames + RELEASE_FRAMES);
  const period = Math.max(2, Math.round(SAMPLE_RATE / midiHz(midi)));
  const random = rng(seed);
  const line = Float32Array.from({ length: period }, () => random() * 2 - 1);
  let at = 0;
  for (let i = 0; i < out.length; i++) {
    const current = line[at]!;
    const next = line[(at + 1) % period]!;
    line[at] = 0.996 * 0.5 * (current + next);
    out[i] = 0.3 * current * release(i, frames);
    at = (at + 1) % period;
  }
  return out;
}
