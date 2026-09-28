// U-05: the playhead is positioned by requestAnimationFrame from the engine
// clock, never by a CSS transition. A CSS-animated playhead is a second clock
// that interpolates smoothly through moments the engine did not have --
// including the loop wrap, which is exactly the seam R-01 exists to expose.
//
// One loop for the whole screen. Every readout (playhead, bar number, chord
// highlight) subscribes through this, and none of them goes through React
// state: at 60 fps that would be 60 renders a second of a tree containing four
// canvases (D-13's "no global store for anything the engine owns").
import { useEffect } from 'react';

import type { SampleIndex } from '../engine/types';

export function usePlayhead(
  getPosition: () => SampleIndex,
  onFrame: (position: SampleIndex) => void,
  active: boolean,
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
  }, [getPosition, onFrame, active]);
}
