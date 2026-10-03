// Scales & modes (D-22): one position (every scale note in a hand window from a
// fret) or two octaves from the root across the neck, walked by a path, in a
// rhythm. Spelled for the key by tonal (spell.ts scaleNotes). A shape that runs
// off the neck is an error with fixes, never squeezed into another (N-08).
import type { InstrumentSettings, PracticeInstrument, PracticeScale } from '../../api/client';
import { mod12 } from '../chordTones';
import { pretty, rootName, scaleDef, scaleNotes } from '../spell';
import { toBtcLabel } from './chords';
import { HAND_SPAN, placeLine, PRACTICE_MAX_FRET, STRING_NAMES, TUNINGS, type Fretted } from './neck';
import { BEATS_PER_BAR, loopOf, RHYTHM_STEP, type Fix, type GenerateResult, type PracticeNote } from './types';

/** `line` walked in overlapping groups: [0,2] gives thirds, [0,1,2] groups of three. */
function sequence(line: readonly number[], offsets: readonly number[]): number[] {
  const reach = Math.max(...offsets);
  const out: number[] = [];
  for (let i = 0; i + reach < line.length; i++) out.push(...offsets.map((o) => line[i + o]!));
  return out;
}

export function pathOrder(n: number, path: PracticeScale['path']): number[] {
  const up = [...Array(n).keys()];
  const down = [...up].reverse();
  switch (path) {
    case 'up':
      return up;
    case 'down':
      return down;
    case 'up_down':
      // The top once, and not the root again: the loop's wrap plays it.
      return [...up, ...down.slice(1, -1)];
    case 'thirds':
      return [...sequence(up, [0, 2]), ...sequence(down, [0, 2])];
    case 'groups3':
      return [...sequence(up, [0, 1, 2]), ...sequence(down, [0, 1, 2])];
    case 'groups4':
      return [...sequence(up, [0, 1, 2, 3]), ...sequence(down, [0, 1, 2, 3])];
  }
}

/** Onsets for `count` notes `step` beats apart, in whole bars; the last note rings to the bar line. */
export function timed(count: number, step: number): { starts: number[]; durs: number[]; barCount: number } {
  const starts = Array.from({ length: count }, (_, i) => i * step);
  const barCount = Math.max(1, Math.ceil((count * step) / BEATS_PER_BAR - 1e-9));
  const durs = starts.map((s, i) => (i === count - 1 ? barCount * BEATS_PER_BAR - s : step));
  return { starts, durs, barCount };
}

export function scaleLine(settings: InstrumentSettings, inst: PracticeInstrument): GenerateResult {
  const sc = settings.scale;
  const def = scaleDef(sc.scale);
  const tonic = rootName(settings.key, def.mode);
  const spelled = scaleNotes(tonic, sc.scale);
  const pcs = new Set(spelled.map((n) => n.pc));
  const nameOf = (midi: number) => pretty(spelled.find((n) => n.pc === mod12(midi))?.name ?? '?');
  const tuning = TUNINGS[inst];
  const span = HAND_SPAN[inst];
  const title = `${pretty(tonic)} ${def.label}`;
  // The pad drones the scale's tonic triad.
  const btcRoot = toBtcLabel(tonic);
  const drone = def.mode === 'minor' ? `${btcRoot}:min` : btcRoot;

  let line: (Fretted & { midi: number })[];
  if (sc.shape === 'position') {
    const lo = sc.from_fret;
    const hi = lo + span;
    if (hi > PRACTICE_MAX_FRET) {
      const fix: Fix = {
        label: `Start from fret ${PRACTICE_MAX_FRET - span}`,
        apply: (s) => ({ ...s, scale: { ...s.scale, from_fret: PRACTICE_MAX_FRET - span } }),
      };
      return { ok: false, error: `Frets ${lo}–${hi} run past the 12th fret.`, fixes: [fix] };
    }
    const cells: (Fretted & { midi: number })[] = [];
    tuning.forEach((open, string) => {
      for (let fret = lo; fret <= hi; fret++) if (pcs.has(mod12(open + fret))) cells.push({ string, fret, midi: open + fret });
    });
    cells.sort((a, b) => a.midi - b.midi);
    line = cells.filter((c, i) => i === 0 || c.midi !== cells[i - 1]!.midi);
  } else {
    const rootFret = sc.from_fret + mod12(settings.key - (tuning[0]! + sc.from_fret));
    const rootMidi = tuning[0]! + rootFret;
    const midis: number[] = [];
    for (let m = rootMidi; m <= rootMidi + 24; m++) if (pcs.has(mod12(m))) midis.push(m);
    const placed = rootFret <= PRACTICE_MAX_FRET ? placeLine(midis, inst, sc.from_fret) : { ok: false as const, midi: rootMidi };
    if (!placed.ok) {
      // Name the top note, not the first one off the neck: "the top D needs fret 19" says
      // how far over the shape is (the States mockup).
      const top = tuning.length - 1;
      const topMidi = midis.at(-1)!;
      const fixes: Fix[] = [];
      if (sc.from_fret > 0) fixes.push({ label: 'Start from fret 0', apply: (s) => ({ ...s, scale: { ...s.scale, from_fret: 0 } }) });
      fixes.push({ label: 'One position', apply: (s) => ({ ...s, scale: { ...s.scale, shape: 'position' } }) });
      return {
        ok: false,
        error:
          `Two octaves of ${title} do not fit from fret ${sc.from_fret}: the top ${nameOf(topMidi)} needs fret ` +
          `${topMidi - tuning[top]!} on the ${STRING_NAMES[inst][top]} string; the neck stops at 12.`,
        fixes,
      };
    }
    line = placed.frets.map((f, i) => ({ ...f, midi: midis[i]! }));
  }
  if (line.length < 2) {
    return { ok: false, error: `${title} has fewer than two notes in frets ${sc.from_fret}–${sc.from_fret + span}.`, fixes: [] };
  }

  const order = pathOrder(line.length, sc.path);
  const { starts, durs, barCount } = timed(order.length, RHYTHM_STEP[sc.rhythm]);
  const notes: PracticeNote[] = order.map((index, i) => {
    const cell = line[index]!;
    return {
      start: starts[i]!,
      dur: durs[i]!,
      string: cell.string,
      fret: cell.fret,
      midi: cell.midi,
      name: nameOf(cell.midi),
      kind: 'tone',
      group: i,
      finger: null,
      stroke: null,
    };
  });
  const bars = Array.from({ length: barCount }, (_, i) => ({ label: i === 0 ? title : '', repeat: false, note: null, chord: drone }));
  return { ok: true, loop: loopOf(inst, bars, notes) };
}
