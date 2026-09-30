// frontend/src/playalong/PlayAlongTransport.tsx
// The transport a player reaches for with a bass in their hands: perform-size
// targets (56 px), and Space to play or pause. It only calls the session's
// handlers, so it cannot drift from Song view's transport: same engine, same
// recipe, same loop.
import { useEffect } from 'react';

import type { Loop } from '../api/client';
import { Button, Segmented } from '../ui';
import { LoopBars } from './LoopBars';
import styles from './PlayAlong.module.css';

const COUNT_IN = [0, 1, 2];

export interface PlayAlongTransportProps {
  playing: boolean;
  tempo: number;
  metronome: boolean;
  countInBars: number;
  loop: Loop | null;
  loopArmed: boolean;
  barCount: number;
  onPlayPause(): void;
  onTempoChange(tempo: number): void;
  onMetronomeToggle(): void;
  onCountInChange(bars: number): void;
  onLoopArmToggle(): void;
  onLoopBars(startBar: number, endBar: number): void;
}

export function PlayAlongTransport(props: PlayAlongTransportProps) {
  const { playing, tempo, metronome, countInBars, loop, loopArmed, barCount, onPlayPause } = props;

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key !== ' ' || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      // Text entry keeps its Space. A slider keeps focus after use and does nothing
      // with Space; a button would re-fire its own action, so on this screen Space is
      // play/pause wherever focus sits (the setup-with-mouse, play-with-Space flow).
      if (target && (target.isContentEditable || /^(TEXTAREA|SELECT)$/.test(target.tagName))) return;
      if (target instanceof HTMLInputElement && target.type !== 'range') return;
      event.preventDefault();
      onPlayPause();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onPlayPause]);

  return (
    <div className={styles.transport}>
      <Button tier="perform" aria-label={playing ? 'Pause' : 'Play'} onClick={onPlayPause}>
        {playing ? '⏸' : '▶'}
      </Button>
      <label className={styles.slider}>
        <span className={styles.caption}>Tempo</span>
        <input
          type="range"
          aria-label="Tempo"
          min={50}
          max={150}
          step={1}
          value={Math.round(tempo * 100)}
          onChange={(e) => props.onTempoChange(Number(e.target.value) / 100)}
        />
        <output>{Math.round(tempo * 100)}%</output>
      </label>
      <Button tier="perform" aria-label="Arm loop" aria-pressed={loopArmed} disabled={!loop} onClick={props.onLoopArmToggle}>
        Loop
      </Button>
      <LoopBars loop={loop} barCount={barCount} onLoopBars={props.onLoopBars} />
      <Button tier="perform" aria-label="Metronome" aria-pressed={metronome} onClick={props.onMetronomeToggle}>
        Metronome
      </Button>
      <div className={styles.picker}>
        <span className={styles.caption}>Count-in</span>
        <Segmented
          label="Count-in"
          value={String(countInBars)}
          options={COUNT_IN.map((bars) => ({ value: String(bars), label: `${bars} ${bars === 1 ? 'bar' : 'bars'}` }))}
          onChange={(value) => props.onCountInChange(Number(value))}
        />
      </div>
    </div>
  );
}
