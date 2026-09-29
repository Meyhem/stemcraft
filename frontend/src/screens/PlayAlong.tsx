// frontend/src/screens/PlayAlong.tsx
// Play along (D-18): the practice screen. Song view is where a song is edited;
// this is where you play with it: a bass neck showing what to play in this bar
// and the next, a beat lane showing when, generated from the chord chart by a
// pattern you pick. It shares the song session (and so the engine) with Song
// view, so switching between them never stops the music.
//
// The patterns are arithmetic over detected chords: exact given the chords,
// but the chords are probabilistic (R-05). The banner says so, and every
// empty or substituted bar is labelled rather than guessed (N-08).
import { useMemo } from 'react';

import { patternSource } from '../music/tabSource';
import { BeatLane } from '../playalong/BeatLane';
import { ChordRibbon } from '../playalong/ChordRibbon';
import { Neck } from '../playalong/Neck';
import { NowReadout } from '../playalong/NowReadout';
import { PatternPanel } from '../playalong/PatternPanel';
import { PlayAlongTransport } from '../playalong/PlayAlongTransport';
import styles from '../playalong/PlayAlong.module.css';
import { useSongSession } from '../session/SongSession';
import { Banner, ButtonLink, EmptyState, Panel } from '../ui';

export function PlayAlong() {
  const session = useSongSession();
  const {
    songId,
    entry,
    isPending,
    loadError,
    fetchedSong,
    hasStems,
    analysis,
    analysisError,
    notAnalyzedYet,
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

  const loopStart = song?.active_loop?.start_bar ?? null;
  const loopEnd = song?.active_loop?.end_bar ?? null;
  const armedLoop = useMemo(
    () => (loopArmed && loopStart !== null && loopEnd !== null ? { startBar: loopStart, endBar: loopEnd } : null),
    [loopArmed, loopStart, loopEnd],
  );

  const result = useMemo(
    () => (song && analysis && grid ? patternSource.barsFor({ song, analysis, grid, loop: armedLoop }) : null),
    [song, analysis, grid, armedLoop],
  );

  const title = song?.title ?? fetchedSong?.title ?? songId;
  const header = (
    <header className={styles.header}>
      <ButtonLink variant="ghost" to={`/songs/${songId}`}>
        &larr; Song view
      </ButtonLink>
      <div className={styles.titles}>
        <h1>{title}</h1>
        <p className={styles.sub}>Play along · bass</p>
      </div>
    </header>
  );

  if (isPending) return <p className={styles.sub}>Loading song&hellip;</p>;
  if (loadError !== null) return <Banner tone="error" trace={String(loadError)} />;
  if (entry?.unreadable) return <Banner tone="error" title={songId} trace={entry.unreadable} />;
  if (!hasStems) {
    return (
      <section className={styles.page}>
        {header}
        <EmptyState title="This song has not been separated yet">Play along needs its four stems.</EmptyState>
      </section>
    );
  }
  if (notAnalyzedYet) {
    return (
      <section className={styles.page}>
        {header}
        <EmptyState title="This song needs analysis">
          Play along builds its patterns from the chord chart and the beat grid, which appear after analysis.
        </EmptyState>
      </section>
    );
  }

  return (
    <section className={styles.page}>
      {header}

      {engineError && <Banner tone="error" trace={engineError} />}
      {saveError && <Banner tone="error" trace={saveError.message} />}
      {analysisError !== null && <Banner tone="error" trace={String(analysisError)} />}
      {analysis && !grid && (
        <Banner tone="error" title="The beat grid is unusable">
          The analysis found fewer than two downbeats, so there are no bars to play along to.
        </Banner>
      )}
      {result && !result.ok && <Banner tone="error" title="No patterns" trace={result.error} />}
      {!engine && !engineError && <p className={styles.sub}>Loading stems&hellip;</p>}

      {engine && song && grid && result?.ok && (
        <>
          <Panel className={styles.panel}>
            <PlayAlongTransport
              playing={playing}
              tempo={song.playback.tempo}
              metronome={song.metronome}
              countInBars={song.count_in_bars}
              loop={song.active_loop}
              loopArmed={loopArmed}
              barCount={result.bars.length}
              onPlayPause={session.onPlayPause}
              onTempoChange={session.onTempoChange}
              onMetronomeToggle={session.onMetronomeToggle}
              onCountInChange={session.onCountInChange}
              onLoopArmToggle={session.onLoopArmToggle}
              onLoopBars={session.onLoopBars}
            />
          </Panel>

          <Panel className={styles.panel}>
            <PatternPanel
              candidates={analysis?.key_candidates ?? []}
              value={song.play_along}
              onChange={session.onPlayAlongChange}
            />
          </Panel>

          <Panel className={styles.panel}>
            <NowReadout
              bars={result.bars}
              nextOf={result.nextOf}
              songKey={result.key}
              grid={grid}
              pitchSemitones={song.playback.pitch_semitones}
              getPosition={getPosition}
              playing={playing}
              seekNonce={seekNonce}
            />
            <div className={styles.board}>
              <Neck
                bars={result.bars}
                nextOf={result.nextOf}
                songKey={result.key}
                grid={grid}
                getPosition={getPosition}
                playing={playing}
                seekNonce={seekNonce}
              />
              <BeatLane
                bars={result.bars}
                nextOf={result.nextOf}
                songKey={result.key}
                grid={grid}
                getPosition={getPosition}
                playing={playing}
                seekNonce={seekNonce}
              />
            </div>
            <ChordRibbon
              bars={result.bars}
              songKey={result.key}
              loop={song.active_loop}
              grid={grid}
              getPosition={getPosition}
              playing={playing}
              seekNonce={seekNonce}
              onLoopBars={session.onLoopBars}
            />
          </Panel>

          <Banner tone="warn" role="note" title="A practice pattern over the detected chords, not a transcription">
            These notes are generated from the chord chart and the key you pick. The arithmetic is exact, but the chords
            themselves are detected and can be wrong. A bar with no chord shows an empty neck saying so; nothing is
            guessed.
          </Banner>
        </>
      )}
    </section>
  );
}
