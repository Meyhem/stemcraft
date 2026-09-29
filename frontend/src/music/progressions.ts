// Roman-numeral progressions, transposed to any key (D-19). Numerals are read
// against the major scale of the tonic, as in most chord books: "bVII" in G is
// F, and a minor-key progression spells its flat degrees ("i bVI bIII bVII").
// tonal's own Progression.fromRomanNumerals drops the chord quality ("vi" in G
// comes back as "E", not "Em"), so the reading is done here.
import { Interval, Note } from 'tonal';

import type { KeyMode } from './spell';

export interface ProgressionDef {
  id: string;
  label: string;
  mode: KeyMode;
  numerals: string[];
}

export const PROGRESSIONS: readonly ProgressionDef[] = [
  { id: 'pop', label: 'I–V–vi–IV', mode: 'major', numerals: ['I', 'V', 'vi', 'IV'] },
  { id: 'fifties', label: 'I–vi–IV–V · 50s', mode: 'major', numerals: ['I', 'vi', 'IV', 'V'] },
  { id: 'two-five-one', label: 'ii–V–I', mode: 'major', numerals: ['ii7', 'V7', 'Imaj7'] },
  { id: 'one-four-five', label: 'I–IV–V', mode: 'major', numerals: ['I', 'IV', 'V'] },
  {
    id: 'twelve-bar',
    label: '12-bar blues',
    mode: 'major',
    numerals: ['I7', 'I7', 'I7', 'I7', 'IV7', 'IV7', 'I7', 'I7', 'V7', 'IV7', 'I7', 'V7'],
  },
  {
    id: 'minor-blues',
    label: 'Minor blues',
    mode: 'minor',
    numerals: ['i7', 'i7', 'i7', 'i7', 'iv7', 'iv7', 'i7', 'i7', 'bVI7', 'V7', 'i7', 'V7'],
  },
  { id: 'sensitive', label: 'vi–IV–I–V', mode: 'major', numerals: ['vi', 'IV', 'I', 'V'] },
  { id: 'andalusian', label: 'Andalusian i–♭VII–♭VI–V', mode: 'minor', numerals: ['i', 'bVII', 'bVI', 'V'] },
  { id: 'minor-one-four-five', label: 'i–iv–v', mode: 'minor', numerals: ['i', 'iv', 'v'] },
  { id: 'mixolydian', label: 'I–♭VII–IV', mode: 'major', numerals: ['I', 'bVII', 'IV'] },
  { id: 'minor-two-five-one', label: 'ii–V–i minor', mode: 'minor', numerals: ['iiø7', 'V7', 'i'] },
  { id: 'canon', label: 'Canon', mode: 'major', numerals: ['I', 'V', 'vi', 'iii', 'IV', 'I', 'IV', 'V'] },
  { id: 'one-four-six-five', label: 'I–IV–vi–V', mode: 'major', numerals: ['I', 'IV', 'vi', 'V'] },
  { id: 'epic-minor', label: 'i–♭VI–♭III–♭VII', mode: 'minor', numerals: ['i', 'bVI', 'bIII', 'bVII'] },
  { id: 'one-three-four-five', label: 'I–iii–IV–V', mode: 'major', numerals: ['I', 'iii', 'IV', 'V'] },
];

const NUMERAL = /^(b|#)?(VII|VI|IV|V|III|II|I|vii|vi|iv|v|iii|ii|i)(°7|°|ø7|maj7|7)?$/;
const STEPS = ['1P', '2M', '3M', '4P', '5P', '6M', '7M'];
const ROMANS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

function alter(interval: string, acc: string | undefined): string {
  if (!acc) return interval;
  const i = Interval.get(interval);
  const perfect = i.type === 'perfectable';
  const q = acc === 'b' ? (perfect ? 'd' : 'm') : 'A';
  return `${i.num}${q}`;
}

/** "vi" in G -> "Em", "bVII" in G -> "F", "ii7" in C -> "Dm7", "iiø7" in A -> "Bm7b5". Null if unreadable. */
export function numeralToSymbol(tonic: string, numeral: string): string | null {
  const m = NUMERAL.exec(numeral);
  if (!m) return null;
  const [, acc, roman = '', suffix = ''] = m;
  const degree = ROMANS.indexOf(roman.toUpperCase());
  const upper = roman === roman.toUpperCase();
  const root = Note.transpose(tonic, alter(STEPS[degree]!, acc));
  const quality =
    suffix === '°' ? 'dim'
    : suffix === '°7' ? 'dim7'
    : suffix === 'ø7' ? 'm7b5'
    : suffix === 'maj7' ? (upper ? 'maj7' : 'mMaj7')
    : suffix === '7' ? (upper ? '7' : 'm7')
    : upper ? '' : 'm';
  return `${root}${quality}`;
}

/** A progression's chords in a key: I–V–vi–IV in G -> G D Em C. */
export function progressionChords(def: ProgressionDef, tonic: string): string[] {
  return def.numerals.map((n) => numeralToSymbol(tonic, n) ?? n);
}
