import styles from './ProgressBar.module.css';

export interface ProgressBarProps {
  /** 0..1. Values outside the range are clamped. */
  value: number;
  label: string;
  tone?: 'default' | 'ok' | 'error';
  className?: string;
}

export function ProgressBar({ value, label, tone = 'default', className }: ProgressBarProps) {
  // Job progress comes off the wire and is not guaranteed to be in range; an unclamped
  // fill overflows its rounded container.
  const fraction = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  const percent = Math.round(fraction * 100);
  const toneClass = tone === 'ok' ? styles.ok : tone === 'error' ? styles.error : undefined;
  return (
    <div
      className={[styles.bar, toneClass, className].filter(Boolean).join(' ')}
      role="progressbar"
      aria-label={label}
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <i className={styles.fill} style={{ width: `${percent}%` }} />
    </div>
  );
}
