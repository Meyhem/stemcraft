// One quiz round (D-19): 20 questions, only the first try at each one scored.
// Answers are held here and appended to theory.json's history in one PUT when
// the round ends, or when the player restarts or leaves mid-round. A failed
// save is the screen's "Couldn't save" banner with Retry: the answers are
// already in the document by then, so Retry sends them once, never twice.
import { useCallback, useEffect, useRef, useState } from 'react';

import type { QuizAnswer } from '../api/client';
import { mulberry32, type Rng } from '../music/quiz';
import { useTheoryDoc } from './TheoryDoc';
import { holdUnloadGuard, releaseUnloadGuard } from './unloadGuard';

export const ROUND = 20;

/** The server keeps the newest 2,000 answers (theory.py HISTORY_CAP); the client never sends more, and trims the oldest. */
export const HISTORY_CAP = 2000;

export interface Result extends QuizAnswer {
  /** How the item reads in the summary: "A string, fret 7", "every G", "V of E♭". */
  text: string;
}

export interface Round {
  /** 1-based number of the current question. */
  number: number;
  results: Result[];
  done: boolean;
  /** History plus this round's unsaved answers: what weighting reads. */
  history: QuizAnswer[];
  /**
   * Adds the first-try answer to this round. Returns what was stored and whether it finished the round, or null
   * when the round was already complete (a late key press): nothing is recorded then.
   */
  record: (result: Omit<Result, 'at'>) => { stored: QuizAnswer; done: boolean } | null;
  /** Saves what this round has, then starts a new one, optionally limited to some items ("Practise these"). */
  restart: (only?: string[]) => void;
  /** Deletes the whole history, including this round's unsaved answers, in one PUT. */
  resetHistory: () => void;
  only: string[] | undefined;
}

/** Where the quiz's random seed comes from: the clock in the app, a fixed number in a test. */
export const seeds = { next: (): number => Date.now() };

/** One Rng for the life of the screen. Every random choice a quiz makes goes through it. */
export function useQuizRng(): Rng {
  const rng = useRef<Rng | null>(null);
  rng.current ??= mulberry32(seeds.next());
  return rng.current;
}

interface RoundState {
  results: Result[];
  /** Answers of this round that are not in the document yet. */
  unsaved: QuizAnswer[];
}

export function useQuizRound(): Round {
  const { doc, update } = useTheoryDoc();
  // The ref is the truth for handlers and cleanups; the state makes the screen redraw.
  const state = useRef<RoundState>({ results: [], unsaved: [] });
  const [view, setView] = useState<RoundState>(state.current);
  const [only, setOnly] = useState<string[] | undefined>(undefined);
  const commit = useCallback((next: RoundState) => {
    state.current = next;
    setView(next);
  }, []);

  // One PUT with every unsaved answer. `update` applies it to the document at once, so nothing is held back
  // here after this call, and a failed save leaves the answers in the document for Retry. Answers are only let go
  // of once `update` has taken them (into the document, or, while the file cannot be read, into the kept copy that
  // goes out after the next good read); if it takes nothing they stay here (N-08).
  const flush = useCallback(() => {
    const answers = state.current.unsaved;
    if (answers.length === 0) return;
    const taken = update((d) => ({ ...d, quiz: { ...d.quiz, history: [...d.quiz.history, ...answers].slice(-HISTORY_CAP) } }), {
      now: true,
      keep: true,
    });
    if (taken) commit({ ...state.current, unsaved: [] });
    else console.error(`${answers.length} quiz answers could not be saved: theory.json was never read, so there is no document to add them to`);
  }, [commit, update]);

  const record = useCallback<Round['record']>(
    (r) => {
      if (state.current.results.length >= ROUND) return null;
      const answer: Result = { ...r, at: new Date().toISOString() };
      const { text: _text, ...stored } = answer;
      commit({ results: [...state.current.results, answer], unsaved: [...state.current.unsaved, stored] });
      const done = state.current.results.length >= ROUND;
      if (done) flush();
      return { stored, done };
    },
    [commit, flush],
  );

  // Answers not yet in the document are lost if the browser tab is closed or reloaded, so the browser is asked to
  // warn for as long as there are any. The effect's own cleanup lets go, so a StrictMode remount takes it back.
  const owner = useRef({});
  const unsavedCount = view.unsaved.length;
  useEffect(() => {
    if (unsavedCount === 0) return;
    holdUnloadGuard(owner.current);
    return () => releaseUnloadGuard(owner.current);
  }, [unsavedCount]);

  // Leaving the quiz mid-round (another tool, another tab) still saves what was answered.
  useEffect(() => () => flush(), [flush]);

  const restart = useCallback(
    (items?: string[]) => {
      flush();
      commit({ results: [], unsaved: state.current.unsaved }); // whatever the flush could not hand over stays
      setOnly(items?.length ? [...new Set(items)] : undefined);
    },
    [flush, commit],
  );

  const resetHistory = useCallback(() => {
    if (update((d) => ({ ...d, quiz: { ...d.quiz, history: [] } }), { now: true })) commit({ ...state.current, unsaved: [] });
  }, [commit, update]);

  return {
    number: Math.min(view.results.length + 1, ROUND),
    results: view.results,
    done: view.results.length >= ROUND,
    history: [...(doc?.quiz.history ?? []), ...view.unsaved],
    record,
    restart,
    resetHistory,
    only,
  };
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

/** Score of a round so far. No streak or timing is shown: they make practice stressful. */
export function roundStats(results: readonly Result[]) {
  const correct = results.filter((r) => r.correct).length;
  return { correct, answered: results.length };
}

/** The 3 weakest items of a round, one entry per item (its worst answer): wrong first, then slowest. */
export function weakestOfRound(results: readonly Result[]): Result[] {
  const worse = (a: Result, b: Result) => Number(a.correct) - Number(b.correct) || b.ms - a.ms;
  const worst = new Map<string, Result>();
  for (const r of results) {
    const seen = worst.get(r.item);
    if (!seen || worse(r, seen) < 0) worst.set(r.item, r);
  }
  return [...worst.values()].sort(worse).slice(0, 3);
}
