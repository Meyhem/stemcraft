// Arpeggios (D-22): each chord's tones (triad or 7th) walked by a path from its
// lowest root, cycling to fill the chord's bars at the rhythm's step. The hand
// is carried from chord to chord (placeLine's anchor), so a progression moves
// the hand as little as it can.
import type { InstrumentSettings, PracticeArpeggio, PracticeInstrument } from '../../api/client';
import { mod12, parseChord } from '../chordTones';
import { spell, type ResolvedKey } from '../patterns';
import { pretty, rootName, type KeyMode } from '../spell';
import { progressionBars, toBtcLabel, type ChordBar } from './chords';
import { lowestMidiOf, placeLine, TUNINGS } from './neck';
import { BEATS_PER_BAR, loopOf, RHYTHM_STEP, type GenerateResult, type PracticeNote } from './types';

const SUFFIX: Record<PracticeArpeggio['quality'], string> = {
  maj: '',
  min: 'm',
  '7': '7',
  maj7: 'maj7',
  min7: 'm7',
  dim: 'dim',
  hdim7: 'm7b5',
};
const MINOR_QUALITIES = new Set<PracticeArpeggio['quality']>(['min', 'min7', 'dim', 'hdim7']);

/** Semitones above the root, in playing order. `tones` excludes the octave. */
export function arpeggioPath(tones: readonly number[], path: PracticeArpeggio['path']): number[] {
  const up = [...tones];
  switch (path) {
    case 'up':
      return up;
    case 'down':
      return [...up].reverse();
    case 'up_down':
      return [...up, ...[...up].reverse().slice(1, -1)];
    case 'inversions':
      // Each inversion of the chord, ascending: R35, 358, 5 8 10 for a triad.
      return tones.flatMap((_, r) => tones.map((_, i) => tones[(r + i) % tones.length]! + (r + i >= tones.length ? 12 : 0)));
  }
}

export function arpeggioLine(settings: InstrumentSettings, inst: PracticeInstrument): GenerateResult {
  const a = settings.arpeggio;
  let chordBars: ChordBar[];
  let mode: KeyMode;
  if (a.over === 'progression') {
    ({ bars: chordBars, mode } = progressionBars(a.progression, settings.key, a.bars_per_chord));
  } else {
    mode = MINOR_QUALITIES.has(a.quality) ? 'minor' : 'major';
    const symbol = `${rootName(settings.key, mode)}${SUFFIX[a.quality]}`;
    chordBars = Array.from({ length: a.bars_per_chord }, (_, i) => ({
      symbol,
      label: toBtcLabel(symbol),
      repeat: i > 0,
      changes: false,
    }));
  }
  const key: ResolvedKey = { tonicPc: settings.key, mode };
  const step = RHYTHM_STEP[a.rhythm];
  const perBar = Math.round(BEATS_PER_BAR / step);

  const notes: PracticeNote[] = [];
  const barNotes: (string | null)[] = chordBars.map(() => null);
  let anchor: number | null = null;
  let group = 0;
  let start = 0;
  while (start < chordBars.length) {
    let end = start + 1;
    while (end < chordBars.length && chordBars[end]!.repeat) end++;
    const bar = chordBars[start]!;
    const parsed = parseChord(bar.label, 0);
    if (parsed.kind !== 'chord') return { ok: false, error: `Can't read chord ${bar.symbol}.`, fixes: [] };
    const t = parsed.tones;
    let tones = [0, t.third, t.fifth];
    if (a.tones === 'seventh') {
      if (t.seventh === null) {
        tones = [0, t.third, t.fifth, 12];
        barNotes[start] = `${pretty(bar.symbol)} has no 7th: root, 3rd, 5th, octave`;
      } else {
        tones = [0, t.third, t.fifth, t.seventh];
      }
    } else if (a.path !== 'inversions') {
      tones = [0, t.third, t.fifth, 12];
    }
    const path = arpeggioPath(tones, a.path);
    const root = lowestMidiOf(t.rootPc, inst);
    const count = (end - start) * perBar;
    const midis = Array.from({ length: count }, (_, i) => root + path[i % path.length]!);
    const placed = placeLine(midis, inst, anchor ?? root - TUNINGS[inst][0]!);
    if (!placed.ok) {
      return { ok: false, error: `The ${pretty(bar.symbol)} arpeggio runs off the neck at MIDI ${placed.midi}.`, fixes: [] };
    }
    anchor = placed.anchor;
    midis.forEach((midi, i) => {
      notes.push({
        start: start * BEATS_PER_BAR + i * step,
        dur: step,
        string: placed.frets[i]!.string,
        fret: placed.frets[i]!.fret,
        midi,
        name: spell(mod12(midi), key),
        kind: 'tone',
        group: group++,
        finger: null,
        stroke: null,
      });
    });
    start = end;
  }
  const bars = chordBars.map((b, i) => ({ label: pretty(b.symbol), repeat: b.repeat, note: barNotes[i] ?? null }));
  return { ok: true, loop: loopOf(inst, bars, notes) };
}
