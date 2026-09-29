// What a wrong Theory-quiz option actually is (D-19): a wrong pick is explained by the fact it answers, so the
// mistake teaches something ("F♯ is the V of B major, not of E♭ major"). Computed from the option's own meaning with
// tonal and spell.ts, never from a stored list. It never reveals the right answer: only what the pick is. An option
// this cannot explain is said so plainly instead of being explained wrongly (N-08).
import { Chord, Note } from 'tonal';

import { keyChords, chordInfo, pretty, relativeKey } from './spell';

const ascii = (s: string) => s.replaceAll('♯', '#').replaceAll('♭', 'b');

/** The quiz's interval names and the tonal interval each stands for. */
const IVL_CODE: Record<string, string> = {
  'minor 2nd': '2m',
  'major 2nd': '2M',
  'minor 3rd': '3m',
  'major 3rd': '3M',
  'perfect 4th': '4P',
  tritone: '5d',
  'perfect 5th': '5P',
  'minor 6th': '6m',
  'major 6th': '6M',
  'minor 7th': '7m',
  'major 7th': '7M',
};

const QUALITIES = ['', 'm', '7', 'maj7', 'm7'];

/** The chord's notes as the quiz prints them: "B♭ D♭ F A♭". */
function spelled(symbol: string): string | null {
  const info = chordInfo(symbol);
  return info.ok ? info.chord.notes.map((n) => pretty(n.name)).join(' ') : null;
}

const simple = (picked: string) => `${picked} is not the answer.`;

/**
 * The one-line reason a wrong option is wrong,. `item` is the question's item key
 * (`v:Eb`, `ivl:C:6M` ...) and `picked` the text of the option the player chose.
 */
export function explainWrong(item: string, picked: string): string {
  const [kind, a = '', b = ''] = item.split(':');
  const key = pretty(a);
  if (kind === 'v') {
    const own = keyChords(a, 'major', 'triads');
    const home = own.findIndex((c, i) => i !== 4 && pretty(c.symbol) === picked);
    if (home >= 0) return `${picked} is the ${own[home]!.numeral} of ${key} major, not the V.`;
    const chord = Chord.get(ascii(picked));
    if (chord.quality !== 'Major' || chord.notes.length !== 3 || !chord.tonic) return simple(picked);
    // A major chord is the V of the key a fifth below its root.
    return `${picked} is the V of ${pretty(Note.transpose(chord.tonic, '4P'))} major, not of ${key} major.`;
  }
  if (kind === 'rel') {
    const minor = picked.endsWith(' minor') ? ascii(picked.slice(0, -' minor'.length)) : null;
    if (!minor || Note.chroma(minor) === undefined) return simple(picked);
    return `${picked} is the relative minor of ${pretty(relativeKey(minor, 'minor').root)} major, not of ${key} major.`;
  }
  if (kind === 'sig') {
    const m = /^(\d+) (sharps?|flats?)$/.exec(picked);
    const n = picked === 'no sharps or flats' ? 0 : m ? Number(m[1]) * (m[2]!.startsWith('sharp') ? 1 : -1) : null;
    if (n === null) return simple(picked);
    return `${pretty(Note.transposeFifths('C', n))} major has ${picked}, not ${key} major.`;
  }
  if (kind === 'notes') {
    const root = chordInfo(a);
    if (!root.ok) return simple(picked);
    const owner = QUALITIES.map((q) => `${root.chord.root}${q}`).find((s) => s !== a && spelled(s) === picked);
    return owner ? `${picked} is ${pretty(owner)}, not ${pretty(a)}.` : simple(picked);
  }
  if (kind === 'name') {
    const asked = spelled(a);
    const notes = spelled(ascii(picked));
    return asked && notes ? `${picked} is ${notes}, not ${asked}.` : simple(picked);
  }
  if (kind === 'ivl') {
    const code = IVL_CODE[picked];
    const to = Note.transpose(a, b);
    if (!code || !to) return simple(picked);
    return `A ${picked} above ${pretty(a)} is ${pretty(Note.transpose(a, code))}, not ${pretty(to)}.`;
  }
  return simple(picked);
}
