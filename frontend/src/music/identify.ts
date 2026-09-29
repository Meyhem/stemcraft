// Notes -> chord names, for Name that chord (D-19). tonal's Chord.detect finds
// every name; the ranking here decides which one a player would say first:
// a common chord in root position, then a common chord over a slash bass, then
// anything rarer. "Em#5" is a real name for E G C, but "C/E" is the answer.
// Names are respelled the way players write them (Bb, not A#) and only names
// this app can read back are returned, so every one is a working link into
// Chord finder (N-08: no name that leads to "Don't know").
import { Chord, Note } from 'tonal';

import { mod12 } from './chordTones';
import { chordInfo, namer, pcOf, rootName } from './spell';

// Most familiar first. Keys are tonal chord-type names; add9 has no type name
// in tonal (its type is ""), so it is recognised by its symbol below.
const COMMON = [
  'major', 'minor', 'dominant seventh', 'major seventh', 'minor seventh', 'diminished',
  'augmented', 'suspended fourth', 'suspended second', 'half-diminished', 'diminished seventh',
  'sixth', 'minor sixth', 'dominant ninth', 'add9', 'minor/major seventh',
];

// tonal writes a major triad as "M", add9 as "Madd9" and minor-major seventh as
// "m/ma7" (a slash inside the name); players write none of those.
function tidy(symbol: string): string {
  return symbol
    .replace('m/ma7', 'mMaj7')
    .replace(/^([A-G][#b]*)M(?=$|\/)/, '$1')
    .replace(/^([A-G][#b]*)Madd9/, '$1add9');
}

interface Named {
  symbol: string;
  rank: number;
  slash: boolean;
  /** Semitones from the bass up to the chord's root: first inversion before second on a tie. */
  above: number;
}

const AWKWARD = new Set(['E#', 'B#', 'Cb', 'Fb']);

// One respelled candidate, or null when this app cannot read it back as exactly
// the notes asked about with the same bass. tonal's detect is not trusted to be
// right: it has returned names of other chords for some five-note sets.
function candidate(detected: string, pcs: ReadonlySet<number>, bass: number): Named | null {
  const tidy1 = tidy(detected);
  const [main = '', bassName] = tidy1.split('/');
  const [tonic = '', suffix = ''] = Chord.tokenize(main);
  const rootPc = pcOf(tonic);
  if (rootPc === null) return null;
  const minorish = Chord.get(main).intervals.includes('3m');
  const root = rootName(rootPc, minorish ? 'minor' : 'major');
  const spelled = chordInfo(`${root}${suffix}`);
  if (!spelled.ok) return null;
  let symbol = `${root}${suffix}`;
  let bassPc = rootPc;
  if (bassName !== undefined) {
    bassPc = pcOf(bassName)!;
    // A chord tone keeps the chord's own spelling unless that is E#, Cb and the like; any other note is
    // sharp or flat the way a chord on this root would be.
    const own = namer(spelled.chord.notes.map((n) => n.name))(bassPc);
    symbol = `${symbol}/${AWKWARD.has(own) || own.length > 2 ? rootName(bassPc, minorish ? 'minor' : 'major') : own}`;
  }
  const read = chordInfo(symbol);
  if (!read.ok || bassPc !== bass) return null;
  const heard = new Set(read.chord.notes.map((n) => n.pc));
  if (read.chord.extraBass) heard.add(read.chord.extraBass.pc);
  if (heard.size !== pcs.size || ![...heard].every((pc) => pcs.has(pc))) return null;
  const type = Chord.get(main).type;
  const commonKey = type === '' && suffix === 'add9' ? 'add9' : type;
  const at = COMMON.indexOf(commonKey);
  return {
    symbol,
    rank: at < 0 ? COMMON.length : at,
    slash: bassName !== undefined,
    above: mod12(rootPc - bassPc),
  };
}

/**
 * Chord names for a set of notes, lowest note first (it is the bass), ranked.
 * Fewer than three different notes is not a chord: [].
 */
export function nameChord(notesLowFirst: readonly string[]): string[] {
  const distinct: string[] = [];
  for (const n of notesLowFirst) if (!distinct.some((d) => pcOf(d) === pcOf(n))) distinct.push(n);
  if (distinct.length < 3) return [];
  const pcs = new Set(distinct.map((n) => pcOf(n)!));
  const bass = pcOf(distinct[0]!)!;
  const rare = (c: Named) => c.rank === COMMON.length;
  const score = (c: Named) => (rare(c) ? 1000 : 0) + (c.slash ? 100 : 0) + c.rank;
  const seen = new Set<string>();
  return Chord.detect(distinct)
    .map((d) => candidate(d, pcs, bass))
    .filter((c): c is Named => c !== null && !seen.has(c.symbol) && !!seen.add(c.symbol))
    .sort((a, b) => score(a) - score(b) || a.above - b.above || (a.symbol < b.symbol ? -1 : 1))
    .map((c) => c.symbol);
}
