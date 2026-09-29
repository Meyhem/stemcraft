// theory.json in the browser (D-19): one GET, then every change is applied
// locally at once and PUT as the whole document. Instrument and last-tool
// changes are debounced 500 ms; quiz answers are sent immediately when a round
// ends. A failed save keeps the unsaved document in memory and says so with a
// Retry; nothing is dropped and nothing is retried silently (N-08).
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

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

  const doc = local ?? query.data ?? null;
  latest.current = doc;

  const save = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const body = latest.current;
    if (!body) return;
    try {
      const saved = await api.put<TheoryDoc>('/api/theory', body);
      client.setQueryData(KEY, saved);
      setSaveError(null);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    }
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

  // Leaving the tab with a debounced change pending still saves it.
  useEffect(
    () => () => {
      if (timer.current) void save();
    },
    [save],
  );

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
