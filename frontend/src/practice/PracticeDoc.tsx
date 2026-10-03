// practice.json in the browser (D-22): one GET, then every change is applied
// locally at once and PUT as the whole document after 500 ms of quiet. A failed
// save keeps the change in memory and says so with a Retry; an unreadable file
// is shown verbatim and never written over (N-08, U-09). Leaving the tab with a
// change pending sends it at once.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

import { api, DEFAULT_PRACTICE, type PracticeDoc } from '../api/client';

const KEY = ['practice'] as const;
const DEBOUNCE_MS = 500;

export interface PracticeDocState {
  doc: PracticeDoc | null;
  loadError: string | null;
  reload(): void;
  saveError: string | null;
  update(change: (doc: PracticeDoc) => PracticeDoc): boolean;
  retry(): void;
  resetToDefaults(): Promise<void>;
}

const Ctx = createContext<PracticeDocState | null>(null);

export function PracticeDocProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const query = useQuery({ queryKey: KEY, queryFn: () => api.get<PracticeDoc>('/api/practice'), retry: false });
  const [local, setLocal] = useState<PracticeDoc | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const latest = useRef<PracticeDoc | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const doc = local ?? query.data ?? null;
  latest.current = doc;

  const save = useCallback(async () => {
    timer.current = null;
    const body = latest.current;
    if (!body) return;
    try {
      client.setQueryData(KEY, await api.put<PracticeDoc>('/api/practice', body));
      setSaveError(null);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    }
  }, [client]);

  const update = useCallback(
    (change: (d: PracticeDoc) => PracticeDoc) => {
      const current = latest.current;
      if (!current) return false;
      const next = change(current);
      latest.current = next;
      setLocal(next);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void save(), DEBOUNCE_MS);
      return true;
    },
    [save],
  );

  // Leaving with a change pending: send it now rather than drop it.
  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
        void save();
      }
    },
    [save],
  );

  const resetToDefaults = useCallback(async () => {
    latest.current = DEFAULT_PRACTICE;
    setLocal(DEFAULT_PRACTICE);
    await save();
    await query.refetch();
  }, [save, query]);

  const value: PracticeDocState = {
    doc,
    loadError: query.error ? query.error.message : null,
    reload: () => void query.refetch(),
    saveError,
    update,
    retry: () => void save(),
    resetToDefaults,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePracticeDoc(): PracticeDocState {
  const state = useContext(Ctx);
  if (!state) throw new Error('usePracticeDoc outside PracticeDocProvider');
  return state;
}
