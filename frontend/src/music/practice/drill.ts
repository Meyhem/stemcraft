// Technique drills (D-22): fret-based, no key, one finger per fret from the
// index finger's fret. Named with sharps. Only "permutations" is random (a
// seeded finger order), so only it is regenerable.
import type { InstrumentSettings, PracticeInstrument } from '../../api/client';
import { sharpName, STRING_NAMES, TUNINGS } from './neck';
import { rng } from './random';
import { timed } from './scale';
import { BEATS_PER_BAR, loopOf, RHYTHM_STEP, type GenerateResult, type PracticeNote } from './types';

interface Cell {
  string: number;
  fret: number;
  finger: number;
}

function permutations(items: readonly number[]): number[][] {
  if (items.length <= 1) return [[...items]];
  return items.flatMap((x, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [x, ...rest]));
}
export const PERMUTATIONS: readonly (readonly number[])[] = permutations([1, 2, 3, 4]);

export function drillLine(settings: InstrumentSettings, inst: PracticeInstrument): GenerateResult {
  const d = settings.drill;
  const tuning = TUNINGS[inst];
  const strings = tuning.length;
  const at = (string: number, finger: number): Cell => ({ string, fret: d.from_fret + finger - 1, finger });

  let up: Cell[];
  switch (d.drill) {
    case 'chromatic':
    case 'permutations': {
      const order = d.drill === 'chromatic' ? [1, 2, 3, 4] : PERMUTATIONS[Math.floor(rng(settings.seed)() * 24)]!;
      up = [...Array(strings).keys()].flatMap((s) => order.map((f) => at(s, f)));
      break;
    }
    case 'spider':
      up = [...Array(strings - 1).keys()].flatMap((s) => [at(s, 1), at(s + 1, 2), at(s, 3), at(s + 1, 4)]);
      break;
    case 'crossing':
      up = [...Array(strings).keys()].map((s) => at(s, 1));
      break;
    case 'octaves': {
      const top = d.from_fret + 3 + 2;
      if (top > 12) {
        return {
          ok: false,
          error: `Octaves from fret ${d.from_fret} reach fret ${top}; the neck stops at 12.`,
          fixes: [{ label: 'Start from fret 7', apply: (s) => ({ ...s, drill: { ...s.drill, from_fret: 7 } }) }],
        };
      }
      up = [...Array(strings - 2).keys()].flatMap((s) =>
        [0, 1, 2, 3].flatMap((k) => [
          { string: s, fret: d.from_fret + k, finger: 1 },
          { string: s + 2, fret: d.from_fret + k + 2, finger: 4 },
        ]),
      );
      break;
    }
  }
  const cells = d.direction === 'up_back' ? [...up, ...[...up].reverse()] : up;

  const { starts, durs, barCount } = timed(cells.length, RHYTHM_STEP[d.rhythm]);
  const notes: PracticeNote[] = cells.map((c, i) => {
    const midi = tuning[c.string]! + c.fret;
    return {
      start: starts[i]!,
      dur: durs[i]!,
      string: c.string,
      fret: c.fret,
      midi,
      name: sharpName(midi),
      kind: 'tone',
      group: i,
      finger: c.finger,
      stroke: null,
    };
  });
  const names = STRING_NAMES[inst];
  const bars = Array.from({ length: barCount }, (_, b) => {
    const inBar = notes.filter((n) => n.start >= b * BEATS_PER_BAR && n.start < (b + 1) * BEATS_PER_BAR);
    const first = names[inBar[0]?.string ?? 0]!;
    const last = names[inBar.at(-1)?.string ?? 0]!;
    return { label: first === last ? first : `${first} → ${last}`, repeat: false, note: null };
  });
  return { ok: true, loop: loopOf(inst, bars, notes) };
}
