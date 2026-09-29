// Harmony lookups that sit on top of spell.ts (D-19): which scales fit a
// chord, and what a song's chord is called in its key. Both are derived on
// every call; nothing is stored.
import { mod12 } from './chordTones';
import { chordInfo, keyChords, pcOf, scaleNotes, SCALES, type ChordInfo, type KeyMode, type ScaleId } from './spell';

export interface ScaleFit {
  scale: ScaleId;
  root: string;
  label: string;
}

/**
 * Scales built on the chord's root that contain every chord tone, safest first:
 * fewer notes first (a pentatonic has no wrong notes to land on), then SCALES
 * order. Am7 -> A minor pentatonic, A blues, A minor, A dorian, A phrygian.
 * A chord no listed scale holds (C7#9b13) gives [], which the caller says out
 * loud (N-08). A slash bass that is not a chord tone is not asked of the scale.
 */
export function scalesOverChord(chord: ChordInfo): ScaleFit[] {
  const tones = chord.notes.map((n) => n.pc);
  return SCALES.map((def, order) => ({ def, order, notes: scaleNotes(chord.root, def.id) }))
    .filter(({ notes }) => tones.every((pc) => notes.some((n) => n.pc === pc)))
    .sort((a, b) => a.notes.length - b.notes.length || a.order - b.order)
    .map(({ def }) => ({ scale: def.id, root: chord.root, label: `${chord.root} ${def.label.toLowerCase()}` }));
}

/**
 * The numeral of a chord in a key, or null when it is outside the key. Null
 * means exactly that (the caller says "borrowed"); it is never "a chord I do
 * not understand", and no chord in the forms below comes back null. Forms:
 *  - Diatonic triads and sevenths: the degree triad's numeral, seventh or not,
 *    so G major gives Em7 -> "vi", D7 -> "V". Uppercase for a major degree,
 *    lowercase for a minor one, "vii°"/"ii°" for a diminished one. Every chord
 *    tone must be a note of the key (natural minor for minor keys), so C7 in C
 *    major (a B-flat) or Am(maj7) is null.
 *  - sus2 and sus4 (nothing else on top): the degree numeral without its "°",
 *    in the case of the key's own triad, plus "sus2"/"sus4": Dsus4 in C major
 *    -> "iisus4", Esus4 in A minor -> "vsus4". Every tone must be in the key.
 *  - Minor keys borrow the raised seventh (harmonic minor) for the dominant and
 *    the leading-tone chord only: E and E7 in A minor -> "V", G#dim and
 *    G#dim7 -> "vii°". Natural numerals are tried first, so Em in A minor stays "v".
 * Spelling never matters (G# and Ab major give the same numerals). Secondary
 * dominants (A7 in C), III+, i(mMaj7), bVII in major and the like are null.
 */
export function numeralInKey(tonic: string, mode: KeyMode, symbol: string): string | null {
  const parsed = chordInfo(symbol);
  if (!parsed.ok) return null;
  const chord = parsed.chord;
  const pcs = new Set(chord.notes.map((n) => n.pc));
  const keyPcs = new Set(scaleNotes(tonic, mode).map((n) => n.pc));
  const rootPc = pcOf(chord.root)!;
  const holds = (triad: readonly number[]) => triad.every((step) => pcs.has(mod12(rootPc + step)));
  const within = (allowed: Set<number>) => [...pcs].every((pc) => allowed.has(pc));

  const degree = keyChords(tonic, mode, 'triads').find((kc) => {
    const t = chordInfo(kc.symbol);
    return t.ok && pcOf(t.chord.root) === rootPc;
  });
  if (within(keyPcs) && degree) {
    const triad = chordInfo(degree.symbol);
    if (triad.ok && triad.chord.notes.every((n) => pcs.has(n.pc))) return degree.numeral;
    const intervals = chord.notes.map((n) => n.interval).join(' ');
    if (intervals === 'R 2 5' || intervals === 'R 4 5') return `${degree.numeral.replace('°', '')}sus${intervals[2]}`;
  }

  if (mode === 'minor') {
    const tonicPc = pcOf(tonic)!;
    const raised = mod12(tonicPc + 11);
    const withRaised = new Set([...keyPcs, raised]);
    if (within(withRaised)) {
      if (rootPc === mod12(tonicPc + 7) && holds([0, 4, 7])) return 'V';
      if (rootPc === raised && holds([0, 3, 6])) return 'vii°';
    }
  }
  return null;
}
