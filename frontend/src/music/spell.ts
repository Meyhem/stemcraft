// Letter-correct spelling and every scale, chord and key query the Theory tab
// makes (D-19). The only module that imports tonal: components see these
// Stemcraft types, so the library stays swappable behind one file. State and
// URLs keep ASCII names ("Bb", "F#"); `pretty` is for display only.
//
// Pure arithmetic with no model behind it (R-05): a chord it cannot read is an
// error the caller shows, never a guess (N-08).
import { Chord, Interval, Key, Note, Scale } from 'tonal';

import { mod12, parseChord } from './chordTones';

/** A spelled note with its interval label relative to the root ("R", "♭3", "♯11"). */
export interface Spelled {
  name: string;
  pc: number;
  interval: string;
}

export type KeyMode = 'major' | 'minor';

const SHARPS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLATS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

/** "Bb" -> "B♭", "F##" -> "F𝄪", "Bbb" -> "B𝄫", "Bbm7b5" -> "B♭m7♭5". */
export function pretty(text: string): string {
  return text
    .replace(/##/g, '𝄪')
    .replace(/([A-G])bb/g, '$1𝄫')
    .replace(/([A-G])b/g, '$1♭')
    .replace(/b(?=\d)/g, '♭')
    .replace(/#/g, '♯');
}

/** Typed text back to ASCII: "B♭m7♭5" -> "Bbm7b5", "c♯m" -> "C#m". */
export function ascii(text: string): string {
  const t = text.trim().replace(/♭/g, 'b').replace(/♯/g, '#').replace(/𝄫/g, 'bb').replace(/𝄪/g, '##');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Pitch class 0-11 of a note name, or null if it is not one. */
export function pcOf(name: string): number | null {
  const chroma = Note.chroma(name);
  return chroma === undefined || Number.isNaN(chroma) ? null : chroma;
}

/**
 * The key-root spelling with fewer accidentals for a pitch class: Db major not
 * C# major, but C# minor not Db minor. F#/Gb ties go to F#.
 */
export function rootName(pc: number, mode: KeyMode): string {
  const MAJOR = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
  const MINOR = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B'];
  return (mode === 'major' ? MAJOR : MINOR)[mod12(pc)]!;
}

/** "3m" -> "♭3", "5d" -> "♭5", "7d" -> "𝄫7", "4A" -> "♯4", "1P"/"8P" -> "R", "9M" -> "9". */
export function intervalLabel(name: string): string {
  const i = Interval.get(name);
  if (i.empty) return name;
  if (i.num === 1 || i.num === 8) return 'R';
  const perfect = i.type === 'perfectable';
  const acc =
    i.q === 'A' ? '♯' : i.q === 'AA' ? '𝄪' : i.q === 'd' ? (perfect ? '♭' : '𝄫') : i.q === 'm' ? '♭' : '';
  return `${acc}${i.num}`;
}

function spell(notes: string[], root: string): Spelled[] {
  return notes.map((name) => ({
    name,
    pc: pcOf(name)!,
    interval: intervalLabel(Interval.distance(root, name)),
  }));
}

/**
 * Names pitch classes the way the current context spells them: a pitch class in
 * `context` gets that name; any other one is sharp, or flat when the context
 * already uses flats.
 */
export function namer(context: readonly string[]): (pc: number) => string {
  const byPc = new Map<number, string>();
  for (const name of context) {
    const pc = pcOf(name);
    if (pc !== null && !byPc.has(pc)) byPc.set(pc, name);
  }
  const flats = context.some((n) => /^[A-G]b/.test(n));
  return (pc) => byPc.get(mod12(pc)) ?? (flats ? FLATS : SHARPS)[mod12(pc)]!;
}

// ---------------------------------------------------------------- scales

export const SCALES = [
  { id: 'major', label: 'Major', group: 'common', tonal: 'major', mode: 'major' },
  { id: 'minor', label: 'Minor', group: 'common', tonal: 'minor', mode: 'minor' },
  { id: 'major-pentatonic', label: 'Major pentatonic', group: 'common', tonal: 'major pentatonic', mode: 'major' },
  { id: 'minor-pentatonic', label: 'Minor pentatonic', group: 'common', tonal: 'minor pentatonic', mode: 'minor' },
  { id: 'blues', label: 'Blues', group: 'common', tonal: 'blues', mode: 'minor' },
  { id: 'dorian', label: 'Dorian', group: 'modes', tonal: 'dorian', mode: 'minor' },
  { id: 'phrygian', label: 'Phrygian', group: 'modes', tonal: 'phrygian', mode: 'minor' },
  { id: 'lydian', label: 'Lydian', group: 'modes', tonal: 'lydian', mode: 'major' },
  { id: 'mixolydian', label: 'Mixolydian', group: 'modes', tonal: 'mixolydian', mode: 'major' },
  { id: 'locrian', label: 'Locrian', group: 'modes', tonal: 'locrian', mode: 'minor' },
  { id: 'harmonic-minor', label: 'Harmonic minor', group: 'more', tonal: 'harmonic minor', mode: 'minor' },
  { id: 'melodic-minor', label: 'Melodic minor', group: 'more', tonal: 'melodic minor', mode: 'minor' },
  { id: 'whole-tone', label: 'Whole tone', group: 'more', tonal: 'whole tone', mode: 'major' },
  { id: 'diminished', label: 'Diminished', group: 'more', tonal: 'diminished', mode: 'minor' },
] as const;

export type ScaleId = (typeof SCALES)[number]['id'];
export type ScaleGroup = (typeof SCALES)[number]['group'];

export function scaleDef(id: ScaleId) {
  return SCALES.find((s) => s.id === id)!;
}

export function isScaleId(value: string): value is ScaleId {
  return SCALES.some((s) => s.id === value);
}

/** The scale's notes from the root, each with its interval: A minor pentatonic -> A C D E G. */
export function scaleNotes(root: string, scale: ScaleId): Spelled[] {
  const s = Scale.get(`${root} ${scaleDef(scale).tonal}`);
  return spell(s.notes, root);
}

const TRIAD_KINDS = [
  { suffix: '', steps: [0, 4, 7] },
  { suffix: 'm', steps: [0, 3, 7] },
  { suffix: 'dim', steps: [0, 3, 6] },
] as const;

/**
 * Major, minor and diminished triads whose three notes are all in the scale,
 * starting from the root: A minor pentatonic -> Am, C.
 */
export function fitsOver(root: string, scale: ScaleId): string[] {
  const notes = scaleNotes(root, scale);
  const pcs = new Set(notes.map((n) => n.pc));
  const name = namer(notes.map((n) => n.name));
  const rootPc = pcOf(root)!;
  const out: string[] = [];
  for (let step = 0; step < 12; step++) {
    const pc = mod12(rootPc + step);
    for (const kind of TRIAD_KINDS) {
      if (kind.steps.every((s) => pcs.has(mod12(pc + s)))) out.push(`${name(pc)}${kind.suffix}`);
    }
  }
  return out;
}

/** Other scales in SCALES with exactly the same notes: A minor pentatonic -> "C major pentatonic". */
export function sameNotes(root: string, scale: ScaleId): string[] {
  const key = (pcs: number[]) => [...new Set(pcs)].sort((a, b) => a - b).join(',');
  const target = key(scaleNotes(root, scale).map((n) => n.pc));
  const out: string[] = [];
  for (const def of SCALES) {
    for (let pc = 0; pc < 12; pc++) {
      const r = rootName(pc, def.mode);
      if (def.id === scale && pc === pcOf(root)) continue;
      if (key(scaleNotes(r, def.id).map((n) => n.pc)) === target) out.push(`${r} ${def.label.toLowerCase()}`);
    }
  }
  return out;
}

// ---------------------------------------------------------------- chords

export const QUALITIES = [
  { id: 'maj', label: 'maj', suffix: '' },
  { id: 'm', label: 'm', suffix: 'm' },
  { id: '7', label: '7', suffix: '7' },
  { id: 'maj7', label: 'maj7', suffix: 'maj7' },
  { id: 'm7', label: 'm7', suffix: 'm7' },
  { id: 'm7b5', label: 'm7♭5', suffix: 'm7b5' },
  { id: 'dim', label: 'dim', suffix: 'dim' },
  { id: 'dim7', label: 'dim7', suffix: 'dim7' },
  { id: 'aug', label: 'aug', suffix: 'aug' },
  { id: 'sus2', label: 'sus2', suffix: 'sus2' },
  { id: 'sus4', label: 'sus4', suffix: 'sus4' },
  { id: '6', label: '6', suffix: '6' },
  { id: 'm6', label: 'm6', suffix: 'm6' },
  { id: '9', label: '9', suffix: '9' },
  { id: 'add9', label: 'add9', suffix: 'add9' },
] as const;

export type QualityId = (typeof QUALITIES)[number]['id'];

export interface ChordInfo {
  /** ASCII symbol as typed or built, e.g. "Am7", "C/E". */
  symbol: string;
  /** tonal's long name, e.g. "A minor seventh". */
  name: string;
  root: string;
  /** The slash bass, or null for a root-position symbol. */
  bass: string | null;
  /** Chord tones from the root, intervals relative to the root. */
  notes: Spelled[];
  /** A slash bass that is not a chord tone (C/Bb), else null. */
  extraBass: Spelled | null;
}

export type ChordResult = { ok: true; chord: ChordInfo } | { ok: false; reason: string };

/** Reads a chord symbol ("Am7", "C/E", "F#m7b5", "B♭maj7"). Never guesses (N-08). */
export function chordInfo(text: string): ChordResult {
  const symbol = ascii(text);
  const fail = { ok: false as const, reason: `Don't know "${text.trim()}"` };
  const [main = '', bass, ...rest] = symbol.split('/');
  const chord = Chord.get(main);
  if (!symbol || rest.length > 0 || chord.empty || !chord.tonic) return fail;
  const notes = spell(chord.notes, chord.tonic);
  let extraBass: Spelled | null = null;
  if (bass !== undefined) {
    if (!/^[A-G](#{1,2}|b{1,2})?$/.test(bass)) return fail;
    if (!notes.some((n) => n.pc === pcOf(bass))) extraBass = spell([bass], chord.tonic)[0]!;
  }
  return {
    ok: true,
    chord: { symbol, name: chord.name || symbol, root: chord.tonic, bass: bass ?? null, notes, extraBass },
  };
}

export function chordSymbol(root: string, quality: QualityId, bass?: string | null): string {
  const suffix = QUALITIES.find((q) => q.id === quality)!.suffix;
  return `${root}${suffix}${bass ? `/${bass}` : ''}`;
}

const BTC_SUFFIX: Record<string, string> = {
  maj: '', min: 'm', dim: 'dim', aug: 'aug', min6: 'm6', maj6: '6', min7: 'm7',
  minmaj7: 'mMaj7', maj7: 'maj7', '7': '7', dim7: 'dim7', hdim7: 'm7b5', sus2: 'sus2', sus4: 'sus4',
};

/**
 * An analysis.json chord label ("G:min", "A#:hdim7", "C:maj/3") as a symbol
 * spelled by `name`; null for "N", "X" and labels chordTones cannot read.
 */
export function analysisChordSymbol(label: string, name: (pc: number) => string): string | null {
  const parsed = parseChord(label, 0);
  if (parsed.kind !== 'chord') return null;
  const { rootPc, bassPc, quality } = parsed.tones;
  const slash = bassPc !== rootPc ? `/${name(bassPc)}` : '';
  return `${name(rootPc)}${BTC_SUFFIX[quality] ?? ''}${slash}`;
}

// ---------------------------------------------------------------- keys

export type ChordFunction = 'home' | 'sub' | 'tension';

export interface KeyChord {
  numeral: string;
  symbol: string;
  fn: ChordFunction;
}

const NUMERALS = {
  major: { triads: ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°'], sevenths: ['Imaj7', 'ii7', 'iii7', 'IVmaj7', 'V7', 'vi7', 'viiø7'] },
  minor: { triads: ['i', 'ii°', 'III', 'iv', 'v', 'VI', 'VII'], sevenths: ['i7', 'iiø7', 'IIImaj7', 'iv7', 'v7', 'VImaj7', 'VII7'] },
} as const;

const FUNCTION: Record<string, ChordFunction> = { T: 'home', SD: 'sub', D: 'tension' };

/** The seven chords of a key with numerals and function (T -> home, SD -> sub, D -> tension). */
export function keyChords(root: string, mode: KeyMode, kind: 'triads' | 'sevenths'): KeyChord[] {
  const k = mode === 'major' ? Key.majorKey(root) : Key.minorKey(root).natural;
  const symbols = kind === 'triads' ? k.triads : k.chords;
  return symbols.map((symbol, i) => ({
    numeral: NUMERALS[mode][kind][i]!,
    symbol,
    fn: FUNCTION[k.chordsHarmonicFunction[i]!]!,
  }));
}

const SHARP_ORDER = ['F#', 'C#', 'G#', 'D#', 'A#', 'E#', 'B#'];
const FLAT_ORDER = ['Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Cb', 'Fb'];

/** G major -> 1 sharp, F#. A minor -> none. */
export function keySignature(root: string, mode: KeyMode): { accidentals: string[]; sharps: boolean } {
  const major = mode === 'major' ? root : Key.minorKey(root).relativeMajor;
  const sig = Key.majorKey(major).keySignature;
  const sharps = sig.startsWith('#');
  return { accidentals: (sharps ? SHARP_ORDER : FLAT_ORDER).slice(0, sig.length), sharps };
}

/** G major -> "E minor"; E minor -> "G major". */
export function relativeKey(root: string, mode: KeyMode): { root: string; mode: KeyMode } {
  return mode === 'major'
    ? { root: Key.majorKey(root).minorRelative, mode: 'minor' }
    : { root: Key.minorKey(root).relativeMajor, mode: 'major' };
}

/** Where a chord is diatonic, by major key: Am7 -> ["vi7 in C major", "iii7 in F major", "ii7 in G major"]. */
export function chordHomes(chord: ChordInfo): string[] {
  const same = (a: Set<number>, b: Set<number>) => a.size === b.size && [...a].every((p) => b.has(p));
  const target = new Set(chord.notes.map((n) => n.pc));
  const rootPc = pcOf(chord.root);
  const out: string[] = [];
  for (let pc = 0; pc < 12; pc++) {
    const key = rootName(pc, 'major');
    for (const kind of ['triads', 'sevenths'] as const) {
      for (const kc of keyChords(key, 'major', kind)) {
        const c = Chord.get(kc.symbol);
        if (pcOf(c.tonic ?? '') === rootPc && same(new Set(c.notes.map((n) => pcOf(n)!)), target)) {
          out.push(`${kc.numeral} in ${pretty(key)} major`);
        }
      }
    }
  }
  return out;
}
