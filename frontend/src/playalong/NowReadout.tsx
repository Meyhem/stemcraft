// frontend/src/playalong/NowReadout.tsx
// Bar · beat, the chord now → the chord next, and what a pattern had to
// substitute in this bar. Painted into refs from the engine clock (U-05), like
// Transport's readouts. The substitution is part of the readout because it
// changes bar to bar, and hiding it would be a silent fallback (N-08).
import { useCallback, useRef } from 'react';

import type { SampleIndex } from '../engine/types';
import type { PlacedBar } from '../music/fingering';
import { beatPosition, type Grid } from '../music/grid';
import type { ResolvedKey } from '../music/patterns';
import { chordText } from '../music/tabSource';
import { usePlayhead } from '../songview/usePlayhead';
import styles from './PlayAlong.module.css';

export interface NowReadoutProps {
  bars: PlacedBar[];
  nextOf(bar: number): number | null;
  songKey: ResolvedKey;
  grid: Grid;
  pitchSemitones: number;
  getPosition(): SampleIndex;
  playing: boolean;
  seekNonce: number;
}

export function NowReadout({ bars, nextOf, songKey, grid, pitchSemitones, getPosition, playing, seekNonce }: NowReadoutProps) {
  const barRef = useRef<HTMLSpanElement | null>(null);
  const beatRef = useRef<HTMLSpanElement | null>(null);
  const nowRef = useRef<HTMLSpanElement | null>(null);
  const nextRef = useRef<HTMLSpanElement | null>(null);
  const noteRef = useRef<HTMLSpanElement | null>(null);

  const paint = useCallback(
    (position: SampleIndex) => {
      const at = beatPosition(grid, position);
      const current = at ? bars[at.bar] : undefined;
      const nextIndex = at ? nextOf(at.bar) : null;
      const next = nextIndex === null ? undefined : bars[nextIndex];
      const set = (el: HTMLElement | null, text: string) => {
        if (el && el.textContent !== text) el.textContent = text;
      };
      set(barRef.current, at ? String(at.bar + 1) : '--');
      set(beatRef.current, at ? `beat ${at.beat + 1}` : '');
      set(nowRef.current, current ? chordText(current, songKey) : '--');
      set(nextRef.current, next ? chordText(next, songKey) : '');
      const note = current?.plan.substitution ?? current?.plan.reason ?? '';
      set(noteRef.current, note);
      if (noteRef.current) noteRef.current.hidden = note === '';
    },
    [bars, nextOf, songKey, grid],
  );
  usePlayhead(getPosition, paint, playing, seekNonce);

  return (
    <div className={styles.now}>
      <span className={styles.caption}>Bar</span>
      <span className={styles.bigBar} data-testid="play-bar" ref={barRef}>
        --
      </span>
      <span className={styles.beat} ref={beatRef} />
      <span className={styles.chordNow} data-testid="play-chord" ref={nowRef}>
        --
      </span>
      <span className={styles.arrow} aria-hidden="true">
        →
      </span>
      <span className={styles.chordNext} data-testid="play-chord-next" ref={nextRef} />
      <span className={styles.substitution} data-testid="play-substitution" ref={noteRef} hidden />
      {pitchSemitones !== 0 && (
        <span className={styles.pitchNote}>
          pitch {pitchSemitones > 0 ? '+' : '−'}
          {Math.abs(pitchSemitones)} st · fingering follows what you hear
        </span>
      )}
    </div>
  );
}
