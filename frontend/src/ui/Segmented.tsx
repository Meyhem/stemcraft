import type { ReactNode } from 'react';

import styles from './Segmented.module.css';

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
}

export interface SegmentedProps<T extends string> {
  /** Accessible name for the group, e.g. "Instrument". */
  label: string;
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange: (value: T) => void;
  className?: string;
  /** Greys the whole group out and ignores clicks; the value is still shown. */
  disabled?: boolean;
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
  disabled = false,
}: SegmentedProps<T>) {
  return (
    <div className={[styles.seg, className].filter(Boolean).join(' ')} role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={styles.item}
          aria-pressed={option.value === value}
          disabled={disabled}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
