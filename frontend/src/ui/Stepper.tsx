// UI spec §5 "Stepper": - value + for small stepped ranges where a slider is overkill
// (tempo in 10 % steps, pitch in semitones, loop bars). Performance tier on the
// transport, setup tier in popovers. A button at the end of the range is disabled,
// never a silent clamp; a value at its default renders muted (U-04, UI spec §5).
// The value is also typeable: focusing it selects the whole text, Enter or blur commits
// the first number typed (clamped to the range), Escape or garbage restores the old value.
import { useRef, useState } from 'react';

import styles from './Stepper.module.css';

export type StepperTier = 'setup' | 'perform';

export interface StepperProps {
  /** Accessible name of the value, e.g. "Tempo". Default button names are `${label} down` / `${label} up`. */
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format(value: number): string;
  onChange(value: number): void;
  tier?: StepperTier;
  /** The value is at its default: render it muted. */
  atDefault?: boolean;
  downLabel?: string;
  upLabel?: string;
}

export function Stepper({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
  tier = 'setup',
  atDefault = false,
  downLabel = `${label} down`,
  upLabel = `${label} up`,
}: StepperProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const cancelled = useRef(false);
  const commit = () => {
    const typed = draft?.match(/[-−]?\d+(?:\.\d+)?/)?.[0];
    setDraft(null);
    if (cancelled.current || typed === undefined) {
      cancelled.current = false;
      return;
    }
    const next = Math.min(max, Math.max(min, Math.round(Number(typed.replace('−', '-')))));
    if (next !== value) onChange(next);
  };
  const move = (delta: number) => onChange(Math.min(max, Math.max(min, value + delta)));
  return (
    <div className={[styles.stepper, tier === 'perform' ? styles.perform : undefined].filter(Boolean).join(' ')}>
      <button type="button" aria-label={downLabel} disabled={value <= min} onClick={() => move(-step)}>
        −
      </button>
      <input
        type="text"
        inputMode={min < 0 ? 'text' : 'numeric'}
        aria-label={label}
        data-default={atDefault ? 'true' : 'false'}
        value={draft ?? format(value)}
        size={5}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          else if (e.key === 'Escape') {
            cancelled.current = true;
            e.currentTarget.blur();
          }
        }}
      />
      <button type="button" aria-label={upLabel} disabled={value >= max} onClick={() => move(step)}>
        +
      </button>
    </div>
  );
}
