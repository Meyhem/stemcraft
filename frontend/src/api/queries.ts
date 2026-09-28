// D-13: the server owns this state; the client only caches it. No store.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api, type Analysis, type CreatedSong, type Health, type Job, type SongEntry } from './client';

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

export function useCancelJob() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (jobId: number) => api.post(`/api/jobs/${jobId}/cancel`),
    onSuccess: () => client.invalidateQueries({ queryKey: ['jobs'] }),
  });
}
