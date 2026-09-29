// Name that chord (D-19): tap notes on the neck, or on the note row, and see
// every chord name for them, the most likely first (identify.ts). The lowest
// note tapped on the neck is the bass; on the note row alone, the first note
// picked is. Notes with no chord name say so and are listed with their
// intervals instead of being forced into a name (N-08). A name is a chord
// Chord finder can read back: clicking one puts it in the shared selection.
import { useState } from 'react';

import { DEFAULT_THEORY } from '../../api/client';
import { mod12 } from '../../music/chordTones';
import { nameChord } from '../../music/identify';
import { positionAt, type Cell } from '../../music/positions';
import { chordInfo, namer, pcOf, pretty, scaleNotes } from '../../music/spell';
import { neckFrets } from '../../music/tuning';
import { Button } from '../../ui';
import { ChipRow, HelpBox, NotePicker, ToolHeader } from '../controls';
import { useSelection } from '../selection';
import styles from '../Theory.module.css';
import { TheoryNeck, type NeckDot } from '../TheoryNeck';
import { useTheoryDoc } from '../TheoryDoc';
import { useChosenSong } from '../useChosenSong';

// Intervals above the lowest note, for notes that make no chord.
const SEMITONE_LABELS = ['R', '♭2', '2', '♭3', '3', '4', '♭5', '5', '♭6', '6', '♭7', '7'];

export function NameThatChord() {
  const { doc } = useTheoryDoc();
  const inst = doc?.instrument ?? DEFAULT_THEORY.instrument;
  const [sel, select] = useSelection();
  const song = useChosenSong();
  // Taps are string/fret cells, which mean nothing on another instrument or tuning: they are remembered with the
  // one they were made on, and read as cleared (with a notice) once it changes.
  const [taps, setTaps] = useState<{ key: string; cells: Cell[] }>({ key: '', cells: [] });
  const [pcs, setPcs] = useState<number[]>([]);
  const [loadProblem, setLoadProblem] = useState<string | null>(null);
  const tuningKey = `${inst.kind} ${inst.tuning.join(' ')}`;
  const stale = taps.key !== tuningKey && taps.cells.length > 0;
  const cells = taps.key === tuningKey ? taps.cells : [];
  const frets = neckFrets(inst);
  const name = namer(scaleNotes(sel.root, sel.scale).map((n) => n.name));

  const tap = (cell: Cell) => {
    const same = (c: Cell) => c.string === cell.string && c.fret === cell.fret;
    // A guitar string sounds one note at a time; bass players tap arpeggios, so any number.
    const others = inst.kind === 'guitar' ? cells.filter((c) => c.string !== cell.string || same(c)) : cells;
    setTaps({ key: tuningKey, cells: cells.some(same) ? others.filter((c) => !same(c)) : [...others, cell] });
    setLoadProblem(null);
  };
  const togglePc = (pc: number) => {
    if (stale) setTaps({ key: tuningKey, cells: [] });
    setPcs((cur) => (cur.includes(pc) ? cur.filter((p) => p !== pc) : [...cur, pc]));
    setLoadProblem(null);
  };
  const clear = () => {
    setTaps({ key: tuningKey, cells: [] });
    setPcs([]);
    setLoadProblem(null);
  };

  const tapped = cells.map((c) => positionAt(inst, c)).sort((a, b) => a.midi - b.midi);
  const lowFirst = [...tapped.map((p) => p.pc), ...pcs];
  const notes = lowFirst.map(name);
  const names = nameChord(notes);
  const distinct = [...new Set(lowFirst)];
  const bass = notes[0];

  const dots: NeckDot[] = cells.map((c) => ({ ...c, label: pretty(name(positionAt(inst, c).pc)), marker: 'accent' }));

  // A song chord goes onto the note row, its slash bass first so it stays the bass.
  const loadSongChord = (symbol: string) => {
    const info = chordInfo(symbol);
    if (!info.ok) {
      setLoadProblem(`${info.reason}. Nothing was loaded`);
      return;
    }
    const tones = info.chord.notes.map((n) => n.pc);
    const slash = info.chord.bass ? pcOf(info.chord.bass) : null;
    setTaps({ key: tuningKey, cells: [] });
    setPcs(slash === null ? tones : [slash, ...tones.filter((p) => p !== slash)]);
    setLoadProblem(null);
  };

  // Chord finder's own way of taking a typed chord: the chord, and its root when the note picker has a button for it.
  const pickName = (symbol: string) => {
    const info = chordInfo(symbol);
    const root = info.ok && /^[A-G](#|b)?$/.test(info.chord.root) ? info.chord.root : sel.root;
    select({ chord: symbol, root });
  };

  return (
    <>
      <ToolHeader title="Name that chord">
        <Button variant="ghost" onClick={clear} disabled={cells.length + pcs.length === 0}>
          Clear
        </Button>
      </ToolHeader>
      <div className={styles.stack}>
        <span className={styles.cap}>or tap notes here</span>
        <NotePicker label="Notes" selected={pcs} onPick={togglePc} />
      </div>
      {song.state === 'ready' && song.distinct.length > 0 && (
        <ChipRow label={`In ${song.title}`} value={null} onChange={loadSongChord} options={song.distinct.map((s) => ({ value: s, label: pretty(s) }))} />
      )}
      {loadProblem && (
        <p className={styles.errorText} role="alert">
          {loadProblem}.
        </p>
      )}
      {stale && (
        <p className={styles.dimText} role="status">
          Tapped notes were cleared because the instrument or tuning changed.
        </p>
      )}
      <div className={styles.neck}>
        <TheoryNeck instrument={inst} frets={frets} dots={dots} onPick={tap} label="Tap notes to name a chord" />
      </div>
      <section aria-label="Chord names" className={styles.names}>
        {distinct.length < 3 ? (
          <span className={styles.dimText}>Tap at least three different notes.</span>
        ) : names.length > 0 ? (
          names.map((n, i) => (
            <button
              key={n}
              type="button"
              className={i === 0 ? `${styles.chip} ${styles.chipLarge}` : styles.chip}
              aria-pressed={sel.chord === n}
              onClick={() => pickName(n)}
            >
              {pretty(n)}
            </button>
          ))
        ) : (
          <span>
            No chord name for these notes:{' '}
            {distinct.map((pc) => `${pretty(name(pc))} (${SEMITONE_LABELS[mod12(pc - lowFirst[0]!)]})`).join(', ')}.
          </span>
        )}
      </section>
      <HelpBox>
        The lowest note you tap on the neck is the bass{bass ? <>, here <b>{pretty(bass)}</b></> : ''}; on the note row
        alone, the first note you pick is. A name with a slash, like Am7/G, means that chord over a different bass note.
        Click a name to use it in the other tools.
      </HelpBox>
    </>
  );
}
