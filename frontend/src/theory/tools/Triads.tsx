// Triads & inversions (D-19): a major, minor, diminished or augmented triad in
// root position or an inversion, on every set of three adjacent strings (or one
// chosen set). On bass these are the arpeggio shapes of the triad. A set with no
// shape that fits the neck in this tuning is disabled and says so, and when none
// does the tool says that instead of drawing nothing (N-08).
import { useState } from 'react';

import { DEFAULT_THEORY } from '../../api/client';
import type { Cell } from '../../music/positions';
import { INVERSION_LABELS, stringSets, triadShapes, type Inversion } from '../../music/shapes';
import { chordInfo, chordSymbol, pcOf, pretty, rootName, type QualityId, type Spelled } from '../../music/spell';
import { neckFrets, type Instrument } from '../../music/tuning';
import { Segmented } from '../../ui';
import { HelpBox, NoteChips, NotePicker, ToolHeader } from '../controls';
import { useSelection } from '../selection';
import styles from '../Theory.module.css';
import { TheoryNeck, type NeckDot } from '../TheoryNeck';
import { useTheoryDoc } from '../TheoryDoc';

const TRIADS = ['maj', 'm', 'dim', 'aug'] as const satisfies readonly QualityId[];
type Triad = (typeof TRIADS)[number];

export interface TriadSet {
  id: string;
  /** Neck rows, lowest string first. */
  rows: number[];
  label: string;
  /** The shapes that fit the neck; empty exactly when `unavailable` is set. */
  shapes: Cell[][];
  unavailable: string | null;
}

/** Every three-string set with its shapes, or the reason it has none. */
export function triadSets(inst: Instrument, triad: readonly Spelled[], inversion: Inversion, frets: number): TriadSet[] {
  const rowNames = [...inst.tuning].reverse().map((n) => pretty(n.replace(/-?\d+$/, '')));
  return stringSets(inst).map((rows) => {
    const label = rows.map((r) => rowNames[r]).join('–');
    const shapes = triad.length === 3 ? triadShapes(inst, triad, rows, inversion, frets) : [];
    const unavailable = shapes.length === 0 ? `No ${INVERSION_LABELS[inversion].toLowerCase()} shape fits within ${frets} frets on the ${label} strings in this tuning` : null;
    return { id: rows.join('-'), rows, label, shapes, unavailable };
  });
}

export function Triads() {
  const { doc } = useTheoryDoc();
  const inst = doc?.instrument ?? DEFAULT_THEORY.instrument;
  const [sel, select] = useSelection();
  const [inversion, setInversion] = useState<Inversion>(0);
  const [chosen, setChosen] = useState('all');

  const quality: Triad = (TRIADS as readonly string[]).includes(sel.quality) ? (sel.quality as Triad) : 'maj';
  const symbol = pretty(chordSymbol(sel.root, quality));
  const parsed = chordInfo(chordSymbol(sel.root, quality));
  const triad = parsed.ok ? parsed.chord.notes : [];
  const frets = neckFrets(inst);
  const sets = triadSets(inst, triad, inversion, frets);
  // A remembered string set the instrument no longer has reads as All.
  const set = sets.some((s) => s.id === chosen) ? chosen : 'all';
  const shown = set === 'all' ? sets : sets.filter((s) => s.id === set);
  const drawn = shown.filter((s) => s.unavailable === null);
  const rootPc = pcOf(sel.root)!;

  // Shapes are read by index into what came back; the octave-up copy is a later entry, not a fixed slot.
  const dots: NeckDot[] = drawn.flatMap((s) =>
    s.shapes.flatMap((cells) =>
      cells.map((c, i) => {
        const note = triad[(i + inversion) % 3]!;
        return { ...c, label: note.interval, marker: note.pc === rootPc ? ('root' as const) : ('tone' as const) };
      }),
    ),
  );
  const missing = shown.filter((s) => s.unavailable !== null);

  return (
    <>
      <ToolHeader title="Triads & inversions">
        <Segmented<string>
          label="Inversion"
          value={String(inversion)}
          onChange={(v) => setInversion(Number(v) as Inversion)}
          options={INVERSION_LABELS.map((label, i) => ({ value: String(i), label }))}
        />
      </ToolHeader>
      <div className={styles.row}>
        <span className={styles.cap}>root</span>
        <NotePicker label="Root" selected={[rootPc]} onPick={(pc) => select({ root: rootName(pc, 'major'), chord: null })} />
      </div>
      <div className={styles.chipRow} role="group" aria-label="Triad">
        <span className={styles.cap}>Triad</span>
        {TRIADS.map((q) => (
          <button key={q} type="button" className={styles.chip} aria-pressed={q === quality} onClick={() => select({ quality: q, chord: null })}>
            {q}
          </button>
        ))}
      </div>
      <div className={styles.chipRow} role="group" aria-label="Strings">
        <span className={styles.cap}>Strings</span>
        <button type="button" className={styles.chip} aria-pressed={set === 'all'} onClick={() => setChosen('all')}>
          All
        </button>
        {sets.map((s) => (
          <button
            key={s.id}
            type="button"
            className={styles.chip}
            aria-pressed={s.id === set}
            disabled={s.unavailable !== null}
            title={s.unavailable ?? undefined}
            onClick={() => setChosen(s.id)}
          >
            {s.label}
          </button>
        ))}
      </div>
      <div className={styles.row}>
        <b>{symbol}</b>
        <NoteChips notes={triad} />
      </div>
      {drawn.length === 0 ? (
        <p className={styles.errorText} role="alert">
          {set === 'all'
            ? `No ${INVERSION_LABELS[inversion].toLowerCase()} shape of ${symbol} fits within ${frets} frets on any three adjacent strings in this tuning.`
            : `${missing[0]!.unavailable}.`}
        </p>
      ) : (
        missing.length > 0 && (
          <p className={styles.errorText} role="status">
            No {INVERSION_LABELS[inversion].toLowerCase()} shape fits within {frets} frets on the {missing.map((s) => s.label).join(', ')} strings in this tuning.
          </p>
        )
      )}
      <div className={styles.neck}>
        <TheoryNeck instrument={inst} frets={frets} dots={dots} label={`${symbol} ${INVERSION_LABELS[inversion]}`} />
      </div>
      <HelpBox>
        <b>{INVERSION_LABELS[inversion]}</b>: the lowest note is the {['root', '3rd', '5th'][inversion]}. Each group of three
        strings holds one shape; the same shape repeats an octave up where it fits. Inversions let you play the same chord
        without jumping around the neck.
      </HelpBox>
    </>
  );
}
