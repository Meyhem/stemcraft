// theory.json in the browser (D-19): one GET, then every change is applied
// locally at once and PUT as the whole document. Instrument and last-tool
// changes are debounced 500 ms; quiz answers are sent immediately, one by one. A
// failed save keeps the unsaved document in memory and says so with a Retry; nothing is dropped and nothing is retried silently (N-08).
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { api, ApiError, DEFAULT_THEORY, type QuizAnswer, type TheoryDoc } from '../api/client';
import { holdUnloadGuard, releaseUnloadGuard } from './unloadGuard';

const KEY = ['theory'] as const;
const DEBOUNCE_MS = 500;

// The document a Theory tab was left holding unsaved (a failed save, or one still in flight or pending), kept
// outside the query cache so that a refetch on coming back cannot overwrite it. The next tab to open applies it
// over the fetched document and saves it again; it is cleared only by a save that succeeded (or a reset). Never set
// from a document that was not loaded (N-08: unsaved answers are not dropped, and an unreadable file is not
// overwritten). While it exists the browser warns before the page is closed, because nothing else holds it.
let unsaved: TheoryDoc | null = null;
const KEPT = {};

function keepUnsaved(doc: TheoryDoc): void {
  unsaved = doc;
  holdUnloadGuard(KEPT);
}

function clearUnsaved(): void {
  unsaved = null;
  releaseUnloadGuard(KEPT);
}

/** Forgets an unsaved document without saving it. For tests; the app clears it by saving. */
export function forgetUnsavedTheory(): void {
  clearUnsaved();
}

const HISTORY_CAP = 2000; // theory.py's HISTORY_CAP: the server keeps the newest 2,000 answers

const asTime = (at: string) => Date.parse(at);

/**
 * Two answer histories as one: every answer of either, once (same quiz, mode, item and time), oldest first, the
 * newest 2,000. Another browser tab may have added answers to the file since the kept document was made.
 */
export function mergeHistory(fetched: readonly QuizAnswer[], kept: readonly QuizAnswer[]): QuizAnswer[] {
  const seen = new Set<string>();
  const all = [...fetched, ...kept].filter((a) => {
    const key = JSON.stringify([a.quiz, a.mode, a.item, a.at]);
    return !seen.has(key) && seen.add(key);
  });
  // Array.sort is stable: answers of one instant keep the order they came in. An unreadable time compares as text.
  all.sort((a, b) => (Number.isNaN(asTime(a.at)) || Number.isNaN(asTime(b.at)) ? (a.at < b.at ? -1 : a.at > b.at ? 1 : 0) : asTime(a.at) - asTime(b.at)));
  return all.slice(-HISTORY_CAP);
}

export interface TheoryDocState {
  /** The document as the player last changed it; null until the first GET succeeds. */
  doc: TheoryDoc | null;
  /** GET /api/theory failed: the server's message, verbatim (U-09). */
  loadError: string | null;
  /**
   * The failed GET was the API saying theory.json itself cannot be read (its 500 carries a `detail`), not a failure
   * to reach the API (a network error, or a proxy's 5xx while the API restarts).
   */
  fileUnreadable: boolean;
  /** Reads theory.json again, after a failed read. A read that works applies a kept document as usual. */
  reload: () => void;
  /** The last PUT failed: its message. Cleared by the next successful save. */
  saveError: string | null;
  /**
   * Changes left unsaved on an earlier visit (and any made since) are waiting for this visit's read of theory.json
   * before anything is saved, so that the read's answers are merged in rather than overwritten. Nothing is written
   * meanwhile; a slow or hanging read holds the saves, and this says so.
   */
  holding: boolean;
  /**
   * Applies `change` now and saves it: after 500 ms, or at once with `{ now: true }`. Returns whether it was applied:
   * false while there is no readable document (nothing is written over an unreadable file, U-09). With `{ keep: true }`
   * a change that would be refused because the file cannot be read now is instead kept in memory, with a message in
   * the console and the unload warning, and goes out after the next read that works: for answers that must not be
   * dropped (N-08). It is still false when no document was ever loaded to add them to.
   */
  update: (change: (doc: TheoryDoc) => TheoryDoc, options?: { now?: boolean; keep?: boolean }) => boolean;
  retry: () => void;
  /** PUTs the defaults over an unreadable theory.json. Only after the player confirms. */
  resetToDefaults: () => Promise<void>;
}

const Ctx = createContext<TheoryDocState | null>(null);

/** FastAPI's own errors are JSON with a `detail`; a proxy with the API down answers with an empty or plain body. */
function saysUnreadable(error: Error | null): boolean {
  if (!(error instanceof ApiError) || error.status !== 500) return false;
  try {
    const body: unknown = JSON.parse(error.body);
    return typeof body === 'object' && body !== null && typeof (body as { detail?: unknown }).detail === 'string';
  } catch {
    return false;
  }
}

export function TheoryDocProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const query = useQuery({ queryKey: KEY, queryFn: () => api.get<TheoryDoc>('/api/theory'), retry: false });
  const [local, setLocal] = useState<TheoryDoc | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const latest = useRef<TheoryDoc | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gone = useRef(false);
  // Changes made vs. changes a successful PUT carried: dirty while `rev` is ahead. A change made while a save is in
  // flight stays dirty when that save succeeds, because the save sent the document as it was.
  const rev = useRef(0);
  const savedRev = useRef(0);
  const guard = useRef({}); // this provider's hold on the unload guard
  const lastError = useRef<string | null>(null);
  // A kept document (see `unsaved`) this mount has not applied yet. Until it is, nothing may be saved: the document
  // on screen is the cached one, and a save of it would clear the kept answers without carrying them. Edits made
  // meanwhile are remembered as functions and re-applied on top of the kept document.
  const awaitingKept = useRef(unsaved !== null);
  const edits = useRef<((doc: TheoryDoc) => TheoryDoc)[]>([]);
  const waiting = () => awaitingKept.current && unsaved !== null;
  // Set by Reset to defaults, the one write allowed over a file that could not be read.
  const overridden = useRef(false);

  // One save at a time. A save asked for while one runs is remembered and run
  // once more, with the newest document, when the current one finishes; only
  // the last save to finish decides saveError, so a slow older success can
  // never clear a newer failure.
  const running = useRef<Promise<string | null> | null>(null);
  const again = useRef(false);

  // A refetch that fails leaves TanStack holding the old data, but the file can no longer be read: no document is
  // offered, and nothing is saved over it (U-09), until a reset or a read that works.
  const unreadable = query.isError && !overridden.current;
  const blocked = useRef(false);
  blocked.current = unreadable;
  const doc = unreadable ? null : local ?? query.data ?? null;
  // Read during render: every change to it (a kept document applied, an edit while waiting, a reset) sets `local`.
  const holding = waiting() && !query.isError;

  // The server's document is the base until the player edits. A layout effect,
  // so the ref is set before any child's effect asks `update` for it.
  useLayoutEffect(() => {
    if (query.data && local === null) latest.current = query.data;
  }, [query.data, local]);

  // While anything is unsaved the browser is asked to warn before the page is closed or reloaded. Kept off React
  // state: a save finishing must not cause a render of its own. Once the tab is gone the kept document holds the
  // guard instead.
  const warnIfUnsaved = useCallback(() => {
    if (!gone.current && rev.current > savedRev.current) holdUnloadGuard(guard.current);
    else releaseUnloadGuard(guard.current);
  }, []);

  /** Unsaved changes were left in memory for the next tab: say so and why, once the final state is known (N-08). */
  const leave = useCallback((reason: string | null) => {
    console.error(`theory.json has unsaved changes, kept in memory for the next visit${reason ? `: ${reason}` : ''}`);
  }, []);

  /** Resolves with the last save's error message, or null when it succeeded. */
  const save = useCallback((): Promise<string | null> => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (waiting()) return Promise.resolve(null); // sent after the kept document is applied, with the edits on top
    if (running.current) {
      again.current = true;
      return running.current;
    }
    const run = (async () => {
      let error: string | null = null;
      do {
        again.current = false;
        const body = latest.current;
        if (!body) break;
        const sent = rev.current;
        try {
          client.setQueryData(KEY, await api.put<TheoryDoc>('/api/theory', body));
          savedRev.current = Math.max(savedRev.current, sent);
          if (rev.current <= savedRev.current && !waiting()) clearUnsaved();
          error = null;
        } catch (caught) {
          error = caught instanceof Error ? caught.message : String(caught);
        }
      } while (again.current);
      lastError.current = error;
      setSaveError(error);
      warnIfUnsaved();
      if (error && gone.current) {
        if (latest.current) keepUnsaved(latest.current);
        leave(error);
      }
      // Done, as of now: a save asked for from here on starts a run of its own. Left to the `finally` below, one asked
      // for in the microtask between this return and that callback would set `again` on a loop that has already
      // exited, and be lost.
      running.current = null;
      return error;
    })().finally(() => {
      if (running.current === run) running.current = null; // this run threw: nothing else will clear it
    });
    running.current = run;
    return run;
  }, [client, leave, warnIfUnsaved]);

  const update = useCallback<TheoryDocState['update']>(
    (change, options) => {
      const base = latest.current;
      if (!base) return false;
      if (blocked.current) {
        if (!options?.keep) return false;
        // The file cannot be read: nothing is sent. The change waits in memory, to be merged into the file's after the
        // next good read (the layout effect below). `doc` stays null meanwhile (the file is unreadable), so nothing
        // here touches what is shown, and `local` is not set: the document the player sees comes from the apply.
        rev.current += 1;
        if (waiting()) {
          // A kept document from an earlier visit is already waiting for this mount's read. The change goes on top
          // of THAT (as the leave path does with `edits`), never on the cached document: replacing the kept one
          // with the cached one would silently drop the answers it holds.
          keepUnsaved(change(unsaved!));
        } else {
          const kept = change(base);
          latest.current = kept;
          keepUnsaved(kept);
          awaitingKept.current = true;
          edits.current = [];
        }
        warnIfUnsaved();
        console.error('theory.json cannot be read, so these changes are kept in memory and saved after the next read that works');
        return true;
      }
      const next = change(base);
      if (waiting()) edits.current.push(change);
      latest.current = next;
      rev.current += 1;
      // A change made while the tab is going (a quiz's last flush): held until it is saved. Before a kept document is
      // applied it goes on top of that one, not of the cached document the change was made to.
      if (gone.current) {
        if (waiting()) {
          keepUnsaved(edits.current.reduce((d, edit) => edit(d), unsaved!));
          edits.current = []; // folded into the kept document: a later fold must not apply them twice
        } else keepUnsaved(next);
      }
      warnIfUnsaved();
      setLocal(next);
      if (timer.current) clearTimeout(timer.current);
      if (options?.now) void save();
      else timer.current = setTimeout(() => void save(), DEBOUNCE_MS);
      return true;
    },
    [save, warnIfUnsaved],
  );

  // Coming back to a tab that was left holding unsaved changes: once THIS mount has read the file (a fetch in
  // flight, or one that failed, writes nothing: an unreadable file must not be replaced), the kept document is
  // applied and saved again through the normal path, so a failure shows the usual "Couldn't save" banner with
  // Retry. The kept document wins, but its answers are merged with the file's, since another browser tab may
  // have added some meanwhile. A layout effect, so it shows no flash of the fetched document.
  useLayoutEffect(() => {
    if (!query.data || query.isFetching || query.isError || !waiting() || !unsaved) return;
    const kept: TheoryDoc = { ...unsaved, quiz: { ...unsaved.quiz, history: mergeHistory(query.data.quiz.history, unsaved.quiz.history) } };
    const merged = edits.current.reduce((d, edit) => edit(d), kept);
    awaitingKept.current = false;
    edits.current = [];
    latest.current = merged;
    rev.current += 1;
    warnIfUnsaved();
    setLocal(merged);
    void save();
  }, [query.data, query.isFetching, query.isError, save, warnIfUnsaved]);

  // The file became unreadable while this tab held changes of its own that no save has carried: they are kept in
  // memory, like a tab's left behind, and go out after a read that works (the layout effect above).
  useEffect(() => {
    if (!query.isError || awaitingKept.current || overridden.current) return;
    if (rev.current > savedRev.current && latest.current) {
      keepUnsaved(latest.current);
      awaitingKept.current = true;
      edits.current = [];
    }
  }, [query.isError]);

  // Once the file reads again, a reset is over and the file's word is final again.
  useEffect(() => {
    if (!query.isError) overridden.current = false;
  }, [query.isError]);

  // Leaving the tab with a change pending or in flight still saves it. If that fails there is no provider left to
  // show a banner, so the message goes to the console and the document is kept for the next tab (N-08). React runs
  // this cleanup before those of the components below it, and a quiz saves its round from its own cleanup, so a
  // save that starts after this one has run reports its failure the same way: `gone` is what tells it to. A save
  // that had already failed is reported once the children's cleanups have run, when it is known whether one of
  // them has saved it after all.
  useEffect(() => {
    gone.current = false;
    warnIfUnsaved(); // a StrictMode remount takes the guard back
    return () => {
      gone.current = true;
      warnIfUnsaved();
      const dirtyNow = rev.current > savedRev.current;
      // Not yet applied: the kept document stays, with this mount's edits on top; the cached one is not what to keep.
      if (waiting() && unsaved) {
        keepUnsaved(edits.current.reduce((d, edit) => edit(d), unsaved));
        edits.current = []; // folded into the kept document (a StrictMode remount must not apply them twice)
        if (timer.current) clearTimeout(timer.current);
        timer.current = null;
        if (dirtyNow) leave(null);
        return;
      }
      if (dirtyNow && latest.current) keepUnsaved(latest.current);
      if (timer.current) void save();
      else if (!running.current && dirtyNow) {
        void Promise.resolve().then(() => {
          if (!gone.current || running.current || timer.current || rev.current <= savedRev.current) return;
          leave(lastError.current);
        });
      }
    };
  }, [save, leave, warnIfUnsaved]);

  const resetToDefaults = useCallback(async () => {
    latest.current = DEFAULT_THEORY;
    rev.current += 1;
    overridden.current = true;
    awaitingKept.current = false;
    edits.current = [];
    clearUnsaved();
    warnIfUnsaved();
    setLocal(DEFAULT_THEORY);
    await save();
    await client.invalidateQueries({ queryKey: KEY });
  }, [client, save, warnIfUnsaved]);

  const value = useMemo<TheoryDocState>(
    () => ({
      doc,
      loadError: query.error ? query.error.message : null,
      fileUnreadable: saysUnreadable(query.error),
      holding,
      reload: () => void query.refetch(),
      saveError,
      update,
      retry: () => void save(),
      resetToDefaults,
    }),
    [doc, query.error, query.refetch, saveError, holding, update, save, resetToDefaults],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheoryDoc(): TheoryDocState {
  const value = useContext(Ctx);
  if (!value) throw new Error('useTheoryDoc outside <TheoryDocProvider>');
  return value;
}
