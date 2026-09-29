// Fretboard quiz (D-19): name the note, find the note, find the interval, spell
// the chord. Weak spots come up more often (quiz.ts). A wrong answer is marked
// and explained and the question stays until it is right; only the first try
// is scored. Focus settings are saved to theory.json. A focus that leaves
// nothing to ask, or a practise list that no longer matches, is said in words
// with a way out, never a blank screen or a different question (N-08).
import { useEffect, useRef, useState } from 'react';

import { DEFAULT_THEORY, type FretboardQuizSettings, type QuizAnswer } from '../../api/client';
import { mod12 } from '../../music/chordTones';
import type { Cell } from '../../music/positions';
import {
  focusFrets,
  focusRows,
  fretboardQuestion,
  NothingToPractise,
  pcAt,
  plainName,
  QuizFocusError,
  type FretboardQuestion,
} from '../../music/quiz';
import { chordInfo, pretty } from '../../music/spell';
import { neckFrets } from '../../music/tuning';
import { Button, Chip, Panel, Segmented } from '../../ui';
import { HelpBox, NotePicker, ToolHeader } from '../controls';
import { cellText, FretboardStats } from '../QuizStats';
import { RoundSummary } from '../RoundSummary';
import styles from '../Theory.module.css';
import { TheoryNeck, type NeckDot } from '../TheoryNeck';
import { useTheoryDoc } from '../TheoryDoc';
import { quizKey, ROUND, roundStats, useQuizRng, useQuizRound } from '../useQuizRound';

const MODES = [
  { value: 'name-note', label: 'Name the note' },
  { value: 'find-note', label: 'Find the note' },
  { value: 'find-interval', label: 'Find the interval' },
  { value: 'spell-chord', label: 'Spell the chord' },
] as const;

const INTERVAL_NAMES = ['unison', 'minor 2nd', 'major 2nd', 'minor 3rd', 'major 3rd', '4th', 'tritone', '5th', 'minor 6th', 'major 6th', 'minor 7th', 'major 7th'];

/** Keys 1–9, 0, -, = answer C … B in note-picker order (ui-spec §7). */
export const NOTE_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '='];

const HELP: Record<FretboardQuestion['mode'], string> = {
  'name-note':
    'One dot is lit: name it with the note buttons, or with the keys 1–9, 0, - and = for C … B. C♯ and D♭ are one button. A wrong answer is marked and explained, and the question stays; only the first attempt is scored.',
  'find-note':
    "Tap every place the note is, in the strings and frets you're practising. A wrong tap is marked ✕ and explained. The question only scores if you find every one without a wrong tap.",
  'find-interval':
    'Tap the note that far above the lit one. Any octave counts: the interval is by note name, so every matching note in the strings and frets you are practising is right, not only the one above it.',
  'spell-chord': 'Tap every chord tone inside the outlined frets, on the strings you are practising. A tone outside the outline does not count.',
};

interface Attempt {
  q: FretboardQuestion;
  started: number;
  failed: boolean;
  found: Cell[];
  wrong: Cell[];
  feedback: string | null;
}

/** Why there is no question: shown with a way out. */
interface Problem {
  kind: 'focus' | 'practise' | 'other';
  message: string;
}

const same = (a: Cell, b: Cell) => a.string === b.string && a.fret === b.fret;
const sameSet = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((x) => b.includes(x));
const OUTSIDE = "but not in the strings and frets you're practising";

export function FretboardQuiz() {
  const { doc, update } = useTheoryDoc();
  const inst = doc?.instrument ?? DEFAULT_THEORY.instrument;
  const settings = doc?.quiz.settings.fretboard ?? DEFAULT_THEORY.quiz.settings.fretboard;
  const round = useQuizRound();
  const rng = useQuizRng();
  // The ref is what handlers read, so two quick events cannot both answer one question.
  const attemptRef = useRef<Attempt | null>(null);
  const [attempt, setAttemptState] = useState<Attempt | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const lastItem = useRef<string | undefined>(undefined);
  const setAttempt = (a: Attempt | null) => {
    attemptRef.current = a;
    setAttemptState(a);
  };

  const frets = neckFrets(inst);
  const rows = inst.tuning.length;
  const focus = { strings: settings.strings, frets: settings.frets, accidentals: settings.accidentals };
  const [, hi] = focusFrets(inst, focus);

  /** The next question, from this render's settings and history plus answers not in it yet. Never the same item twice in a row. */
  const draw = (extra: readonly QuizAnswer[], only: string[] | undefined) => {
    try {
      const q = fretboardQuestion(settings.mode, inst, focus, [...round.history, ...extra], rng, lastItem.current, only);
      lastItem.current = q.item;
      setProblem(null);
      setAttempt({ q, started: Date.now(), failed: false, found: [], wrong: [], feedback: null });
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      const kind = error instanceof QuizFocusError ? 'focus' : error instanceof NothingToPractise ? 'practise' : 'other';
      if (kind === 'other') console.error(error);
      setAttempt(null);
      setProblem({ kind, message: error.message });
    }
  };

  // A new question whenever the mode, focus or instrument changes (and the first one).
  const focusKey = [doc !== null, settings.mode, settings.strings.join(), settings.frets.join(), settings.accidentals, inst.tuning.join()].join('|');
  useEffect(() => {
    // No readable document (the file could not be read mid-round): no question is on offer, so no key or tap can
    // answer one. The round's results are kept; when the file reads again a fresh question is drawn.
    if (doc) draw([], round.only);
    else {
      setAttempt(null);
      setProblem(null);
    }
    // Deliberately keyed on the focus alone: a new question is drawn for a new focus, not for every history change.
  }, [focusKey]);

  const setSettings = (patch: Partial<FretboardQuizSettings>) => {
    if ((Object.keys(patch) as (keyof FretboardQuizSettings)[]).every((k) => JSON.stringify(patch[k]) === JSON.stringify(settings[k]))) return;
    update((d) => ({ ...d, quiz: { ...d.quiz, settings: { ...d.quiz.settings, fretboard: { ...d.quiz.settings.fretboard, ...patch } } } }));
    round.restart();
  };

  const finish = (a: Attempt, text: string, msEach: number) => {
    setAttempt(null);
    const recorded = round.record({ quiz: 'fretboard', mode: a.q.mode, item: a.q.item, correct: !a.failed, ms: Math.max(0, Math.round(msEach)), text });
    if (recorded && !recorded.done) draw([recorded.stored], round.only);
  };

  const miss = (a: Attempt, cell: Cell | null, feedback: string) =>
    setAttempt({ ...a, failed: true, wrong: cell && !a.wrong.some((w) => same(w, cell)) ? [...a.wrong, cell] : a.wrong, feedback });

  const answerNote = (pc: number) => {
    const a = attemptRef.current;
    if (!doc || !a || a.q.mode !== 'name-note') return;
    if (pc === a.q.answerPc) finish(a, cellText(inst, a.q.item), Date.now() - a.started);
    else miss(a, null, `✕ not ${pretty(plainName(pc))}. Try again.`);
  };

  const tap = (cell: Cell) => {
    const a = attemptRef.current;
    if (!doc || !a || a.q.mode === 'name-note') return;
    const q = a.q;
    const pc = pcAt(inst, cell);
    const name = pretty(plainName(pc));
    if (q.mode === 'find-interval') {
      if (same(cell, q.cell)) return miss(a, null, "✕ that's the note you started from");
      if (q.targets.some((t) => same(t, cell))) return finish(a, cellText(inst, q.item), Date.now() - a.started);
      if (pc === q.answerPc) return miss(a, cell, `✕ that's ${name}, ${OUTSIDE}`);
      const d = mod12(pc - pcAt(inst, q.cell));
      return miss(a, cell, d === 0 ? `✕ that's ${name}, the note you started from` : `✕ that's ${name}, a ${INTERVAL_NAMES[d]} above`);
    }
    if (a.found.some((c) => same(c, cell))) return;
    if (q.targets.some((t) => same(t, cell))) {
      const found = [...a.found, cell];
      if (found.length < q.targets.length) return setAttempt({ ...a, found, feedback: null });
      const text = q.mode === 'find-note' ? `every ${pretty(plainName(q.pc))}` : pretty(q.symbol);
      // Time per note, so a chord of five is not slower than a single note.
      return finish({ ...a, found }, text, (Date.now() - a.started) / q.targets.length);
    }
    if (q.mode === 'spell-chord') {
      const info = chordInfo(q.symbol);
      const tone = info.ok && info.chord.notes.some((n) => n.pc === pc);
      if (!tone) return miss(a, cell, `✕ ${name} is not in ${pretty(q.symbol)}`);
      // A chord tone the player could be asked about somewhere else: only the outline is the problem.
      const [flo, fhi] = focusFrets(inst, focus);
      const practised = focusRows(inst, focus).includes(cell.string) && cell.fret >= flo && cell.fret <= fhi;
      return miss(a, cell, `✕ ${name} is in ${pretty(q.symbol)}, ${practised ? 'but outside the outlined frets' : OUTSIDE}`);
    }
    if (pc === q.pc) return miss(a, cell, `✕ that's ${name}, ${OUTSIDE}`);
    const near = q.targets.filter((t) => t.string === cell.string).sort((x, y) => Math.abs(x.fret - cell.fret) - Math.abs(y.fret - cell.fret))[0];
    const diff = near ? cell.fret - near.fret : 0;
    const how = near && Math.abs(diff) <= 2 ? `, ${Math.abs(diff)} fret${Math.abs(diff) > 1 ? 's' : ''} too ${diff > 0 ? 'high' : 'low'}` : '';
    miss(a, cell, `✕ that's ${name}${how}`);
  };

  // Name the note by keyboard. One listener per mode, always calling this render's handler.
  const onKey = useRef<(e: KeyboardEvent) => void>(() => {});
  onKey.current = (e) => {
    const key = quizKey(e);
    const pc = key === null ? -1 : NOTE_KEYS.indexOf(key);
    if (pc >= 0) answerNote(pc);
  };
  useEffect(() => {
    if (settings.mode !== 'name-note') return;
    const listener = (e: KeyboardEvent) => onKey.current(e);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [settings.mode]);

  const startRound = (only?: string[]) => {
    round.restart(only);
    draw([], only);
  };
  const widen = () => setSettings({ strings: [], frets: [0, frets], accidentals: true });
  const reset = round.resetHistory;

  const header = (
    <ToolHeader title="Fretboard quiz">
      <Segmented label="Quiz" value={settings.mode} onChange={(mode) => setSettings({ mode })} options={MODES} />
    </ToolHeader>
  );

  if (!doc) {
    return (
      <>
        {header}
        <p className={styles.errorText} role="alert">
          The quiz needs theory.json, which could not be read (see above), so it has nowhere to save your answers. Nothing was started.
        </p>
      </>
    );
  }

  const stats = roundStats(round.results);
  const q = attempt?.q;
  const dots: NeckDot[] = [];
  if (q && attempt) {
    if (q.mode === 'name-note') dots.push({ ...q.cell, label: '?', marker: 'question' });
    if (q.mode === 'find-interval') dots.push({ ...q.cell, label: pretty(plainName(pcAt(inst, q.cell))), marker: 'accent' });
    for (const c of attempt.found) dots.push({ ...c, label: pretty(plainName(pcAt(inst, c))), marker: 'ok' });
    for (const c of attempt.wrong) dots.push({ ...c, label: '', marker: 'wrong' });
  }
  const lowTwo = [rows - 1, rows - 2];
  const stringsValue = settings.strings.length === 0 || sameSet(settings.strings, Array.from({ length: rows }, (_, i) => i)) ? 'all' : sameSet(settings.strings, lowTwo) ? 'low' : 'custom';
  const lowNames = lowTwo.map((r) => pretty(inst.tuning[rows - 1 - r]!.replace(/-?\d+$/, ''))).join(' + ');
  const fretOptions = [[0, 5], [0, 12], [0, frets]] as const;

  return (
    <>
      {header}
      {round.done ? (
        <RoundSummary results={round.results} onRestart={startRound} />
      ) : problem ? (
        <Panel className={styles.stack}>
          <p className={styles.errorText} role="alert">
            {problem.message}
          </p>
          <div className={styles.row}>
            {problem.kind === 'focus' && <Button onClick={widen}>Widen the focus</Button>}
            {problem.kind === 'practise' && <Button onClick={() => startRound()}>Start a normal round</Button>}
          </div>
        </Panel>
      ) : (
        q &&
        attempt && (
          <>
            <div className={styles.row}>
              <div className={styles.stack}>
                <span className={styles.cap}>{`round ${round.number} of ${ROUND}`}</span>
                <span className={styles.big} aria-live="polite">
                  {q.prompt}
                </span>
                {q.mode === 'name-note' ? (
                  <span className={styles.dimText}>keys 1–9, 0, - and = answer C … B</span>
                ) : (
                  <span className={styles.dimText}>
                    {q.mode === 'find-interval'
                      ? 'tap the neck · any octave counts'
                      : `${attempt.found.length} found · ${q.targets.length - attempt.found.length} to go · tap the neck`}
                  </span>
                )}
                {round.only && <span className={styles.dimText}>practising the {round.only.length} weakest from your last round</span>}
              </div>
              <span className={styles.stat}>
                <b>{stats.correct}</b>/{stats.answered} first try
              </span>
              <span className={styles.stat}>
                <b>{stats.streak}</b> streak
              </span>
              <span className={styles.stat}>
                <b>{stats.avgSeconds.toFixed(1)}s</b> avg
              </span>
            </div>
            <div className={styles.neck}>
              <TheoryNeck
                instrument={inst}
                frets={Math.max(1, hi)}
                dots={dots}
                window={q.mode === 'spell-chord' ? { lo: q.window[0], hi: q.window[1] } : null}
                onPick={q.mode === 'name-note' ? undefined : tap}
                label={q.prompt}
              />
            </div>
            {q.mode === 'name-note' && <NotePicker label="Answer" selected={[]} onPick={answerNote} />}
          </>
        )
      )}
      <div role="status">
        {attempt?.feedback && (
          <Chip tone="error" size="lg">
            {attempt.feedback}
          </Chip>
        )}
      </div>
      <div className={styles.row}>
        <span className={styles.cap}>practise</span>
        <Segmented<string>
          label="Strings"
          value={stringsValue}
          onChange={(v) => setSettings({ strings: v === 'all' ? [] : lowTwo })}
          options={[
            { value: 'all', label: 'All strings' },
            { value: 'low', label: `${lowNames} only` },
          ]}
        />
        <Segmented<string>
          label="Frets"
          value={settings.frets.join('-')}
          onChange={(v) => setSettings({ frets: v.split('-').map(Number) as [number, number] })}
          options={fretOptions.map(([lo, top]) => ({ value: `${lo}-${top}`, label: `Frets ${lo}–${top}` }))}
        />
        <Segmented<string>
          label="Notes"
          value={settings.accidentals ? 'all' : 'naturals'}
          onChange={(v) => setSettings({ accidentals: v === 'all' })}
          options={[
            { value: 'naturals', label: 'Naturals' },
            { value: 'all', label: '+ sharps/flats' },
          ]}
        />
      </div>
      <HelpBox>{HELP[settings.mode]}</HelpBox>
      <FretboardStats instrument={inst} history={round.history} frets={frets} onReset={reset} />
    </>
  );
}
