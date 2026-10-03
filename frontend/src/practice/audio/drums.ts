// The Practice drum grooves (D-22 Phase B): three synthesized voices and five
// one-bar patterns on a step grid (sixteenths, or triplet eighths for the
// shuffle). Plain DSP at 48 kHz, deterministic for a seed, like voices.ts.
import type { DrumGroove } from '../../api/client';
import { SAMPLE_RATE } from '../../engine/types';
import { rng } from '../../music/practice/random';

export type DrumVoice = 'kick' | 'snare' | 'hat';

export interface DrumPattern {
  /** Steps per bar of 4/4: 16 sixteenths, or 12 triplet eighths. */
  steps: 12 | 16;
  kick: number[];
  snare: number[];
  hat: number[];
}

const EIGHTHS = [0, 2, 4, 6, 8, 10, 12, 14];
export const GROOVES: Record<DrumGroove, DrumPattern> = {
  rock: { steps: 16, kick: [0, 8], snare: [4, 12], hat: EIGHTHS },
  half_time: { steps: 16, kick: [0, 6], snare: [8], hat: EIGHTHS },
  funk: { steps: 16, kick: [0, 3, 10], snare: [4, 12], hat: [...Array(16).keys()] },
  four_floor: { steps: 16, kick: [0, 4, 8, 12], snare: [4, 12], hat: [2, 6, 10, 14] },
  shuffle: { steps: 12, kick: [0, 6], snare: [3, 9], hat: [0, 2, 3, 5, 6, 8, 9, 11] },
};

export function drumHits(groove: DrumGroove, bars: number): { voice: DrumVoice; beat: number }[] {
  const p = GROOVES[groove];
  const beatOf = (step: number) => (step * 4) / p.steps;
  const out: { voice: DrumVoice; beat: number }[] = [];
  for (let bar = 0; bar < bars; bar++) {
    for (const voice of ['kick', 'snare', 'hat'] as const) {
      for (const step of p[voice]) out.push({ voice, beat: bar * 4 + beatOf(step) });
    }
  }
  return out.sort((a, b) => a.beat - b.beat);
}

const LENGTH: Record<DrumVoice, number> = { kick: 0.35, snare: 0.22, hat: 0.06 };

export function drumHit(voice: DrumVoice, seed: number): Float32Array {
  const n = Math.round(LENGTH[voice] * SAMPLE_RATE);
  const out = new Float32Array(n);
  const noise = rng(seed);
  let phase = 0;
  let previous = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    const fade = 1 - i / n; // reaches 0 at the end: no click
    if (voice === 'kick') {
      // A sine whose pitch falls fast from 120 Hz to 45 Hz: the thump.
      const hz = 45 + 75 * Math.exp(-t / 0.03);
      phase += (2 * Math.PI * hz) / SAMPLE_RATE;
      out[i] = 0.9 * Math.sin(phase) * Math.exp(-t / 0.12) * fade;
    } else if (voice === 'snare') {
      // A short 185 Hz body under a longer noise burst: the wires.
      const body = Math.sin((2 * Math.PI * 185 * i) / SAMPLE_RATE) * Math.exp(-t / 0.04);
      const wires = (noise() * 2 - 1) * Math.exp(-t / 0.07);
      out[i] = (0.35 * body + 0.45 * wires) * fade;
    } else {
      // Noise through a first difference (a crude high-pass): the tick.
      const x = noise() * 2 - 1;
      out[i] = 0.5 * (x - previous) * Math.exp(-t / 0.015) * fade;
      previous = x;
    }
  }
  return out;
}
