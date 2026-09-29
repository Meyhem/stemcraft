// Controls every Theory tool shares (D-19, ui-spec §5): the 12-note picker, a
// row of selectable chips, the scale's or chord's note chips, the help box and
// the tool header. Styles: Theory.module.css.
import type { ReactNode } from 'react';

import { pretty, type Spelled } from '../music/spell';
import styles from './Theory.module.css';

const KEYS = ['C', 'C♯/D♭', 'D', 'E♭', 'E', 'F', 'F♯/G♭', 'G', 'A♭', 'A', 'B♭', 'B'];

/** Twelve buttons, C … B. `selected` lights them (U-01: accent); `onPick` gets the pitch class. */
export function NotePicker({
  label,
  selected,
  onPick,
}: {
  label: string;
  selected: readonly number[];
  onPick: (pc: number) => void;
}) {
  return (
    <div className={styles.notekeys} role="group" aria-label={label}>
      {KEYS.map((name, pc) => (
        <button key={name} type="button" className={styles.notekey} aria-pressed={selected.includes(pc)} onClick={() => onPick(pc)}>
          {name}
        </button>
      ))}
    </div>
  );
}

export interface ChipOption<T extends string> {
  value: T;
  label: ReactNode;
}

/** A labelled row of selectable chips, e.g. "Common: Major · Minor · …". */
export function ChipRow<T extends string>({
  label,
  options,
  value,
  onChange,
  large = false,
}: {
  label: string;
  options: readonly ChipOption<T>[];
  value: T | null;
  onChange: (value: T) => void;
  large?: boolean;
}) {
  return (
    <div className={styles.chipRow} role="group" aria-label={label}>
      <span className={styles.cap}>{label}</span>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={large ? `${styles.chip} ${styles.chipLarge}` : styles.chip}
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** The notes with their intervals; the root filled in the bass hue (U-13). */
export function NoteChips({ notes }: { notes: readonly Spelled[] }) {
  return (
    <ul className={styles.notechips} aria-label="Notes">
      {notes.map((n, i) => (
        <li key={`${n.name}-${i}`} className={i === 0 ? `${styles.notechip} ${styles.rootChip}` : styles.notechip}>
          {pretty(n.name)}
          <small>{n.interval}</small>
        </li>
      ))}
    </ul>
  );
}

export function HelpBox({ children }: { children: ReactNode }) {
  return <div className={styles.help}>{children}</div>;
}

export function ToolHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className={styles.toolHead}>
      <h1 className={styles.title}>{title}</h1>
      {children}
    </div>
  );
}
