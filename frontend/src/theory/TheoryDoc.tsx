// theory.json in the browser (D-19): one GET, then every change is applied
// locally at once and PUT as the whole document. Instrument and last-tool
// changes are debounced 500 ms; quiz answers are sent immediately when a round
// ends. A failed save keeps the unsaved document in memory and says so with a
// Retry; nothing is dropped and nothing is retried silently (N-08).
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

import { api, DEFAULT_THEORY, type TheoryDoc } from '../api/client';

const KEY = ['theory'] as const;
const DEBOUNCE_MS = 500;

export interface TheoryDocState {
  /** The document as the player last changed it; null until the first GET succeeds. */
  doc: TheoryDoc | null;
  /** GET /api/theory failed: the server's message, verbatim (U-09). */
  loadError: string | null;
  /** The last PUT failed: its message. Cleared by the next successful save. */
  saveError: string | null;
  /** Applies `change` now and saves it: after 500 ms, or at once with `{ now: true }`. */
  update: (change: (doc: TheoryDoc) => TheoryDoc, options?: { now?: boolean }) => void;
  retry: () => void;
  /** PUTs the defaults over an unreadable theory.json. Only after the player confirms. */
  resetToDefaults: () => Promise<void>;
}

const Ctx = createContext<TheoryDocState | null>(null);

export function TheoryDocProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const query = useQuery({ queryKey: KEY, queryFn: () => api.get<TheoryDoc>('/api/theory'), retry: false });
  const [local, setLocal] = useState<TheoryDoc | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const latest = useRef<TheoryDoc | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gone = useRef(false);

  // One save at a time. A save asked for while one runs is remembered and run
  // once more, with the newest document, when the current one finishes; only
  // the last save to finish decides saveError, so a slow older success can
  // never clear a newer failure.
  const running = useRef<Promise<string | null> | null>(null);
  const again = useRef(false);

  const doc = local ?? query.data ?? null;

  // The server's document is the base until the player edits. A layout effect,
  // so the ref is set before any child's effect asks `update` for it.
  useLayoutEffect(() => {
    if (query.data && local === null) latest.current = query.data;
  }, [query.data, local]);

  /** Resolves with the last save's error message, or null when it succeeded. */
  const save = useCallback((): Promise<string | null> => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
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
        try {
          client.setQueryData(KEY, await api.put<TheoryDoc>('/api/theory', body));
          error = null;
        } catch (caught) {
          error = caught instanceof Error ? caught.message : String(caught);
        }
      } while (again.current);
      setSaveError(error);
      if (error && gone.current) {
        console.error(`theory.json was not saved on leaving the tab: ${error}`);
        if (latest.current) client.setQueryData(KEY, latest.current);
      }
      return error;
    })().finally(() => {
      running.current = null;
    });
    running.current = run;
    return run;
  }, [client]);

  const update = useCallback<TheoryDocState['update']>(
    (change, options) => {
      const base = latest.current;
      if (!base) return;
      const next = change(base);
      latest.current = next;
      setLocal(next);
      if (timer.current) clearTimeout(timer.current);
      if (options?.now) void save();
      else timer.current = setTimeout(() => void save(), DEBOUNCE_MS);
    },
    [save],
  );

  // Leaving the tab with a change pending or in flight still saves it. If that
  // fails there is no provider left to show a banner, so the message goes to
  // the console and the document is parked in the query cache: coming back
  // shows the unsaved document rather than silently dropping it (N-08). React
  // runs this cleanup before those of the components below it, and a quiz saves
  // its round from its own cleanup, so a save that starts after this one has
  // run must report its failure the same way: `gone` is what tells it to.
  useEffect(() => {
    gone.current = false;
    return () => {
      gone.current = true;
      if (timer.current) void save();
    };
  }, [save]);

  const resetToDefaults = useCallback(async () => {
    latest.current = DEFAULT_THEORY;
    setLocal(DEFAULT_THEORY);
    await save();
    await client.invalidateQueries({ queryKey: KEY });
  }, [client, save]);

  const value = useMemo<TheoryDocState>(
    () => ({
      doc,
      loadError: query.error ? query.error.message : null,
      saveError,
      update,
      retry: () => void save(),
      resetToDefaults,
    }),
    [doc, query.error, saveError, update, save, resetToDefaults],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheoryDoc(): TheoryDocState {
  const value = useContext(Ctx);
  if (!value) throw new Error('useTheoryDoc outside <TheoryDocProvider>');
  return value;
}
