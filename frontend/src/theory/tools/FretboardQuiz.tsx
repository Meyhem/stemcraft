// Fretboard quiz (D-19): name the note, find the note, find the interval, spell
// the chord. It is relaxed practice: no score, rounds, streaks or clocks. A wrong
// answer is marked and explained and the question stays until it is right; what
// you found tricky quietly comes up a little more often (quiz.ts). Focus settings
// are saved to theory.json. A focus that leaves nothing to ask is said in words
// with a way out, never a blank screen or a different question (N-08).
import { useEffect, useRef, useState } from 'react';

import { DEFAULT_THEORY, type FretboardQuizSettings, type QuizAnswer } from '../../api/client';
import { mod12 } from '../../music/chordTones';
import type { Cell } from '../../music/positions';
import {
  focusFrets,
  focusRows,
  SEMITONE_NAMES,
  fretboardQuestion,
  pcAt,
  plainName,
  QuizFocusError,
  type FretboardQuestion,
} from '../../music/quiz';
import { chordInfo, pretty } from '../../music/spell';
import { neckFrets } from '../../music/tuning';
import { Button, Chip, Panel, Segmented } from '../../ui';
import { HelpBox, NotePicker, ToolHeader } from '../controls';
import { FocusControls } from '../FocusControls';
import { StartFresh } from '../StartFresh';
import styles from '../Theory.module.css';
import { TheoryNeck, type NeckDot } from '../TheoryNeck';
import { useTheoryDoc } from '../TheoryDoc';
import { quizKey, useQuizHistory, useQuizRng } from '../useQuizHistory';

const MODES = [
  { value: 'name-note', label: 'Name the note' },
  { value: 'find-note', label: 'Find the note' },
  { value: 'find-interval', label: 'Find the interval' },
  { value: 'spell-chord', label: 'Spell the chord' },
] as const;

/** Keys 1–9, 0, -, = answer C … B in note-picker order (ui-spec §7). */
export const NOTE_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '='];

const HELP: Record<FretboardQuestion['mode'], string> = {
  'name-note':
    'One dot is lit: name it with the note buttons, or with the keys 1–9, 0, - and = for C … B. C♯ and D♭ are one button. A wrong answer is marked and explained, and the question stays until you find it.',
  'find-note':
    "Tap every place the note is, in the strings and frets you're practising. A wrong tap is marked ✕ and explained.",
  'find-interval':
    'Tap the note that far above the lit one. Any octave counts: the interval is by note name, so every matching note in the strings and frets you are practising is right, not only the one above it.',
  'spell-chord': 'Tap every chord tone inside the outlined frets, on the strings you are practising. A tone outside the outline does not count.',
};

interface Attempt {
  q: FretboardQuestion;
  failed: boolean;
  found: Cell[];
  wrong: Cell[];
  feedback: string | null;
}

/** Why there is no question: shown with a way out. */
interface Problem {
  kind: 'focus' | 'other';
  message: string;
}

const same = (a: Cell, b: Cell) => a.string === b.string && a.fret === b.fret;
const OUTSIDE = "but not in the strings and frets you're practising";

export function FretboardQuiz() {
  const { doc, update } = useTheoryDoc();
  const inst = doc?.instrument ?? DEFAULT_THEORY.instrument;
  const settings = doc?.quiz.settings.fretboard ?? DEFAULT_THEORY.quiz.settings.fretboard;
  const practice = useQuizHistory();
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
  const focus = { strings: settings.strings, frets: settings.frets, accidentals: settings.accidentals };
  const [, hi] = focusFrets(inst, focus);

  /** The next question, from this render's settings and history plus answers not in it yet. Never the same item twice in a row. */
  const draw = (extra: readonly QuizAnswer[]) => {
    try {
      const q = fretboardQuestion(settings.mode, inst, focus, [...practice.history, ...extra], rng, lastItem.current);
      lastItem.current = q.item;
      setProblem(null);
      setAttempt({ q, failed: false, found: [], wrong: [], feedback: null });
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      const kind = error instanceof QuizFocusError ? 'focus' : 'other';
      if (kind === 'other') console.error(error);
      setAttempt(null);
      setProblem({ kind, message: error.message });
    }
  };

  // A new question whenever the mode, focus or instrument changes (and the first one).
  const focusKey = [doc !== null, settings.mode, settings.strings.join(), settings.frets.join(), settings.accidentals, inst.tuning.join()].join('|');
  useEffect(() => {
    // No readable document (the file could not be read mid-round): no question is on offer, so no key or tap can
    // answer one. When the file reads again a fresh question is drawn.
    if (doc) draw([]);
    else {
      setAttempt(null);
      setProblem(null);
    }
    // Deliberately keyed on the focus alone: a new question is drawn for a new focus, not for every history change.
  }, [focusKey]);

  const setSettings = (patch: Partial<FretboardQuizSettings>) => {
    if ((Object.keys(patch) as (keyof FretboardQuizSettings)[]).every((k) => JSON.stringify(patch[k]) === JSON.stringify(settings[k]))) return;
    update((d) => ({ ...d, quiz: { ...d.quiz, settings: { ...d.quiz.settings, fretboard: { ...d.quiz.settings.fretboard, ...patch } } } }));
  };

  const finish = (a: Attempt) => {
    setAttempt(null);
    // The first try is what informs which questions come back; nothing is shown or counted.
    const stored = practice.record({ quiz: 'fretboard', mode: a.q.mode, item: a.q.item, correct: !a.failed });
    draw([stored]);
  };

  const miss = (a: Attempt, cell: Cell | null, feedback: string) =>
    setAttempt({ ...a, failed: true, wrong: cell && !a.wrong.some((w) => same(w, cell)) ? [...a.wrong, cell] : a.wrong, feedback });

  const answerNote = (pc: number) => {
    const a = attemptRef.current;
    if (!doc || !a || a.q.mode !== 'name-note') return;
    if (pc === a.q.answerPc) finish(a);
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
      if (q.targets.some((t) => same(t, cell))) return finish(a);
      if (pc === q.answerPc) return miss(a, cell, `✕ that's ${name}, ${OUTSIDE}`);
      const d = mod12(pc - pcAt(inst, q.cell));
      return miss(a, cell, d === 0 ? `✕ that's ${name}, the note you started from` : `✕ that's ${name}, a ${SEMITONE_NAMES[d]} above`);
    }
    if (a.found.some((c) => same(c, cell))) return;
    if (q.targets.some((t) => same(t, cell))) {
      const found = [...a.found, cell];
      if (found.length < q.targets.length) return setAttempt({ ...a, found, feedback: null });
      return finish({ ...a, found });
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
    const how = near && Math.abs(diff) <= 2 ? `, ${['', 'one fret', 'two frets'][Math.abs(diff)]} too ${diff > 0 ? 'high' : 'low'}` : '';
    miss(a, cell, `✕ that's ${name}${how}`);
  };

  // Name the note by keyboard. One listener per mode, always calling this render's handler. Shift is let through:
  // AZERTY and Czech/Slovak QWERTZ type the digits with it, and Shift+- and Shift+= are _ and +, not note keys.
  const onKey = useRef<(e: KeyboardEvent) => void>(() => {});
  onKey.current = (e) => {
    const key = quizKey(e, { shift: true });
    const pc = key === null ? -1 : NOTE_KEYS.indexOf(key);
    if (pc >= 0) answerNote(pc);
  };
  useEffect(() => {
    if (settings.mode !== 'name-note') return;
    const listener = (e: KeyboardEvent) => onKey.current(e);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [settings.mode]);

  const widen = () => setSettings({ strings: [], frets: [0, frets], accidentals: true });

  const header = (
    <ToolHeader title="Fretboard quiz">
      {/* Without a readable theory.json a mode could be neither saved nor played: no switch that does nothing. */}
      {doc && <Segmented label="Quiz" value={settings.mode} onChange={(mode) => setSettings({ mode })} options={MODES} />}
    </ToolHeader>
  );

  if (!doc) {
    return (
      <>
        {header}
        <p className={styles.errorText} role="alert">
          The quiz needs theory.json, which could not be read (see above), so it has nowhere to keep your place. Nothing was started.
        </p>
      </>
    );
  }

  const q = attempt?.q;
  const dots: NeckDot[] = [];
  if (q && attempt) {
    if (q.mode === 'name-note') dots.push({ ...q.cell, label: '?', marker: 'question' });
    if (q.mode === 'find-interval') dots.push({ ...q.cell, label: pretty(plainName(pcAt(inst, q.cell))), marker: 'accent' });
    for (const c of attempt.found) dots.push({ ...c, label: pretty(plainName(pcAt(inst, c))), marker: 'ok' });
    for (const c of attempt.wrong) dots.push({ ...c, label: '', marker: 'wrong' });
  }
  return (
    <>
      {header}
      {problem ? (
        <Panel className={styles.stack}>
          <p className={styles.errorText} role="alert">
            {problem.message}
          </p>
          <div className={styles.row}>
            {problem.kind === 'focus' && <Button onClick={widen}>Widen the focus</Button>}
          </div>
        </Panel>
      ) : (
        q &&
        attempt && (
          <>
            <div className={styles.row}>
              <div className={styles.stack}>
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
              </div>
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
      <FocusControls inst={inst} focus={focus} onChange={setSettings} />
      <HelpBox>{HELP[settings.mode]}</HelpBox>
      <StartFresh onReset={practice.resetHistory} />
    </>
  );
}
