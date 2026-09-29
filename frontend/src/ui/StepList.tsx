// D-17: one step vocabulary for the Job queue and the Import modal. The marks
// mean the same everywhere: ✓ done, ● running, ○ pending, ! failed, – skipped, ■ cancelled.
import type { JobStep } from '../api/client';
import { Banner } from './Banner';
import { ProgressBar } from './ProgressBar';
import styles from './StepList.module.css';

export interface StepListProps {
  steps: JobStep[];
  /** The job's error. U-09: drawn verbatim under the failed step. */
  error?: string | null;
}

function mark(step: JobStep, index: number): string {
  switch (step.state) {
    case 'done':
      return '✓';
    case 'failed':
      return '!';
    case 'skipped':
      return '–';
    case 'cancelled':
      return '■';
    default:
      return String(index + 1);
  }
}

function aside(step: JobStep): string {
  if (step.state === 'running') return `${Math.round(step.progress * 100)}%`;
  if (step.state === 'skipped') return step.detail ? `skipped · ${step.detail}` : 'skipped';
  if (step.started_at !== null && step.finished_at !== null) {
    return `${(step.finished_at - step.started_at).toFixed(1)} s`;
  }
  return '—';
}

export function StepList({ steps, error }: StepListProps) {
  return (
    <ol className={styles.list} aria-label="Steps">
      {steps.map((step, index) => (
        <li
          key={step.id}
          className={styles.step}
          data-state={step.state}
          aria-label={`${step.label}: ${step.state}`}
        >
          <span className={styles.mark} aria-hidden="true">
            {mark(step, index)}
          </span>
          <span className={styles.label}>
            {step.label}
            {step.detail && step.state !== 'skipped' && <span className={styles.detail}>{step.detail}</span>}
          </span>
          <span className={styles.aside}>{aside(step)}</span>
          {step.state === 'running' && (
            <div className={styles.extra}>
              <ProgressBar value={step.progress} label={`${step.label} progress`} />
            </div>
          )}
          {step.state === 'failed' && error && (
            <div className={styles.extra}>
              <Banner tone="error" trace={error} />
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}
