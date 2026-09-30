// UI spec §5 "Stepper": - value + for small stepped ranges where a slider is overkill
// (tempo in 10 % steps, pitch in semitones, loop bars). Performance tier on the
// transport, setup tier in popovers. A button at the end of the range is disabled,
// never a silent clamp; a value at its default renders muted (U-04, UI spec §5).
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
  const move = (delta: number) => onChange(Math.min(max, Math.max(min, value + delta)));
  return (
    <div className={[styles.stepper, tier === 'perform' ? styles.perform : undefined].filter(Boolean).join(' ')}>
      <button type="button" aria-label={downLabel} disabled={value <= min} onClick={() => move(-step)}>
        −
      </button>
      <output aria-label={label} data-default={atDefault ? 'true' : 'false'}>
        {format(value)}
      </output>
      <button type="button" aria-label={upLabel} disabled={value >= max} onClick={() => move(step)}>
        +
      </button>
    </div>
  );
}
