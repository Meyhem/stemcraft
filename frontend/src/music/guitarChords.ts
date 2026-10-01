// The guitar Tabs' chords (D-20): a bar's parsed chord, optionally reduced to
// its triad, read into the ChordInfo the voicing search (voicings.ts) takes.
// The BTC label is parsed once, by chordTones.parseChord, exactly as for bass;
// this only respells the result as a symbol tonal can read. A chord tonal
// cannot read is an error the bar shows, never a guess (N-08).
import { withQuality, type ChordTones } from './chordTones';
import { spell, type ResolvedKey } from './patterns';
import { chordInfo, type ChordInfo } from './spell';

/** Simplify: 7ths and 6ths become the triad under them. Everything else stays. */
const SIMPLER: Record<string, string> = {
  maj7: 'maj',
  '7': 'maj',
  maj6: 'maj',
  min7: 'min',
  min6: 'min',
  minmaj7: 'min',
  hdim7: 'dim',
  dim7: 'dim',
};

export function simplify(tones: ChordTones): ChordTones {
  const to = SIMPLER[tones.quality];
  return to ? withQuality(tones, to) : tones;
}

/** chordTones' quality names as tonal chord suffixes. */
const TONAL_SUFFIX: Record<string, string> = {
  maj: '',
  min: 'm',
  dim: 'dim',
  aug: 'aug',
  min6: 'm6',
  maj6: '6',
  min7: 'm7',
  minmaj7: 'mMaj7',
  maj7: 'maj7',
  '7': '7',
  dim7: 'dim7',
  hdim7: 'm7b5',
  sus2: 'sus2',
  sus4: 'sus4',
};

export interface GuitarChord {
  tones: ChordTones;
  info: ChordInfo;
}

export type GuitarChordResult = { ok: true; chord: GuitarChord } | { ok: false; reason: string };

export function guitarChord(tones: ChordTones, key: ResolvedKey): GuitarChordResult {
  const suffix = TONAL_SUFFIX[tones.quality];
  if (suffix === undefined) return { ok: false, reason: `no guitar spelling for chord quality "${tones.quality}"` };
  const bass = tones.bassPc !== tones.rootPc ? `/${spell(tones.bassPc, key)}` : '';
  const read = chordInfo(`${spell(tones.rootPc, key)}${suffix}${bass}`);
  return read.ok ? { ok: true, chord: { tones, info: read.chord } } : { ok: false, reason: read.reason };
}
