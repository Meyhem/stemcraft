// The listening session for one song, shared by every screen that plays it
// (D-18). Song view and Play along are two views of one session: the engine,
// the recipe, the transport and the loop live here, above both routes, so
// switching screens never stops playback or re-decodes the stems.
//
// Moved from SongView, which owned all of this until Play along existed. The
// rules it documented still shape this file:
//   * One funnel. Every control edits the recipe through `applyRecipe`, which
//     sets state, pushes to the engine and saves -- so no control can change
//     what you hear without also persisting it (§6, "all settings auto-save").
//   * Solo is transient, mute is persistent (D6-04). song.json has `muted` and
//     `gain_db` and no `soloed`; solo lives in React state and is combined with
//     the other two only at the engine edge, in `effectiveGain`.
//   * Moving the cursor releases an armed loop first, visibly (U-06), and at
//     the engine *before* the seek (D-06).
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import {
  ApiError,
  songMedia,
  type Analysis,
  type ChordSegment,
  type Loop,
  type PlayAlong,
  type Song,
  type SongEntry,
  type StemMix,
} from '../api/client';
import { useAnalysis, useSong, useUpdateSong } from '../api/queries';
import { EngineController, STEM_ORDER, type StemName } from '../engine/EngineController';
import { sampleIndex, type SampleIndex } from '../engine/types';
import { barAt, barStart, buildGrid, snapToBar, type Grid } from '../music/grid';

/** Shared identity, so resetting solo on navigation is not a re-render. */
const NO_SOLO: ReadonlySet<StemName> = new Set<StemName>();
/** Stable identity, so a song with no analysis does not re-merge every render. */
const NO_CHORDS: ChordSegment[] = [];

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

export interface SongSession {
  songId: string;
  entry: SongEntry | undefined;
  isPending: boolean;
  /** The song query's error, or null. Rendered verbatim (N-08). */
  loadError: unknown | null;
  fetchedSong: Song | null;
  hasStems: boolean;
  analysis: Analysis | undefined;
  /** The analysis query's error, or null. A 404 also sets `notAnalyzedYet`. */
  analysisError: unknown | null;
  notAnalyzedYet: boolean;
  chords: ChordSegment[];
  grid: Grid | null;
  /** The recipe, owned here once seeded; the query result is only its seed. */
  song: Song | null;
  engine: EngineController | null;
  engineError: string | null;
  saveError: Error | null;
  soloed: ReadonlySet<StemName>;
  playing: boolean;
  loopArmed: boolean;
  /** A repaint ticket for paused seeks (usePlayhead), not a position. */
  seekNonce: number;
  getPosition(): SampleIndex;
  applyRecipe(next: Song): void;
  onPlayPause(): Promise<void>;
  onScrub(position: SampleIndex): void;
  onNudgeBars(delta: number): void;
  /** Moves the cursor to the start of a 0-based bar. An armed loop survives only if the bar is inside it. */
  onSeekBar(bar: number): void;
  onTempoChange(tempo: number): void;
  onPitchChange(pitchSemitones: number): void;
  onMetronomeToggle(): void;
  onSetLoopStart(): void;
  onSetLoopEnd(): void;
  onLoopArmToggle(): void;
  onMuteToggle(name: StemName): void;
  onSoloToggle(name: StemName): void;
  onGainChange(name: StemName, gainDb: number): void;
  onMuteLane(index: number): void;
  onRecallLoop(loop: Loop): void;
  onSaveActiveLoop(name: string): void;
  onDeleteLoop(name: string): void;
  onCountInChange(bars: number): void;
  /** Sets the loop by bars: 0-based start, exclusive end. Ignored unless end > start >= 0. */
  onLoopBars(startBar: number, endBar: number): void;
  onPlayAlongChange(playAlong: PlayAlong): void;
}

export function useSongSessionState(songId: string): SongSession {
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
  // listener in an effect keyed on them, and the rAF loops usePlayhead runs
  // restart when their callbacks change. So the handlers read the current
  // render's values from here instead of closing over them.
  const latest = useRef({ engine, song, grid, soloed, playing, loopArmed });
  useEffect(() => {
    latest.current = { engine, song, grid, soloed, playing, loopArmed };
  });

  // ---- data -> state ------------------------------------------------------

  const seededFor = useRef<string | null>(null);

  // The scope is not keyed by :songId, so React Router reuses this component
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

  // Play along's ribbon seeks by bar. Inside an armed loop the cursor stays in
  // the region the wrap logic expects, so the loop can stay armed -- restarting
  // a looped phrase from one of its bars should not end the loop. Anywhere else
  // it is a cursor move like any other and goes through handleScrub (U-06).
  const handleSeekBar = useCallback(
    (bar: number) => {
      const { engine: current, grid: currentGrid, song: currentSong, loopArmed: armed } = latest.current;
      if (!current || !currentGrid || bar < 0) return;
      const position = barStart(currentGrid, bar);
      const loop = currentSong?.active_loop;
      if (armed && loop && bar >= loop.start_bar && bar < loop.end_bar) {
        current.seek(position);
        setSeekNonce((n) => n + 1);
        return;
      }
      handleScrub(position);
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

  // ---- play along -------------------------------------------------------

  // Play along sets the loop by bar numbers rather than from the cursor. Same
  // shape as Set A / Set B: the loop keeps its name, and an empty or inverted
  // range is not a loop, so it is refused rather than stored.
  const handleLoopBars = useCallback(
    (start_bar: number, end_bar: number) => {
      const { song: currentSong } = latest.current;
      if (!currentSong || start_bar < 0 || end_bar <= start_bar) return;
      applyRecipe({
        ...currentSong,
        active_loop: { name: currentSong.active_loop?.name ?? '', start_bar, end_bar },
      });
    },
    [applyRecipe],
  );

  const handlePlayAlongChange = useCallback(
    (play_along: PlayAlong) => {
      const { song: currentSong } = latest.current;
      if (currentSong) applyRecipe({ ...currentSong, play_along });
    },
    [applyRecipe],
  );

  // ---- context value ---

  // A 404 from analysis is "not analyzed yet" (the normal state for a song that
  // has only been separated), not a failure: the screen still plays, with no
  // bars. Any other error keeps the loud N-08 treatment.
  const notAnalyzedYet =
    analysisQuery.error instanceof ApiError && analysisQuery.error.status === 404;
  const chords = analysisQuery.data?.chords ?? NO_CHORDS;

  return useMemo<SongSession>(
    () => ({
      songId,
      entry,
      isPending: songQuery.isPending,
      loadError: songQuery.isError ? songQuery.error : null,
      fetchedSong,
      hasStems,
      analysis: analysisQuery.data,
      analysisError: analysisQuery.isError ? analysisQuery.error : null,
      notAnalyzedYet,
      chords,
      grid,
      song,
      engine,
      engineError,
      saveError: saveError ?? null,
      soloed,
      playing,
      loopArmed,
      seekNonce,
      getPosition,
      applyRecipe,
      onPlayPause: handlePlayPause,
      onScrub: handleScrub,
      onNudgeBars: handleNudgeBars,
      onSeekBar: handleSeekBar,
      onTempoChange: handleTempoChange,
      onPitchChange: handlePitchChange,
      onMetronomeToggle: handleMetronomeToggle,
      onSetLoopStart: handleSetLoopStart,
      onSetLoopEnd: handleSetLoopEnd,
      onLoopArmToggle: handleLoopArmToggle,
      onMuteToggle: handleMuteToggle,
      onSoloToggle: handleSoloToggle,
      onGainChange: handleGainChange,
      onMuteLane: handleMuteLane,
      onRecallLoop: handleRecallLoop,
      onSaveActiveLoop: handleSaveActiveLoop,
      onDeleteLoop: handleDeleteLoop,
      onCountInChange: handleCountInChange,
      onLoopBars: handleLoopBars,
      onPlayAlongChange: handlePlayAlongChange,
    }),
    [
      songId,
      entry,
      songQuery.isPending,
      songQuery.isError,
      songQuery.error,
      fetchedSong,
      hasStems,
      analysisQuery.data,
      analysisQuery.isError,
      analysisQuery.error,
      notAnalyzedYet,
      chords,
      grid,
      song,
      engine,
      engineError,
      saveError,
      soloed,
      playing,
      loopArmed,
      seekNonce,
      getPosition,
      applyRecipe,
      handlePlayPause,
      handleScrub,
      handleNudgeBars,
      handleSeekBar,
      handleTempoChange,
      handlePitchChange,
      handleMetronomeToggle,
      handleSetLoopStart,
      handleSetLoopEnd,
      handleLoopArmToggle,
      handleMuteToggle,
      handleSoloToggle,
      handleGainChange,
      handleMuteLane,
      handleRecallLoop,
      handleSaveActiveLoop,
      handleDeleteLoop,
      handleCountInChange,
      handleLoopBars,
      handlePlayAlongChange,
    ],
  );
}

export const SongSessionContext = createContext<SongSession | null>(null);

export function useSongSession(): SongSession {
  const session = useContext(SongSessionContext);
  if (!session) throw new Error('useSongSession must be used inside a SongScope route');
  return session;
}
