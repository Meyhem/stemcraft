// frontend/src/music/fingering.test.ts
import { describe, expect, it } from 'vitest';

import type { PlayAlongPattern } from '../api/client';
import { HIGHEST, LOWEST, MAX_FRET, placeBars, positionsOf, type PlacedBar } from './fingering';
import { approachPitch, planBar, type ResolvedKey } from './patterns';

const G_MAJOR: ResolvedKey = { tonicPc: 7, mode: 'major' };

function place(labels: string[], pattern: Partial<PlayAlongPattern> = {}, wrapTo: number | null = null): PlacedBar[] {
  const full: PlayAlongPattern = { notes: 'triad_chord', rhythm: 'quarter', approach: 'none', ...pattern };
  const nextOf = (bar: number) => (bar === labels.length - 1 ? wrapTo : bar + 1);
  const plans = labels.map((label, bar) => {
    const next = nextOf(bar);
    return planBar({ bar, label, nextLabel: next === null ? null : labels[next]!, key: G_MAJOR, pattern: full, beatsPerBar: 4, transpose: 0 });
  });
  return placeBars(plans, { approach: full.approach, key: G_MAJOR, nextOf });
}

describe('positionsOf', () => {
  it('lists every string and fret that sounds a pitch, low string first', () => {
    // G2 (43): past fret 12 on E (43 - 28 = 15), so not listed there.
    expect(positionsOf(43)).toEqual([
      { string: 1, fret: 10 },
      { string: 2, fret: 5 },
      { string: 3, fret: 0 },
    ]);
    expect(positionsOf(27)).toEqual([]);
  });
});

describe('placeBars', () => {
  it('places every note of a bar on the neck, in one hand position', () => {
    const [bar] = place(['G']);
    expect(bar!.notes.map((n) => n.name)).toEqual(['G', 'B', 'D', 'B']);
    expect(bar!.bassMidi! % 12).toBe(7);
    for (const note of bar!.notes) {
      expect(note.position.fret).toBeGreaterThanOrEqual(0);
      expect(note.position.fret).toBeLessThanOrEqual(MAX_FRET);
      expect(note.midi).toBeGreaterThanOrEqual(LOWEST);
      expect(note.midi).toBeLessThanOrEqual(HIGHEST);
    }
    const fretted = bar!.notes.map((n) => n.position.fret).filter((f) => f > 0);
    expect(Math.max(...fretted) - Math.min(...fretted)).toBeLessThanOrEqual(4);
  });

  it('is deterministic', () => {
    expect(place(['G', 'C', 'D', 'G'])).toEqual(place(['G', 'C', 'D', 'G']));
  });

  it('stays in position across a I-IV-V-I', () => {
    const bars = place(['G', 'C', 'D', 'G']);
    for (let i = 1; i < bars.length; i++) {
      expect(Math.abs(bars[i]!.anchor! - bars[i - 1]!.anchor!)).toBeLessThanOrEqual(2);
    }
  });

  it('places a chromatic approach a semitone from the next bar\'s chosen bass note', () => {
    const [g, c] = place(['G', 'C'], { approach: 'chromatic' });
    const last = g!.notes[3]!;
    expect(last.approach).toBe(true);
    expect(last.midi).toBe(approachPitch('chromatic', c!.bassMidi!, G_MAJOR, LOWEST));
  });

  it("approaches the loop start from a loop's last bar", () => {
    const bars = place(['G', 'C', 'D'], { approach: 'chromatic' }, 0);
    const last = bars[2]!.notes[3]!;
    expect(last.midi).toBe(approachPitch('chromatic', bars[0]!.bassMidi!, G_MAJOR, LOWEST));
  });

  it('leaves a no-chord bar empty and starts fresh after it', () => {
    const bars = place(['G', 'N', 'C']);
    expect(bars[1]).toMatchObject({ bassMidi: null, anchor: null, notes: [] });
    expect(bars[2]!.notes).toHaveLength(4);
  });

  it('fails loudly when a plan asks for an approach to a bar that has no notes', () => {
    const plan = planBar({ bar: 0, label: 'G', nextLabel: 'C', key: G_MAJOR, pattern: { notes: 'root', rhythm: 'quarter', approach: 'chromatic' }, beatsPerBar: 4, transpose: 0 });
    expect(() => placeBars([plan], { approach: 'chromatic', key: G_MAJOR, nextOf: () => null })).toThrow(/approach/);
  });
});
