import { render, screen, within } from '@testing-library/react';
import { expect, test } from 'vitest';

import type { JobStep } from '../api/client';
import { StepList } from './StepList';
import { StepStrip } from './StepStrip';

function step(over: Partial<JobStep>): JobStep {
  return {
    id: 'x', label: 'X', weight: 1, state: 'pending', progress: 0,
    detail: null, started_at: null, finished_at: null, ...over,
  };
}

const steps: JobStep[] = [
  step({ id: 'download', label: 'Download', state: 'skipped', detail: 'uploaded file', finished_at: 1 }),
  step({ id: 'decode', label: 'Decode to 48 kHz', state: 'done', started_at: 1, finished_at: 7.1 }),
  step({ id: 'separate', label: 'Separate 4 stems', state: 'running', progress: 0.62, detail: 'segment 11 of 17', started_at: 8 }),
  step({ id: 'write', label: 'Write stems', state: 'pending' }),
];

test('every step says its label and state', () => {
  render(<StepList steps={steps} />);
  const list = within(screen.getByRole('list', { name: 'Steps' }));
  expect(list.getByRole('listitem', { name: 'Download: skipped' })).toBeInTheDocument();
  expect(list.getByRole('listitem', { name: 'Decode to 48 kHz: done' })).toBeInTheDocument();
  expect(list.getByRole('listitem', { name: 'Separate 4 stems: running' })).toBeInTheDocument();
  expect(list.getByRole('listitem', { name: 'Write stems: pending' })).toBeInTheDocument();
});

test('a done step shows its duration, a skipped one its reason, the running one its live percent and bar', () => {
  render(<StepList steps={steps} />);
  expect(screen.getByText('6.1 s')).toBeInTheDocument();
  expect(screen.getByText('skipped · uploaded file')).toBeInTheDocument();
  expect(screen.getByText('62%')).toBeInTheDocument();
  expect(screen.getByText('segment 11 of 17')).toBeInTheDocument();
  expect(screen.getByRole('progressbar', { name: 'Separate 4 stems progress' })).toHaveAttribute('aria-valuenow', '62');
});

test("the job's real error sits under the failed step", () => {
  render(
    <StepList
      steps={[step({ id: 'key', label: 'Key', state: 'failed', started_at: 1, finished_at: 1.6 })]}
      error={'Traceback...\nRuntimeError: frame too short'}
    />,
  );
  const failed = screen.getByRole('listitem', { name: 'Key: failed' });
  expect(within(failed).getByText(/RuntimeError: frame too short/)).toBeInTheDocument();
});

test('the strip summarises how many steps are done', () => {
  render(<StepStrip steps={steps} />);
  // A skipped step is finished too, so download (skipped) + decode (done) = 2.
  expect(screen.getByRole('img', { name: '2 of 4 steps done' })).toBeInTheDocument();
});
