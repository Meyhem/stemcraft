// The Practice tab's generated exercise (D-22): timed, fretted notes in beats
// from the loop start, plus what each bar is called. Generators in this folder
// return one; the renderer turns it into audio and the painters draw it. Pure
// data: nothing here touches Web Audio or the DOM.
import type { InstrumentSettings, LineRhythm, PracticeInstrument } from '../../api/client';
import type { GuitarBar } from '../guitarSource';

export const BEATS_PER_BAR = 4;

/** Beats per note for the single-note lines (scales, arpeggios, drills). */
export const RHYTHM_STEP: Record<LineRhythm, number> = {
  quarter: 1,
  eighth: 0.5,
  triplet: 1 / 3,
  sixteenth: 0.25,
};

export interface PracticeNote {
  /** Onset in beats from the loop start. Rounded to a sample only by the renderer. */
  start: number;
  /** How long it rings, in beats. */
  dur: number;
  /** 0 = the lowest string. */
  string: number;
  fret: number;
  midi: number;
  /** Spelled for display: "F♯", "B♭". */
  name: string;
  kind: 'tone' | 'approach';
  /** Notes struck together share a group (a guitar strum); otherwise 0, 1, 2… in order. */
  group: number;
  /** A drill's finger, 1 (index) to 4 (pinky); null elsewhere. */
  finger: number | null;
  /** Guitar groove: the strum's direction; null elsewhere. */
  stroke: 'down' | 'up' | null;
}

/** A note the backing bass plays under a guitar groove. */
export interface SynthNote {
  start: number;
  dur: number;
  midi: number;
}

export interface PracticeBar {
  /** The chord row: "F♯m7", "A minor pentatonic", "E → A". */
  label: string;
  /** Same chord as the bar before: drawn as "%". */
  repeat: boolean;
  /** A substitution the generator made in this bar, shown, never hidden (N-08); null if none. */
  note: string | null;
  /** The bar's harmony for the chord pad, as a BTC label parseChord reads; null for none (drills). */
  chord: string | null;
}

export interface PracticeLoop {
  instrument: PracticeInstrument;
  /** 4 for bass, 6 for guitar. */
  strings: number;
  bars: PracticeBar[];
  /** Sorted by start, then string. */
  notes: PracticeNote[];
  /** Guitar groove only: D-20's bars, for GuitarNeck and StrumLane. */
  guitarBars: GuitarBar[] | null;
  /** Guitar groove only: the backing bass line. Empty otherwise. */
  backing: SynthNote[];
}

/** A change the screen offers as a button when an exercise does not fit (N-08: offered, never applied for you). */
export interface Fix {
  label: string;
  apply(settings: InstrumentSettings): InstrumentSettings;
}

export type GenerateResult = { ok: true; loop: PracticeLoop } | { ok: false; error: string; fixes: Fix[] };

export function loopOf(
  instrument: PracticeInstrument,
  bars: PracticeBar[],
  notes: PracticeNote[],
  extra: Partial<Pick<PracticeLoop, 'guitarBars' | 'backing'>> = {},
): PracticeLoop {
  const sorted = [...notes].sort((a, b) => a.start - b.start || a.string - b.string);
  return {
    instrument,
    strings: instrument === 'bass' ? 4 : 6,
    bars,
    notes: sorted,
    guitarBars: extra.guitarBars ?? null,
    backing: extra.backing ?? [],
  };
}
