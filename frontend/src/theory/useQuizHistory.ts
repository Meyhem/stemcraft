// Quiz practice (D-19): there are no rounds, scores or timers. Each first-try answer is
// appended to theory.json's history at once, and only ever used to bring facts you found
// tricky back a little more often (quiz.ts). A failed save is the screen's "Couldn't save"
// banner with Retry (TheoryDoc), never a silent loss (N-08).
import { useCallback, useRef } from 'react';

import type { QuizAnswer } from '../api/client';
import { mulberry32, type Rng } from '../music/quiz';
import { useTheoryDoc } from './TheoryDoc';

/** The server keeps the newest 2,000 answers (theory.py HISTORY_CAP); the client never sends more, and trims the oldest. */
export const HISTORY_CAP = 2000;

export interface QuizHistory {
  /** Every answer so far: what question weighting reads. */
  history: QuizAnswer[];
  /** Adds the first-try answer to the history and returns what was stored. */
  record: (answer: Omit<QuizAnswer, 'at'>) => QuizAnswer;
  /** Forgets everything practised so far, in one PUT. */
  resetHistory: () => void;
}

/** Where the quiz's random seed comes from: the clock in the app, a fixed number in a test. */
export const seeds = { next: (): number => Date.now() };

/** One Rng for the life of the screen. Every random choice a quiz makes goes through it. */
export function useQuizRng(): Rng {
  const rng = useRef<Rng | null>(null);
  rng.current ??= mulberry32(seeds.next());
  return rng.current;
}

export function useQuizHistory(): QuizHistory {
  const { doc, update } = useTheoryDoc();

  const record = useCallback<QuizHistory['record']>(
    (r) => {
      const stored: QuizAnswer = { ...r, at: new Date().toISOString() };
      // `keep`: if the tab is left before the save lands, the answer waits for the next visit instead of being dropped.
      update((d) => ({ ...d, quiz: { ...d.quiz, history: [...d.quiz.history, stored].slice(-HISTORY_CAP) } }), { now: true, keep: true });
      return stored;
    },
    [update],
  );

  const resetHistory = useCallback(() => {
    update((d) => ({ ...d, quiz: { ...d.quiz, history: [] } }), { now: true });
  }, [update]);

  return { history: doc?.quiz.history ?? [], record, resetHistory };
}

/**
 * The key a quiz should act on, or null when it should not: with Ctrl, Alt, Meta or Shift, auto-repeating (holding
 * a key must not answer the next question too), already handled, or typed into a field. `shift: true` lets Shift
 * through, for digits: an AZERTY keyboard types 1–4 with Shift, and no other layout makes Shift+digit report a digit.
 */
export function quizKey(e: KeyboardEvent, options: { shift?: boolean } = {}): string | null {
  if (e.ctrlKey || e.altKey || e.metaKey || (e.shiftKey && !options.shift) || e.repeat || e.defaultPrevented) return null;
  const t = e.target;
  if (t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(t.tagName))) return null;
  return e.key;
}
