// Harmony lookups that sit on top of spell.ts (D-19): which scales fit a
// chord, and what a song's chord is called in its key. Both are derived on
// every call; nothing is stored.
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
 * The numeral of a chord in a key when it is diatonic, else null: the caller
 * labels a null "borrowed" rather than force a numeral on it. Diatonic means
 * every chord tone is a note of the key (the natural minor for minor keys,
 * which is what keyChords numbers) and the chord holds the key triad built on
 * its root, so C7 in C major (a B-flat) is borrowed and Em7 in G major is "vi".
 * The numeral is the triad's, seventh or not: G major, Em7 -> "vi", D7 -> "V".
 * Spelling never matters: G# and Ab major give the same numerals. A chord that
 * cannot be read is null, never a numeral.
 */
export function numeralInKey(tonic: string, mode: KeyMode, symbol: string): string | null {
  const parsed = chordInfo(symbol);
  if (!parsed.ok) return null;
  const pcs = new Set(parsed.chord.notes.map((n) => n.pc));
  const keyPcs = new Set(scaleNotes(tonic, mode).map((n) => n.pc));
  if (![...pcs].every((pc) => keyPcs.has(pc))) return null;
  const rootPc = pcOf(parsed.chord.root);
  for (const kc of keyChords(tonic, mode, 'triads')) {
    const triad = chordInfo(kc.symbol);
    if (!triad.ok || pcOf(triad.chord.root) !== rootPc) continue;
    return triad.chord.notes.every((n) => pcs.has(n.pc)) ? kc.numeral : null;
  }
  return null;
}
