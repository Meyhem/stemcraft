// §10: this is the real operational dashboard. Everything the spec asks the
// queue to expose — state, duration, device, error, traceback — is here.
import { useCancelJob, useEnqueueProbe, useJobs } from '../api/queries';
import type { Job } from '../api/client';
import { Banner, Button, Chip, EmptyState, ProgressBar, Table, jobStateTone } from '../ui';
import { JobStats } from './JobStats';
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
    <section className={styles.screen}>
      <div className={styles.header}>
        <h1>Job queue</h1>
        <Button onClick={() => probe.mutate()}>Enqueue probe job</Button>
      </div>

      {jobs.isError && (
        <Banner tone="error" title="The queue could not be listed" trace={String(jobs.error)} />
      )}

      {jobs.data?.length === 0 && <EmptyState title="No jobs yet." />}

      {jobs.data && jobs.data.length > 0 && (
        <Table>
          <thead>
            <tr>
              <th>Kind</th>
              <th>State</th>
              <th>Device</th>
              <th>Duration</th>
              <th className={styles.progressHead}>Progress</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {jobs.data.map((job) => (
              <tr key={job.id}>
                <td>{job.kind}</td>
                <td>
                  <Chip tone={jobStateTone(job.state)} dot>
                    {job.state}
                  </Chip>
                </td>
                <td>{job.device ? <Chip>{job.device}</Chip> : <span className="dim3">—</span>}</td>
                {/* U-04: a ticking duration must not jitter. */}
                <td className="num">{duration(job)}</td>
                <td>
                  <ProgressBar
                    value={job.progress}
                    label={`${job.kind} progress`}
                    tone={job.state === 'failed' ? 'error' : job.state === 'done' ? 'ok' : 'default'}
                  />
                </td>
                <td className={styles.actions}>
                  {(job.state === 'queued' || job.state === 'running') && (
                    <Button variant="danger" onClick={() => cancel.mutate(job.id)}>
                      Cancel
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      {/* U-09: a failed job's traceback is the thing the queue exists to show, and it
          needs the full row width -- it does not fit in a table cell. */}
      {jobs.data
        ?.filter((job) => job.error)
        .map((job) => (
          <Banner
            key={`error-${job.id}`}
            tone="error"
            title={`${job.kind} job ${job.id} failed`}
            trace={job.error}
          />
        ))}

      {/* Mockup order: live queue and failures first, all-time stats below. */}
      <JobStats />
    </section>
  );
}
