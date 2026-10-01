// Strum patterns for the guitar Tabs (D-20). A pattern is a cycle of one-beat
// cells, each two eighth-note slots: D (down), U (up) or · (rest). The cells
// cycle over the bar's beats, so every pattern fits 3/4 as well as 4/4, the
// way the bass rhythms do.
import type { GuitarStrum } from '../api/client';

export interface Stroke {
  /** Offset into the bar in beats; a multiple of 0.5. */
  beat: number;
  dir: 'down' | 'up';
  /** The bar's first stroke, drawn bolder. */
  accent: boolean;
  /** Push: this stroke already plays the next bar's chord. */
  early: boolean;
}

const CELLS: Record<Exclude<GuitarStrum, 'whole' | 'push'>, readonly string[]> = {
  half: ['D·', '··'],
  quarters: ['D·'],
  eighths: ['DU'],
  folk: ['D·', 'DU', '·U', 'DU'],
};

export function strumStrokes(strum: GuitarStrum, beatsPerBar: number): Stroke[] {
  const cells =
    strum === 'whole' ? ['D·', ...new Array<string>(beatsPerBar - 1).fill('··')] : CELLS[strum === 'push' ? 'folk' : strum];
  const strokes: Stroke[] = [];
  for (let beat = 0; beat < beatsPerBar; beat++) {
    [...cells[beat % cells.length]!].forEach((slot, half) => {
      if (slot === '·') return;
      strokes.push({ beat: beat + half / 2, dir: slot === 'D' ? 'down' : 'up', accent: strokes.length === 0, early: false });
    });
  }
  if (strum === 'push') {
    for (let i = strokes.length - 1; i >= 0; i--) {
      if (strokes[i]!.dir === 'up') {
        strokes[i] = { ...strokes[i]!, early: true };
        break;
      }
    }
  }
  return strokes;
}

/** A bar that was pushed into: its beat-1 down-stroke is tied over from the push. */
export function withoutDownbeat(strokes: readonly Stroke[]): Stroke[] {
  const rest = strokes.filter((s) => !(s.beat === 0 && s.dir === 'down'));
  return rest.map((s, i) => ({ ...s, accent: i === 0 }));
}
