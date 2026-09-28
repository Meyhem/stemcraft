// The album waveform with its draggable split boundaries.
//
// D-07 / invariant 7: wavesurfer renders and NEVER plays. It is constructed
// from precomputed peaks with an explicit duration -- no `url`, no `media`, no
// way for it to start a sound -- and its own cursor is switched off. Preview
// audio is a plain <audio> element owned by the screen; the playhead drawn
// here comes from that element's clock via the `playheadSample` prop.
//
// Invariant 4: every position this component reports is an integer sample
// index at 48 kHz. Pointer positions are rounded at the point of conversion,
// never handed on as float seconds.
import { Fragment, type KeyboardEvent as ReactKeyboardEvent, useEffect, useMemo, useRef } from 'react';
import WaveSurfer from 'wavesurfer.js';

import styles from './WaveformMarkers.module.css';

// D-03: the one sample rate. Restated here because the keyboard steps below
// are defined in time and stored in samples.
const SAMPLE_RATE = 48000;

// U-02: a boundary must be placeable without a mouse. 0.1 s of nudge, 1 s of
// travel -- enough to cross a gap between tracks in a handful of presses.
const FINE_STEP = SAMPLE_RATE / 10; // 4800
const COARSE_STEP = SAMPLE_RATE; // 48000

export interface WaveformMarkersProps {
  peaks: number[]; // the envelope, 0..1, as peaks.json stores it
  totalSamples: number;
  splitPoints: number[]; // sample indices, sorted
  playheadSample: number | null;
  onMove(index: number, sample: number): void; // a marker dragged
  onAdd(sample: number): void; // a click on empty waveform
  onRemove(index: number): void; // a marker's × pressed
  onScrub(sample: number): void; // seek the <audio> element
}

function percent(sample: number, totalSamples: number): string {
  if (totalSamples <= 0) return '0%';
  return `${(sample / totalSamples) * 100}%`;
}

export function WaveformMarkers({
  peaks,
  totalSamples,
  splitPoints,
  playheadSample,
  onMove,
  onAdd,
  onRemove,
  onScrub,
}: WaveformMarkersProps) {
  const waveRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);

  // wavesurfer wants one array per channel; the envelope is a single mono
  // summary, so it is exactly one channel.
  const channels = useMemo(() => [peaks], [peaks]);
  const durationSeconds = totalSamples / SAMPLE_RATE;

  useEffect(() => {
    if (!waveRef.current) return;
    const ws = WaveSurfer.create({
      container: waveRef.current,
      height: 96,
      cursorWidth: 0, // the playhead below is ours, drawn from the <audio> clock
      interact: false, // clicks belong to this component: they add boundaries
      normalize: false,
      waveColor: 'var(--ds-text-3)',
      progressColor: 'var(--ds-text-3)',
      peaks: channels,
      duration: durationSeconds,
    });
    return () => ws.destroy();
  }, [channels, durationSeconds]);

  // Pointer x -> sample, rounded, against the box of the element the position
  // is being measured *in*. That element is an argument rather than always
  // trackRef because the scrub strip is a sibling of the waveform, not the
  // waveform: they happen to be the same width today, and reading the wrong
  // one would start seeking to the wrong place the moment either grows a
  // padding or a margin.
  //
  // Invariant 4: an integer sample index, never a float. Returns null when the
  // element has no measurable width (jsdom, or a container that has not been
  // laid out yet), rather than NaN.
  function sampleAt(clientX: number, element: Element | null | undefined): number | null {
    const rect = element?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return null;
    const fraction = (clientX - rect.left) / rect.width;
    const clamped = Math.min(1, Math.max(0, fraction));
    return Math.round(clamped * totalSamples);
  }

  // A boundary may not cross its neighbours -- doing so would silently
  // reorder the track list under the user's titles -- and it may not sit on
  // either end of the album. The outer bounds are 1 and totalSamples - 1
  // because Album's own validator rejects a point at 0 or at total_samples
  // (both would mean a zero-length track); allowing them here would turn one
  // ordinary drag-to-the-edge, or a single Home/End press, into a 422 on the
  // autosave PUT.
  function bounds(index: number): [number, number] {
    const previous = splitPoints[index - 1];
    const next = splitPoints[index + 1];
    return [
      previous === undefined ? 1 : previous + 1,
      next === undefined ? totalSamples - 1 : next - 1,
    ];
  }

  function moveTo(index: number, sample: number) {
    const [low, high] = bounds(index);
    onMove(index, Math.min(high, Math.max(low, Math.round(sample))));
  }

  function handleKeyDown(index: number, event: ReactKeyboardEvent<HTMLDivElement>) {
    const current = splitPoints[index];
    if (current === undefined) return;
    const step = event.shiftKey ? COARSE_STEP : FINE_STEP;
    const [low, high] = bounds(index);
    let target: number | null = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') target = current + step;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') target = current - step;
    else if (event.key === 'Home') target = low;
    else if (event.key === 'End') target = high;
    if (target === null) return;
    event.preventDefault();
    moveTo(index, target);
  }

  return (
    <div className={styles.frame}>
      <div
        ref={trackRef}
        className={styles.track}
        data-testid="album-waveform"
        // A click on bare waveform is how a boundary is created. The markers
        // and the scrub strip stop propagation, so this only ever fires for
        // the background.
        onClick={(event) => {
          const sample = sampleAt(event.clientX, event.currentTarget);
          if (sample !== null) onAdd(sample);
        }}
      >
        <div ref={waveRef} className={styles.wave} />

        {playheadSample !== null && (
          <div
            className={styles.playhead}
            data-testid="album-playhead"
            style={{ left: percent(playheadSample, totalSamples) }}
          />
        )}

        {splitPoints.map((sample, index) => (
          <Fragment key={index}>
            <div
              role="slider"
              tabIndex={0}
              aria-label={`split point ${index + 1}`}
              aria-valuemin={0}
              aria-valuemax={totalSamples}
              aria-valuenow={sample}
              className={styles.grip}
              style={{ left: percent(sample, totalSamples) }}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => handleKeyDown(index, event)}
              onPointerDown={(event) => {
                event.stopPropagation();
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerMove={(event) => {
                if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
                // The grip, not its box: a drag is measured against the
                // track the marker slides along.
                const next = sampleAt(event.clientX, trackRef.current);
                if (next !== null) moveTo(index, next);
              }}
              onPointerUp={(event) => {
                if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                  event.currentTarget.releasePointerCapture(event.pointerId);
                }
              }}
            />
            <button
              type="button"
              className={styles.remove}
              aria-label={`Remove split point ${index + 1}`}
              style={{ left: percent(sample, totalSamples) }}
              onClick={(event) => {
                event.stopPropagation();
                onRemove(index);
              }}
            >
              ×
            </button>
          </Fragment>
        ))}
      </div>

      {/* The scrub affordance is deliberately separate from the waveform: a
          click on the waveform means "cut here", and overloading the same
          pixels with "seek here" would make both ambiguous. */}
      <div
        role="button"
        tabIndex={0}
        aria-label="Scrub the preview"
        className={styles.scrub}
        onClick={(event) => {
          event.stopPropagation();
          const sample = sampleAt(event.clientX, event.currentTarget);
          if (sample !== null) onScrub(sample);
        }}
      >
        <span className={styles.scrubHint}>click here to scrub the preview</span>
      </div>
    </div>
  );
}
