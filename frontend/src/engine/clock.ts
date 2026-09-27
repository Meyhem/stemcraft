import { SampleIndex, sampleIndex } from './types';

export interface ClockSync {
  /** AudioContext.currentTime at the moment `position` was true. */
  contextTime: number;
  /** The cursor's position (48 kHz domain) at `contextTime`. */
  position: SampleIndex;
  /** Samples of stem time advanced per second of real time. */
  samplesPerSecond: number;
}

export class EngineClock {
  private sync: ClockSync;

  constructor(initial: ClockSync) {
    this.sync = initial;
  }

  /** Called whenever the worklet reports its true cursor position (Task 5's port messages). */
  resync(sync: ClockSync): void {
    this.sync = sync;
  }

  /** Extrapolated position at `contextTime`, using the most recent resync as the anchor. */
  positionAt(contextTime: number): SampleIndex {
    const elapsed = contextTime - this.sync.contextTime;
    return sampleIndex(this.sync.position + elapsed * this.sync.samplesPerSecond);
  }
}
