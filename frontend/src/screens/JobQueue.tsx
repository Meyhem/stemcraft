// §10: this is the real operational dashboard. Everything the spec asks the
// queue to expose — state, duration, device, error, traceback — is here.
// D-17: each job is a row that opens on its named steps; a failed job's
// traceback sits under its failed step.
import { useSearchParams } from 'react-router-dom';

import { useCancelJob, useEnqueueProbe, useJobs, useSongJobs } from '../api/queries';
import { Banner, Button, EmptyState, Loader, ScreenHeader, TextLink } from '../ui';
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
      <ScreenHeader
        title="Job queue"
        actions={<Button onClick={() => probe.mutate()}>Enqueue probe job</Button>}
      />

      {songId && (
        <p className={styles.filter}>
          Showing one song's jobs. <TextLink to="/jobs">Show all jobs</TextLink>
        </p>
      )}

      {jobs.isError && (
        <Banner tone="error" title="The queue could not be listed" trace={String(jobs.error)} />
      )}

      {jobs.isPending && <Loader size="page" label="Loading jobs…" />}

      {jobs.data?.length === 0 && <EmptyState title="No jobs yet." />}

      {jobs.data && jobs.data.length > 0 && (
        <table className={styles.table} aria-label="Jobs">
          <thead>
            <tr>
              <th scope="col"><span className={styles.srOnly}>Steps</span></th>
              <th scope="col">State</th>
              <th scope="col">Kind</th>
              <th scope="col" className={styles.narrowHide}>ID</th>
              <th scope="col" className={styles.narrowHide}>Device</th>
              <th scope="col">Started</th>
              <th scope="col">Duration</th>
              <th scope="col">Progress</th>
              <th scope="col"><span className={styles.srOnly}>Actions</span></th>
            </tr>
          </thead>
          <tbody>
          {jobs.data.map((job) => (
            <JobRow
              key={job.id}
              job={job}
              defaultOpen={songId ? true : undefined}
              onCancel={() => cancel.mutate(job.id)}
            />
          ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
