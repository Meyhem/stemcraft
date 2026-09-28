// Dev-only manual verification page for the playback engine (Task 8, R-01).
// Excluded from the production bundle: see app/routes.tsx, which only reaches
// this module through a dynamic import() gated on import.meta.env.DEV.
//
// Loads the four stem fixtures through EngineController exactly the way a
// future Song screen will. The click track is deliberately NOT one of the
// four stems: it is the human listener's audible timing reference, played
// through a plain <audio> element outside the engine, at low volume, so a
// tempo or loop-seam error shows up as a click track that drifts or stutters
// against the engine's own beat.
import { type ChangeEvent, useEffect, useRef, useState } from 'react';

import { EngineController, type EngineLoop, STEM_ORDER, type StemName } from '../engine/EngineController';
import { secondsToSamples, seconds } from '../engine/types';

import clickUrl from './fixtures/click.wav?url';
import bassUrl from './fixtures/stem-bass.wav?url';
import drumsUrl from './fixtures/stem-drums.wav?url';
import otherUrl from './fixtures/stem-other.wav?url';
import vocalsUrl from './fixtures/stem-vocals.wav?url';

const STEM_URLS: Record<StemName, string> = {
  vocals: vocalsUrl,
  drums: drumsUrl,
  bass: bassUrl,
  other: otherUrl,
};

const CLICK_TRACK_VOLUME = 0.15;

type Metrics = ReturnType<EngineController['getMetrics']>;

export default function EngineHarness() {
  const controllerRef = useRef<EngineController | null>(null);
  const clickAudioRef = useRef<HTMLAudioElement | null>(null);
  const metricsIntervalRef = useRef<number | null>(null);

  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gains, setGains] = useState<Record<StemName, number>>({
    vocals: 1,
    drums: 1,
    bass: 1,
    other: 1,
  });
  const [tempo, setTempoState] = useState(1.0);
  const [pitch, setPitchState] = useState(0);
  const [loopStart, setLoopStart] = useState('');
  const [loopEnd, setLoopEnd] = useState('');
  const [metrics, setMetrics] = useState<Metrics>(null);

  useEffect(() => {
    return () => {
      if (metricsIntervalRef.current !== null) window.clearInterval(metricsIntervalRef.current);
      void controllerRef.current?.dispose();
      clickAudioRef.current?.pause();
    };
  }, []);

  async function handlePlay() {
    setError(null);
    setLoading(true);
    try {
      if (!controllerRef.current) {
        controllerRef.current = await EngineController.create(STEM_URLS);
        for (const stem of STEM_ORDER) controllerRef.current.setStemGain(stem, gains[stem]);
        controllerRef.current.setTempo(tempo);
        controllerRef.current.setPitchSemitones(pitch);

        metricsIntervalRef.current = window.setInterval(() => {
          setMetrics(controllerRef.current?.getMetrics() ?? null);
        }, 200);
      }
      if (!clickAudioRef.current) {
        const audio = new Audio(clickUrl);
        audio.loop = true;
        audio.volume = CLICK_TRACK_VOLUME;
        clickAudioRef.current = audio;
      }
      await clickAudioRef.current.play();
      setPlaying(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleStop() {
    clickAudioRef.current?.pause();
    if (clickAudioRef.current) clickAudioRef.current.currentTime = 0;
    if (metricsIntervalRef.current !== null) {
      window.clearInterval(metricsIntervalRef.current);
      metricsIntervalRef.current = null;
    }
    await controllerRef.current?.dispose();
    controllerRef.current = null;
    setMetrics(null);
    setPlaying(false);
  }

  function handleGainChange(stem: StemName, event: ChangeEvent<HTMLInputElement>) {
    const value = Number(event.target.value);
    setGains((prev) => ({ ...prev, [stem]: value }));
    controllerRef.current?.setStemGain(stem, value);
  }

  function handleTempoChange(event: ChangeEvent<HTMLInputElement>) {
    const value = Number(event.target.value);
    setTempoState(value);
    controllerRef.current?.setTempo(value);
  }

  function handlePitchChange(event: ChangeEvent<HTMLInputElement>) {
    const value = Number(event.target.value);
    setPitchState(value);
    controllerRef.current?.setPitchSemitones(value);
  }

  function handleSetLoop(event: React.FormEvent) {
    event.preventDefault();
    if (!controllerRef.current) return;
    const startSec = Number(loopStart);
    const endSec = Number(loopEnd);
    if (!Number.isFinite(startSec) || !Number.isFinite(endSec)) return;
    const loop: EngineLoop = {
      startFrame: secondsToSamples(seconds(startSec)),
      endFrame: secondsToSamples(seconds(endSec)),
    };
    controllerRef.current.setLoop(loop);
  }

  function handleClearLoop() {
    controllerRef.current?.setLoop(null);
  }

  return (
    <section style={{ fontFamily: 'monospace', padding: '1rem', maxWidth: 640 }}>
      <h1>Engine harness (dev only)</h1>
      <p>
        Click track plays separately at low volume as a timing reference — it is not
        one of the four engine stems. Listen for tempo drift or a seam at the loop
        wrap.
      </p>

      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
        <button type="button" onClick={handlePlay} disabled={playing || loading}>
          {loading ? 'Loading…' : 'Play'}
        </button>
        <button type="button" onClick={handleStop} disabled={!playing}>
          Stop
        </button>
      </div>

      {error && (
        <p style={{ color: 'crimson' }} role="alert">
          Error: {error}
        </p>
      )}

      <fieldset>
        <legend>Stem gains</legend>
        {STEM_ORDER.map((stem) => (
          <div key={stem} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <label htmlFor={`gain-${stem}`} style={{ width: '5rem' }}>
              {stem}
            </label>
            <input
              id={`gain-${stem}`}
              type="range"
              min={0}
              max={1.5}
              step={0.01}
              value={gains[stem]}
              onChange={(e) => handleGainChange(stem, e)}
            />
            <span>{gains[stem].toFixed(2)}</span>
          </div>
        ))}
      </fieldset>

      <fieldset>
        <legend>Tempo</legend>
        <input
          id="tempo"
          type="range"
          min={0.5}
          max={1.0}
          step={0.01}
          value={tempo}
          onChange={handleTempoChange}
        />
        <span> {tempo.toFixed(2)}x</span>
      </fieldset>

      <fieldset>
        <legend>Pitch (semitones)</legend>
        <input
          id="pitch"
          type="range"
          min={-12}
          max={12}
          step={1}
          value={pitch}
          onChange={handlePitchChange}
        />
        <span> {pitch}</span>
      </fieldset>

      <fieldset>
        <legend>Loop region (seconds)</legend>
        <form onSubmit={handleSetLoop} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <label htmlFor="loop-start">Start</label>
          <input
            id="loop-start"
            type="number"
            step="any"
            value={loopStart}
            onChange={(e) => setLoopStart(e.target.value)}
          />
          <label htmlFor="loop-end">End</label>
          <input
            id="loop-end"
            type="number"
            step="any"
            value={loopEnd}
            onChange={(e) => setLoopEnd(e.target.value)}
          />
          <button type="submit">Set loop</button>
          <button type="button" onClick={handleClearLoop}>
            Clear loop
          </button>
        </form>
      </fieldset>

      <fieldset>
        <legend>Time-stretcher metrics</legend>
        {metrics ? (
          <ul>
            <li>underrunCount: {metrics.underrunCount}</li>
            <li>blockCount: {metrics.blockCount}</li>
            <li>framesBuffered: {metrics.framesBuffered}</li>
            <li>outputRms: {metrics.outputRms.toFixed(4)}</li>
            <li>outputPeak: {metrics.outputPeak.toFixed(4)}</li>
          </ul>
        ) : (
          <p>No metrics yet — start playback (the processor reports every 100 render blocks).</p>
        )}
      </fieldset>
    </section>
  );
}
