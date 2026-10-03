// The Practice tab's playback (D-22): one engine for the visit, fed the rendered
// loop. A changed loop is rendered again and swapped into the same engine
// (replaceStems); playback restarts from bar 1 with the count-in. A ramp step is
// the engine's tempo ratio, applied when the cursor wraps, so a bar never
// changes speed halfway (R-01's seamless wrap is untouched).
import { useCallback, useEffect, useRef, useState } from 'react';

import type { InstrumentSettings, PracticeInstrument, PracticeLevels } from '../api/client';
import type { StemChannels } from '../engine/loopCursor';
import { sampleIndex, STEM_ORDER, type SampleIndex, type StemName } from '../engine/types';
import type { PracticeLoop } from '../music/practice/types';
import { renderPractice, type RenderedPractice } from './audio/render';
import { rampState } from './tempo';

export interface PracticeEngine {
  replaceStems(stems: readonly StemChannels[]): void;
  setGrid(bars: SampleIndex[], beats: SampleIndex[]): void;
  setLoop(loop: { startFrame: SampleIndex; endFrame: SampleIndex } | null): void;
  seek(position: SampleIndex): void;
  play(): Promise<void>;
  pause(): void;
  countInAndPlay(from: SampleIndex, bars: number, barStarts: SampleIndex[], restoreGains: () => void): Promise<void>;
  setStemGain(stem: StemName, gain: number): void;
  setMetronome(on: boolean): void;
  setMetronomeLevel(level: number): void;
  setTempo(ratio: number): void;
  getPositionSamples(): SampleIndex;
  dispose(): Promise<void>;
}

export function gainsFor(instrument: PracticeInstrument, levels: PracticeLevels): Record<StemName, number> {
  const on = (level: number, muted: boolean) => (muted ? 0 : level);
  const ref = on(levels.ref, levels.ref_muted);
  const drums = on(levels.drums, levels.drums_muted);
  return instrument === 'bass'
    ? { vocals: 0, drums, bass: ref, other: on(levels.chords, levels.chords_muted) }
    : { vocals: 0, drums, bass: on(levels.backing, levels.backing_muted), other: ref };
}

export interface PracticeSession {
  rendered: RenderedPractice | null;
  playing: boolean;
  togglePlay(): void;
  getPosition(): SampleIndex;
  seekNonce: number;
  loopsDone: number;
  error: string | null;
}

// Imported on first use, not at module load: the engine's SoundTouch node extends
// AudioWorkletNode at import time, which jsdom (and so every screen test) lacks.
const defaultCreate = async (stems: readonly StemChannels[]): Promise<PracticeEngine> => {
  const { EngineController } = await import('../engine/EngineController');
  return EngineController.createFromStems(stems);
};

export function usePracticeSession({
  instrument,
  settings,
  loop,
  createEngine = defaultCreate,
}: {
  instrument: PracticeInstrument;
  settings: InstrumentSettings;
  loop: PracticeLoop | null;
  createEngine?: (stems: readonly StemChannels[]) => Promise<PracticeEngine>;
}): PracticeSession {
  const engine = useRef<PracticeEngine | null>(null);
  const creating = useRef<Promise<PracticeEngine> | null>(null);
  const fresh = useRef(true);
  const playingRef = useRef(false);
  // Loops completed since this loop was rendered: a pause does not restart the ramp, a new render does.
  const loops = useRef(0);
  const [rendered, setRendered] = useState<RenderedPractice | null>(null);
  const [playing, setPlaying] = useState(false);
  const [seekNonce, setSeekNonce] = useState(0);
  const [loopsDone, setLoopsDone] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const renderBpm = settings.ramp.on ? settings.ramp.start : settings.bpm;
  // Keyed on its values, so a new object with the same pickers does not re-render.
  const backingKey = settings.backing.chord_sound + settings.backing.drum_groove;
  const latest = useRef({ settings, instrument, rendered });
  latest.current = { settings, instrument, rendered };

  const applyGains = useCallback(() => {
    const e = engine.current;
    if (!e) return;
    const { instrument: inst, settings: s } = latest.current;
    const gains = gainsFor(inst, s.levels);
    for (const stem of STEM_ORDER) e.setStemGain(stem, gains[stem]);
    e.setMetronomeLevel(s.levels.click);
    e.setMetronome(true);
  }, []);

  const start = useCallback(() => {
    const e = engine.current;
    const r = latest.current.rendered;
    if (!e || !r) return;
    const bars = latest.current.settings.count_in_bars;
    playingRef.current = true;
    setPlaying(true);
    if (fresh.current && bars > 0) {
      fresh.current = false;
      void e.countInAndPlay(r.loopStart, bars, r.grid.bars, applyGains);
    } else {
      fresh.current = false;
      void e.play();
    }
  }, [applyGains]);

  // Render, then hand the result to the (one) engine.
  useEffect(() => {
    if (!loop) return;
    let cancelled = false;
    (async () => {
      try {
        const r = renderPractice(loop, renderBpm, latest.current.settings.backing);
        let e = engine.current;
        if (!e) {
          creating.current ??= createEngine(r.stems);
          e = await creating.current;
          if (cancelled) return;
          engine.current = e;
        } else {
          e.replaceStems(r.stems);
        }
        e.setGrid(r.grid.bars, r.grid.beats);
        e.setLoop({ startFrame: r.loopStart, endFrame: r.loopEnd });
        e.seek(r.loopStart);
        e.setTempo(1);
        latest.current.rendered = r;
        setRendered(r);
        setError(null);
        loops.current = 0;
        setLoopsDone(0);
        setSeekNonce((n) => n + 1);
        fresh.current = true;
        applyGains();
        if (playingRef.current) start();
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loop, renderBpm, backingKey, createEngine, applyGains, start]);

  useEffect(() => {
    applyGains();
  }, [settings.levels, instrument, applyGains]);

  // Ramp: watch for the wrap while playing.
  const ramp = settings.ramp;
  useEffect(() => {
    if (!playing || !ramp.on || !rendered) return;
    const barFrames = rendered.grid.medianBarSamples;
    let last = engine.current?.getPositionSamples() ?? 0;
    let handle = 0;
    // A ramp edited mid-play takes effect at once at the current step.
    engine.current?.setTempo(rampState(ramp, loops.current).bpm / ramp.start);
    const watch = () => {
      const now = engine.current?.getPositionSamples() ?? 0;
      if (now < last - barFrames) {
        loops.current += 1;
        setLoopsDone(loops.current);
        engine.current?.setTempo(rampState(ramp, loops.current).bpm / ramp.start);
      }
      last = now;
      handle = requestAnimationFrame(watch);
    };
    handle = requestAnimationFrame(watch);
    return () => cancelAnimationFrame(handle);
  }, [playing, ramp, rendered]);

  useEffect(
    () => () => {
      void engine.current?.dispose();
      engine.current = null;
    },
    [],
  );

  const togglePlay = useCallback(() => {
    if (error || !engine.current) return;
    if (playingRef.current) {
      playingRef.current = false;
      setPlaying(false);
      engine.current.pause();
    } else {
      start();
    }
  }, [error, start]);

  const getPosition = useCallback(() => engine.current?.getPositionSamples() ?? sampleIndex(0), []);

  return { rendered, playing, togglePlay, getPosition, seekNonce, loopsDone, error };
}
