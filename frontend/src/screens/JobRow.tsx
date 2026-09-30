// §10 + D-17: one job, one table row (plus a detail row when open). Running and failed rows open on their steps by
// default, so a traceback is never hidden behind a click (N-08).
import { useId, useState } from 'react';

import type { Job } from '../api/client';
import { Banner, Button, Chip, ProgressBar, StepList, StepStrip, jobStateTone } from '../ui';
import { formatJobTime, formatJobTimeFull } from './jobTime';
import styles from './JobRow.module.css';

function duration(job: Job): string {
  if (job.started_at === null) return '—';
  const end = job.finished_at ?? Date.now() / 1000;
  return `${(end - job.started_at).toFixed(1)} s`;
}

// When the job began: the worker picking it up, or for a job still waiting, when it was queued.
function initiated(job: Job) {
  const started = job.started_at !== null;
  const at = started ? job.started_at : job.created_at;
  if (at === null) return null;
  return (
    <>
      {!started && 'queued '}
      <time dateTime={new Date(at * 1000).toISOString()} title={formatJobTimeFull(at)}>
        {formatJobTime(at)}
      </time>
    </>
  );
}

function summary(job: Job): string | null {
  const n = job.steps.length;
  const failed = job.steps.findIndex((s) => s.state === 'failed');
  if (failed >= 0) return `failed at step ${failed + 1} of ${n} · ${job.steps[failed]!.label}`;
  const running = job.steps.findIndex((s) => s.state === 'running');
  if (running >= 0) return `step ${running + 1} of ${n} · ${Math.round(job.progress * 100)}% overall`;
  return null;
}

// Column count of the Jobs table in JobQueue.tsx; the detail row spans it.
const COLS = 9;

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
  const began = initiated(job);

  return (
    <>
      <tr className={styles.row} data-state={job.state}>
        <td className={styles.toggle}>
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
        </td>
        <td>
          <Chip tone={jobStateTone(job.state)} dot>
            {job.state}
          </Chip>
        </td>
        <td className={styles.kind}>{job.kind}</td>
        <td className={`${styles.num} ${styles.narrowHide}`}>#{job.id}</td>
        <td className={styles.narrowHide}>
          {job.device ? <Chip>{job.device}</Chip> : <span className="dim3">—</span>}
        </td>
        {/* U-04: times and a ticking duration are tabular, so they must not jitter. */}
        <td className={styles.num}>{began}</td>
        <td className={styles.num}>{duration(job)}</td>
        <td className={styles.progress} data-failed={job.state === 'failed'}>
          <div className={styles.progressCell}>
            {job.state === 'running' && (
              <ProgressBar value={job.progress} label={`${job.kind} progress`} />
            )}
            {line && <span>{line}</span>}
            {!open && job.steps.length > 0 && <StepStrip steps={job.steps} />}
          </div>
        </td>
        <td className={styles.action}>
          {(job.state === 'queued' || job.state === 'running') && (
            <Button variant="danger" onClick={onCancel}>
              Cancel
            </Button>
          )}
        </td>
      </tr>
      {open && (
        <tr className={styles.detail} data-state={job.state}>
          <td />
          <td colSpan={COLS - 1} id={bodyId} className={styles.body}>
            {job.steps.length > 0 ? (
              <StepList steps={job.steps} error={job.error} />
            ) : (
              <>
                <p className={styles.none}>No step record. This job ran before step tracking existed.</p>
                {job.error && <Banner tone="error" title={`${job.kind} job ${job.id} failed`} trace={job.error} />}
              </>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
