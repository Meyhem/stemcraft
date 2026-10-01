// U-14 on a song: the glows follow the stems you can hear, so muting a stem takes
// its colour out of the bar.
//
// Levels are the load-time stem envelopes read at the engine clock's position;
// audibility is the gain the engine was last given (so a count-in, which silences
// the stems inside the engine, darkens the bar too).
import { useMemo } from 'react';

import { STEM_ORDER } from '../engine/types';
import { useSongSession } from '../session/SongSession';
import { follow, levelAt } from './levels';
import { PulseBar, type PulseFrame } from './PulseBar';

/** How fast a mute or solo fades its glows in and out, per second. */
const WEIGHT_RATE = 8;

export function StemPulseBar() {
  const { engine, playing } = useSongSession();

  const frame = useMemo<PulseFrame | null>(() => {
    if (!engine) return null;
    return (dt, levels, weights) => {
      const position = engine.getPositionSamples();
      STEM_ORDER.forEach((name, i) => {
        const summary = engine.stemSummaries[i];
        levels[i] = follow(levels[i]!, summary ? levelAt(summary, position) : 0, dt);
        // A boost above unity is still just "audible" here.
        const audible = Math.min(1, engine.getStemGain(name));
        weights[i] = weights[i]! + (audible - weights[i]!) * Math.min(1, dt * WEIGHT_RATE);
      });
    };
  }, [engine]);

  return <PulseBar owner="StemPulseBar" playing={playing} frame={frame} />;
}
