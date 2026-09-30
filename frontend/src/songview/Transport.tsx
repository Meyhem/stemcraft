// The one transport of the song screen, identical over the Stems and the Tabs content
// (UI spec §5 "Transport bar", §7 keyboard). Performance tier throughout: 56 px
// targets, mono tabular numerals (U-04), and an untouched tempo or pitch renders muted
// so the eye finds the one that is not at its default. Loops are set by bar number;
// the A and B keys set the ends to the bar under the playhead.
import { useCallback, useEffect, useMemo, useRef } from 'react';

import type { ChordSegment, Loop } from '../api/client';
import { clampTempo, TEMPO_MAX, TEMPO_MIN, type SampleIndex } from '../engine/types';
import { chordIndexAt, displayChord, mergeChords } from '../music/chords';
import { barAt, type Grid } from '../music/grid';
import { LoopBars } from '../playalong/LoopBars';
import { Button, Segmented } from '../ui';
import { SavedLoops } from './SavedLoops';
import { usePlayhead } from './usePlayhead';
import styles from './Transport.module.css';

const TEMPO_STEP = 0.05; // UI spec §7: up/down arrows move 5%
const NO_BARS = 'Looping needs bars, and bars need analysis to have run';
const COUNT_IN = [0, 1, 2];
// The count-in is played out of the bars *before* the start point, so there has to be
// room for it. Said on the control rather than left to be discovered mid-practice.
const COUNT_IN_NOTE = 'Played from the bars before your start point, so starting at the top of a song plays none';

export interface TransportProps {
  playing: boolean;
  grid: Grid | null;
  getPosition(): SampleIndex;
  /**
   * Bumped by the owner whenever it moves the engine cursor, so this readout
   * repaints after a scrub or a bar nudge made while paused (usePlayhead).
   */
  seekNonce: number;
  tempo: number; // 0.5..1.5
  pitchSemitones: number; // -12..12
  metronome: boolean;
  countInBars: number;
  /** The active loop, 0-based bars, end exclusive. */
  loop: Loop | null;
  loopArmed: boolean;
  savedLoops: Loop[];
  onPlayPause(): void;
  onTempoChange(tempo: number): void;
  onPitchChange(semitones: number): void;
  onMetronomeToggle(): void;
  onCountInChange(bars: number): void;
  onLoopArmToggle(): void;
  onLoopBars(startBar: number, endBar: number): void;
  /** The A and B keys: loop start / end at the bar under the playhead. */
  onSetLoopStart(): void;
  onSetLoopEnd(): void;
  onRecallLoop(loop: Loop): void;
  onSaveActiveLoop(name: string): void;
  onDeleteLoop(name: string): void;
  onNudgeBars(delta: number): void;
  onMuteLane(index: number): void;
  /** The analysis's per-bar chord segments, for the current/next readout. */
  chords: ChordSegment[];
}

export function Transport({
  playing,
  grid,
  getPosition,
  seekNonce,
  tempo,
  pitchSemitones,
  metronome,
  countInBars,
  loop,
  loopArmed,
  savedLoops,
  onPlayPause,
  onTempoChange,
  onPitchChange,
  onMetronomeToggle,
  onCountInChange,
  onLoopArmToggle,
  onLoopBars,
  onSetLoopStart,
  onSetLoopEnd,
  onRecallLoop,
  onSaveActiveLoop,
  onDeleteLoop,
  onNudgeBars,
  onMuteLane,
  chords,
}: TransportProps) {
  const barRef = useRef<HTMLSpanElement | null>(null);
  const chordRef = useRef<HTMLSpanElement | null>(null);
  const nextChordRef = useRef<HTMLSpanElement | null>(null);
  const segments = useMemo(() => mergeChords(chords), [chords]);

  // Derived, never props: `grid === null` *is* "analysis hasn't run", and a loop
  // without a grid has no bars to resolve to samples.
  const barsAvailable = grid !== null;
  const hasLoop = barsAvailable && loop !== null;

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
      // Never steal a key from a text field: the title and loop names are typed here.
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
        b: () => hasLoop && onSetLoopEnd(),
        B: () => hasLoop && onSetLoopEnd(),
        m: onMetronomeToggle,
        M: onMetronomeToggle,
        ArrowUp: () => onTempoChange(clampTempo(Number((tempo + TEMPO_STEP).toFixed(2)))),
        ArrowDown: () => onTempoChange(clampTempo(Number((tempo - TEMPO_STEP).toFixed(2)))),
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
      <Button tier="perform" className={styles.play} aria-label={playing ? 'Pause' : 'Play'} onClick={onPlayPause}>
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
          min={TEMPO_MIN * 100}
          max={TEMPO_MAX * 100}
          step={1}
          list="tempo-ticks"
          value={Math.round(tempo * 100)}
          onChange={(e) => onTempoChange(Number(e.target.value) / 100)}
        />
        {/* The original tempo, so 100% can be found again by eye. */}
        <datalist id="tempo-ticks">
          <option value="100" />
        </datalist>
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
        <output data-default={pitchSemitones === 0 ? 'true' : 'false'}>{pitchSemitones} st</output>
      </label>

      {/* Bars come from analysis; without a grid there is nothing to loop over, so the
          control is withheld and says why rather than no-opping. */}
      <Button
        tier="perform"
        className={styles.action}
        aria-label="Arm loop"
        aria-pressed={loopArmed}
        disabled={!hasLoop}
        title={!barsAvailable ? NO_BARS : !loop ? 'Set the loop bars first' : undefined}
        onClick={onLoopArmToggle}
      >
        Loop
      </Button>
      {grid && <LoopBars loop={loop} barCount={grid.barCount} onLoopBars={onLoopBars} />}
      <SavedLoops
        savedLoops={savedLoops}
        activeLoop={loop}
        onRecallLoop={onRecallLoop}
        onSaveActiveLoop={onSaveActiveLoop}
        onDeleteLoop={onDeleteLoop}
      />

      <Button
        tier="perform"
        className={styles.action}
        aria-label="Metronome"
        aria-pressed={metronome}
        onClick={onMetronomeToggle}
      >
        Metronome
      </Button>
      <div className={styles.readout} title={COUNT_IN_NOTE}>
        <span className={styles.caption} aria-hidden="true">
          Count-in
        </span>
        <Segmented
          label="Count-in"
          value={String(countInBars)}
          options={COUNT_IN.map((bars) => ({ value: String(bars), label: `${bars} ${bars === 1 ? 'bar' : 'bars'}` }))}
          onChange={(value) => onCountInChange(Number(value))}
        />
      </div>
    </div>
  );
}
