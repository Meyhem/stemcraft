// Weak spots (D-19): a heatmap over the neck for the fretboard quiz (answers
// asked in this tuning only) and the weakest facts for the theory quiz, both
// computed from the history on every render and never stored. Reset history
// asks first.
import type { QuizAnswer } from '../api/client';
import { cellItem, cellItemTuning, heatmap, mulberry32, parseCellKey, theoryQuestion, tuningTag, weakestFacts } from '../music/quiz';
import { pretty } from '../music/spell';
import type { Instrument } from '../music/tuning';
import { Button, Panel } from '../ui';
import styles from './Theory.module.css';
import { TheoryNeck } from './TheoryNeck';

/**
 * A position in words, named exactly as TheoryNeck names its click targets: "A string, fret 7", "E string, open",
 * and with the octave ("E2 string") when two strings share a note letter. Takes a cell item ("E1-A1-D2-G2/s2f7") or a
 * bare cell key. A key that is not a cell of this instrument (an item from another tuning, a row it does not have) is
 * returned as it is, not dressed up as a position.
 */
export function cellText(inst: Instrument, key: string): string {
  const cell = parseCellKey(key);
  const tuning = cellItemTuning(key);
  const rows = [...inst.tuning].reverse();
  if (!cell || cell.string >= rows.length || (tuning !== null && tuning !== tuningTag(inst))) return key;
  const letters = rows.map((n) => n.replace(/-?\d+$/, ''));
  const shared = letters.filter((l) => l === letters[cell.string]).length > 1;
  const string = pretty(shared ? rows[cell.string]! : letters[cell.string]!);
  return `${string} string, ${cell.fret === 0 ? 'open' : `fret ${cell.fret}`}`;
}

function ResetHistory({ onReset }: { onReset: () => void }) {
  const reset = () => {
    if (window.confirm('Delete your whole quiz history? Your weak spots start again from scratch.')) onReset();
  };
  return (
    <Button variant="ghost" onClick={reset}>
      Reset history…
    </Button>
  );
}

export function FretboardStats({
  instrument,
  history,
  frets,
  onReset,
}: {
  instrument: Instrument;
  history: readonly QuizAnswer[];
  /** The neck's fret count. Cells past it, and strings the instrument does not have, are not drawn or listed. */
  frets: number;
  onReset: () => void;
}) {
  const heat = heatmap(history, instrument).filter((h) => h.string < instrument.tuning.length && h.fret <= frets);
  const weakest = [...heat].sort((a, b) => b.weakness - a.weakness).slice(0, 3).filter((h) => h.weakness >= 0.5);
  return (
    <Panel className={styles.stack}>
      <div className={styles.row}>
        <span className={styles.cap}>your weak spots · last 5 answers per position</span>
        <ResetHistory onReset={onReset} />
      </div>
      <div className={styles.neck}>
        <TheoryNeck instrument={instrument} frets={Math.max(1, frets)} dots={[]} heat={heat} label="Weak spots" />
      </div>
      <p className={styles.dimText}>
        {heat.length === 0
          ? 'No answers yet: play a round and your weak spots show up here.'
          : weakest.length === 0
            ? 'No weak spots right now.'
            : `Weakest: ${weakest.map((h) => cellText(instrument, cellItem(instrument, h))).join(' · ')}. `}
        {heat.length > 0 && "Shown in red: positions you've missed or been slow on."}
      </p>
    </Panel>
  );
}

/** A fact as the question reads. An item this version does not know is named as it is, not hidden or crashed on. */
function factText(item: string): string {
  try {
    return theoryQuestion(item, mulberry32(1)).prompt;
  } catch {
    return `${item} (not a question this version asks)`;
  }
}

export function TheoryStats({ history, onReset }: { history: readonly QuizAnswer[]; onReset: () => void }) {
  const facts = weakestFacts(history, 10);
  return (
    <Panel className={styles.stack}>
      <div className={styles.row}>
        <span className={styles.cap}>your weakest facts · last 5 answers each</span>
        <ResetHistory onReset={onReset} />
      </div>
      {facts.length === 0 ? (
        <p className={styles.dimText}>No answers yet: play a round and your weakest facts show up here.</p>
      ) : (
        <ol className={styles.list}>
          {facts.map((f) => (
            <li key={f.item} className={styles.listRow}>
              {factText(f.item)} <span className={styles.dimText}>{Math.round(f.weakness * 100)}% weak</span>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}
