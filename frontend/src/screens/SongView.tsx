// UI spec §6, screen 3 -- the screen the product exists for. Everything the
// earlier tasks built meets here: the engine (Tasks 5-7), the bar/sample grid
// (Task 4), the autosave hook (Task 8) and the five view components (Tasks
// 9-12).
//
// Three rules shape this file:
//   * One funnel. Every control edits the recipe through `applyRecipe`, which
//     sets state, pushes to the engine and saves -- so no control can change
//     what you hear without also persisting it (§6, "all settings auto-save").
//   * Solo is transient, mute is persistent (D6-04). song.json has `muted` and
//     `gain_db` and no `soloed`; solo lives in React state and is combined with
//     the other two only at the engine edge, in `effectiveGain`.
//   * Moving the cursor releases an armed loop first, visibly (U-06), and at
//     the engine *before* the seek (D-06).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { ApiError, songMedia, type Loop, type Song, type StemMix } from '../api/client';
import { useAnalysis, useSong, useUpdateSong } from '../api/queries';
import { EngineController, STEM_ORDER, type StemName } from '../engine/EngineController';
import { sampleIndex, type SampleIndex } from '../engine/types';
import { barAt, barStart, buildGrid, snapToBar } from '../music/grid';
import { ChordStrip } from '../songview/ChordStrip';
import { RightRail } from '../songview/RightRail';
import { StemLane } from '../songview/StemLane';
import { Timeline } from '../songview/Timeline';
import { Transport } from '../songview/Transport';
import styles from './SongView.module.css';

/** Shared identity, so resetting solo on navigation is not a re-render. */
const NO_SOLO: ReadonlySet<StemName> = new Set<StemName>();

/**
 * Mute, solo and gain collapse into the one number the engine takes. D6-04:
 * solo is transient React state and mute is persisted in song.json, so they are
 * combined here rather than stored combined.
 */
function effectiveGain(
  mix: StemMix | undefined,
  name: StemName,
  soloed: ReadonlySet<StemName>,
): number {
  if (mix?.muted) return 0;
  if (soloed.size > 0 && !soloed.has(name)) return 0;
  const db = mix?.gain_db ?? 0;
  return Math.pow(10, db / 20);
}

function pushMix(engine: EngineController, song: Song, soloed: ReadonlySet<StemName>): void {
  for (const name of STEM_ORDER) engine.setStemGain(name, effectiveGain(song.mix[name], name, soloed));
}

/**
 * The whole recipe, pushed at the engine. Written as a full push rather than a
 * diff: every call underneath is an idempotent parameter write, and a diff
 * would mean tracking a previous-value shadow copy of song.json for no audible
 * difference. The loop is *not* here -- it is the one setting with a transient
 * armed flag of its own, synced by its own effect below.
 */
function pushRecipe(engine: EngineController, song: Song, soloed: ReadonlySet<StemName>): void {
  engine.setTempo(song.playback.tempo);
  engine.setPitchSemitones(song.playback.pitch_semitones);
  engine.setMetronome(song.metronome);
  pushMix(engine, song, soloed);
}

export function SongView() {
  const { songId } = useParams();
  const songQuery = useSong(songId);
  const analysisQuery = useAnalysis(songId);
  // N-08: a save that failed must say so. Everything on this screen edits a
  // recipe that is only real once it reaches song.json, so a rejected PUT (a
  // 409 on an id mismatch, a 500 on an unreadable song.json, a dropped LAN
  // connection) leaves the user editing something nothing is persisting --
  // silently, unless this error is rendered.
  const { save, error: saveError } = useUpdateSong(songId);

  const [engine, setEngine] = useState<EngineController | null>(null);
  const [engineError, setEngineError] = useState<string | null>(null);
  // The recipe is owned here once seeded; the query result is only its seed.
  const [song, setSong] = useState<Song | null>(null);
  const [soloed, setSoloed] = useState<ReadonlySet<StemName>>(NO_SOLO);
  const [playing, setPlaying] = useState(false);
  const [loopArmed, setLoopArmed] = useState(false);
  // A repaint ticket, not a position. The readouts read the cursor through
  // `getPosition`, whose identity depends only on the engine, so moving the
  // cursor while paused changes nothing any of their rAF effects depend on and
  // they stay frozen on the old position. Bumping this is how a seek tells them
  // to paint one more frame.
  const [seekNonce, setSeekNonce] = useState(0);

  const entry = songQuery.data;
  const fetchedSong = entry?.song ?? null;
  const hasStems = entry?.files?.has_stems === true;

  const grid = useMemo(
    () => (analysisQuery.data ? buildGrid(analysisQuery.data.beat_grid) : null),
    [analysisQuery.data],
  );

  // Handlers must keep a stable identity: Transport registers a window keydown
  // listener in an effect keyed on them, and the rAF loops usePlayhead runs --
  // one each in Timeline, ChordStrip and Transport, all reading the same engine
  // clock, so they cannot disagree -- restart when their callbacks change. So
  // the handlers read the current render's values from here instead of closing
  // over them.
  const latest = useRef({ engine, song, grid, soloed, playing, loopArmed });
  useEffect(() => {
    latest.current = { engine, song, grid, soloed, playing, loopArmed };
  });

  // ---- data -> state ------------------------------------------------------

  const seededFor = useRef<string | null>(null);

  // SongView is not keyed by :songId, so React Router reuses this component
  // across a song-to-song navigation. Everything transient is dropped here
  // rather than relying on an unmount that never happens.
  useEffect(() => {
    seededFor.current = null;
    setSong(null);
    setSoloed(NO_SOLO);
    setPlaying(false);
    setLoopArmed(false);
    setEngineError(null);
  }, [songId]);

  // Seed once per song id, never on every query result: a PUT's response lands
  // in the cache as a fresh object, and reseeding from it would clobber edits
  // made during the autosave debounce window.
  useEffect(() => {
    if (fetchedSong && seededFor.current !== fetchedSong.id) {
      seededFor.current = fetchedSong.id;
      setSong(fetchedSong);
    }
  }, [fetchedSong]);

  // ---- engine lifecycle ---------------------------------------------------

  useEffect(() => {
    if (!songId || !hasStems) return;
    let cancelled = false;
    let built: EngineController | null = null;

    void (async () => {
      try {
        const media = songMedia(songId);
        const urls = Object.fromEntries(
          STEM_ORDER.map((name) => [name, media.stem(name)]),
        ) as Record<StemName, string>;
        const controller = await EngineController.create(urls);
        if (cancelled) {
          // React's double-invoked effects (and a fast song-to-song
          // navigation) both land here: the controller we asked for arrives
          // after its effect was torn down. An AudioContext nobody holds is a
          // leak, so dispose it rather than dropping the reference.
          void controller.dispose();
          return;
        }
        built = controller;
        setEngine(controller);
      } catch (error) {
        // N-08: the real message, verbatim, never a friendly substitute.
        if (!cancelled) setEngineError(error instanceof Error ? error.message : String(error));
      }
    })();

    return () => {
      cancelled = true;
      setEngine(null);
      if (built) void built.dispose();
    };
  }, [songId, hasStems]);

  useEffect(() => {
    if (!engine) return;
    return engine.onEnded(() => setPlaying(false));
  }, [engine]);

  // ---- engine <- recipe ---------------------------------------------------

  // Restores the saved recipe exactly once per engine, as soon as both the
  // engine and the song exist (they arrive in either order). Every later edit
  // pushes through applyRecipe instead.
  const restoreReady = engine !== null && song !== null;
  useEffect(() => {
    const current = latest.current;
    if (!current.engine || !current.song) return;
    pushRecipe(current.engine, current.song, current.soloed);
  }, [engine, restoreReady]);

  useEffect(() => {
    if (engine && grid) engine.setGrid(grid.bars, grid.beats);
  }, [engine, grid]);

  const loopStartBar = song?.active_loop?.start_bar ?? null;
  const loopEndBar = song?.active_loop?.end_bar ?? null;

  // Loops are stored as bar numbers and resolved to samples here, at use time
  // (tech spec §5). Keyed on the bar numbers rather than the loop object so a
  // re-render of an unchanged loop does not re-post it to the worklet.
  useEffect(() => {
    if (!engine) return;
    if (loopArmed && grid && loopStartBar !== null && loopEndBar !== null) {
      engine.setLoop({
        startFrame: barStart(grid, loopStartBar),
        endFrame: barStart(grid, loopEndBar),
      });
    } else {
      engine.setLoop(null);
    }
  }, [engine, grid, loopArmed, loopStartBar, loopEndBar]);

  // ---- the one funnel -----------------------------------------------------

  const applyRecipe = useCallback(
    (next: Song) => {
      setSong(next);
      const { engine: current, soloed: currentSolo } = latest.current;
      if (current) pushRecipe(current, next, currentSolo);
      save(next);
    },
    [save],
  );

  // ---- transport ----------------------------------------------------------

  const getPosition = useCallback(
    () => engine?.getPositionSamples() ?? sampleIndex(0),
    [engine],
  );

  const stamped = useRef(false);
  useEffect(() => {
    stamped.current = false;
  }, [songId]);

  const handlePlayPause = useCallback(async () => {
    const { engine: current, song: currentSong, grid: currentGrid } = latest.current;
    if (!current || !currentSong) return;
    if (latest.current.playing) {
      current.pause();
      setPlaying(false);
      return;
    }
    setPlaying(true);
    try {
      if (currentSong.count_in_bars > 0 && currentGrid) {
        await current.countInAndPlay(
          current.getPositionSamples(),
          currentSong.count_in_bars,
          currentGrid.bars,
          // The whole audible recipe, not just the mix: countInAndPlay turns
          // the click on unconditionally and never turns it off -- undoing
          // that is the caller's job, and this callback is also what
          // cancelCountIn runs when a pause or a seek interrupts the count-in.
          () => pushRecipe(current, latest.current.song ?? currentSong, latest.current.soloed),
        );
      } else {
        await current.play();
      }
      // The library sorts by last played; without this it would sort by a
      // field nothing ever writes. Once per visit is enough.
      if (!stamped.current) {
        stamped.current = true;
        const now = latest.current.song ?? currentSong;
        applyRecipe({ ...now, last_played_at: new Date().toISOString() });
      }
    } catch (error) {
      setPlaying(false);
      setEngineError(error instanceof Error ? error.message : String(error));
    }
  }, [applyRecipe]);

  /**
   * U-06 and D-06. The loop is released at the engine *before* the cursor
   * moves, so the wrap logic never runs against a cursor that has left the
   * region -- and `loopArmed` goes false so the button unlights and the region
   * greys: the user sees the mode change they caused, rather than an armed
   * loop that silently stopped looping.
   */
  const handleScrub = useCallback((position: SampleIndex) => {
    const { engine: current, loopArmed: armed } = latest.current;
    if (!current) return;
    if (armed) {
      current.setLoop(null);
      setLoopArmed(false);
    }
    current.seek(position);
    setSeekNonce((n) => n + 1);
  }, []);

  // A bar nudge is a cursor move like any other, so it goes through the same
  // rule rather than inventing a second one -- including the repaint ticket,
  // which handleScrub bumps on its behalf.
  const handleNudgeBars = useCallback(
    (delta: number) => {
      const { engine: current, grid: currentGrid } = latest.current;
      if (!current || !currentGrid) return;
      const here = Math.max(0, barAt(currentGrid, current.getPositionSamples()));
      handleScrub(barStart(currentGrid, Math.max(0, here + delta)));
    },
    [handleScrub],
  );

  const handleTempoChange = useCallback(
    (tempo: number) => {
      const { song: currentSong } = latest.current;
      if (currentSong) applyRecipe({ ...currentSong, playback: { ...currentSong.playback, tempo } });
    },
    [applyRecipe],
  );

  const handlePitchChange = useCallback(
    (pitch_semitones: number) => {
      const { song: currentSong } = latest.current;
      if (currentSong) {
        applyRecipe({ ...currentSong, playback: { ...currentSong.playback, pitch_semitones } });
      }
    },
    [applyRecipe],
  );

  const handleMetronomeToggle = useCallback(() => {
    const { song: currentSong } = latest.current;
    if (currentSong) applyRecipe({ ...currentSong, metronome: !currentSong.metronome });
  }, [applyRecipe]);

  // ---- loop -------------------------------------------------------------

  const handleSetLoopStart = useCallback(() => {
    const { engine: current, grid: currentGrid, song: currentSong } = latest.current;
    if (!current || !currentGrid || !currentSong) return;
    const bar = snapToBar(currentGrid, current.getPositionSamples());
    const existing = currentSong.active_loop;
    applyRecipe({
      ...currentSong,
      active_loop: {
        name: existing?.name ?? '',
        start_bar: bar,
        // A loop is at least one bar long: an A dropped past the current B
        // pushes B along rather than leaving an inverted region on screen.
        end_bar: Math.max(existing?.end_bar ?? 0, bar + 1),
      },
    });
  }, [applyRecipe]);

  const handleSetLoopEnd = useCallback(() => {
    const { engine: current, grid: currentGrid, song: currentSong } = latest.current;
    if (!current || !currentGrid || !currentSong?.active_loop) return;
    const bar = snapToBar(currentGrid, current.getPositionSamples());
    // An end at or before the start is not a loop. Left as it was rather than
    // inverted or silently swapped -- B before A is a gesture, not an intent.
    if (bar <= currentSong.active_loop.start_bar) return;
    applyRecipe({
      ...currentSong,
      active_loop: { ...currentSong.active_loop, end_bar: bar },
    });
  }, [applyRecipe]);

  const handleLoopArmToggle = useCallback(() => {
    const { grid: currentGrid, song: currentSong } = latest.current;
    if (!currentGrid || !currentSong?.active_loop) return;
    setLoopArmed((armed) => !armed);
  }, []);

  // ---- mixer --------------------------------------------------------------

  const handleMuteToggle = useCallback(
    (name: StemName) => {
      const { song: currentSong } = latest.current;
      if (!currentSong) return;
      const lane = currentSong.mix[name] ?? { gain_db: 0, muted: false };
      applyRecipe({
        ...currentSong,
        mix: { ...currentSong.mix, [name]: { ...lane, muted: !lane.muted } },
      });
    },
    [applyRecipe],
  );

  const handleSoloToggle = useCallback((name: StemName) => {
    const { engine: current, song: currentSong, soloed: currentSolo } = latest.current;
    const next = new Set(currentSolo);
    if (!next.delete(name)) next.add(name);
    setSoloed(next);
    // Transient: it never reaches song.json, only the engine.
    if (current && currentSong) pushMix(current, currentSong, next);
  }, []);

  const handleGainChange = useCallback(
    (name: StemName, gain_db: number) => {
      const { song: currentSong } = latest.current;
      if (!currentSong) return;
      const lane = currentSong.mix[name] ?? { gain_db: 0, muted: false };
      applyRecipe({
        ...currentSong,
        mix: { ...currentSong.mix, [name]: { ...lane, gain_db } },
      });
    },
    [applyRecipe],
  );

  const handleMuteLane = useCallback(
    (index: number) => {
      const name = STEM_ORDER[index];
      if (name) handleMuteToggle(name);
    },
    [handleMuteToggle],
  );

  // ---- right rail ---------------------------------------------------------

  const handleRecallLoop = useCallback(
    (loop: Loop) => {
      const { song: currentSong } = latest.current;
      if (currentSong) applyRecipe({ ...currentSong, active_loop: loop });
    },
    [applyRecipe],
  );

  const handleSaveActiveLoop = useCallback(
    (name: string) => {
      const { song: currentSong } = latest.current;
      if (!currentSong?.active_loop) return;
      const saved: Loop = { ...currentSong.active_loop, name };
      applyRecipe({
        ...currentSong,
        active_loop: saved,
        loops: [...currentSong.loops.filter((l) => l.name !== name), saved],
      });
    },
    [applyRecipe],
  );

  const handleDeleteLoop = useCallback(
    (name: string) => {
      const { song: currentSong } = latest.current;
      if (currentSong) {
        applyRecipe({ ...currentSong, loops: currentSong.loops.filter((l) => l.name !== name) });
      }
    },
    [applyRecipe],
  );

  const handleCountInChange = useCallback(
    (count_in_bars: number) => {
      const { song: currentSong } = latest.current;
      if (currentSong) applyRecipe({ ...currentSong, count_in_bars });
    },
    [applyRecipe],
  );

  // ---- render -------------------------------------------------------------

  const timelineLoop = useMemo(
    () =>
      loopStartBar !== null && loopEndBar !== null
        ? { startBar: loopStartBar, endBar: loopEndBar }
        : null,
    [loopStartBar, loopEndBar],
  );

  // A 404 from analysis is "not analyzed yet" (the normal state for a song that
  // has only been separated), not a failure: the screen still plays, with no
  // bars. Any other error keeps the loud N-08 treatment.
  const notAnalyzedYet = analysisQuery.error instanceof ApiError && analysisQuery.error.status === 404;

  if (songQuery.isPending) return <p className={styles.note}>Loading song&hellip;</p>;
  if (songQuery.isError) {
    return (
      <p role="alert" className={styles.alert}>
        {String(songQuery.error)}
      </p>
    );
  }

  // §9 / U-09: a song.json we could not parse says so in the server's own
  // words, and offers nothing that would need it.
  if (entry?.unreadable) {
    return (
      <section className={styles.empty}>
        <h1>{songId}</h1>
        <p role="alert" className={styles.alert}>
          {entry.unreadable}
        </p>
      </section>
    );
  }

  if (!hasStems) {
    return (
      <section className={styles.empty}>
        <h1>{fetchedSong?.title ?? songId}</h1>
        <p className={styles.note}>
          This song has not been separated yet &mdash; the Song view needs its four stems.
        </p>
        <Link className={styles.link} to="/jobs">
          Job queue &rarr;
        </Link>
      </section>
    );
  }

  return (
    <section className={styles.page}>
      <div className={styles.main}>
        <header className={styles.header}>
          <Link className={styles.link} to="/">
            &larr; Library
          </Link>
          <div className={styles.titles}>
            <h1>{song?.title ?? fetchedSong?.title ?? songId}</h1>
            <p className={styles.artist}>{song?.artist ?? fetchedSong?.artist}</p>
          </div>
          <Link className={styles.link} to={`/songs/${songId}/export`}>
            Export
          </Link>
        </header>

        {engineError && (
          <p role="alert" className={styles.alert}>
            {engineError}
          </p>
        )}

        {/* ApiError's message already carries the server's own detail, so it is
            shown as it came rather than paraphrased into reassurance. */}
        {saveError && (
          <p role="alert" className={styles.alert}>
            {saveError.message}
          </p>
        )}

        {analysisQuery.isError && !notAnalyzedYet && (
          <p role="alert" className={styles.alert}>
            {String(analysisQuery.error)}
          </p>
        )}

        {!engine && !engineError && <p className={styles.note}>Loading stems&hellip;</p>}

        {engine && song && (
          <>
            <Timeline
              grid={grid}
              durationSamples={engine.durationSamples}
              loop={timelineLoop}
              loopArmed={loopArmed}
              getPosition={getPosition}
              playing={playing}
              seekNonce={seekNonce}
              onScrub={handleScrub}
            />

            <div className={styles.lanes}>
              {engine.stemSummaries.map((summary) => (
                <StemLane
                  key={summary.name}
                  summary={summary}
                  durationSeconds={engine.durationSeconds}
                  muted={song.mix[summary.name]?.muted ?? false}
                  soloed={soloed.has(summary.name)}
                  gainDb={song.mix[summary.name]?.gain_db ?? 0}
                  anySoloed={soloed.size > 0}
                  onMuteToggle={() => handleMuteToggle(summary.name)}
                  onSoloToggle={() => handleSoloToggle(summary.name)}
                  onGainChange={(db) => handleGainChange(summary.name, db)}
                />
              ))}
            </div>

            <ChordStrip
              chords={analysisQuery.data?.chords ?? []}
              grid={grid}
              durationSamples={engine.durationSamples}
              getPosition={getPosition}
              playing={playing}
              seekNonce={seekNonce}
            />

            <div className={styles.transport}>
              <Transport
                playing={playing}
                grid={grid}
                getPosition={getPosition}
                seekNonce={seekNonce}
                tempo={song.playback.tempo}
                pitchSemitones={song.playback.pitch_semitones}
                metronome={song.metronome}
                loopArmed={loopArmed}
                hasLoop={Boolean(grid && song.active_loop)}
                onPlayPause={handlePlayPause}
                onTempoChange={handleTempoChange}
                onPitchChange={handlePitchChange}
                onMetronomeToggle={handleMetronomeToggle}
                onLoopArmToggle={handleLoopArmToggle}
                onSetLoopStart={handleSetLoopStart}
                onSetLoopEnd={handleSetLoopEnd}
                onNudgeBars={handleNudgeBars}
                onMuteLane={handleMuteLane}
              />
            </div>
          </>
        )}
      </div>

      <RightRail
        songId={songId ?? ''}
        candidates={analysisQuery.data?.key_candidates ?? []}
        savedLoops={song?.loops ?? []}
        activeLoop={song?.active_loop ?? null}
        countInBars={song?.count_in_bars ?? 0}
        onRecallLoop={handleRecallLoop}
        onSaveActiveLoop={handleSaveActiveLoop}
        onDeleteLoop={handleDeleteLoop}
        onCountInChange={handleCountInChange}
      />
    </section>
  );
}
