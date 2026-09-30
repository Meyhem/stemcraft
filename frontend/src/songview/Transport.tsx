// The one transport of the song screen, identical over the Stems and the Tabs content
// (UI spec §5 "Transport bar", §7 keyboard). One row: play, the bar and chord readout,
// tempo and pitch steppers, a loop split button and Practice. Performance tier (56 px
// targets, mono tabular numerals, U-04); an untouched tempo or pitch renders muted so
// the eye finds the one that is not at its default. What is set once per session -- the
// loop's bars, saved loops, metronome, count-in -- sits in two popovers, never on the bar.
// The A and B keys still set the loop ends to the bar under the playhead.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { ChordSegment, Loop } from '../api/client';
import { clampTempo, TEMPO_MAX, TEMPO_MIN, type SampleIndex } from '../engine/types';
import { chordIndexAt, displayChord, mergeChords } from '../music/chords';
import { barAt, type Grid } from '../music/grid';
import { LoopBars } from '../playalong/LoopBars';
import { Button, Popover, Segmented, Stepper } from '../ui';
import { SavedLoops } from './SavedLoops';
import { usePlayhead } from './usePlayhead';
import styles from './Transport.module.css';

const TEMPO_STEP = 0.05; // UI spec §7: up/down arrows move 5%
const NO_BARS = 'Looping needs bars, and bars need analysis to have run';
const COUNT_IN = [0, 1, 2];
// The count-in is played out of the bars *before* the start point, so there has to be
// room for it. Said on the control rather than left to be discovered mid-practice.
const COUNT_IN_NOTE = 'Played from the bars before your start point, so starting at the top of a song plays none';

// Icons as paths, never emoji glyphs: a glyph renders in the OS emoji font and ignores
// the design tokens.
const PLAY = 'M8 5v14l11-7z';
const PAUSE = 'M6 5h4v14H6zm8 0h4v14h-4z';
const LOOP_ICON = 'M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z';
const CHEVRON = 'M7 10l5 5 5-5z';
const PRACTICE_ICON =
  'M3 17v2h6v-2H3zM3 5v2h10V5H3zm10 16v-2h8v-2h-8v-2h-2v6h2zM7 9v2H3v2h4v2h2V9H7zm14 4v-2H11v2h10zm-6-4h2V7h4V5h-4V3h-2v6z';

function Icon({ path }: { path: string }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
      <path d={path} />
    </svg>
  );
}

type Editor = 'loop' | 'practice';

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
  // One popover open at a time: opening one closes the other.
  const [editor, setEditor] = useState<Editor | null>(null);
  const closeEditor = useCallback(() => setEditor(null), []);
  const toggleEditor = (which: Editor) => setEditor((now) => (now === which ? null : which));

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

  const loopLabel = loop ? `${loop.start_bar + 1}–${loop.end_bar}` : '';

  return (
    <div className={styles.bar}>
      <Button
        tier="perform"
        variant="primary"
        className={styles.play}
        aria-label={playing ? 'Pause' : 'Play'}
        onClick={onPlayPause}
      >
        <Icon path={playing ? PAUSE : PLAY} />
      </Button>

      <div className={styles.readout}>
        <span className={styles.caption}>Bar</span>
        <span className={styles.barNumber} data-testid="bar-readout" ref={barRef}>
          --
        </span>
      </div>
      <div className={styles.readout}>
        <span className={styles.caption}>Chord</span>
        <span className={styles.chord}>
          <span data-testid="chord-readout" ref={chordRef}>
            --
          </span>{' '}
          <span className={styles.nextChord} data-testid="chord-next" ref={nextChordRef} />
        </span>
      </div>

      <div className={styles.readout}>
        <span className={styles.caption}>Tempo</span>
        {/* 10 % a press; the arrow keys keep their 5 %. */}
        <Stepper
          tier="perform"
          label="Tempo"
          value={Math.round(tempo * 100)}
          min={TEMPO_MIN * 100}
          max={TEMPO_MAX * 100}
          step={10}
          format={(v) => `${v}%`}
          atDefault={tempo === 1}
          onChange={(v) => onTempoChange(clampTempo(v / 100))}
        />
      </div>
      <div className={styles.readout}>
        <span className={styles.caption}>Pitch</span>
        <Stepper
          tier="perform"
          label="Pitch"
          value={pitchSemitones}
          min={-12}
          max={12}
          step={1}
          format={(v) => `${v} st`}
          atDefault={pitchSemitones === 0}
          onChange={onPitchChange}
        />
      </div>

      <span className={styles.spacer} />

      {/* Bars come from analysis; without a grid there is nothing to loop over, so the
          controls are withheld and say why rather than no-opping. */}
      <Popover
        open={editor === 'loop'}
        onClose={closeEditor}
        label="Loop"
        trigger={
          <div className={styles.split}>
            <Button
              tier="perform"
              aria-label="Arm loop"
              aria-pressed={loopArmed}
              disabled={!hasLoop}
              title={!barsAvailable ? NO_BARS : !loop ? 'Set the loop bars first' : undefined}
              onClick={onLoopArmToggle}
            >
              <Icon path={LOOP_ICON} />
              <span>Loop</span>
              <span className={styles.loopBars}>{loopLabel}</span>
            </Button>
            <Button
              tier="perform"
              aria-label="Edit loop"
              aria-haspopup="dialog"
              aria-expanded={editor === 'loop'}
              aria-pressed={loopArmed}
              disabled={!barsAvailable}
              title={!barsAvailable ? NO_BARS : undefined}
              onClick={() => toggleEditor('loop')}
            >
              <Icon path={CHEVRON} />
            </Button>
          </div>
        }
      >
        {grid && <LoopBars loop={loop} barCount={grid.barCount} onLoopBars={onLoopBars} />}
        <span className={styles.hint}>A and B set an end to the bar under the playhead</span>
        <SavedLoops
          savedLoops={savedLoops}
          activeLoop={loop}
          onRecallLoop={onRecallLoop}
          onSaveActiveLoop={onSaveActiveLoop}
          onDeleteLoop={onDeleteLoop}
        />
      </Popover>

      <Popover
        open={editor === 'practice'}
        onClose={closeEditor}
        label="Practice"
        trigger={
          <Button
            tier="perform"
            aria-haspopup="dialog"
            aria-expanded={editor === 'practice'}
            onClick={() => toggleEditor('practice')}
          >
            <Icon path={PRACTICE_ICON} />
            Practice
          </Button>
        }
      >
        <div className={styles.prow}>
          <span className={styles.label}>Metronome</span>
          <Button aria-label="Metronome" aria-pressed={metronome} onClick={onMetronomeToggle}>
            {metronome ? 'On' : 'Off'}
          </Button>
        </div>
        <div className={styles.prow}>
          <span className={styles.label} aria-hidden="true">
            Count-in
          </span>
          <Segmented
            label="Count-in"
            value={String(countInBars)}
            options={COUNT_IN.map((bars) => ({ value: String(bars), label: `${bars} ${bars === 1 ? 'bar' : 'bars'}` }))}
            onChange={(value) => onCountInChange(Number(value))}
          />
        </div>
        <span className={styles.hint}>{COUNT_IN_NOTE}.</span>
      </Popover>
    </div>
  );
}
