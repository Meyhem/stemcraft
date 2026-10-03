// The Practice chord part (D-22 Phase B): each bar's chord voiced in close
// position in the middle of the keyboard, out of the bass's register, played
// as a soft pad (held) or keys (struck on 1 and 3). Several notes sound at
// once, so each is quiet: peaks stay well under 1 when a 7th chord stacks up.
import type { ChordSound } from '../../api/client';
import { SAMPLE_RATE } from '../../engine/types';
import { mod12, parseChord } from '../../music/chordTones';
import { midiHz, RELEASE_FRAMES } from './voices';

const LOW = 48; // C3

export function voicing(label: string): number[] | null {
  const parsed = parseChord(label, 0);
  if (parsed.kind !== 'chord') return null;
  const t = parsed.tones;
  const root = LOW + mod12(t.rootPc - LOW);
  const tones = [0, t.third, t.fifth, ...(t.seventh === null ? [] : [t.seventh])];
  return tones.map((s) => root + s);
}

function release(i: number, frames: number): number {
  return i < frames ? 1 : Math.max(0, 1 - (i - frames) / RELEASE_FRAMES);
}

/** Two slightly detuned voices with a few soft harmonics, swelling in over 120 ms. */
export function padNote(midi: number, frames: number): Float32Array {
  const out = new Float32Array(frames + RELEASE_FRAMES);
  const f = midiHz(midi);
  const attack = 0.12 * SAMPLE_RATE;
  for (let i = 0; i < out.length; i++) {
    const env = Math.min(1, i / attack) * release(i, frames);
    let s = 0;
    for (const detune of [-0.002, 0.002]) {
      const w = (2 * Math.PI * f * (1 + detune) * i) / SAMPLE_RATE;
      s += Math.sin(w) + 0.3 * Math.sin(2 * w) + 0.12 * Math.sin(3 * w);
    }
    out[i] = 0.06 * env * s;
  }
  return out;
}

/** A struck electric-piano-ish tone: the fundamental and a bell-like 4th harmonic, decaying. */
export function keysNote(midi: number, frames: number): Float32Array {
  const out = new Float32Array(frames + RELEASE_FRAMES);
  const w = (2 * Math.PI * midiHz(midi)) / SAMPLE_RATE;
  const attack = 0.003 * SAMPLE_RATE;
  for (let i = 0; i < out.length; i++) {
    const t = i / SAMPLE_RATE;
    const env = Math.min(1, i / attack) * Math.exp(-t / 0.8) * release(i, frames);
    out[i] = 0.12 * env * (Math.sin(w * i) + 0.25 * Math.exp(-t / 0.1) * Math.sin(4 * w * i));
  }
  return out;
}

export function chordHits(sound: ChordSound): { beat: number; dur: number }[] {
  return sound === 'pad' ? [{ beat: 0, dur: 4 }] : [{ beat: 0, dur: 2 }, { beat: 2, dur: 2 }];
}
