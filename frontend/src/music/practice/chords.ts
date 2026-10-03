// A chosen progression as bars (D-22). progressions.ts spells chords as symbols
// ("F#m7"); parseChord reads BTC labels ("Gb:min7"), the format the bass and
// guitar sources were built on, so they are converted here once. The root goes
// through its pitch class, so an exotic spelling ("Cb") still parses; display
// keeps the symbol.
import type { BarsPerChord, ProgressionId } from '../../api/client';
import { PROGRESSIONS, progressionChords } from '../progressions';
import { pcOf, rootName, type KeyMode } from '../spell';

const QUALITY: Record<string, string> = {
  '': 'maj',
  m: 'min',
  dim: 'dim',
  aug: 'aug',
  '7': '7',
  m7: 'min7',
  maj7: 'maj7',
  m7b5: 'hdim7',
  dim7: 'dim7',
  mMaj7: 'minmaj7',
  '6': 'maj6',
  m6: 'min6',
  sus2: 'sus2',
  sus4: 'sus4',
};
const BTC_ROOT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

export function toBtcLabel(symbol: string): string {
  const m = /^([A-G](?:##|bb|#|b)?)(.*)$/.exec(symbol);
  const quality = m ? QUALITY[m[2]!] : undefined;
  const pc = m ? pcOf(m[1]!) : null;
  if (!m || quality === undefined || pc === null) throw new Error(`no chord quality for "${symbol}"`);
  const root = BTC_ROOT[pc]!;
  return quality === 'maj' ? root : `${root}:${quality}`;
}

export interface ChordBar {
  /** As progressions.ts spells it: "F#m7". */
  symbol: string;
  /** For parseChord, planBar and guitarBars: "Gb:min7". */
  label: string;
  /** The same chord as the bar before (drawn "%"). */
  repeat: boolean;
  /** The next bar (the first, at the end) is a different chord: only then is there an approach into it. */
  changes: boolean;
}

export function progressionBars(
  id: ProgressionId,
  keyPc: number,
  barsPerChord: BarsPerChord,
): { bars: ChordBar[]; mode: KeyMode; tonic: string } {
  const def = PROGRESSIONS.find((p) => p.id === id)!;
  const tonic = rootName(keyPc, def.mode);
  const symbols = progressionChords(def, tonic).flatMap((s) => new Array<string>(barsPerChord).fill(s));
  const n = symbols.length;
  const bars = symbols.map((symbol, i) => ({
    symbol,
    label: toBtcLabel(symbol),
    repeat: i > 0 && symbols[i - 1] === symbol,
    changes: symbols[(i + 1) % n] !== symbol,
  }));
  return { bars, mode: def.mode, tonic };
}
