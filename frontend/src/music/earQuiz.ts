// Guess the note (D-23): a note is played (an A first, unless the reference is
// off), and the player names it or finds it on the neck. Targets come from the
// same focus as the Fretboard quiz, so every note is on the neck in front of
// the player; weighting, the RNG and "never twice in a row" are quiz.ts's.
// Naming is by pitch class (any octave), the neck by exact pitch.
import type { QuizAnswer } from '../api/client';
import { mod12 } from './chordTones';
import { positionAt } from './positions';
import { checkFocus, focusCells, SEMITONE_NAMES, pickItem, plainName, QuizFocusError, weakness, type FretboardFocus, type Rng } from './quiz';
import { pretty } from './spell';
import type { Instrument } from './tuning';

export type EarAnswer = 'name' | 'neck';
export type EarReference = 'a' | 'none';

export interface EarQuestion {
  /** `m<midi>`: the history item. */
  item: string;
  /** `<answer>/<reference>`: the history mode. Knowing a note after an A is not knowing it cold. */
  mode: string;
  midi: number;
  /** The A played first, or null for none. */
  reference: number | null;
}

export const earMode = (answer: EarAnswer, reference: EarReference) => `${answer}/${reference}`;

/** The A nearest the target: at most a tritone away, the lower one on a tie. */
export function referenceMidi(target: number): number {
  const above = mod12(target - 9); // semitones from the A at or below
  return above <= 6 ? target - above : target - above + 12;
}

/** "G2": the quizzes' plain name with the scientific octave. */
export function pitchLabel(midi: number): string {
  return `${pretty(plainName(mod12(midi)))}${Math.floor(midi / 12) - 1}`;
}

export function earQuestion(
  answer: EarAnswer,
  reference: EarReference,
  inst: Instrument,
  focus: FretboardFocus,
  history: readonly QuizAnswer[],
  rng: Rng,
  previous?: string,
): EarQuestion {
  checkFocus(inst, focus);
  const cells = focusCells(inst, focus);
  if (cells.length === 0) throw new QuizFocusError('naturals');
  const mode = earMode(answer, reference);
  const items = [...new Set(cells.map((c) => positionAt(inst, c).midi))].sort((a, b) => a - b).map((m) => `m${m}`);
  const item = pickItem(items, (i) => weakness(history, 'ear', mode, i), rng, previous);
  const midi = Number(item.slice(1));
  return { item, mode, midi, reference: reference === 'a' ? referenceMidi(midi) : null };
}

/** Null when right: any octave of the note. */
export function judgeName(target: number, pc: number): string | null {
  return mod12(pc) === mod12(target) ? null : `✕ not ${pretty(plainName(pc))}. Try again.`;
}

/** Null when right: the exact pitch, on any string. */
export function judgeNeck(target: number, tapped: number): string | null {
  const d = tapped - target;
  if (d === 0) return null;
  const dir = d > 0 ? 'high' : 'low';
  const n = Math.abs(d);
  if (n % 12 === 0) return `✕ right note, ${n === 12 ? 'an octave' : `${n / 12} octaves`} too ${dir}`;
  const that = `✕ that's ${pitchLabel(tapped)}`;
  return n > 12 ? `${that}, more than an octave too ${dir}` : `${that}, a ${SEMITONE_NAMES[n]} too ${dir}`;
}
