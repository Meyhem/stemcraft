// Pure music theory: pitch classes, key-appropriate note spelling, scale and
// pentatonic generation, and fretboard note lookup. No model, no failure mode
// (R-05) -- this is arithmetic over the tonic the user picks from the
// analyzed key candidates, not a prediction of its own.

export type Mode = 'major' | 'minor';

const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

// Major-key tonics conventionally spelled with flats (the flat side of the
// circle of fifths); everything else -- including F#/Gb, called F# here --
// uses sharps. A minor key follows its relative major's family (tonic + 3
// semitones), e.g. G minor (pc 7) -> Bb major (pc 10) -> flat family.
const FLAT_FAMILY_MAJOR_TONICS = new Set([5, 10, 3, 8, 1]); // F, Bb, Eb, Ab, Db

const NAME_TO_PC: Record<string, number> = {};
SHARP_NAMES.forEach((n, i) => (NAME_TO_PC[n] = i));
FLAT_NAMES.forEach((n, i) => (NAME_TO_PC[n] = i));

export function pitchClassOf(name: string): number {
  const pc = NAME_TO_PC[name];
  if (pc === undefined) throw new Error(`unknown note name: ${name}`);
  return pc;
}

function familyIsFlat(tonicPitchClass: number, mode: Mode): boolean {
  const majorTonic = mode === 'minor' ? (tonicPitchClass + 3) % 12 : tonicPitchClass;
  return FLAT_FAMILY_MAJOR_TONICS.has(majorTonic);
}

export function noteName(pitchClass: number, tonicPitchClass: number, mode: Mode): string {
  const pc = ((pitchClass % 12) + 12) % 12;
  return familyIsFlat(tonicPitchClass, mode) ? FLAT_NAMES[pc] : SHARP_NAMES[pc];
}

const MAJOR_INTERVALS = [0, 2, 4, 5, 7, 9, 11];
const MINOR_INTERVALS = [0, 2, 3, 5, 7, 8, 10];
const MAJOR_PENTATONIC_DEGREES = [0, 1, 2, 4, 5]; // scale degrees 1,2,3,5,6
const MINOR_PENTATONIC_DEGREES = [0, 2, 3, 4, 6]; // scale degrees 1,b3,4,5,b7

export function scaleSemitones(mode: Mode, pentatonic: boolean): number[] {
  const base = mode === 'major' ? MAJOR_INTERVALS : MINOR_INTERVALS;
  if (!pentatonic) return base;
  const degrees = mode === 'major' ? MAJOR_PENTATONIC_DEGREES : MINOR_PENTATONIC_DEGREES;
  return degrees.map((d) => base[d]);
}

export function scaleNoteNames(
  tonicPitchClass: number,
  mode: Mode,
  pentatonic = false,
): string[] {
  return scaleSemitones(mode, pentatonic).map((semitone) =>
    noteName((tonicPitchClass + semitone) % 12, tonicPitchClass, mode),
  );
}

export function noteAtFret(
  openNotePitchClass: number,
  fret: number,
  tonicPitchClass: number,
  mode: Mode,
): string {
  return noteName((openNotePitchClass + fret) % 12, tonicPitchClass, mode);
}

// Standard tunings, low string to high string.
export const BASS_TUNING = ['E', 'A', 'D', 'G'];
export const GUITAR_TUNING = ['E', 'A', 'D', 'G', 'B', 'E'];
