// Groove over chords (D-22): a chosen progression in a key, played with Play
// along's own generators. Bass: planBar + placeBars (D-18), with the approach
// only before a real chord change. planBar alone puts one before every bar
// followed by a chord, which is right for a song's chart but not for 2 or 4 bars
// of one chord, so nextLabel is null where the next bar is the same chord.
// Guitar: D-20's guitarBars, plus a backing bass on the roots.
import type { InstrumentSettings } from '../../api/client';
import { mod12, parseChord } from '../chordTones';
import { positionsOf, placeBars, type PlacedBar } from '../fingering';
import { guitarBars, guitarEmptyText } from '../guitarSource';
import { GUITAR_OPEN } from '../guitarShapes';
import { planBar, spell, type ResolvedKey } from '../patterns';
import { pretty } from '../spell';
import { scaleSemitones } from '../theory';
import { progressionBars, type ChordBar } from './chords';
import { lowestMidiOf } from './neck';
import { rng } from './random';
import { BEATS_PER_BAR, loopOf, type GenerateResult, type PracticeBar, type PracticeNote, type SynthNote } from './types';

function chordRow(bars: readonly ChordBar[], notes: (string | null)[] = []): PracticeBar[] {
  return bars.map((b, i) => ({ label: pretty(b.symbol), repeat: b.repeat, note: notes[i] ?? null }));
}

/**
 * Regenerate's choice in a groove: each approach note comes from below (as
 * placeBars wrote it) or from above, a coin per approach from the seed. The
 * coin is drawn for every approach, so one choice never shifts the others.
 */
function varyApproaches(
  bars: PlacedBar[],
  key: ResolvedKey,
  kind: 'chromatic' | 'scale' | 'fifth',
  random: () => number,
  nextOf: (bar: number) => number,
): PlacedBar[] {
  const inScale = new Set(scaleSemitones(key.mode, false).map((s) => mod12(key.tonicPc + s)));
  return bars.map((bar, i) => ({
    ...bar,
    notes: bar.notes.map((note) => {
      if (!note.approach) return note;
      const fromAbove = random() < 0.5;
      const target = bars[nextOf(i)]!.bassMidi;
      if (!fromAbove || target === null) return note;
      let midi = kind === 'chromatic' ? target + 1 : kind === 'fifth' ? target + 7 : target + 1;
      if (kind === 'scale') while (!inScale.has(mod12(midi))) midi++;
      const candidates = positionsOf(midi);
      if (candidates.length === 0) return note;
      const anchor = bar.anchor ?? note.position.fret;
      const position = candidates.reduce((a, b) => (Math.abs(b.fret - anchor) < Math.abs(a.fret - anchor) ? b : a));
      return { ...note, midi, name: spell(mod12(midi), key), position };
    }),
  }));
}

export function bassGroove(settings: InstrumentSettings): GenerateResult {
  const g = settings.groove;
  const { bars, mode } = progressionBars(g.progression, settings.key, g.bars_per_chord);
  const key: ResolvedKey = { tonicPc: settings.key, mode };
  const n = bars.length;
  const nextOf = (bar: number) => (bar + 1) % n;
  const pattern = { notes: g.notes, rhythm: g.rhythm, approach: g.approach };
  const plans = bars.map((b, i) =>
    planBar({
      bar: i,
      label: b.label,
      nextLabel: b.changes ? bars[nextOf(i)]!.label : null,
      key,
      pattern,
      beatsPerBar: BEATS_PER_BAR,
      transpose: 0,
    }),
  );
  let placed: PlacedBar[];
  try {
    placed = placeBars(plans, { approach: g.approach, key, nextOf });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error), fixes: [] };
  }
  if (g.approach !== 'none') placed = varyApproaches(placed, key, g.approach, rng(settings.seed), nextOf);

  let group = 0;
  const notes: PracticeNote[] = placed.flatMap((bar, i) =>
    bar.notes.map((note) => ({
      start: i * BEATS_PER_BAR + note.beat,
      dur: note.beats,
      string: note.position.string,
      fret: note.position.fret,
      midi: note.midi,
      name: note.name,
      kind: note.approach ? ('approach' as const) : ('tone' as const),
      group: group++,
      finger: null,
      stroke: null,
    })),
  );
  return { ok: true, loop: loopOf('bass', chordRow(bars, plans.map((p) => p.substitution)), notes) };
}

export function guitarGroove(settings: InstrumentSettings): GenerateResult {
  const g = settings.groove;
  const { bars, mode } = progressionBars(g.progression, settings.key, g.bars_per_chord);
  const key: ResolvedKey = { tonicPc: settings.key, mode };
  const n = bars.length;
  const nextOf = (bar: number) => (bar + 1) % n;
  const shaped = guitarBars(
    bars.map((b) => b.label),
    key,
    { style: g.style, strum: g.strum, position: g.position, simplify: false },
    BEATS_PER_BAR,
    0,
    nextOf,
  );
  const empty = shaped.find((b) => b.shape === null);
  if (empty) {
    return {
      ok: false,
      error: `Bar ${empty.bar + 1}: ${guitarEmptyText(empty)}.`,
      fixes:
        g.style === 'barre'
          ? []
          : [{ label: 'Use barre shapes', apply: (s) => ({ ...s, groove: { ...s.groove, style: 'barre' } }) }],
    };
  }

  let group = 0;
  const notes: PracticeNote[] = [];
  shaped.forEach((bar, i) => {
    bar.strokes.forEach((stroke, k) => {
      const end = bar.strokes[k + 1]?.beat ?? BEATS_PER_BAR;
      const source = stroke.early ? shaped[nextOf(i)]! : bar;
      source.shape!.frets.forEach((fret, row) => {
        if (fret === null) return;
        const midi = GUITAR_OPEN[row]! + fret;
        notes.push({
          start: i * BEATS_PER_BAR + stroke.beat,
          dur: end - stroke.beat,
          string: 5 - row,
          fret,
          midi,
          name: spell(mod12(midi), key),
          kind: 'tone',
          group,
          finger: null,
          stroke: stroke.dir,
        });
      });
      group++;
    });
  });

  const backing: SynthNote[] = bars.flatMap((b, i) => {
    const parsed = parseChord(b.label, 0);
    if (parsed.kind !== 'chord') return [];
    const root = lowestMidiOf(parsed.tones.bassPc, 'bass');
    return [root, root + 7, root, root + 7].map((midi, beat) => ({ start: i * BEATS_PER_BAR + beat, dur: 1, midi }));
  });

  const row = chordRow(bars, shaped.map((b) => (b.substitutions.length > 0 ? b.substitutions.join('; ') : null)));
  return { ok: true, loop: loopOf('guitar', row, notes, { guitarBars: shaped, backing }) };
}
