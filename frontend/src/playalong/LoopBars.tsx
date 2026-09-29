// Play along loops by bar numbers (D-18), not by the cursor: start and end
// steppers over the same active_loop Song view edits. Stored bars are 0-based
// with an exclusive end; shown 1-based and inclusive, like the ruler, so
// "5 to 8" is start_bar 4, end_bar 8.
import type { Loop } from '../api/client';
import { Button } from '../ui';
import styles from './PlayAlong.module.css';

export interface LoopBarsProps {
  loop: Loop | null;
  /** Bars the analysis found; neither end steps past it. */
  barCount: number;
  onLoopBars(startBar: number, endBar: number): void;
}

export function LoopBars({ loop, barCount, onLoopBars }: LoopBarsProps) {
  // No loop yet: the steppers start from a one-bar loop on bar 1.
  const start = loop?.start_bar ?? 0;
  const end = loop?.end_bar ?? 1;

  // Like Set A: a start moved onto or past the end pushes the end along.
  const setStart = (next: number) => onLoopBars(next, Math.max(end, next + 1));

  return (
    <div className={styles.picker}>
      <span className={styles.caption}>Loop bars</span>
      <div className={styles.loopBars}>
        <Button aria-label="Start bar earlier" disabled={start <= 0} onClick={() => setStart(start - 1)}>
          −
        </Button>
        <output className={styles.barValue} aria-label="Loop start bar">
          {start + 1}
        </output>
        <Button aria-label="Start bar later" disabled={start >= barCount - 1} onClick={() => setStart(start + 1)}>
          +
        </Button>
        <span className={styles.to}>to</span>
        <Button aria-label="End bar earlier" disabled={end <= start + 1} onClick={() => onLoopBars(start, end - 1)}>
          −
        </Button>
        <output className={styles.barValue} aria-label="Loop end bar">
          {end}
        </output>
        <Button aria-label="End bar later" disabled={end >= barCount} onClick={() => onLoopBars(start, end + 1)}>
          +
        </Button>
      </div>
    </div>
  );
}
