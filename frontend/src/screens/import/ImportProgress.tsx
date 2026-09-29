// Import, step two (UI spec §6.2, D-17): the song's import, separate and
// analyze jobs, drawn with the same StepList as the Job queue. Closing never
// stops the work.
import { pendingStep } from '../../api/client';
import { useJobKinds, useSongJobs } from '../../api/queries';
import { Banner, Button, ButtonLink, Chip, Modal, StepList, jobStateTone } from '../../ui';
import type { CreatedImport } from './ImportForm';
import styles from './ImportProgress.module.css';
import { type PipelineGroup, pipelineDone, pipelineGroups } from './pipeline';

export interface ImportProgressProps {
  created: CreatedImport;
  onClose: () => void;
}

function Group({ group }: { group: PipelineGroup }) {
  return (
    <section className={styles.group} aria-label={`${group.kind} job`}>
      <header className={styles.head}>
        <span className={styles.kind}>{group.kind}</span>
        {group.status === 'job' && (
          <Chip tone={jobStateTone(group.job.state)} dot>
            {group.job.state === 'running' && group.job.device ? group.job.device : group.job.state}
          </Chip>
        )}
        {group.status === 'declared' && <span className={styles.note}>not queued yet</span>}
        {group.status === 'blocked' && (
          <span className={styles.note}>
            won't run: {group.blockedBy} {group.blockedState}
          </span>
        )}
      </header>
      {group.status === 'job' && <StepList steps={group.job.steps} error={group.job.error} />}
      {group.status === 'declared' && <StepList steps={group.steps.map(pendingStep)} />}
    </section>
  );
}

export function ImportProgress({ created, onClose }: ImportProgressProps) {
  const jobs = useSongJobs(created.songId);
  const kinds = useJobKinds();
  const groups = pipelineGroups(jobs.data ?? [], created.jobId, kinds.data ?? {});
  const done = pipelineDone(groups);

  return (
    <Modal
      title={created.title}
      subtitle={[created.artist, created.source].filter(Boolean).join(' · ')}
      onClose={onClose}
      footer={
        <>
          <span className={styles.foot}>Closing won't stop the import</span>
          <ButtonLink variant="ghost" to={`/jobs?song=${encodeURIComponent(created.songId)}`}>
            Open job queue
          </ButtonLink>
          <Button onClick={onClose}>Close</Button>
          {done ? (
            <ButtonLink variant="primary" to={`/songs/${created.songId}`}>
              Open song
            </ButtonLink>
          ) : (
            <Button variant="primary" disabled>
              Open song
            </Button>
          )}
        </>
      }
    >
      {(jobs.isError || kinds.isError) && (
        <Banner tone="error" title="The import's jobs could not be read" trace={String(jobs.error ?? kinds.error)} />
      )}
      <div className={styles.groups}>
        {groups.map((group) => (
          <Group key={group.kind} group={group} />
        ))}
      </div>
    </Modal>
  );
}
