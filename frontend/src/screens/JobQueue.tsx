// §10: this is the real operational dashboard. Everything the spec asks the
// queue to expose — state, duration, device, error, traceback — is here.
import { useCancelJob, useEnqueueProbe, useJobs } from '../api/queries';
import type { Job } from '../api/client';
import styles from './JobQueue.module.css';

function duration(job: Job): string {
  if (job.started_at === null) return '—';
  const end = job.finished_at ?? Date.now() / 1000;
  return `${(end - job.started_at).toFixed(1)} s`;
}

export function JobQueue() {
  const jobs = useJobs();
  const cancel = useCancelJob();
  const probe = useEnqueueProbe();

  return (
    <section>
      <h1>Job queue</h1>
      <button className={styles.action} onClick={() => probe.mutate()}>
        Enqueue probe job
      </button>

      {jobs.isError && <p className={styles.error}>{String(jobs.error)}</p>}
      {jobs.data?.length === 0 && <p>No jobs yet.</p>}

      <ul className={styles.list}>
        {jobs.data?.map((job) => (
          <li key={job.id} className={styles.row}>
            <span className={styles.kind}>{job.kind}</span>
            <span className={styles.state} data-state={job.state}>
              {job.state}
            </span>
            <span className={styles.device}>{job.device ?? '—'}</span>
            <span className={styles.duration}>{duration(job)}</span>
            <div
              className={styles.progress}
              role="progressbar"
              aria-valuenow={Math.round(job.progress * 100)}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <i style={{ inlineSize: `${job.progress * 100}%` }} />
            </div>
            {(job.state === 'queued' || job.state === 'running') && (
              <button onClick={() => cancel.mutate(job.id)}>Cancel</button>
            )}
            {job.error && <pre className={styles.error}>{job.error}</pre>}
          </li>
        ))}
      </ul>
    </section>
  );
}
