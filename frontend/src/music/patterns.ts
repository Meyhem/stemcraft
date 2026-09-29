// Bar plans for the Play along screen (D-18): which interval to play on which
// beat, generated from the bar's chord and the user's pattern. No pitches or
// frets here; fingering.ts picks the octave and the position. Keeping the two
// apart is what lets the fingering search the whole song at once while this
// stays a per-bar function.
//
// Every fallback is reported in `substitution` and drawn on screen, so a
// pattern that could not apply is never silently swapped for another (N-08).
import type {
  KeyCandidate,
  PatternApproach,
  PatternNotes,
  PatternRhythm,
  PlayAlongKey,
  PlayAlongPattern,
} from '../api/client';
import { mod12, parseChord, type ChordTones, type Shape } from './chordTones';
import { noteName, pitchClassOf, scaleSemitones, type Mode } from './theory';

export interface ResolvedKey {
  tonicPc: number;
  mode: Mode;
}

/** The chosen key, else the top candidate, transposed to what is heard. */
export function resolveKey(
  chosen: PlayAlongKey | null,
  candidates: readonly KeyCandidate[],
  transpose: number,
): ResolvedKey | null {
  const key = chosen ?? candidates[0] ?? null;
  if (!key) return null;
  return { tonicPc: mod12(pitchClassOf(key.tonic) + transpose), mode: key.mode };
}

/** A pitch class spelled for the key, with display glyphs ("F♯", "B♭"). */
export function spell(pc: number, key: ResolvedKey): string {
  return noteName(pc, key.tonicPc, key.mode).replace('#', '♯').replace(/^([A-G])b$/, '$1♭');
}

export function keyName(key: ResolvedKey): string {
  return `${spell(key.tonicPc, key)} ${key.mode}`;
}

function scalePcs(key: ResolvedKey): number[] {
  return scaleSemitones(key.mode, false).map((s) => mod12(key.tonicPc + s));
}

/** The triad (and 7th) the key builds on `rootPc`, or null if the root is not in the key. */
function diatonicShape(rootPc: number, key: ResolvedKey): Shape | null {
  const scale = scalePcs(key);
  const i = scale.indexOf(rootPc);
  if (i < 0) return null;
  const above = (step: number) => mod12(scale[(i + step) % 7]! - rootPc);
  return { third: above(2), fifth: above(4), seventh: above(6) };
}

/** Beat offsets of each note in a bar. The pattern cycles over these. */
export function slotBeats(rhythm: PatternRhythm, beatsPerBar: number): number[] {
  const step =
    rhythm === 'whole' ? beatsPerBar : rhythm === 'half' ? 2 : rhythm === 'quarter' ? 1 : 0.5;
  const out: number[] = [];
  for (let beat = 0; beat < beatsPerBar; beat += step) out.push(beat);
  return out;
}

type Degree = 1 | 3 | 5 | 7 | 8;

const CYCLES: Record<PatternNotes, readonly Degree[]> = {
  root: [1],
  root_fifth: [1, 5],
  root_fifth_octave: [1, 5, 8, 5],
  octave_pump: [1, 8],
  triad_chord: [1, 3, 5, 3],
  triad_diatonic: [1, 3, 5, 3],
  seventh: [1, 3, 5, 7],
};
const TRIAD: readonly Degree[] = CYCLES.triad_chord;

/**
 * Semitones above the bar's bass note. For a slash chord the bass is not the
 * root, so chord tones are re-measured from it (`bassShift`) and folded into
 * the octave above.
 */
function semisOf(degree: Degree, shape: Shape, bassShift: number): number {
  if (degree === 1) return 0;
  if (degree === 8) return 12;
  const tone = degree === 3 ? shape.third : degree === 5 ? shape.fifth : shape.seventh!;
  return mod12(tone - bassShift);
}

export type SlotTone = { kind: 'tone'; semis: number } | { kind: 'approach' };

export interface Slot {
  /** Offset into the bar, in beats. */
  beat: number;
  /** Duration, in beats: until the next slot or the end of the bar. */
  beats: number;
  tone: SlotTone;
}

export type EmptyKind = 'no_chord' | 'unclassified' | 'unparsed';

export interface BarPlan {
  bar: number;
  /** The analysis's label, as written. */
  label: string;
  empty: EmptyKind | null;
  /** Why an `unparsed` label could not be read. */
  reason: string | null;
  tones: ChordTones | null;
  bassPc: number | null;
  slots: Slot[];
  /** What was drawn instead of the chosen pattern, and why. */
  substitution: string | null;
}

export interface PlanInput {
  bar: number;
  label: string;
  /** The label of the bar that follows this one (the loop start at a loop's end), or null at the end. */
  nextLabel: string | null;
  key: ResolvedKey;
  pattern: PlayAlongPattern;
  beatsPerBar: number;
  transpose: number;
}

export function planBar(input: PlanInput): BarPlan {
  const { bar, label, key, pattern, beatsPerBar, transpose } = input;
  const parsed = parseChord(label, transpose);
  if (parsed.kind !== 'chord') {
    return {
      bar,
      label,
      empty: parsed.kind,
      reason: parsed.kind === 'unparsed' ? parsed.reason : null,
      tones: null,
      bassPc: null,
      slots: [],
      substitution: null,
    };
  }

  const tones = parsed.tones;
  const root = spell(tones.rootPc, key);
  let shape: Shape = tones;
  let cycle = CYCLES[pattern.notes];
  let substitution: string | null = null;

  if (pattern.notes === 'triad_diatonic') {
    const diatonic = diatonicShape(tones.rootPc, key);
    if (diatonic) shape = diatonic;
    else substitution = `${root} not in ${keyName(key)}: chord triad`;
  } else if (pattern.notes === 'seventh' && tones.seventh === null) {
    const diatonic = diatonicShape(tones.rootPc, key);
    if (diatonic) {
      shape = { ...tones, seventh: diatonic.seventh };
      substitution = `no 7th in the chord: ${keyName(key)}'s diatonic 7th`;
    } else {
      cycle = TRIAD;
      substitution = `${root} not in ${keyName(key)}: chord triad`;
    }
  }

  const bassShift = mod12(tones.bassPc - tones.rootPc);
  const starts = slotBeats(pattern.rhythm, beatsPerBar);
  const slots: Slot[] = starts.map((beat, i) => ({
    beat,
    beats: (starts[i + 1] ?? beatsPerBar) - beat,
    tone: { kind: 'tone', semis: semisOf(cycle[i % cycle.length]!, shape, bassShift) },
  }));

  const nextIsChord =
    input.nextLabel !== null && parseChord(input.nextLabel, transpose).kind === 'chord';
  if (pattern.approach !== 'none' && nextIsChord && slots.length > 1) {
    const last = slots.length - 1;
    slots[last] = { ...slots[last]!, tone: { kind: 'approach' } };
  }

  return { bar, label, empty: null, reason: null, tones, bassPc: tones.bassPc, slots, substitution };
}

/**
 * The lead-in to `target` (a MIDI pitch): a semitone, the nearest scale note,
 * or a fifth below it. When below would fall under the lowest open string, it
 * comes from above instead (a semitone, a scale note, or a fourth).
 */
export function approachPitch(
  kind: Exclude<PatternApproach, 'none'>,
  target: number,
  key: ResolvedKey,
  lowest: number,
): number {
  const inScale = new Set(scalePcs(key));
  const scaleBelow = () => {
    let p = target - 1;
    while (!inScale.has(mod12(p))) p--;
    return p;
  };
  const scaleAbove = () => {
    let p = target + 1;
    while (!inScale.has(mod12(p))) p++;
    return p;
  };
  const down = kind === 'chromatic' ? target - 1 : kind === 'fifth' ? target - 7 : scaleBelow();
  if (down >= lowest) return down;
  return kind === 'chromatic' ? target + 1 : kind === 'fifth' ? target + 5 : scaleAbove();
}
