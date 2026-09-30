// §10: this is the real operational dashboard. Everything the spec asks the
// queue to expose — state, duration, device, error, traceback — is here.
// D-17: each job is a row that opens on its named steps; a failed job's
// traceback sits under its failed step.
import { useSearchParams } from 'react-router-dom';

import { useCancelJob, useEnqueueProbe, useJobs, useSongJobs } from '../api/queries';
import { Banner, Button, EmptyState, TextLink } from '../ui';
import { JobRow } from './JobRow';
import styles from './JobQueue.module.css';

export function JobQueue() {
  const [params] = useSearchParams();
  const songId = params.get('song') ?? undefined;
  const allJobs = useJobs();
  const songJobs = useSongJobs(songId);
  const jobs = songId ? songJobs : allJobs;
  const cancel = useCancelJob();
  const probe = useEnqueueProbe();

  return (
    <section className={styles.screen}>
      <div className={styles.header}>
        <h1>Job queue</h1>
        <Button onClick={() => probe.mutate()}>Enqueue probe job</Button>
      </div>

      {songId && (
        <p className={styles.filter}>
          Showing one song's jobs. <TextLink to="/jobs">Show all jobs</TextLink>
        </p>
      )}

      {jobs.isError && (
        <Banner tone="error" title="The queue could not be listed" trace={String(jobs.error)} />
      )}

      {jobs.data?.length === 0 && <EmptyState title="No jobs yet." />}

      {jobs.data && jobs.data.length > 0 && (
        <ul className={styles.list} aria-label="Jobs">
          {jobs.data.map((job) => (
            <JobRow
              key={job.id}
              job={job}
              defaultOpen={songId ? true : undefined}
              onCancel={() => cancel.mutate(job.id)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
