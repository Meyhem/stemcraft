// The Practice tab (D-22): song-free exercises. Settings come from practice.json
// (PracticeDoc); the loop is generated in the browser, rendered to stems and
// played by one engine (usePracticeSession). An exercise that does not fit, an
// engine that cannot start, and a practice.json that cannot be read or saved
// are each shown with the real message (N-08, U-09).
import { useCallback, useEffect, useMemo } from 'react';

import type { ExerciseKind, InstrumentSettings, PracticeInstrument, PracticePreset } from '../api/client';
import type { StemChannels } from '../engine/loopCursor';
import { generate, regenerable } from '../music/practice/generate';
import { newSeed } from '../music/practice/random';
import { GuitarNeck } from '../playalong/GuitarNeck';
import { StrumLane } from '../playalong/StrumLane';
import { helpFor } from '../practice/help';
import styles from '../practice/Practice.module.css';
import { PracticeDocProvider, usePracticeDoc } from '../practice/PracticeDoc';
import { PracticeNeck } from '../practice/PracticeNeck';
import { PracticeRail } from '../practice/PracticeRail';
import { PracticeStaff } from '../practice/PracticeStaff';
import { PracticeTransport } from '../practice/PracticeTransport';
import { RampStrip } from '../practice/RampStrip';
import { SettingsPanel } from '../practice/SettingsPanel';
import { SoundPanel } from '../practice/SoundPanel';
import { usePracticeSession, type PracticeEngine } from '../practice/usePracticeSession';
import { Banner, Button, Loader } from '../ui';

type CreateEngine = (stems: readonly StemChannels[]) => Promise<PracticeEngine>;

export function Practice({ createEngine }: { createEngine?: CreateEngine }) {
  return (
    <PracticeDocProvider>
      <PracticeScreen createEngine={createEngine} />
    </PracticeDocProvider>
  );
}

function PracticeScreen({ createEngine }: { createEngine?: CreateEngine }) {
  const { doc, loadError, reload, saveError, update, retry, resetToDefaults } = usePracticeDoc();

  if (!doc) {
    return loadError ? (
      <section className={styles.content}>
        <Banner tone="error" title="Couldn't load practice.json" trace={loadError}>
          Nothing has been overwritten. <Button onClick={reload}>Try again</Button>{' '}
          <Button
            variant="danger"
            onClick={() => {
              if (window.confirm('Replace practice.json with the defaults? Your settings and presets will be lost.')) void resetToDefaults();
            }}
          >
            Reset to defaults…
          </Button>
        </Banner>
      </section>
    ) : (
      <Loader size="page" label="Loading practice…" />
    );
  }
  return <Loaded createEngine={createEngine} saveError={saveError} retry={retry} update={update} doc={doc} />;
}

function Loaded({
  doc,
  update,
  saveError,
  retry,
  createEngine,
}: {
  doc: NonNullable<ReturnType<typeof usePracticeDoc>['doc']>;
  update: ReturnType<typeof usePracticeDoc>['update'];
  saveError: string | null;
  retry(): void;
  createEngine?: CreateEngine;
}) {
  const instrument = doc.instrument;
  const settings = doc[instrument];
  const change = useCallback((next: InstrumentSettings) => void update((d) => ({ ...d, [d.instrument]: next })), [update]);

  // Only what changes the notes regenerates; levels, count-in and the ramp's shape do not.
  const noteKey = JSON.stringify([instrument, settings.exercise, settings.key, settings.seed, settings.groove, settings.scale, settings.arpeggio, settings.drill]);
  const result = useMemo(() => generate(instrument, settings), [noteKey]);
  const loop = result.ok ? result.loop : null;
  const session = usePracticeSession({ instrument, settings, loop, createEngine });
  // A stable nextOf, so GuitarNeck and StrumLane repaint on a new loop, not on every render.
  const nextOf = useCallback((bar: number) => (bar + 1) % (loop?.bars.length ?? 1), [loop]);

  // Space plays and pauses; never from a text field (songview/Transport.tsx's rule).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== ' ' || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(TEXTAREA|SELECT)$/.test(target.tagName))) return;
      if (target instanceof HTMLInputElement && target.type !== 'range') return;
      event.preventDefault();
      session.togglePlay();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [session]);

  const onInstrument = (next: PracticeInstrument) => void update((d) => ({ ...d, instrument: next }));
  const onExercise = (exercise: ExerciseKind) => change({ ...settings, exercise });
  const onLoadPreset = (p: PracticePreset) => change(p.settings);
  const onSavePreset = (name: string) =>
    void update((d) => ({
      ...d,
      presets: [...d.presets.filter((p) => p.name.toLowerCase() !== name.toLowerCase()), { name, instrument, settings }],
    }));

  const rendered = session.rendered;
  return (
    <div className={styles.layout}>
      <PracticeRail doc={doc} onInstrument={onInstrument} onExercise={onExercise} onLoadPreset={onLoadPreset} onSavePreset={onSavePreset} />
      <section className={styles.content}>
        {saveError && (
          <Banner tone="warn" title="Couldn't save practice.json" trace={saveError}>
            Your change is kept on this page. <Button onClick={retry}>Retry</Button>
          </Banner>
        )}
        <PracticeTransport
          session={session}
          settings={settings}
          loop={loop}
          canRegenerate={loop !== null && regenerable(instrument, settings)}
          onSettings={change}
          onRegenerate={() => change({ ...settings, seed: newSeed() })}
        />
        {settings.ramp.on && <RampStrip ramp={settings.ramp} loopsDone={session.loopsDone} />}
        <SettingsPanel instrument={instrument} settings={settings} onChange={change} />
        {!result.ok && (
          <Banner tone="error" title="This exercise does not fit">
            {result.error} Nothing plays until it fits.
            {result.fixes.map((f) => (
              <Button key={f.label} onClick={() => change(f.apply(settings))}>
                {f.label}
              </Button>
            ))}
          </Banner>
        )}
        {session.error && <Banner tone="error" title="Can't play" trace={session.error} />}
        {loop && rendered && (
          <>
            <PracticeStaff loop={loop} display={rendered.display} getPosition={session.getPosition} playing={session.playing} seekNonce={session.seekNonce} />
            {loop.bars.some((b) => b.note) && (
              <p className={styles.dim}>
                {loop.bars.map((b, i) => (b.note ? `Bar ${i + 1}: ${b.note}. ` : '')).join('')}
              </p>
            )}
            {loop.guitarBars ? (
              <>
                <GuitarNeck bars={loop.guitarBars} nextOf={nextOf} grid={rendered.display} getPosition={session.getPosition} playing={session.playing} seekNonce={session.seekNonce} />
                <StrumLane bars={loop.guitarBars} nextOf={nextOf} grid={rendered.display} strum={settings.groove.strum} getPosition={session.getPosition} playing={session.playing} seekNonce={session.seekNonce} />
              </>
            ) : (
              <PracticeNeck loop={loop} display={rendered.display} getPosition={session.getPosition} playing={session.playing} seekNonce={session.seekNonce} />
            )}
          </>
        )}
        <SoundPanel instrument={instrument} levels={settings.levels} onChange={(levels) => change({ ...settings, levels })} />
        <p className={styles.help}>{helpFor(instrument, settings)}</p>
      </section>
    </div>
  );
}
