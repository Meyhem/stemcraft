// U-05: the playhead is positioned by requestAnimationFrame from the engine
// clock, never by a CSS transition. A CSS-animated playhead is a second clock
// that interpolates smoothly through moments the engine did not have --
// including the loop wrap, which is exactly the seam R-01 exists to expose.
//
// One loop per readout, not one for the screen: Timeline, ChordStrip and
// Transport each mount their own. That is safe because they are not three
// clocks -- all three call getPosition() into the same EngineClock, so they
// read one source of truth and cannot disagree about where the cursor is. What
// they must not do is go through React state: at 60 fps that would be 60
// renders a second of a tree containing four canvases (D-13's "no global store
// for anything the engine owns"). Each painter writes straight into its own
// ref instead.
import { useEffect } from 'react';

import type { SampleIndex } from '../engine/types';

/**
 * `repaintNonce` exists because the engine's cursor can move without anything
 * in this effect's other dependencies changing: a scrub or a bar nudge while
 * paused moves the cursor through a stable `getPosition` callback, so nothing
 * re-runs and every readout stays frozen on the old position until the user
 * presses play. Bumping the nonce is the caller saying "the cursor moved, paint
 * again" -- it is not read, only depended on.
 */
export function usePlayhead(
  getPosition: () => SampleIndex,
  onFrame: (position: SampleIndex) => void,
  active: boolean,
  repaintNonce: number,
): void {
  useEffect(() => {
    // Paint once even when stopped, so a seek or a reload lands the playhead in
    // the right place instead of leaving it wherever the last frame put it.
    onFrame(getPosition());
    if (!active) return;
    let handle = 0;
    const tick = () => {
      onFrame(getPosition());
      handle = requestAnimationFrame(tick);
    };
    handle = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(handle);
  }, [getPosition, onFrame, active, repaintNonce]);
}
