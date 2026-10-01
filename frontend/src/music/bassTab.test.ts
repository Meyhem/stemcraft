import { describe, expect, it } from 'vitest';

import type { TranscribedNote } from '../api/client';
import { sampleIndex } from '../engine/types';
import { noteAt, placeTranscription, tabBars, tabCounts, UNSURE_BELOW } from './bassTab';
import type { Grid } from './grid';

const n = (start: number, midi: number, confidence = 0.9, len = 4800): TranscribedNote => ({
  start, end: start + len, midi, cents: 0, confidence,
});

describe('placeTranscription', () => {
  it('transposes to what is heard and names the note', () => {
    const [a] = placeTranscription([n(0, 31)], -2);
    expect(a!.midi).toBe(29);
    expect(a!.name).toBe('F');
    expect(a!.octave).toBe(0);
  });

  it('raises a note below the open E by octaves and says so', () => {
    const [a] = placeTranscription([n(0, 28)], -2); // E1 down a tone = D1, off the neck
    expect(a!.midi).toBe(38);
    expect(a!.octave).toBe(1);
  });

  it('lowers a note above the 12th fret of G by octaves', () => {
    const [a] = placeTranscription([n(0, 60)], 0);
    expect(a!.midi).toBe(48);
    expect(a!.octave).toBe(-1);
  });

  it('marks low confidence as unsure', () => {
    const [a, b] = placeTranscription([n(0, 31, UNSURE_BELOW - 0.01), n(9600, 31, UNSURE_BELOW)], 0);
    expect([a!.unsure, b!.unsure]).toEqual([true, false]);
  });

  it('keeps the hand still: a run in one position stays there', () => {
    const notes = placeTranscription([n(0, 31), n(4800, 33), n(9600, 35), n(14400, 36)], 0);
    const fretted = notes.map((x) => x.position.fret).filter((f) => f > 0);
    expect(Math.max(...fretted) - Math.min(...fretted)).toBeLessThanOrEqual(3);
  });

  it('puts every note where it sounds', () => {
    const open = [28, 33, 38, 43];
    const notes = placeTranscription([n(0, 40), n(4800, 45), n(9600, 43), n(14400, 38)], 0);
    for (const x of notes) expect(open[x.position.string]! + x.position.fret).toBe(x.midi);
  });

  it('is deterministic', () => {
    const line = [n(0, 40), n(4800, 45), n(9600, 43), n(14400, 38)];
    expect(placeTranscription(line, 0)).toEqual(placeTranscription(line, 0));
  });
});

const grid: Grid = {
  bars: [0, 96000, 192000].map(sampleIndex),
  beats: [],
  beatsPerBar: 4,
  bpm: 120,
  barCount: 3,
  medianBarSamples: 96000,
};

describe('tabBars and noteAt', () => {
  it('groups notes by the bar their onset is in', () => {
    const notes = placeTranscription([n(0, 31), n(50000, 33), n(100000, 36)], 0);
    expect(tabBars(notes, grid).map((b) => b.notes.length)).toEqual([2, 1, 0]);
  });

  it('finds the sounding note, or -1 between notes', () => {
    const notes = placeTranscription([n(0, 31), n(9600, 33)], 0);
    expect(noteAt(notes, 100)).toBe(0);
    expect(noteAt(notes, 5000)).toBe(-1);
    expect(noteAt(notes, 9700)).toBe(1);
  });

  it('counts unsure and shifted notes', () => {
    const notes = placeTranscription([n(0, 28, 0.5), n(9600, 33)], -2);
    expect(tabCounts(notes)).toEqual({ total: 2, unsure: 1, shifted: 1 });
  });
});
