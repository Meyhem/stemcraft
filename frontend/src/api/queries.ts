// D-13: the server owns this state; the client only caches it. No store.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';

import {
  api,
  type Analysis,
  type CreatedSong,
  type Health,
  type Job,
  type Song,
  type SongEntry,
} from './client';

export const queryKeys = {
  health: ['health'] as const,
  songs: ['songs'] as const,
  jobs: (active: boolean) => ['jobs', active] as const,
};

export function useHealth() {
  return useQuery({ queryKey: queryKeys.health, queryFn: () => api.get<Health>('/api/health') });
}

export function useSongs() {
  return useQuery({
    queryKey: queryKeys.songs,
    queryFn: () => api.get<{ songs: SongEntry[] }>('/api/songs'),
    select: (data) => data.songs,
  });
}

export function useCreateSongFromUpload() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (form: FormData) => api.upload<CreatedSong>('/api/songs/upload', form),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.songs }),
  });
}

export interface FromUrlInput {
  url: string;
  title: string;
  artist?: string;
}

export function useCreateSongFromUrl() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: FromUrlInput) => api.post<CreatedSong>('/api/songs/from-url', body),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.songs }),
  });
}

export function useDeleteSong() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (songId: string) => api.del(`/api/songs/${songId}`),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.songs }),
  });
}

export function useJobs(active = false) {
  return useQuery({
    queryKey: queryKeys.jobs(active),
    queryFn: () => api.get<{ jobs: Job[] }>(`/api/jobs${active ? '?active=true' : ''}`),
    select: (data) => data.jobs,
  });
}

export function useEnqueueProbe() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ id: number }>('/api/jobs', { kind: 'probe', payload: {} }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['jobs'] }),
  });
}

export function useAnalysis(songId: string | undefined) {
  return useQuery({
    queryKey: ['analysis', songId],
    queryFn: () => api.get<Analysis>(`/api/songs/${songId}/analysis`),
    enabled: Boolean(songId),
  });
}

export function useSong(songId: string | undefined) {
  return useQuery({
    queryKey: ['song', songId],
    queryFn: () => api.get<SongEntry>(`/api/songs/${songId}`),
    enabled: Boolean(songId),
  });
}

const AUTOSAVE_DEBOUNCE_MS = 600;

/**
 * Whole-document autosave for the practice recipe (§6). Trailing debounce: a
 * dragged tempo slider fires dozens of changes a second and every one of them
 * is a complete song.json -- sending the trail would be pointless writes, and
 * §5's last-write-wins means only the final one could ever matter anyway.
 */
export function useUpdateSong(songId: string | undefined) {
  const client = useQueryClient();
  const timer = useRef<number | null>(null);
  const pending = useRef<Song | null>(null);

  const mutation = useMutation({
    mutationFn: (song: Song) => api.put<SongEntry>(`/api/songs/${song.id}`, song),
    // Cache key comes from the *response's* song id, never from the enclosing
    // render's `songId`. `useMutation` re-runs `observer.setOptions` on every
    // render, so this closure always carries whichever `songId` was current
    // when the mutation happened to resolve -- which, across a debounce
    // window, can be a different song than the one that was actually queued
    // (e.g. the owning component re-renders under a new `:songId` route param
    // instead of unmounting). The server takes the id from disk (Task 3), so
    // `entry.song.id` is authoritative for which row this response belongs to.
    onSuccess: (entry) => {
      if (entry.song) client.setQueryData(['song', entry.song.id], entry);
      client.invalidateQueries({ queryKey: queryKeys.songs });
    },
  });

  // Depend on `mutation.mutate` (stable per TanStack Query's own useCallback),
  // not the `mutation` result object (a fresh object every render): the
  // latter would recreate `flush` on every render, and since flush is
  // registered as the unmount cleanup below, that would fire a save on every
  // re-render rather than only on unmount.
  const { mutate } = mutation;
  const flush = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    const song = pending.current;
    pending.current = null;
    if (song) mutate(song);
  }, [mutate]);

  const save = useCallback(
    (song: Song) => {
      pending.current = song;
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(flush, AUTOSAVE_DEBOUNCE_MS);
    },
    [flush],
  );

  useEffect(() => () => flush(), [flush]);

  return { save, flush, error: mutation.error };
}

export function useCancelJob() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (jobId: number) => api.post(`/api/jobs/${jobId}/cancel`),
    onSuccess: () => client.invalidateQueries({ queryKey: ['jobs'] }),
  });
}
