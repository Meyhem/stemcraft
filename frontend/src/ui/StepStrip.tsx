import type { JobStep } from '../api/client';
import styles from './StepStrip.module.css';

/** The step list drawn small, for a collapsed job row. */
export function StepStrip({ steps }: { steps: JobStep[] }) {
  const done = steps.filter((s) => s.state === 'done' || s.state === 'skipped').length;
  return (
    <span className={styles.strip} role="img" aria-label={`${done} of ${steps.length} steps done`}>
      {steps.map((step) => (
        <i key={step.id} data-state={step.state} />
      ))}
    </span>
  );
}
