// Where the guitar Tabs' chords are held (D-20): every shape a style allows for
// a chord, on a 6-string guitar in standard tuning, frets 0-12. Open and barre
// shapes are full chords and pass voicings.ts's isPlayable; power chords and
// triads cannot (they are 2-3 strings), so they are generated here with their
// own rules. Which shape each bar gets is guitarSource's choice, not this
// module's. Rows are indexed as voicings.ts indexes them: row 0 = high e.
import { mod12, type ChordTones } from './chordTones';
import type { GuitarChord } from './guitarChords';
import { rowMidi } from './positions';
import { instrumentFor } from './tuning';
import { isPlayable, tabOf } from './voicings';

export type GuitarStyle = 'open' | 'barre' | 'power' | 'triad';

export const GUITAR = instrumentFor('guitar6', false);
/** MIDI of the open strings, row 0 = high e, row 5 = low E. */
export const GUITAR_OPEN: readonly number[] = rowMidi(GUITAR);
export const GUITAR_MAX_FRET = 12;
const LOW_E = 5;
const A_STRING = 4;

/** A finger laid flat across rows `from`..`to` (from ≤ to) at `fret`. */
export interface Barre {
  fret: number;
  from: number;
  to: number;
}

export interface GuitarShape {
  /** Fret per row (row 0 = high e); null = muted, 0 = open. */
  frets: (number | null)[];
  /** "320003": low string first, as voicings.ts writes it. */
  tab: string;
  barre: Barre | null;
  /** Lowest fretted fret, 0 if nothing is fretted. Where the hand sits. */
  anchor: number;
  /** Highest fretted fret minus the anchor. */
  span: number;
  muted: number;
}

/**
 * The barre in a fretting: only when more strings are fretted than there are
 * fingers, a flat first finger across every row at the lowest fret, with
 * nothing open or muted between its ends. D (xx0232) has two strings at fret 2
 * but three fretted notes, so it is fingered, not barred.
 */
export function barreOf(frets: readonly (number | null)[]): Barre | null {
  const fretted = frets.flatMap((f, row) => (f !== null && f > 0 ? [{ f, row }] : []));
  if (fretted.length <= 4) return null;
  const min = Math.min(...fretted.map((x) => x.f));
  const rows = fretted.filter((x) => x.f === min).map((x) => x.row);
  if (rows.length < 2) return null;
  const from = Math.min(...rows);
  const to = Math.max(...rows);
  if (frets.slice(from, to + 1).some((f) => f === null || f === 0)) return null;
  return { fret: min, from, to };
}

export function shapeOf(frets: readonly (number | null)[]): GuitarShape {
  const fretted = frets.filter((f): f is number => f !== null && f > 0);
  const anchor = fretted.length ? Math.min(...fretted) : 0;
  return {
    frets: [...frets],
    tab: tabOf(frets),
    barre: barreOf(frets),
    anchor,
    span: fretted.length ? Math.max(...fretted) - anchor : 0,
    muted: frets.filter((f) => f === null).length,
  };
}

const lowestRow = (s: GuitarShape) => s.frets.reduce<number>((acc, f, row) => (f !== null ? row : acc), -1);

/**
 * Every fretting isPlayable accepts: one unbroken run of 4-6 strings, each
 * open or within a 4-fret window. Unlike guitarVoicings (one best shape per
 * fret, for the Theory cards) this keeps them all, so xx0232 survives next to
 * x54232 and the styles below have something to choose from.
 */
function playableShapes(chord: GuitarChord): GuitarShape[] {
  const tones = new Set(chord.info.notes.map((n) => n.pc));
  if (chord.info.extraBass) tones.add(chord.info.extraBass.pc);
  const seen = new Map<string, GuitarShape>();
  for (let lo = 1; lo <= GUITAR_MAX_FRET; lo++) {
    const hi = Math.min(lo + 3, GUITAR_MAX_FRET);
    const options = GUITAR_OPEN.map((open) => {
      const opts: number[] = tones.has(mod12(open)) ? [0] : [];
      for (let f = lo; f <= hi; f++) if (tones.has(mod12(open + f))) opts.push(f);
      return opts;
    });
    for (let top = 0; top < GUITAR_OPEN.length; top++) {
      for (let bottom = top + 3; bottom < GUITAR_OPEN.length; bottom++) {
        const frets: (number | null)[] = GUITAR_OPEN.map(() => null);
        const walk = (row: number) => {
          if (row > bottom) {
            if (isPlayable(GUITAR, chord.info, frets)) {
              const shape = shapeOf(frets);
              if (!seen.has(shape.tab)) seen.set(shape.tab, shape);
            }
            return;
          }
          for (const f of options[row]!) {
            frets[row] = f;
            walk(row + 1);
          }
          frets[row] = null;
        };
        walk(top);
      }
    }
  }
  return [...seen.values()];
}

/** Open: at least one open string, nothing fretted above fret 4. */
const isOpen = (s: GuitarShape) => s.frets.includes(0) && s.anchor + s.span <= 4;

/** Barre: the E or A shape. No open strings; the barre starts on the bass string, which is low E or A. */
function isBarre(s: GuitarShape): boolean {
  const low = lowestRow(s);
  return s.barre !== null && !s.frets.includes(0) && (low === LOW_E || low === A_STRING) && s.barre.to === low;
}

/** Root on low E or A, the 5th and the octave above it. Needs a perfect 5th and no slash bass. */
function powerShapes(t: ChordTones): GuitarShape[] {
  if (t.fifth !== 7 || t.bassPc !== t.rootPc) return [];
  const out: GuitarShape[] = [];
  for (const row of [LOW_E, A_STRING]) {
    for (let f = mod12(t.rootPc - GUITAR_OPEN[row]!); f + 2 <= GUITAR_MAX_FRET; f += 12) {
      const frets: (number | null)[] = GUITAR_OPEN.map(() => null);
      frets[row] = f;
      frets[row - 1] = f + 2;
      frets[row - 2] = f + 2;
      out.push(shapeOf(frets));
    }
  }
  return out;
}

/**
 * Root, third and fifth, one each, on three adjacent strings of the top four
 * (e-B-G or B-G-D), any inversion, all within 4 frets. A slash chord keeps its
 * bass lowest, so it needs a slash note that is one of the three.
 */
function triadShapes(t: ChordTones): GuitarShape[] {
  const pcs = [t.rootPc, mod12(t.rootPc + t.third), mod12(t.rootPc + t.fifth)];
  if (!pcs.includes(t.bassPc)) return [];
  const slash = t.bassPc !== t.rootPc;
  const out: GuitarShape[] = [];
  const fretsFor = (row: number) => {
    const fs: number[] = [];
    for (let f = 0; f <= GUITAR_MAX_FRET; f++) if (pcs.includes(mod12(GUITAR_OPEN[row]! + f))) fs.push(f);
    return fs;
  };
  for (const top of [0, 1]) {
    const [r0, r1, r2] = [top, top + 1, top + 2];
    for (const f0 of fretsFor(r0)) {
      for (const f1 of fretsFor(r1)) {
        for (const f2 of fretsFor(r2)) {
          const played = [f0 + GUITAR_OPEN[r0]!, f1 + GUITAR_OPEN[r1]!, f2 + GUITAR_OPEN[r2]!].map(mod12);
          if (new Set(played).size !== 3) continue;
          if (Math.max(f0, f1, f2) - Math.min(f0, f1, f2) > 3) continue;
          if (slash && played[2] !== t.bassPc) continue;
          const frets: (number | null)[] = GUITAR_OPEN.map(() => null);
          frets[r0] = f0;
          frets[r1] = f1;
          frets[r2] = f2;
          out.push(shapeOf(frets));
        }
      }
    }
  }
  return out;
}

const byPlace = (a: GuitarShape, b: GuitarShape) => a.anchor - b.anchor || (a.tab < b.tab ? -1 : a.tab > b.tab ? 1 : 0);

const memo = new Map<string, GuitarShape[]>();

/** Every shape `style` allows for the chord, lowest on the neck first. Deterministic. */
export function shapesFor(style: GuitarStyle, chord: GuitarChord): GuitarShape[] {
  const t = chord.tones;
  const id = `${style}|${t.rootPc}|${t.bassPc}|${t.quality}`;
  const hit = memo.get(id);
  if (hit) return hit;
  const shapes =
    style === 'power'
      ? powerShapes(t)
      : style === 'triad'
        ? triadShapes(t)
        : playableShapes(chord).filter(style === 'open' ? isOpen : isBarre);
  shapes.sort(byPlace);
  memo.set(id, shapes);
  return shapes;
}

const DEGREE = ['R', '♭2', '2', '♭3', '3', '4', '♭5', '5', '♯5', '6', '♭7', '7'];

/** The chord degree each sounding string plays (R, ♭3, 5…), null for a muted string. */
export function degreesOf(shape: GuitarShape, t: ChordTones): (string | null)[] {
  return shape.frets.map((f, row) => {
    if (f === null) return null;
    const semis = mod12(GUITAR_OPEN[row]! + f - t.rootPc);
    return t.seventh === 9 && semis === 9 ? '𝄫7' : DEGREE[semis]!;
  });
}
