// The song screen (UI spec §6, screen 3): one header, one transport, and under them
// the content the player switches between -- Stems (the time axis and mixer), Tab (the
// transcribed bass line, D-21) or Play along (the generated patterns, D-18). The session
// and the engine live one route up, in SongScope (D-18), so switching content never
// stops the music; this layout only makes sure the controls do not move either.
import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';

import { ButtonLink, Loader, ScreenHeader } from '../ui';
import { useSongSession } from '../session/SongSession';
import { TitleEditor } from '../songview/TitleEditor';
import { Transport } from '../songview/Transport';
import { ViewToolsContext } from '../songview/ViewTools';
import styles from './SongScreen.module.css';

export function SongScreen() {
  const session = useSongSession();
  const {
    songId,
    entry,
    isPending,
    loadError,
    fetchedSong,
    hasStems,
    analysisError,
    notAnalyzedYet,
    chords,
    grid,
    song,
    engine,
    engineError,
    saveError,
    playing,
    loopArmed,
    seekNonce,
    getPosition,
  } = session;
  // As state, so the views' ViewTools re-render once the slot element exists.
  const [toolsSlot, setToolsSlot] = useState<HTMLDivElement | null>(null);

  if (isPending) return <Loader size="page" label="Loading song…" />;
  if (loadError !== null) {
    return (
      <p role="alert" className={styles.alert}>
        {String(loadError)}
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
          This song has not been separated yet &mdash; playback needs its four stems.
        </p>
        <ButtonLink variant="ghost" to="/jobs">
          Job queue &rarr;
        </ButtonLink>
      </section>
    );
  }

  return (
    <section className={styles.page}>
      <ScreenHeader
        crumbs={[{ label: 'Library', to: '/' }, { label: song?.title ?? fetchedSong?.title ?? songId }]}
        title={
          <TitleEditor
            title={song?.title ?? fetchedSong?.title ?? songId}
            artist={song?.artist ?? fetchedSong?.artist ?? ''}
            onRename={session.onRename}
          />
        }
        actions={<ButtonLink to={`/songs/${songId}/export`}>Export</ButtonLink>}
      />

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
      {analysisError !== null && !notAnalyzedYet && (
        <p role="alert" className={styles.alert}>
          {String(analysisError)}
        </p>
      )}
      {!engine && !engineError && <Loader size="page" label="Loading stems…" />}

      {/* Pinned while the page scrolls: the one surface touched with an instrument in
          hand, found in the same place whichever content is showing. */}
      {engine && song && (
        <div className={styles.transport}>
          <Transport
            playing={playing}
            grid={grid}
            getPosition={getPosition}
            seekNonce={seekNonce}
            tempo={song.playback.tempo}
            pitchSemitones={song.playback.pitch_semitones}
            metronome={song.metronome}
            countInBars={song.count_in_bars}
            loop={song.active_loop}
            loopArmed={loopArmed}
            savedLoops={song.loops}
            onPlayPause={session.onPlayPause}
            onTempoChange={session.onTempoChange}
            onPitchChange={session.onPitchChange}
            onMetronomeToggle={session.onMetronomeToggle}
            onCountInChange={session.onCountInChange}
            onLoopArmToggle={session.onLoopArmToggle}
            onLoopBars={session.onLoopBars}
            onSetLoopStart={session.onSetLoopStart}
            onSetLoopEnd={session.onSetLoopEnd}
            onRecallLoop={session.onRecallLoop}
            onSaveActiveLoop={session.onSaveActiveLoop}
            onDeleteLoop={session.onDeleteLoop}
            onNudgeBars={session.onNudgeBars}
            onMuteLane={session.onMuteLane}
            chords={chords}
          />
        </div>
      )}

      {/* Nothing to switch between until the stems have decoded: an engine that is still
          loading leaves both views empty. An engine that failed keeps the switch, so the
          page is not left without navigation next to its error. */}
      {(engine || engineError) && (
      <div className={styles.viewBar}>
        {/* Links, not buttons: each view keeps its own URL (D-14). */}
        <nav className={styles.switch} aria-label="View">
          <NavLink end to={`/songs/${songId}`}>
            Stems
          </NavLink>
          <NavLink to={`/songs/${songId}/tab`}>Tab</NavLink>
          <NavLink to={`/songs/${songId}/play`}>Play along</NavLink>
        </nav>
        <div className={styles.tools} ref={setToolsSlot} />
      </div>
      )}

      <ViewToolsContext.Provider value={toolsSlot}>
        <Outlet />
      </ViewToolsContext.Provider>
    </section>
  );
}
