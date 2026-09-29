// "stats — all time" (§10, ui-spec §9.6): pass/fail counts and how long each kind of job
// takes on each device. Averages cover finished jobs only (D9-03) and are neutral-coloured
// (D9-04): a CPU average is information, the CPU-fallback banner is the warning.
import { useJobStats } from '../api/queries';
import { Banner } from '../ui';
import styles from './JobStats.module.css';

export function formatAverage(seconds: number): string {
  const tenths = Math.round(seconds * 10) / 10;
  if (tenths < 60) return `${tenths.toFixed(1)} s`;
  const whole = Math.round(seconds);
  if (whole < 3600) return `${Math.floor(whole / 60)} m ${String(whole % 60).padStart(2, '0')} s`;
  const minutes = Math.round(seconds / 60);
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} m`;
}

function Stat({ value, label, tone }: { value: string; label: string; tone?: 'ok' | 'error' }) {
  return (
    <div className={styles.stat}>
      <span className={`num ${styles.value} ${tone ? styles[tone] : ''}`}>{value}</span>
      <span className={styles.label}>{label}</span>
    </div>
  );
}

export function JobStats() {
  const stats = useJobStats();
  if (stats.isError) {
    return <Banner tone="error" title="The job stats could not be read" trace={String(stats.error)} />;
  }
  if (!stats.data) return null;
  const { passed, failed, durations } = stats.data;
  return (
    <section aria-labelledby="job-stats-title">
      <h2 id="job-stats-title" className={`cap ${styles.caption}`}>
        stats — all time
      </h2>
      <div className={styles.row} data-testid="job-stats">
        <Stat value={String(passed)} label="passed" tone="ok" />
        <Stat value={String(failed)} label="failed" tone="error" />
        {durations.map((d) => (
          <Stat
            key={`${d.kind}:${d.device ?? ''}`}
            value={formatAverage(d.avg_seconds)}
            label={`avg ${d.kind} · ${d.device ?? '—'}`}
          />
        ))}
      </div>
      {durations.length === 0 && <p className={styles.label}>No finished jobs yet to average.</p>}
    </section>
  );
}
