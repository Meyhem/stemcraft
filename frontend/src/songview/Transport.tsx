// UI spec §5 "Transport bar" and §7 (keyboard). Performance tier throughout:
// 56 px targets, mono tabular numerals (U-04), and an untouched tempo or pitch
// renders muted so the eye finds the one that is not at its default.
import { useCallback, useEffect, useRef } from 'react';

import { barAt, type Grid } from '../music/grid';
import type { SampleIndex } from '../engine/types';
import { usePlayhead } from './usePlayhead';
import styles from './Transport.module.css';

const TEMPO_STEP = 0.05; // UI spec §7: up/down arrows move 5%

export interface TransportProps {
  playing: boolean;
  grid: Grid | null;
  getPosition(): SampleIndex;
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
}

export function Transport({
  playing,
  grid,
  getPosition,
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
}: TransportProps) {
  const barRef = useRef<HTMLSpanElement | null>(null);

  const paint = useCallback(
    (position: SampleIndex) => {
      if (!barRef.current) return;
      // 1-indexed on screen; barAt returns -1 before the first downbeat.
      const bar = grid ? barAt(grid, position) : -1;
      barRef.current.textContent = bar >= 0 ? String(bar + 1) : '--';
    },
    [grid],
  );
  usePlayhead(getPosition, paint, playing);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      // Never steal a key from a text field: the right rail renames loops.
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
      ) {
        return;
      }
      const key = event.key;
      const actions: Record<string, () => void> = {
        ' ': onPlayPause,
        l: onLoopArmToggle,
        L: onLoopArmToggle,
        a: onSetLoopStart,
        A: onSetLoopStart,
        b: onSetLoopEnd,
        B: onSetLoopEnd,
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
      <button
        type="button"
        className={styles.play}
        aria-label={playing ? 'Pause' : 'Play'}
        onClick={onPlayPause}
      >
        {playing ? '⏸' : '▶'}
      </button>

      <span className={styles.barNumber} data-testid="bar-readout" ref={barRef}>
        --
      </span>

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

      <button
        type="button"
        aria-label="Metronome"
        aria-pressed={metronome}
        onClick={onMetronomeToggle}
      >
        Metronome
      </button>
      <button
        type="button"
        aria-label="Arm loop"
        aria-pressed={loopArmed}
        disabled={!hasLoop}
        onClick={onLoopArmToggle}
      >
        Loop
      </button>
      <button type="button" onClick={onSetLoopStart}>
        Set A
      </button>
      <button type="button" onClick={onSetLoopEnd}>
        Set B
      </button>
    </div>
  );
}
