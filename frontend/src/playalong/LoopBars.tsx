// Play along loops by bar numbers (D-18), not by the cursor: start and end
// steppers over the same active_loop Song view edits. Stored bars are 0-based
// with an exclusive end; shown 1-based and inclusive, like the ruler, so
// "5 to 8" is start_bar 4, end_bar 8.
import type { Loop } from '../api/client';
import { Stepper } from '../ui';
import styles from './PlayAlong.module.css';

export interface LoopBarsProps {
  loop: Loop | null;
  /** Bars the analysis found; neither end steps past it. */
  barCount: number;
  onLoopBars(startBar: number, endBar: number): void;
}

const bar = (value: number) => String(value);

export function LoopBars({ loop, barCount, onLoopBars }: LoopBarsProps) {
  // No loop yet: the steppers start from a one-bar loop on bar 1.
  const start = loop?.start_bar ?? 0;
  const end = loop?.end_bar ?? 1;

  return (
    <div className={styles.picker}>
      <span className={styles.caption}>Loop bars</span>
      <div className={styles.loopBars}>
        {/* Like Set A: a start moved onto or past the end pushes the end along rather
            than inverting the loop. Shown 1-based, so v is start_bar + 1. */}
        <Stepper
          label="Loop start bar"
          downLabel="Start bar earlier"
          upLabel="Start bar later"
          value={start + 1}
          min={1}
          max={barCount}
          step={1}
          format={bar}
          onChange={(v) => onLoopBars(v - 1, Math.max(end, v))}
        />
        <span className={styles.to}>to</span>
        <Stepper
          label="Loop end bar"
          downLabel="End bar earlier"
          upLabel="End bar later"
          value={end}
          min={start + 1}
          max={barCount}
          step={1}
          format={bar}
          onChange={(v) => onLoopBars(start, v)}
        />
      </div>
    </div>
  );
}
