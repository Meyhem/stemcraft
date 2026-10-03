// The ramp's progress (D-22): range, rule, a bar, and where in it the player is.
import type { PracticeRamp } from '../api/client';
import { ProgressBar } from '../ui';
import styles from './Practice.module.css';
import { rampState } from './tempo';

export function RampStrip({ ramp, loopsDone }: { ramp: PracticeRamp; loopsDone: number }) {
  const state = rampState(ramp, loopsDone);
  const where =
    state.loopInStep === null
      ? `holding at ${state.bpm} bpm`
      : `${state.bpm} bpm · step ${state.step + 1} of ${state.steps + 1} · loop ${state.loopInStep} of ${ramp.every_loops}`;
  return (
    <div className={styles.rampStrip} role="status">
      <span className={styles.chip}>Ramp</span>
      <span>
        <b>
          {ramp.start} → {ramp.target} bpm
        </b>
        , {ramp.target >= ramp.start ? '+' : '−'}
        {ramp.step} every {ramp.every_loops === 1 ? 'loop' : `${ramp.every_loops} loops`}
      </span>
      <ProgressBar label="Ramp progress" value={state.steps === 0 ? 1 : state.step / state.steps} />
      <span className={styles.dim}>{where}</span>
    </div>
  );
}
