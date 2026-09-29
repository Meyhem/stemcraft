// UI spec §5, "Stem strip" -- the signature component. Identity is carried by
// fixed order, a permanent text label and a fixed lane position (U-01); hue is
// an accelerator, never the only signal.
//
// D-07: wavesurfer renders and never plays. It is constructed with precomputed
// peaks and an explicit duration, so it has no URL to fetch and no media element
// to start, and its own cursor is switched off -- the playhead belongs to
// Timeline, driven by the engine clock (U-05).
//
// A lane is one row of the Song view's scrolling time axis: the controls are
// the row's sticky 200px head, and the waveform is exactly the axis's content
// width, so it lines up with the bar ruler and the chord row above it.
import type { CSSProperties } from 'react';
import { useEffect, useRef } from 'react';
import WaveSurfer from 'wavesurfer.js';

import type { StemName } from '../engine/EngineController';
import type { StemSummary } from '../engine/stemPeaks';
import { Button } from '../ui';
import { resolveColor } from '../ui/resolveColor';
import axis from './Axis.module.css';
import styles from './StemLane.module.css';

const STEM_COLOR: Record<StemName, string> = {
  vocals: 'var(--ds-vocals)',
  drums: 'var(--ds-drums)',
  bass: 'var(--ds-bass)',
  other: 'var(--ds-other)',
};

export interface StemLaneProps {
  summary: StemSummary;
  durationSeconds: number;
  /** The time axis content width in px (TimeScale.contentWidth). */
  width: number;
  muted: boolean;
  soloed: boolean;
  gainDb: number;
  anySoloed: boolean;
  onMuteToggle(): void;
  onSoloToggle(): void;
  onGainChange(db: number): void;
}

export function StemLane({
  summary,
  durationSeconds,
  width,
  muted,
  soloed,
  gainDb,
  anySoloed,
  onMuteToggle,
  onSoloToggle,
  onGainChange,
}: StemLaneProps) {
  const container = useRef<HTMLDivElement | null>(null);
  const waveSurfer = useRef<WaveSurfer | null>(null);
  // Read at construction only (not an effect dependency): later changes go
  // through setOptions below, so a zoom resizes the waveform in place instead
  // of tearing it down and rebuilding it.
  const latestWidth = useRef(width);
  latestWidth.current = width;
  const { name, envelope, nearSilent } = summary;
  const silenced = muted || (anySoloed && !soloed);

  useEffect(() => {
    if (!container.current) return;
    const color = resolveColor(STEM_COLOR[name]);
    const ws = WaveSurfer.create({
      container: container.current,
      height: 64,
      cursorWidth: 0, // U-05: the playhead is ours, drawn from the engine clock
      interact: false, // scrubbing is Timeline's job, and U-06 governs it
      normalize: false,
      waveColor: color,
      progressColor: color,
      peaks: [envelope],
      duration: durationSeconds,
      width: latestWidth.current,
    });
    waveSurfer.current = ws;
    return () => {
      waveSurfer.current = null;
      ws.destroy();
    };
  }, [name, envelope, durationSeconds]);

  useEffect(() => {
    waveSurfer.current?.setOptions({ width });
  }, [width]);

  return (
    <div
      role="group"
      aria-label={`${name} stem`}
      className={styles.lane}
      data-silenced={silenced ? 'true' : 'false'}
      data-near-silent={nearSilent ? 'true' : 'false'}
      // UI spec §5, Slider row: "Gain fill takes the stem hue" -- exposed as a
      // custom property so the CSS module can drive accent-color on the native
      // range input without a stem-conditional class per lane.
      style={{ '--lane-hue': STEM_COLOR[name] } as CSSProperties}
    >
      <div className={`${axis.head} ${styles.controls}`}>
        <span className={styles.name}>{name}</span>
        <div className={styles.buttons}>
          <Button
            tier="perform"
            className={styles.ms}
            aria-label={`Mute ${name}`}
            aria-pressed={muted}
            disabled={nearSilent}
            onClick={onMuteToggle}
          >
            M
          </Button>
          <Button
            tier="perform"
            className={styles.ms}
            aria-label={`Solo ${name}`}
            aria-pressed={soloed}
            disabled={nearSilent}
            onClick={onSoloToggle}
          >
            S
          </Button>
        </div>
        <label className={styles.gain}>
          <span className={styles.srOnly}>{name} gain</span>
          <input
            type="range"
            aria-label={`${name} gain`}
            min={-60}
            max={6}
            step={0.5}
            value={gainDb}
            disabled={nearSilent}
            onChange={(event) => onGainChange(Number(event.target.value))}
          />
          {/* UI spec §5: every slider mirrors its value as a mono readout --
              a knob position is unreadable at 1.5 m (U-C1). */}
          <output className={styles.readout}>{gainDb.toFixed(1)} dB</output>
        </label>
      </div>

      <div className={styles.waveWrap} style={{ width: `${width}px` }}>
        <div ref={container} data-testid={`${name}-wave`} className={styles.wave} style={{ width: `${width}px` }} />
        {nearSilent && (
          <span className={styles.pill}>
            near-silent &mdash; this song has no {name} the model could find
          </span>
        )}
      </div>
    </div>
  );
}
