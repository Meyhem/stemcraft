// The Practice transport (D-22), perform tier: play, the bar and beat, now →
// next, BPM (with tap), the ramp, the count-in and Regenerate. The readouts are
// written from the engine clock straight into the DOM (U-05), never through
// React state at audio rate.
import { useCallback, useRef, useState } from 'react';

import type { InstrumentSettings } from '../api/client';
import { STRING_NAMES } from '../music/practice/neck';
import type { PracticeLoop } from '../music/practice/types';
import { usePlayhead } from '../songview/usePlayhead';
import { Button, Popover, Segmented, Stepper } from '../ui';
import styles from './Practice.module.css';
import { beatAt, chordNameAt } from './practiceStaffPainter';
import { BPM_MAX, BPM_MIN, rampLimits, tapTempo } from './tempo';
import type { PracticeSession } from './usePracticeSession';

export function nowAndNext(loop: PracticeLoop, beat: number): { cap: string; now: string; next: string } {
  const total = loop.bars.length * 4;
  const b = ((beat % total) + total) % total;
  const bar = Math.floor(b / 4);
  if (loop.notes.some((n) => n.finger !== null)) {
    const i = loop.notes.findIndex((n) => b >= n.start && b < n.start + n.dur);
    const names = STRING_NAMES[loop.instrument];
    const now = loop.notes[Math.max(0, i)]!;
    const next = loop.notes[(Math.max(0, i) + 1) % loop.notes.length]!;
    return { cap: 'string', now: `${names[now.string]} string`, next: names[next.string]! };
  }
  if (loop.bars.every((x, i) => i === 0 || x.label === '')) {
    const i = loop.notes.findIndex((n) => b >= n.start && b < n.start + n.dur);
    const now = loop.notes[Math.max(0, i)]!;
    return { cap: 'note', now: now.name, next: loop.notes[(Math.max(0, i) + 1) % loop.notes.length]!.name };
  }
  const now = chordNameAt(loop, bar);
  let j = bar + 1;
  while (j < bar + loop.bars.length && chordNameAt(loop, j) === now) j++;
  return { cap: 'chord', now, next: chordNameAt(loop, j) };
}

export function PracticeTransport({
  session,
  settings,
  loop,
  canRegenerate,
  onSettings,
  onRegenerate,
}: {
  session: PracticeSession;
  settings: InstrumentSettings;
  /** Null while the exercise does not fit: the transport stays, Play is disabled, the readouts show "–". */
  loop: PracticeLoop | null;
  canRegenerate: boolean;
  onSettings(next: InstrumentSettings): void;
  onRegenerate(): void;
}) {
  const barRef = useRef<HTMLSpanElement | null>(null);
  const beatRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const nowRef = useRef<HTMLSpanElement | null>(null);
  const capRef = useRef<HTMLSpanElement | null>(null);
  const [rampOpen, setRampOpen] = useState(false);
  const taps = useRef<number[]>([]);
  const display = session.rendered?.display;

  const paint = useCallback(
    (position: number) => {
      if (!display || !loop) return;
      const beat = beatAt(display, position as never);
      const inLoop = beat === null ? null : beat % (loop.bars.length * 4);
      if (barRef.current) barRef.current.textContent = inLoop === null ? '–' : String(Math.floor(inLoop / 4) + 1);
      beatRefs.current.forEach((el, i) => el?.setAttribute('data-on', String(inLoop !== null && Math.floor(inLoop % 4) === i)));
      const nn = nowAndNext(loop, inLoop ?? 0);
      if (capRef.current) capRef.current.textContent = nn.cap;
      if (nowRef.current) nowRef.current.textContent = `${nn.now} → ${nn.next}`;
    },
    [display, loop],
  );
  usePlayhead(session.getPosition, paint, session.playing, session.seekNonce);

  const set = (patch: Partial<InstrumentSettings>) => onSettings({ ...settings, ...patch });
  const ramp = settings.ramp;
  const setRamp = (patch: Partial<InstrumentSettings['ramp']>) => set({ ramp: { ...ramp, ...patch } });
  const limits = rampLimits(ramp.start);

  const tap = () => {
    taps.current = [...taps.current, performance.now()].slice(-8);
    const bpm = tapTempo(taps.current);
    if (bpm !== null) set({ bpm });
  };

  return (
    <div className={styles.transport}>
      <button type="button" className={styles.play} aria-label={session.playing ? 'Pause' : 'Play'} onClick={session.togglePlay} disabled={!loop || !session.rendered || session.error !== null}>
        {session.playing ? '❚❚' : '▶'}
      </button>
      <div className={styles.readout}>
        <span className={styles.cap}>bar</span>
        <span className={styles.big}>
          <span ref={barRef}>–</span>
          <span className={styles.dim}> / {loop?.bars.length ?? '–'}</span>
        </span>
      </div>
      <div className={styles.readout} aria-hidden="true">
        <span className={styles.cap}>beat</span>
        <span className={styles.beats}>
          {[0, 1, 2, 3].map((i) => (
            <span key={i} ref={(el) => void (beatRefs.current[i] = el)} className={i === 0 ? styles.downbeat : styles.beat} data-on="false" />
          ))}
        </span>
      </div>
      <div className={styles.readout}>
        <span className={styles.cap} ref={capRef}>
          chord
        </span>
        <span className={styles.chord} ref={nowRef} />
      </div>
      <div className={styles.grow} />
      <div className={styles.readout}>
        <span className={styles.cap}>{ramp.on ? 'bpm · ramping' : 'bpm'}</span>
        <div className={styles.row}>
          <Stepper
            tier="perform"
            label="Tempo"
            downLabel="Slower"
            upLabel="Faster"
            value={ramp.on ? ramp.start : settings.bpm}
            min={BPM_MIN}
            max={BPM_MAX}
            step={1}
            format={String}
            onChange={(v) => (ramp.on ? setRamp({ start: v, target: Math.min(Math.max(ramp.target, rampLimits(v).lo), rampLimits(v).hi) }) : set({ bpm: v }))}
          />
          <Button tier="perform" onClick={tap}>
            Tap
          </Button>
        </div>
      </div>
      <div className={styles.readout}>
        <span className={styles.cap}>ramp</span>
      <Popover
        open={rampOpen}
        onClose={() => setRampOpen(false)}
        label="Tempo ramp"
        trigger={
          <div className={styles.row}>
            <Button tier="perform" aria-pressed={ramp.on} onClick={() => setRamp({ on: !ramp.on, start: ramp.on ? ramp.start : settings.bpm, target: Math.min(rampLimits(settings.bpm).hi, Math.max(ramp.target, settings.bpm)) })}>
              Ramp
            </Button>
            <Button tier="perform" aria-label="Edit ramp" aria-expanded={rampOpen} onClick={() => setRampOpen((o) => !o)}>
              ▾
            </Button>
          </div>
        }
      >
        <div className={styles.field}>
          <span className={styles.cap}>From</span>
          <Stepper label="Ramp start" value={ramp.start} min={BPM_MIN} max={BPM_MAX} step={5} format={(v) => `${v} bpm`} onChange={(start) => setRamp({ start, target: Math.min(Math.max(ramp.target, rampLimits(start).lo), rampLimits(start).hi) })} />
        </div>
        <div className={styles.field}>
          <span className={styles.cap}>To</span>
          <Stepper label="Ramp target" value={ramp.target} min={limits.lo} max={limits.hi} step={5} format={(v) => `${v} bpm`} onChange={(target) => setRamp({ target })} />
        </div>
        <p className={styles.dim}>
          The engine stretches 0.5–1.5× of the start, so {limits.lo}–{limits.hi} bpm from {ramp.start}.
        </p>
        <div className={styles.field}>
          <span className={styles.cap}>Step</span>
          <Stepper label="Ramp step" value={ramp.step} min={1} max={20} step={1} format={(v) => `+${v} bpm`} onChange={(step) => setRamp({ step })} />
        </div>
        <div className={styles.field}>
          <span className={styles.cap}>Every</span>
          <Stepper label="Ramp every" value={ramp.every_loops} min={1} max={8} step={1} format={(v) => (v === 1 ? '1 loop' : `${v} loops`)} onChange={(every_loops) => setRamp({ every_loops })} />
        </div>
      </Popover>
      </div>
      <div className={styles.readout}>
        <span className={styles.cap}>count-in</span>
        <Segmented
          label="Count-in bars"
          value={String(settings.count_in_bars) as '0'}
          onChange={(v) => set({ count_in_bars: Number(v) as 0 | 1 | 2 })}
          options={[
            { value: '0', label: 'Off' },
            { value: '1', label: '1' },
            { value: '2', label: '2' },
          ]}
        />
      </div>
      {canRegenerate && (
        <Button tier="perform" onClick={onRegenerate}>
          ⟳ Regenerate
        </Button>
      )}
    </div>
  );
}
