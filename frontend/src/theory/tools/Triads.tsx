// Triads & inversions (D-19): a major, minor, diminished or augmented triad in
// root position or an inversion, on every set of three adjacent strings (or one
// chosen set). On bass these are the arpeggio shapes of the triad. The triad is
// the selected chord's (its 3rd and 5th), whatever tool chose it; a bigger chord
// shows the triad inside it and says so, and one with no triad (sus, power) says
// that instead of drawing another chord (N-08). A set with no shape that fits the
// neck in this tuning is disabled and says so, and when none does the tool says
// that instead of drawing nothing.
import { useState } from 'react';

import { DEFAULT_THEORY } from '../../api/client';
import type { Cell } from '../../music/positions';
import { INVERSION_LABELS, stringSets, triadShapes, type Inversion } from '../../music/shapes';
import { chordInfo, chordSymbol, pcOf, pretty, rootName, type ChordInfo, type QualityId, type Spelled } from '../../music/spell';
import { neckFrets, type Instrument } from '../../music/tuning';
import { Segmented } from '../../ui';
import { HelpBox, NoteChips, NotePicker, ToolHeader } from '../controls';
import { useSelection } from '../selection';
import styles from '../Theory.module.css';
import { TheoryNeck, type NeckDot } from '../TheoryNeck';
import { useTheoryDoc } from '../TheoryDoc';
import { chordLinkProblem, selectedChord } from './ChordFinder';

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

/** The triad a chord is built on, from its 3rd and 5th; null when it has none (sus, power chords, 7♭5). */
export function triadIn(chord: ChordInfo): Triad | null {
  const has = (interval: string) => chord.notes.some((n) => n.interval === interval);
  if (has('3') && has('5')) return 'maj';
  if (has('♭3') && has('5')) return 'm';
  if (has('♭3') && has('♭5')) return 'dim';
  if (has('3') && has('♯5')) return 'aug';
  return null;
}

/** Why a chord has no triad, for the message that says so. */
function noTriadReason(chord: ChordInfo): string {
  const has = (interval: string) => chord.notes.some((n) => n.interval === interval);
  if (!has('3') && !has('♭3')) return 'it has no 3rd';
  if (!has('5') && !has('♭5') && !has('♯5')) return 'it has no 5th';
  return 'its 3rd and 5th make none of them';
}

export function Triads() {
  const { doc } = useTheoryDoc();
  const inst = doc?.instrument ?? DEFAULT_THEORY.instrument;
  const [sel, select] = useSelection();
  const [inversion, setInversion] = useState<Inversion>(0);
  const [chosen, setChosen] = useState<{ key: string; id: string }>({ key: '', id: 'all' });

  const chord = selectedChord(sel);
  const linkProblem = chordLinkProblem(sel);
  const quality = triadIn(chord);
  const rootPc = pcOf(chord.root)!;
  // The chord's root spelled as the note picker writes it, when it has a button (not a double sharp or flat).
  const root = /^[A-G](#|b)?$/.test(chord.root) ? chord.root : rootName(rootPc, 'major');
  const triadSymbol = quality ? chordSymbol(chord.root, quality) : null;
  const parsed = triadSymbol ? chordInfo(triadSymbol) : null;
  const triad = parsed?.ok ? parsed.chord.notes : [];
  const symbol = triadSymbol ? pretty(triadSymbol) : pretty(chord.symbol);
  const inside = quality !== null && (chord.notes.length !== 3 || chord.bass !== null);
  const frets = neckFrets(inst);
  const sets = triadSets(inst, triad, inversion, frets);
  // A string set is rows of the neck: it belongs to the tuning it was picked on. Another tuning, or a set the
  // instrument no longer has, reads as All.
  const tuningKey = `${inst.kind} ${inst.tuning.join(' ')}`;
  const set = chosen.key === tuningKey && sets.some((s) => s.id === chosen.id) ? chosen.id : 'all';
  const setChosenSet = (id: string) => setChosen({ key: tuningKey, id });
  const shown = set === 'all' ? sets : sets.filter((s) => s.id === set);
  const drawn = quality ? shown.filter((s) => s.unavailable === null) : [];

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
      {linkProblem && (
        <p className={styles.errorText} role="alert">
          {linkProblem}. The link's chord was ignored; showing {pretty(chord.symbol)} instead.
        </p>
      )}
      <div className={styles.row}>
        <span className={styles.cap}>root</span>
        {/* A typed chord gives way to the triad it holds, on the new root; a quality from the chip row stays. */}
        <NotePicker
          label="Root"
          selected={[rootPc]}
          onPick={(pc) => select({ root: rootName(pc, 'major'), chord: null, bass: null, ...(sel.chord && quality ? { quality } : {}) })}
        />
      </div>
      <div className={styles.chipRow} role="group" aria-label="Triad">
        <span className={styles.cap}>Triad</span>
        {TRIADS.map((q) => (
          <button key={q} type="button" className={styles.chip} aria-pressed={q === quality} onClick={() => select({ root, quality: q, chord: null, bass: null })}>
            {q}
          </button>
        ))}
      </div>
      {quality && (
        <div className={styles.chipRow} role="group" aria-label="Strings">
          <span className={styles.cap}>Strings</span>
          <button type="button" className={styles.chip} aria-pressed={set === 'all'} onClick={() => setChosenSet('all')}>
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
              onClick={() => setChosenSet(s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}
      <div className={styles.row}>
        <b>{symbol}</b>
        <NoteChips notes={quality ? triad : chord.notes} />
      </div>
      {inside && (
        <p className={styles.dimText} role="status">
          Showing the {symbol} triad inside {pretty(chord.symbol)}.
        </p>
      )}
      {!quality ? (
        <p className={styles.errorText} role="alert">
          {symbol} holds no major, minor, diminished or augmented triad ({noTriadReason(chord)}), so none is shown. Pick a triad above.
        </p>
      ) : drawn.length === 0 ? (
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
