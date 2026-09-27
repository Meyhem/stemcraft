// D-13: the server owns this state; the client only caches it. No store.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api, type Health, type Job } from './client';

export const queryKeys = {
  health: ['health'] as const,
  songs: ['songs'] as const,
  jobs: (active: boolean) => ['jobs', active] as const,
};

export function useHealth() {
  return useQuery({ queryKey: queryKeys.health, queryFn: () => api.get<Health>('/api/health') });
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

export function useCancelJob() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (jobId: number) => api.post(`/api/jobs/${jobId}/cancel`),
    onSuccess: () => client.invalidateQueries({ queryKey: ['jobs'] }),
  });
}
