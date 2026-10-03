// Guess the note (D-23): a note is played in the instrument's voice, an A first
// unless the reference is off, and the player names it or finds it on the neck.
// Relaxed practice like the other quizzes: no score, rounds, streaks or clocks;
// a wrong answer is explained and the question stays; replays are free. Nothing
// sounds before Play (browsers need a gesture); after it, each question plays by
// itself. Without sound there is no quiz: the engine's error is shown (N-08).
import { useEffect, useRef, useState } from 'react';

import { DEFAULT_THEORY, type EarQuizSettings, type QuizAnswer } from '../../api/client';
import { earQuestion, judgeName, judgeNeck, pitchLabel, type EarQuestion } from '../../music/earQuiz';
import { positionAt, type Cell } from '../../music/positions';
import { focusFrets, QuizFocusError } from '../../music/quiz';
import { neckFrets } from '../../music/tuning';
import { Button, Chip, Panel, Segmented } from '../../ui';
// A namespace import so a test can spy on renderGuess to learn which note was asked.
import * as guessAudio from '../audio/guessRender';
import { HelpBox, NotePicker, ToolHeader } from '../controls';
import { FocusControls } from '../FocusControls';
import { StartFresh } from '../StartFresh';
import styles from '../Theory.module.css';
import { TheoryNeck, type NeckDot } from '../TheoryNeck';
import { useTheoryDoc } from '../TheoryDoc';
import { useGuessSound } from '../useGuessSound';
import { quizKey, useQuizHistory, useQuizRng } from '../useQuizHistory';
import { NOTE_KEYS } from './FretboardQuiz';

const ANSWERS = [
  { value: 'name', label: 'Name it' },
  { value: 'neck', label: 'On the neck' },
] as const;
const REFERENCES = [
  { value: 'a', label: 'A first' },
  { value: 'none', label: 'No reference' },
] as const;

const HELP: Record<EarQuizSettings['answer'], string> = {
  name: 'Listen, then name the note with the buttons or the keys 1–9, 0, - and = for C … B. Any octave counts. Space plays it again as often as you like; only your first answer is remembered, to bring tricky notes back a little more often.',
  neck: 'Listen, then tap where the note is. It must be the same pitch, not just the same name, but any string will do. Space plays it again as often as you like.',
};

interface Attempt {
  q: EarQuestion;
  failed: boolean;
  wrong: Cell[];
  feedback: string | null;
}

/** Why there is no question: shown with a way out. */
interface Problem {
  kind: 'focus' | 'other';
  message: string;
}

export function GuessNote() {
  const { doc, update } = useTheoryDoc();
  const inst = doc?.instrument ?? DEFAULT_THEORY.instrument;
  const settings = doc?.quiz.settings.ear ?? DEFAULT_THEORY.quiz.settings.ear;
  const practice = useQuizHistory();
  const rng = useQuizRng();
  const sound = useGuessSound();
  // Whether Play has been pressed: until then nothing may sound and nothing can be answered.
  const armedRef = useRef(false);
  const [armed, setArmed] = useState(false);
  const attemptRef = useRef<Attempt | null>(null);
  const [attempt, setAttemptState] = useState<Attempt | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [last, setLast] = useState<number | null>(null);
  const lastItem = useRef<string | undefined>(undefined);
  const setAttempt = (a: Attempt | null) => {
    attemptRef.current = a;
    setAttemptState(a);
  };

  const focus = { strings: settings.strings, frets: settings.frets, accidentals: settings.accidentals };
  const [, hi] = focusFrets(inst, focus);

  const say = (q: EarQuestion) => void sound.play(guessAudio.renderGuess(inst.kind, q.midi, q.reference));

  const draw = (extra: readonly QuizAnswer[]) => {
    try {
      const q = earQuestion(settings.answer, settings.reference, inst, focus, [...practice.history, ...extra], rng, lastItem.current);
      lastItem.current = q.item;
      setProblem(null);
      setAttempt({ q, failed: false, wrong: [], feedback: null });
      if (armedRef.current) say(q);
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      const kind = error instanceof QuizFocusError ? 'focus' : 'other';
      if (kind === 'other') console.error(error);
      setAttempt(null);
      setProblem({ kind, message: error.message });
    }
  };

  const focusKey = [doc !== null, settings.answer, settings.reference, settings.strings.join(), settings.frets.join(), settings.accidentals, inst.kind, inst.tuning.join()].join('|');
  useEffect(() => {
    setLast(null);
    if (doc) draw([]);
    else {
      setAttempt(null);
      setProblem(null);
    }
    // Keyed on the focus alone, as in the Fretboard quiz.
  }, [focusKey]);

  const setSettings = (patch: Partial<EarQuizSettings>) => {
    if ((Object.keys(patch) as (keyof EarQuizSettings)[]).every((k) => JSON.stringify(patch[k]) === JSON.stringify(settings[k]))) return;
    update((d) => ({
      ...d,
      quiz: { ...d.quiz, settings: { ...d.quiz.settings, ear: { ...(d.quiz.settings.ear ?? DEFAULT_THEORY.quiz.settings.ear), ...patch } } },
    }));
  };

  const start = () => {
    armedRef.current = true;
    setArmed(true);
    if (attemptRef.current) say(attemptRef.current.q);
  };
  const again = () => (armedRef.current ? void sound.replay() : start());

  const finish = (a: Attempt) => {
    setAttempt(null);
    const stored = practice.record({ quiz: 'ear', mode: a.q.mode, item: a.q.item, correct: !a.failed });
    setLast(a.q.midi);
    draw([stored]);
  };

  const answerName = (pc: number) => {
    const a = attemptRef.current;
    if (!doc || !a || !armedRef.current || settings.answer !== 'name') return;
    const feedback = judgeName(a.q.midi, pc);
    if (feedback === null) finish(a);
    else setAttempt({ ...a, failed: true, feedback });
  };

  const tap = (cell: Cell) => {
    const a = attemptRef.current;
    if (!doc || !a || !armedRef.current || settings.answer !== 'neck') return;
    const feedback = judgeNeck(a.q.midi, positionAt(inst, cell).midi);
    if (feedback === null) return finish(a);
    const known = a.wrong.some((w) => w.string === cell.string && w.fret === cell.fret);
    setAttempt({ ...a, failed: true, wrong: known ? a.wrong : [...a.wrong, cell], feedback });
  };

  // Space replays in both modes; the note keys answer in name mode. Shift is let through for the digits (as in the Fretboard quiz).
  const onKey = useRef<(e: KeyboardEvent) => void>(() => {});
  onKey.current = (e) => {
    const key = quizKey(e, { shift: true });
    if (key === ' ') {
      e.preventDefault(); // not a page scroll
      again();
      return;
    }
    const pc = key === null ? -1 : NOTE_KEYS.indexOf(key);
    if (pc >= 0) answerName(pc);
  };
  useEffect(() => {
    const listener = (e: KeyboardEvent) => onKey.current(e);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);

  const widen = () => setSettings({ strings: [], frets: [0, neckFrets(inst)], accidentals: true });

  const header = (
    <ToolHeader title="Guess the note">
      {doc && <Segmented label="How to answer" value={settings.answer} onChange={(answer) => setSettings({ answer })} options={ANSWERS} />}
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
  const dots: NeckDot[] = (attempt?.wrong ?? []).map((c) => ({ ...c, label: '', marker: 'wrong' }));
  const prompt = settings.reference === 'a' ? 'A, then which note?' : 'Which note?';

  return (
    <>
      {header}
      {problem ? (
        <Panel className={styles.stack}>
          <p className={styles.errorText} role="alert">
            {problem.message}
          </p>
          <div className={styles.row}>{problem.kind === 'focus' && <Button onClick={widen}>Widen the focus</Button>}</div>
        </Panel>
      ) : sound.error ? (
        <p className={styles.errorText} role="alert">
          Can't play the note: {sound.error}
        </p>
      ) : (
        q && (
          <>
            <div className={styles.row}>
              <div className={styles.stack}>
                <span className={styles.big} aria-live="polite">
                  {prompt}
                </span>
                <span className={styles.dimText}>
                  {settings.answer === 'name' ? 'Space plays it again · keys 1–9, 0, - and = answer C … B' : 'Space plays it again · tap where it is'}
                </span>
                {last !== null && <span className={styles.dimText}>That was {pitchLabel(last)}</span>}
              </div>
              <Button onClick={again}>{armed ? (sound.playing ? 'Playing…' : '↻ Replay') : '▶ Play'}</Button>
            </div>
            {armed &&
              (settings.answer === 'neck' ? (
                <div className={styles.neck}>
                  <TheoryNeck instrument={inst} frets={Math.max(1, hi)} dots={dots} onPick={tap} label={prompt} />
                </div>
              ) : (
                <NotePicker label="Answer" selected={[]} onPick={answerName} />
              ))}
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
      <div className={styles.row}>
        <span className={styles.cap}>reference</span>
        <Segmented label="Reference" value={settings.reference} onChange={(reference) => setSettings({ reference })} options={REFERENCES} />
      </div>
      <HelpBox>{HELP[settings.answer]}</HelpBox>
      <StartFresh onReset={practice.resetHistory} />
    </>
  );
}
