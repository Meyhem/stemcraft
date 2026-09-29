// Instruments and tunings for the Theory tab (D-19). A tuning is scientific
// pitch low string to high ("E1 A1 D2 G2"), the same order theory.json stores.
// Play along keeps its own fixed EADG (D-18); this module does not touch it.
import { Note } from 'tonal';

import type { TheoryInstrument } from '../api/client';

/** theory.json's instrument: kind, string count, tuning low string first, left-handed. */
export type Instrument = TheoryInstrument;
export type InstrumentKind = Instrument['kind'];

export interface TuningPreset {
  id: string;
  label: string;
  kind: InstrumentKind;
  notes: string[];
}

export const PRESETS: readonly TuningPreset[] = [
  { id: 'bass4-standard', label: 'Standard', kind: 'bass', notes: ['E1', 'A1', 'D2', 'G2'] },
  { id: 'bass4-drop-d', label: 'Drop D', kind: 'bass', notes: ['D1', 'A1', 'D2', 'G2'] },
  { id: 'bass4-half-down', label: 'Half-step down', kind: 'bass', notes: ['Eb1', 'Ab1', 'Db2', 'Gb2'] },
  { id: 'bass4-d-standard', label: 'D standard', kind: 'bass', notes: ['D1', 'G1', 'C2', 'F2'] },
  { id: 'bass5-standard', label: 'Standard', kind: 'bass', notes: ['B0', 'E1', 'A1', 'D2', 'G2'] },
  { id: 'guitar-standard', label: 'Standard', kind: 'guitar', notes: ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'] },
  { id: 'guitar-drop-d', label: 'Drop D', kind: 'guitar', notes: ['D2', 'A2', 'D3', 'G3', 'B3', 'E4'] },
  { id: 'guitar-half-down', label: 'Half-step down', kind: 'guitar', notes: ['Eb2', 'Ab2', 'Db3', 'Gb3', 'Bb3', 'Eb4'] },
  { id: 'guitar-d-standard', label: 'D standard', kind: 'guitar', notes: ['D2', 'G2', 'C3', 'F3', 'A3', 'D4'] },
  { id: 'guitar-dadgad', label: 'DADGAD', kind: 'guitar', notes: ['D2', 'A2', 'D3', 'G3', 'A3', 'D4'] },
  { id: 'guitar-open-g', label: 'Open G', kind: 'guitar', notes: ['D2', 'G2', 'D3', 'G3', 'B3', 'D4'] },
  { id: 'guitar-open-d', label: 'Open D', kind: 'guitar', notes: ['D2', 'A2', 'D3', 'F#3', 'A3', 'D4'] },
];

/** The three instruments the footer offers. 7-string guitar and 6-string bass are not offered (spec non-goal). */
export const INSTRUMENT_CHOICES = [
  { id: 'bass4', label: 'Bass · 4 string', kind: 'bass', strings: 4, preset: 'bass4-standard' },
  { id: 'bass5', label: 'Bass · 5 string', kind: 'bass', strings: 5, preset: 'bass5-standard' },
  { id: 'guitar6', label: 'Guitar · 6 string', kind: 'guitar', strings: 6, preset: 'guitar-standard' },
] as const;

export type InstrumentChoiceId = (typeof INSTRUMENT_CHOICES)[number]['id'];

export const DEFAULT_INSTRUMENT: Instrument = {
  kind: 'bass',
  strings: 4,
  tuning: ['E1', 'A1', 'D2', 'G2'],
  left_handed: false,
};

export function choiceOf(inst: Instrument): InstrumentChoiceId {
  return inst.kind === 'guitar' ? 'guitar6' : inst.strings === 5 ? 'bass5' : 'bass4';
}

export function instrumentFor(id: InstrumentChoiceId, leftHanded: boolean): Instrument {
  const choice = INSTRUMENT_CHOICES.find((c) => c.id === id)!;
  const preset = PRESETS.find((p) => p.id === choice.preset)!;
  return { kind: choice.kind, strings: choice.strings, tuning: [...preset.notes], left_handed: leftHanded };
}

/** Presets that fit this instrument's kind and string count. */
export function presetsFor(inst: Instrument): TuningPreset[] {
  return PRESETS.filter((p) => p.kind === inst.kind && p.notes.length === inst.strings);
}

export function presetOf(inst: Instrument): TuningPreset | null {
  return presetsFor(inst).find((p) => p.notes.join(' ') === inst.tuning.join(' ')) ?? null;
}

/** MIDI note of each open string, low string first. */
export function openMidi(inst: Instrument): number[] {
  return inst.tuning.map((n) => Note.midi(n)!);
}

/** "E A D G" for the footer: pitch classes low to high, no octaves. */
export function tuningLabel(inst: Instrument): string {
  return inst.tuning.map((n) => Note.pitchClass(n)).join(' ');
}

// The pitches theory.json accepts (stemcraft_lib.theory._PITCH): tonal alone would let "E###1" through to a 422.
const PITCH = /^[A-G](#{1,2}|b{1,2})?-?\d$/;

/**
 * A typed custom tuning, "D1 A1 D2 G2", low string first. Refused unless it has
 * one valid scientific pitch per string, each higher than the one before.
 */
export function parseTuning(
  text: string,
  strings: number,
): { ok: true; notes: string[] } | { ok: false; reason: string } {
  const notes = text.trim().split(/\s+/).filter(Boolean);
  if (notes.length !== strings) {
    const example = strings === 6 ? 'E2 A2 D3 G3 B3 E4' : strings === 5 ? 'B0 E1 A1 D2 G2' : 'E1 A1 D2 G2';
    return { ok: false, reason: `Need ${strings} notes, low string first, e.g. "${example}"` };
  }
  const midis = notes.map((n) => Note.midi(n.charAt(0).toUpperCase() + n.slice(1)));
  const bad = notes.find((_, i) => midis[i] == null || !PITCH.test(notes[i]!.charAt(0).toUpperCase() + notes[i]!.slice(1)));
  if (bad !== undefined) return { ok: false, reason: `"${bad}" is not a note with an octave, like E1 or F#2` };
  for (let i = 1; i < midis.length; i++) {
    if (midis[i]! <= midis[i - 1]!) return { ok: false, reason: 'Each string must be higher than the one before it' };
  }
  return { ok: true, notes: notes.map((n) => n.charAt(0).toUpperCase() + n.slice(1)) };
}

/** How many frets the whole-neck tools draw: 0–15 on bass, 0–17 on guitar. */
export function neckFrets(inst: Instrument): number {
  return inst.kind === 'bass' ? 15 : 17;
}
