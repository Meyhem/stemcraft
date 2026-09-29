// §10 + D-17: one job, one row. Running and failed rows open on their steps by
// default, so a traceback is never hidden behind a click (N-08).
import { useId, useState } from 'react';

import type { Job } from '../api/client';
import { Banner, Button, Chip, ProgressBar, StepList, StepStrip, jobStateTone } from '../ui';
import styles from './JobRow.module.css';

function duration(job: Job): string {
  if (job.started_at === null) return '—';
  const end = job.finished_at ?? Date.now() / 1000;
  return `${(end - job.started_at).toFixed(1)} s`;
}

function summary(job: Job): string | null {
  const n = job.steps.length;
  const failed = job.steps.findIndex((s) => s.state === 'failed');
  if (failed >= 0) return `failed at step ${failed + 1} of ${n} · ${job.steps[failed]!.label}`;
  const running = job.steps.findIndex((s) => s.state === 'running');
  if (running >= 0) return `step ${running + 1} of ${n} · ${Math.round(job.progress * 100)}% overall`;
  return null;
}

export interface JobRowProps {
  job: Job;
  defaultOpen?: boolean;
  onCancel: () => void;
}

export function JobRow({ job, defaultOpen, onCancel }: JobRowProps) {
  // Only the user's explicit toggle is state; the default follows the job, so a row that
  // was queued at mount still opens when it starts running or fails (N-08).
  const [toggled, setToggled] = useState<boolean | undefined>(undefined);
  const open = toggled ?? defaultOpen ?? (job.state === 'running' || job.state === 'failed');
  const bodyId = useId();
  const line = summary(job);

  return (
    <li className={styles.row} data-state={job.state}>
      <div className={styles.head}>
        <button
          type="button"
          className={styles.disclosure}
          aria-expanded={open}
          aria-controls={bodyId}
          aria-label={`Steps of ${job.kind} job ${job.id}`}
          onClick={() => setToggled(!open)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M9 6l6 6-6 6-1.4-1.4 4.6-4.6-4.6-4.6z" />
          </svg>
        </button>
        <Chip tone={jobStateTone(job.state)} dot>
          {job.state}
        </Chip>
        <div className={styles.main}>
          <div className={styles.title}>
            <span className={styles.kind}>{job.kind}</span>
            {job.device ? <Chip>{job.device}</Chip> : <span className="dim3">—</span>}
          </div>
          {job.state === 'running' && <ProgressBar value={job.progress} label={`${job.kind} progress`} />}
          <span className={styles.meta} data-failed={job.state === 'failed'}>
            {/* U-04: a ticking duration must not jitter. */}
            {[line, duration(job)].filter(Boolean).join(' · ')}
            {!open && job.steps.length > 0 && <StepStrip steps={job.steps} />}
          </span>
        </div>
        {(job.state === 'queued' || job.state === 'running') && (
          <Button variant="danger" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
      {open && (
        <div id={bodyId} className={styles.body}>
          {job.steps.length > 0 ? (
            <StepList steps={job.steps} error={job.error} />
          ) : (
            <>
              <p className={styles.none}>No step record. This job ran before step tracking existed.</p>
              {job.error && <Banner tone="error" title={`${job.kind} job ${job.id} failed`} trace={job.error} />}
            </>
          )}
        </div>
      )}
    </li>
  );
}
