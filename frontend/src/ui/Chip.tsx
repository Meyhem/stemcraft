import type { ReactNode } from 'react';

import styles from './Chip.module.css';

export type ChipTone = 'neutral' | 'ok' | 'warn' | 'error' | 'run';

const TONE: Record<ChipTone, string | undefined> = {
  neutral: undefined,
  ok: styles.ok,
  warn: styles.warn,
  error: styles.error,
  run: styles.run,
};

export interface ChipProps {
  tone?: ChipTone;
  size?: 'sm' | 'lg';
  dot?: boolean;
  className?: string;
  children: ReactNode;
}

export function Chip({ tone = 'neutral', size = 'sm', dot = false, className, children }: ChipProps) {
  const cls = [styles.chip, TONE[tone], size === 'lg' ? styles.lg : undefined, className]
    .filter(Boolean)
    .join(' ');
  return (
    <span className={cls}>
      {dot && <span className={styles.dot} aria-hidden="true" />}
      {children}
    </span>
  );
}

/**
 * The job states the API emits, mapped to chip tones. Anything unrecognised is
 * neutral: an unknown state must never read as success.
 */
export function jobStateTone(state: string): ChipTone {
  switch (state) {
    case 'running':
      return 'run';
    case 'done':
      return 'ok';
    case 'failed':
      return 'error';
    default:
      return 'neutral';
  }
}
