import { describe, expect, it } from 'vitest';

import type { PlayAlongPattern } from '../api/client';
import {
  approachPitch,
  keyName,
  planBar,
  resolveKey,
  slotBeats,
  spell,
  type BarPlan,
  type ResolvedKey,
} from './patterns';

const G_MAJOR: ResolvedKey = { tonicPc: 7, mode: 'major' };
const TRIAD: PlayAlongPattern = { notes: 'triad_chord', rhythm: 'quarter', approach: 'none' };

function plan(label: string, pattern: Partial<PlayAlongPattern> = {}, extra: Partial<Parameters<typeof planBar>[0]> = {}): BarPlan {
  return planBar({
    bar: 0,
    label,
    nextLabel: 'C',
    key: G_MAJOR,
    pattern: { ...TRIAD, ...pattern },
    beatsPerBar: 4,
    transpose: 0,
    ...extra,
  });
}

const semis = (p: BarPlan) => p.slots.map((s) => (s.tone.kind === 'tone' ? s.tone.semis : 'approach'));
const beats = (p: BarPlan) => p.slots.map((s) => [s.beat, s.beats]);

describe('resolveKey', () => {
  it('uses the chosen key, else the top candidate, transposed', () => {
    expect(resolveKey({ tonic: 'D', mode: 'major' }, [], 0)).toEqual({ tonicPc: 2, mode: 'major' });
    expect(resolveKey(null, [{ tonic: 'G', mode: 'major', confidence: 0.4 }], -2)).toEqual({ tonicPc: 5, mode: 'major' });
    expect(resolveKey(null, [], 0)).toBeNull();
  });
});

describe('spell', () => {
  it('spells in the key with real sharp and flat glyphs', () => {
    expect(spell(6, G_MAJOR)).toBe('F♯');
    expect(spell(10, { tonicPc: 5, mode: 'major' })).toBe('B♭');
    expect(keyName(G_MAJOR)).toBe('G major');
  });
});

describe('slotBeats', () => {
  it('lays out whole, half, quarter and eighth slots in 4/4 and 3/4', () => {
    expect(slotBeats('whole', 4)).toEqual([0]);
    expect(slotBeats('half', 4)).toEqual([0, 2]);
    expect(slotBeats('half', 3)).toEqual([0, 2]);
    expect(slotBeats('quarter', 3)).toEqual([0, 1, 2]);
    expect(slotBeats('eighth', 4)).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]);
  });
});

describe('planBar', () => {
  it('cycles a 1-3-5-3 chord triad over quarter notes', () => {
    const p = plan('G');
    expect(semis(p)).toEqual([0, 4, 7, 4]);
    expect(beats(p)).toEqual([[0, 1], [1, 1], [2, 1], [3, 1]]);
    expect(p.bassPc).toBe(7);
    expect(p.substitution).toBeNull();
    expect(semis(plan('E:min'))).toEqual([0, 3, 7, 3]);
  });

  it('fits the cycle to the bar: 3/4 plays 1-3-5, the last half note lasts one beat', () => {
    expect(semis(plan('G', {}, { beatsPerBar: 3 }))).toEqual([0, 4, 7]);
    expect(beats(plan('G', { rhythm: 'half' }, { beatsPerBar: 3 }))).toEqual([[0, 2], [2, 1]]);
  });

  it('builds the foundation patterns', () => {
    expect(semis(plan('G', { notes: 'root', rhythm: 'eighth' }))).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(semis(plan('G', { notes: 'root_fifth' }))).toEqual([0, 7, 0, 7]);
    expect(semis(plan('G', { notes: 'root_fifth_octave' }))).toEqual([0, 7, 12, 7]);
    expect(semis(plan('G', { notes: 'octave_pump' }))).toEqual([0, 12, 0, 12]);
    expect(semis(plan('G', { rhythm: 'whole' }))).toEqual([0]);
  });

  it('takes a diatonic triad from the key, and says so when the root is borrowed', () => {
    // A in G major is A minor: A C E.
    expect(semis(plan('A', { notes: 'triad_diatonic' }))).toEqual([0, 3, 7, 3]);
    const borrowed = plan('A#', { notes: 'triad_diatonic' });
    expect(semis(borrowed)).toEqual([0, 4, 7, 4]);
    expect(borrowed.substitution).toBe('A♯ not in G major: chord triad');
  });

  it("uses the chord's 7th, else the key's, else falls back to the triad, visibly", () => {
    expect(semis(plan('G:7', { notes: 'seventh' }))).toEqual([0, 4, 7, 10]);
    const diatonic = plan('G', { notes: 'seventh' });
    expect(semis(diatonic)).toEqual([0, 4, 7, 11]);
    expect(diatonic.substitution).toBe("no 7th in the chord: G major's diatonic 7th");
    const borrowed = plan('A#', { notes: 'seventh' });
    expect(semis(borrowed)).toEqual([0, 4, 7, 4]);
    expect(borrowed.substitution).toBe('A♯ not in G major: chord triad');
  });

  it('replaces the last slot with an approach only when the next bar is a chord', () => {
    expect(semis(plan('G', { approach: 'chromatic' }))).toEqual([0, 4, 7, 'approach']);
    expect(semis(plan('G', { approach: 'chromatic' }, { nextLabel: 'N' }))).toEqual([0, 4, 7, 4]);
    expect(semis(plan('G', { approach: 'chromatic' }, { nextLabel: null }))).toEqual([0, 4, 7, 4]);
    expect(semis(plan('G', { approach: 'chromatic', rhythm: 'whole' }))).toEqual([0]);
  });

  it('renders N, X and an unreadable label as labelled empty bars (N-08)', () => {
    expect(plan('N')).toMatchObject({ empty: 'no_chord', slots: [], bassPc: null });
    expect(plan('X')).toMatchObject({ empty: 'unclassified', slots: [] });
    const bad = plan('G:weird');
    expect(bad.empty).toBe('unparsed');
    expect(bad.reason).toContain('weird');
  });

  it('transposes, and plays a slash note in the bass', () => {
    expect(plan('G', {}, { transpose: -2 }).bassPc).toBe(5);
    const slash = plan('C:maj/3');
    expect(slash.bassPc).toBe(4);
    // Intervals sit above the bass note E: the 3rd is E itself, the 5th G is 3 above.
    expect(semis(slash)).toEqual([0, 0, 3, 0]);
  });
});

describe('approachPitch', () => {
  it('leads in from below, or from above when below would leave the neck', () => {
    expect(approachPitch('chromatic', 45, G_MAJOR, 28)).toBe(44);
    expect(approachPitch('chromatic', 28, G_MAJOR, 28)).toBe(29);
    expect(approachPitch('fifth', 45, G_MAJOR, 28)).toBe(38);
    expect(approachPitch('fifth', 30, G_MAJOR, 28)).toBe(35);
    // Scale step: the nearest G-major note below C3 (48) is B2 (47); below G2 (43) is F♯2 (42).
    expect(approachPitch('scale', 48, G_MAJOR, 28)).toBe(47);
    expect(approachPitch('scale', 43, G_MAJOR, 28)).toBe(42);
  });
});
