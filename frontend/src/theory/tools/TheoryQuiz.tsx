// Theory quiz (D-19): keys, chords and intervals as four-option questions.
// Wrong options are plausible (neighbouring keys, one changed chord tone). A
// wrong pick is crossed out and the question stays; only the first pick counts.
// The keys 1–4 choose. A topic list that leaves nothing to ask, or a practise
// list that no longer matches, is said in words with a way out, never a blank
// screen or a different question (N-08).
import { useEffect, useRef, useState } from 'react';

import { DEFAULT_THEORY, type QuizAnswer, type TheoryQuizSettings } from '../../api/client';
import { mulberry32, nextTheoryQuestion, NothingToPractise, QuizFocusError, theoryQuestion, type TheoryQuestion } from '../../music/quiz';
import { explainWrong } from '../../music/quizExplain';
import { pretty } from '../../music/spell';
import { Button, Chip, Panel } from '../../ui';
import { HelpBox, ToolHeader } from '../controls';
import { TheoryStats } from '../QuizStats';
import { RoundSummary } from '../RoundSummary';
import styles from '../Theory.module.css';
import { useTheoryDoc } from '../TheoryDoc';
import { quizKey, ROUND, roundStats, useQuizRng, useQuizRound } from '../useQuizRound';

type Topic = TheoryQuizSettings['topics'][number];

/** In this order, always: the order the chips are shown and the order the setting is saved in. */
const TOPICS: readonly { value: Topic; label: string }[] = [
  { value: 'keys', label: 'Keys' },
  { value: 'chords', label: 'Chords' },
  { value: 'intervals', label: 'Intervals' },
];
const ALL_TOPICS = TOPICS.map((t) => t.value);
const OPTION_KEYS = ['1', '2', '3', '4'];

/** How a fact reads in the round summary: "V of E♭", "B♭m7 from its notes", "C up to A". */
export function factText(item: string): string {
  const [kind, a = ''] = item.split(':');
  switch (kind) {
    case 'v':
      return `V of ${pretty(a)}`;
    case 'rel':
      return `relative minor of ${pretty(a)}`;
    case 'sig':
      return `key signature of ${pretty(a)}`;
    case 'notes':
      return `notes of ${pretty(a)}`;
    case 'name':
      return `${pretty(a)} from its notes`;
    case 'ivl':
      return theoryQuestion(item, mulberry32(1)).prompt.replace(/ is a…$/, '');
    default:
      return item;
  }
}

interface Attempt {
  q: TheoryQuestion;
  started: number;
  /** Option indexes picked wrongly so far, in order. */
  wrong: number[];
}

/** Why there is no question: shown with a way out. */
interface Problem {
  kind: 'focus' | 'practise' | 'other';
  message: string;
}

export function TheoryQuiz() {
  const { doc, update } = useTheoryDoc();
  const topics = doc?.quiz.settings.theory.topics ?? DEFAULT_THEORY.quiz.settings.theory.topics;
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

  /** The next question, from this render's topics and history plus answers not in it yet. Never the same item twice in a row. */
  const draw = (extra: readonly QuizAnswer[], only: string[] | undefined) => {
    try {
      const q = nextTheoryQuestion(topics, [...round.history, ...extra], rng, lastItem.current, only);
      lastItem.current = q.item;
      setProblem(null);
      setAttempt({ q, started: Date.now(), wrong: [] });
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      const kind = error instanceof QuizFocusError ? 'focus' : error instanceof NothingToPractise ? 'practise' : 'other';
      if (kind !== 'practise') console.error(error);
      setAttempt(null);
      setProblem({ kind, message: error.message });
    }
  };

  // A new question whenever the topics change (and the first one).
  const topicKey = `${doc !== null}|${topics.join()}`;
  useEffect(() => {
    // No readable document (the file could not be read mid-round): no question is on offer, so no key can answer one.
    // The round's results are kept; when the file reads again the flip of `doc` above draws a fresh question.
    if (doc) draw([], round.only);
    else {
      setAttempt(null);
      setProblem(null);
    }
    // Deliberately keyed on the topics alone: a new question is drawn for new topics, not for every history change.
  }, [topicKey]);

  const setTopics = (next: Topic[]) => {
    if (next.length === 0) return; // theory.json requires at least one; the last chip is disabled, this is the backstop
    if (next.length === topics.length && next.every((t) => topics.includes(t))) return;
    update((d) => ({ ...d, quiz: { ...d.quiz, settings: { ...d.quiz.settings, theory: { ...d.quiz.settings.theory, topics: next } } } }));
    round.restart();
  };
  const toggleTopic = (topic: Topic) => setTopics(ALL_TOPICS.filter((t) => (t === topic ? !topics.includes(t) : topics.includes(t))));

  const finish = (a: Attempt) => {
    setAttempt(null);
    const recorded = round.record({
      quiz: 'theory',
      mode: a.q.topic,
      item: a.q.item,
      // Only the first pick is scored: any wrong pick before the right one is a miss.
      correct: a.wrong.length === 0,
      // Time to the right answer, retries included (a quick wrong tap would otherwise look "strong").
      ms: Math.max(0, Date.now() - a.started),
      text: factText(a.q.item),
    });
    if (recorded && !recorded.done) draw([recorded.stored], round.only);
  };

  const choose = (i: number) => {
    const a = attemptRef.current;
    if (!doc || !a || i < 0 || i >= a.q.options.length || a.wrong.includes(i)) return;
    if (i === a.q.answer) finish(a);
    else setAttempt({ ...a, wrong: [...a.wrong, i] });
  };

  // Keys 1–4 choose. One listener for the life of the quiz, always calling this render's handler.
  const onKey = useRef<(e: KeyboardEvent) => void>(() => {});
  onKey.current = (e) => {
    const key = quizKey(e, { shift: true });
    if (key !== null) choose(OPTION_KEYS.indexOf(key));
  };
  useEffect(() => {
    const listener = (e: KeyboardEvent) => onKey.current(e);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);

  const startRound = (only?: string[]) => {
    round.restart(only);
    draw([], only);
  };

  const header = (
    <ToolHeader title="Theory quiz">
      {doc && (
        <div className={styles.choices} role="group" aria-label="Topics">
          {TOPICS.map((t) => {
            const last = topics.length === 1 && topics.includes(t.value);
            return (
              <button
                key={t.value}
                type="button"
                className={styles.chip}
                aria-pressed={topics.includes(t.value)}
                disabled={last}
                aria-describedby={last ? 'theory-topic-reason' : undefined}
                onClick={() => toggleTopic(t.value)}
              >
                {t.label}
              </button>
            );
          })}
          {topics.length === 1 && (
            <span id="theory-topic-reason" className={styles.dimText}>
              At least one topic stays on.
            </span>
          )}
        </div>
      )}
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
  const lastWrong = attempt && attempt.wrong.length > 0 ? q!.options[attempt.wrong[attempt.wrong.length - 1]!] : null;

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
            {problem.kind === 'practise' && <Button onClick={() => startRound()}>Start a normal round</Button>}
            {problem.kind !== 'practise' && <Button onClick={() => draw([], round.only)}>Try again</Button>}
            {problem.kind !== 'practise' && topics.length < ALL_TOPICS.length && <Button onClick={() => setTopics(ALL_TOPICS)}>Use all topics</Button>}
          </div>
        </Panel>
      ) : (
        q &&
        attempt && (
          <>
            <div className={styles.row}>
              <div className={styles.stack}>
                <span className={styles.cap}>{`round ${round.number} of ${ROUND}`}</span>
                <h2 className={styles.big} aria-live="polite">
                  {q.prompt}
                </h2>
                <span className={styles.dimText}>keys 1–4 choose</span>
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
            <div className={styles.list} role="group" aria-label="Answers">
              {q.options.map((o, i) => (
                <button key={o} type="button" className={styles.option} disabled={attempt.wrong.includes(i)} aria-keyshortcuts={OPTION_KEYS[i]} onClick={() => choose(i)}>
                  <span aria-hidden="true" className={styles.dimText}>
                    {i + 1}.{' '}
                  </span>
                  <span>{o}</span>
                  {attempt.wrong.includes(i) && <span aria-hidden="true"> ✕</span>}
                </button>
              ))}
            </div>
          </>
        )
      )}
      <div role="status">
        {lastWrong && (
          <Chip tone="error" size="lg">
            <span aria-hidden="true">✕ </span>
            {explainWrong(q!.item, lastWrong)} Try again.
          </Chip>
        )}
      </div>
      <HelpBox>
        Pick the answer with the buttons or the keys 1–4. A wrong pick is crossed out and the question stays until you find the right one, but only your first pick is scored. Wrong options are plausible on purpose:
        neighbouring keys, a chord with one tone changed. Turn topics on and off above; at least one stays on.
      </HelpBox>
      <TheoryStats history={round.history} onReset={round.resetHistory} />
    </>
  );
}
