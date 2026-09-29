// UI spec §5 "Transport bar" and §7 (keyboard). Performance tier throughout:
// 56 px targets, mono tabular numerals (U-04), and an untouched tempo or pitch
// renders muted so the eye finds the one that is not at its default.
import { useCallback, useEffect, useMemo, useRef } from 'react';

import type { ChordSegment } from '../api/client';
import { chordIndexAt, displayChord, mergeChords } from '../music/chords';
import { barAt, type Grid } from '../music/grid';
import type { Zoom } from '../music/timeScale';
import type { SampleIndex } from '../engine/types';
import { Button, Segmented } from '../ui';
import { usePlayhead } from './usePlayhead';
import styles from './Transport.module.css';

const TEMPO_STEP = 0.05; // UI spec §7: up/down arrows move 5%
const NO_BARS = 'Bars need analysis to have run';

const ZOOM_OPTIONS = [
  { value: 'fit', label: 'Fit' },
  { value: '1x', label: '1×' },
  { value: '2x', label: '2×' },
] as const;

export interface TransportProps {
  playing: boolean;
  grid: Grid | null;
  getPosition(): SampleIndex;
  /**
   * Bumped by the owner whenever it moves the engine cursor, so this readout
   * repaints after a scrub or a bar nudge made while paused (usePlayhead).
   */
  seekNonce: number;
  tempo: number; // 0.5..1.0
  pitchSemitones: number; // -12..12
  metronome: boolean;
  loopArmed: boolean;
  hasLoop: boolean;
  onPlayPause(): void;
  onTempoChange(tempo: number): void;
  onPitchChange(semitones: number): void;
  onMetronomeToggle(): void;
  onLoopArmToggle(): void;
  onSetLoopStart(): void;
  onSetLoopEnd(): void;
  onNudgeBars(delta: number): void;
  onMuteLane(index: number): void;
  /** The analysis's per-bar chord segments, for the current/next readout. */
  chords: ChordSegment[];
  zoom: Zoom;
  onZoomChange(zoom: Zoom): void;
  follow: boolean;
  onFollowToggle(): void;
}

export function Transport({
  playing,
  grid,
  getPosition,
  seekNonce,
  tempo,
  pitchSemitones,
  metronome,
  loopArmed,
  hasLoop,
  onPlayPause,
  onTempoChange,
  onPitchChange,
  onMetronomeToggle,
  onLoopArmToggle,
  onSetLoopStart,
  onSetLoopEnd,
  onNudgeBars,
  onMuteLane,
  chords,
  zoom,
  onZoomChange,
  follow,
  onFollowToggle,
}: TransportProps) {
  const barRef = useRef<HTMLSpanElement | null>(null);
  const chordRef = useRef<HTMLSpanElement | null>(null);
  const nextChordRef = useRef<HTMLSpanElement | null>(null);
  const segments = useMemo(() => mergeChords(chords), [chords]);

  // Derived, never a prop: `grid === null` *is* "analysis hasn't run", and a
  // second prop saying the same thing is a second source of truth a caller can
  // make disagree with the grid this component already draws from.
  const barsAvailable = grid !== null;

  const paint = useCallback(
    (position: SampleIndex) => {
      if (!barRef.current) return;
      // 1-indexed on screen; barAt returns -1 before the first downbeat.
      const bar = grid ? barAt(grid, position) : -1;
      barRef.current.textContent = bar >= 0 ? String(bar + 1) : '--';
      // The chord readout, from the same frame: what is sounding and what
      // comes next -- the merged list, so "next" is the next *change*.
      const i = chordIndexAt(segments, position);
      const now = segments[i];
      const next = segments[i + 1];
      if (chordRef.current) chordRef.current.textContent = now ? displayChord(now.chord).text : '--';
      if (nextChordRef.current) {
        nextChordRef.current.textContent = next ? `→ ${displayChord(next.chord).text}` : '';
      }
    },
    [grid, segments],
  );
  usePlayhead(getPosition, paint, playing, seekNonce);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      // Never steal a key from a text field: the right rail renames loops.
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(TEXTAREA|SELECT)$/.test(target.tagName))) {
        return;
      }
      if (target instanceof HTMLInputElement) {
        // A slider (tempo, pitch, lane gain) keeps focus after it is used. It is not text
        // entry, so Space must still reach play/pause -- but its arrow keys are its own,
        // and every other key stays with it as before.
        const isSlider = target.type === 'range';
        if (!(isSlider && event.key === ' ')) return;
      }
      // Never hijack an OS/browser chord (Ctrl/Cmd+A select-all, Ctrl/Cmd+B
      // bookmark bar, etc.). Shift is left alone: the uppercase A/B/L/M
      // entries below exist so a shift-held letter still works.
      if (event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }
      const key = event.key;
      const actions: Record<string, () => void> = {
        ' ': onPlayPause,
        l: () => hasLoop && onLoopArmToggle(),
        L: () => hasLoop && onLoopArmToggle(),
        a: () => barsAvailable && onSetLoopStart(),
        A: () => barsAvailable && onSetLoopStart(),
        b: () => barsAvailable && hasLoop && onSetLoopEnd(),
        B: () => barsAvailable && hasLoop && onSetLoopEnd(),
        m: onMetronomeToggle,
        M: onMetronomeToggle,
        ArrowUp: () => onTempoChange(Math.min(1, Number((tempo + TEMPO_STEP).toFixed(2)))),
        ArrowDown: () => onTempoChange(Math.max(0.5, Number((tempo - TEMPO_STEP).toFixed(2)))),
        ArrowRight: () => onNudgeBars(1),
        ArrowLeft: () => onNudgeBars(-1),
      };
      if (key >= '1' && key <= '4') {
        event.preventDefault();
        onMuteLane(Number(key) - 1);
        return;
      }
      const action = actions[key];
      if (action) {
        event.preventDefault();
        action();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [
    tempo,
    hasLoop,
    barsAvailable,
    onPlayPause,
    onLoopArmToggle,
    onSetLoopStart,
    onSetLoopEnd,
    onMetronomeToggle,
    onTempoChange,
    onNudgeBars,
    onMuteLane,
  ]);

  return (
    <div className={styles.bar}>
      <Button
        tier="perform"
        className={styles.play}
        aria-label={playing ? 'Pause' : 'Play'}
        onClick={onPlayPause}
      >
        {playing ? '⏸' : '▶'}
      </Button>

      <span className={styles.barNumber} data-testid="bar-readout" ref={barRef}>
        --
      </span>

      <div className={styles.readout}>
        <span className={styles.caption}>Chord</span>
        <span className={styles.chord}>
          <span data-testid="chord-readout" ref={chordRef}>
            --
          </span>{' '}
          <span className={styles.nextChord} data-testid="chord-next" ref={nextChordRef} />
        </span>
      </div>

      <label className={styles.slider}>
        Tempo
        <input
          type="range"
          aria-label="Tempo"
          min={50}
          max={100}
          step={1}
          value={Math.round(tempo * 100)}
          onChange={(e) => onTempoChange(Number(e.target.value) / 100)}
        />
        {/* Untouched values render muted (UI spec §5). */}
        <output data-default={tempo === 1 ? 'true' : 'false'}>{Math.round(tempo * 100)}%</output>
      </label>

      <label className={styles.slider}>
        Pitch
        <input
          type="range"
          aria-label="Pitch"
          min={-12}
          max={12}
          step={1}
          value={pitchSemitones}
          onChange={(e) => onPitchChange(Number(e.target.value))}
        />
        <output data-default={pitchSemitones === 0 ? 'true' : 'false'}>
          {pitchSemitones} st
        </output>
      </label>

      <Button
        tier="perform"
        className={styles.action}
        aria-label="Metronome"
        aria-pressed={metronome}
        onClick={onMetronomeToggle}
      >
        Metronome
      </Button>
      <Button
        tier="perform"
        className={styles.action}
        aria-label="Arm loop"
        aria-pressed={loopArmed}
        disabled={!hasLoop}
        onClick={onLoopArmToggle}
      >
        Loop
      </Button>
      {/* Bars come from analysis; without a grid there is nothing to snap to,
          so the control is withheld and says why rather than no-opping. And a
          B with no A behind it is not an end of anything, so it waits for one
          rather than accepting a click that cannot mean what it looks like. */}
      <Button
        tier="perform"
        className={styles.action}
        disabled={!barsAvailable}
        title={barsAvailable ? undefined : NO_BARS}
        onClick={onSetLoopStart}
      >
        Set A
      </Button>
      <Button
        tier="perform"
        className={styles.action}
        disabled={!barsAvailable || !hasLoop}
        title={!barsAvailable ? NO_BARS : !hasLoop ? 'Set A first' : undefined}
        onClick={onSetLoopEnd}
      >
        Set B
      </Button>

      {/* View controls: hands-free setup, so the setup tier (40px). */}
      <div className={styles.view}>
        <div className={styles.readout}>
          <span className={styles.caption} aria-hidden="true">
            Zoom
          </span>
          <Segmented label="Zoom" value={zoom} options={ZOOM_OPTIONS} onChange={onZoomChange} />
        </div>
        <Button aria-pressed={follow} onClick={onFollowToggle}>
          Follow playhead
        </Button>
      </div>
    </div>
  );
}
