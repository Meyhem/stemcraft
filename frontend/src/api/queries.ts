// D-13: the server owns this state; the client only caches it. No store.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';

import {
  albumMedia,
  api,
  type Album,
  type AlbumEntry,
  type AlbumTrackFile,
  type Analysis,
  type CreatedAlbum,
  type CreatedSong,
  type ExportEntry,
  type ExportRequest,
  type Health,
  type Job,
  type PeaksDoc,
  type Proposals,
  type QueuedExport,
  type QueuedSplit,
  type StepDecl,
  type Song,
  type SongEntry,
  type Transcription,
} from './client';
import { sendTrackToLibrary } from '../splitter/toLibrary';

export const queryKeys = {
  health: ['health'] as const,
  songs: ['songs'] as const,
  jobs: (active: boolean) => ['jobs', active] as const,
  // Under ['jobs', ...] so the job stream's prefix invalidation refreshes it live.
  songJobs: (songId: string | undefined) => ['jobs', 'song', songId] as const,
  jobKinds: ['job-kinds'] as const,
  exports: (songId: string | undefined) => ['exports', songId] as const,
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

export function useTranscription(songId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['transcription', songId],
    queryFn: () => api.get<Transcription>(`/api/songs/${songId}/transcription`),
    enabled: Boolean(songId) && enabled,
  });
}

/** D-21: enqueue (or re-run) the bass transcription. The job stream does the rest. */
export function useStartTranscription(songId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ job_id: number }>(`/api/songs/${songId}/transcribe`),
    onSuccess: () => client.invalidateQueries({ queryKey: ['jobs'] }),
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

export function useExports(songId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.exports(songId),
    queryFn: () => api.get<{ exports: ExportEntry[] }>(`/api/songs/${songId}/exports`),
    select: (data) => data.exports,
    enabled: Boolean(songId),
  });
}

export function useQueueExport(songId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: ExportRequest) =>
      api.post<QueuedExport>(`/api/songs/${songId}/export`, body),
    // The render itself is a job; the file appears when it finishes, which the
    // screen learns from the jobs query the WebSocket already invalidates.
    onSuccess: () => client.invalidateQueries({ queryKey: ['jobs'] }),
  });
}

// Q-04: an album is a standalone tool's document, not a Song. These hooks
// share nothing with the song ones above beyond the `api` helper and the
// autosave shape.

export function useAlbums() {
  return useQuery({
    queryKey: ['albums'],
    queryFn: () => api.get<{ albums: AlbumEntry[] }>('/api/albums'),
    select: (data) => data.albums,
  });
}

export function useAlbum(albumId: string | undefined) {
  return useQuery({
    queryKey: ['album', albumId],
    queryFn: () => api.get<AlbumEntry>(`/api/albums/${albumId}`),
    enabled: Boolean(albumId),
  });
}

export function useProposals(albumId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['album-proposals', albumId],
    queryFn: () => api.get<Proposals>(`/api/albums/${albumId}/proposals`),
    enabled: Boolean(albumId) && enabled,
    // A 404 here means "the import job has not finished", which is a state, not
    // a failure — retrying on it would just hammer the route.
    retry: false,
  });
}

// The album waveform. Like the proposals above, a 404 means "the import job
// has not finished" -- a state, not a failure, so it is not retried.
export function useAlbumPeaks(albumId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['album-peaks', albumId],
    queryFn: () => api.get<PeaksDoc>(albumMedia(albumId!).peaks),
    enabled: Boolean(albumId) && enabled,
    retry: false,
  });
}

export function useUploadAlbum() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (form: FormData) => api.upload<CreatedAlbum>('/api/albums/upload', form),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['albums'] });
      client.invalidateQueries({ queryKey: ['jobs'] });
    },
  });
}

/**
 * Whole-document autosave for the split recipe (D8-05), mirroring
 * useUpdateSong above. Trailing debounce for the same reason: a dragged split
 * marker fires dozens of changes a second, each one a complete album.json.
 */
export function useUpdateAlbum(albumId: string | undefined) {
  const client = useQueryClient();
  const timer = useRef<number | null>(null);
  const pending = useRef<Album | null>(null);

  const mutation = useMutation({
    mutationFn: (album: Album) => api.put<AlbumEntry>(`/api/albums/${album.id}`, album),
    // Cache key comes from the *response's* album id, never from the enclosing
    // render's `albumId` — see useUpdateSong's comment above for why the
    // closure over `albumId` can't be trusted across a debounce window.
    onSuccess: (entry) => {
      if (entry.album) client.setQueryData(['album', entry.album.id], entry);
      client.invalidateQueries({ queryKey: ['albums'] });
    },
  });

  // Returns whether the document is saved, and never rejects: both the
  // debounce timer and the unmount effect below call it without a catch, and
  // the error is already surfaced through `mutation.error` (N-08). The boolean
  // exists for the one caller that must not proceed on a failed save -- Split,
  // which queues a job against whatever album.json is on disk (D8-05).
  const { mutateAsync } = mutation;
  const flush = useCallback(async (): Promise<boolean> => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    const album = pending.current;
    pending.current = null;
    if (!album) return true;
    try {
      await mutateAsync(album);
      return true;
    } catch {
      return false;
    }
  }, [mutateAsync]);

  const save = useCallback(
    (album: Album) => {
      pending.current = album;
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(flush, AUTOSAVE_DEBOUNCE_MS);
    },
    [flush],
  );

  useEffect(() => () => void flush(), [flush]);

  return { save, flush, error: mutation.error };
}

export function useQueueSplit() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (albumId: string) => api.post<QueuedSplit>(`/api/albums/${albumId}/split`),
    onSuccess: () => client.invalidateQueries({ queryKey: ['jobs'] }),
  });
}

export function useAlbumTracks(albumId: string | undefined) {
  return useQuery({
    queryKey: ['album-tracks', albumId],
    queryFn: () => api.get<{ tracks: AlbumTrackFile[] }>(`/api/albums/${albumId}/tracks`),
    enabled: Boolean(albumId),
    select: (data) => data.tracks,
  });
}

/** One track per call, so each row can show its own progress and its own error. */
export function useSendTrackToLibrary(albumId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (filename: string) => sendTrackToLibrary(albumId, filename),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: queryKeys.songs });
      client.invalidateQueries({ queryKey: ['jobs'] });
    },
  });
}

export function useDeleteAlbum() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (albumId: string) => api.del(`/api/albums/${albumId}`),
    onSuccess: () => client.invalidateQueries({ queryKey: ['albums'] }),
  });
}

export function useSongJobs(songId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.songJobs(songId),
    queryFn: () => api.get<{ jobs: Job[] }>(`/api/jobs?song_id=${encodeURIComponent(songId!)}`),
    select: (data) => data.jobs,
    enabled: songId !== undefined,
  });
}

export function useJobKinds() {
  return useQuery({
    queryKey: queryKeys.jobKinds,
    queryFn: () => api.get<{ kinds: Record<string, StepDecl[]> }>('/api/job-kinds'),
    select: (data) => data.kinds,
    // Declarations change only with a deploy.
    staleTime: Infinity,
  });
}
