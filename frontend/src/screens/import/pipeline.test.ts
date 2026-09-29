import { expect, test } from 'vitest';

import type { Job } from '../../api/client';
import { pipelineDone, pipelineGroups } from './pipeline';

const kinds = {
  import: [{ id: 'decode', label: 'Decode', weight: 1 }],
  separate: [{ id: 'separate', label: 'Separate', weight: 1 }],
  analyze: [{ id: 'key', label: 'Key', weight: 1 }],
};

function job(id: number, kind: string, state: Job['state']): Job {
  return {
    id, song_id: 's1', kind, payload: {}, state, cancel_requested: false, progress: 0,
    device: null, lease_until: null, created_at: id, started_at: null, finished_at: null,
    error: null, result: null, steps: [],
  };
}

test('jobs that exist are shown; the rest come from their declarations', () => {
  const groups = pipelineGroups([job(5, 'import', 'done'), job(6, 'separate', 'running')], 5, kinds);
  expect(groups.map((g) => [g.kind, g.status])).toEqual([
    ['import', 'job'], ['separate', 'job'], ['analyze', 'declared'],
  ]);
});

test("an older run's jobs for the same song are ignored", () => {
  const groups = pipelineGroups([job(2, 'separate', 'done'), job(5, 'import', 'running')], 5, kinds);
  expect(groups[1]).toMatchObject({ kind: 'separate', status: 'declared' });
});

test('after a failure the later groups are blocked by it', () => {
  const groups = pipelineGroups([job(5, 'import', 'failed')], 5, kinds);
  expect(groups.slice(1)).toEqual([
    { kind: 'separate', status: 'blocked', blockedBy: 'import', blockedState: 'failed' },
    { kind: 'analyze', status: 'blocked', blockedBy: 'import', blockedState: 'failed' },
  ]);
});

test('done only when analyze is done', () => {
  expect(pipelineDone(pipelineGroups([job(5, 'import', 'done'), job(6, 'separate', 'done')], 5, kinds))).toBe(false);
  expect(
    pipelineDone(pipelineGroups([job(5, 'import', 'done'), job(6, 'separate', 'done'), job(7, 'analyze', 'done')], 5, kinds)),
  ).toBe(true);
});
