// The Import modal's view of one upload: the import job the API queued, then
// the separate and analyze jobs the worker queues after it. Pure, so the
// grouping rules are tested without React.
import type { Job, JobState, StepDecl } from '../../api/client';

export const PIPELINE_KINDS = ['import', 'separate', 'analyze'] as const;
export type PipelineKind = (typeof PIPELINE_KINDS)[number];

export type PipelineGroup =
  | { kind: PipelineKind; status: 'job'; job: Job }
  | { kind: PipelineKind; status: 'declared'; steps: StepDecl[] }
  | { kind: PipelineKind; status: 'blocked'; blockedBy: PipelineKind; blockedState: JobState };

export function pipelineGroups(
  jobs: Job[],
  importJobId: number,
  kinds: Record<string, StepDecl[]>,
): PipelineGroup[] {
  const groups: PipelineGroup[] = [];
  let blocked: { by: PipelineKind; state: JobState } | null = null;
  for (const kind of PIPELINE_KINDS) {
    if (blocked) {
      groups.push({ kind, status: 'blocked', blockedBy: blocked.by, blockedState: blocked.state });
      continue;
    }
    // Only this run: a re-imported song still has its earlier jobs in history.
    const job = jobs
      .filter((j) => j.kind === kind && j.id >= importJobId)
      .sort((a, b) => b.id - a.id)[0];
    if (job) {
      groups.push({ kind, status: 'job', job });
      if (job.state === 'failed' || job.state === 'cancelled') blocked = { by: kind, state: job.state };
    } else {
      groups.push({ kind, status: 'declared', steps: kinds[kind] ?? [] });
    }
  }
  return groups;
}

export function pipelineDone(groups: PipelineGroup[]): boolean {
  const last = groups[groups.length - 1];
  return last?.status === 'job' && last.job.state === 'done';
}
