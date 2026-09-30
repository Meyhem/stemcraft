// frontend/src/screens/PlayAlong.tsx
// The Tabs content of the song screen (D-18): where Stems shows the audio, this
// shows what to play: a bass neck showing what to play in this bar
// and the next, a beat lane showing when, generated from the chord chart by a
// pattern you pick. It shares the song session (and so the engine, and the
// transport above it) with Stems, so switching between them never stops the music.
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
import styles from '../playalong/PlayAlong.module.css';
import { useSongSession } from '../session/SongSession';
import { ViewTools } from '../songview/ViewTools';
import { Banner, EmptyState, Panel, TextLink } from '../ui';

export function PlayAlong() {
  const session = useSongSession();
  const { songId, analysis, notAnalyzedYet, grid, song, engine, playing, loopArmed, seekNonce, getPosition } = session;

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

  // The transport above still plays; only this content has nothing to draw.
  if (notAnalyzedYet) {
    return (
      <EmptyState title="This song needs analysis">
        Tabs are built from the chord chart and the beat grid, which appear after analysis.
      </EmptyState>
    );
  }
  // Loading and engine errors are SongScreen's to say.
  if (!engine || !song) return null;

  return (
    <>
      <ViewTools>
        <TextLink to={`/songs/${songId}/scale`}>Scale &amp; fretboard &rarr;</TextLink>
      </ViewTools>

      {analysis && !grid && (
        <Banner tone="error" title="The beat grid is unusable">
          The analysis found fewer than two downbeats, so there are no bars to play along to.
        </Banner>
      )}
      {result && !result.ok && <Banner tone="error" title="No patterns" trace={result.error} />}

      {grid && result?.ok && (
        <>
          <Panel className={styles.panel}>
            <PatternPanel
              candidates={analysis?.key_candidates ?? []}
              value={song.play_along}
              onChange={session.onPlayAlongChange}
              pitchSemitones={song.playback.pitch_semitones}
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
              onSeekBar={session.onSeekBar}
            />
          </Panel>

          <Banner tone="warn" role="note" title="A practice pattern over the detected chords, not a transcription">
            These notes are generated from the chord chart and the key you pick. The arithmetic is exact, but the chords
            themselves are detected and can be wrong. A bar with no chord shows an empty neck saying so; nothing is
            guessed.
          </Banner>
        </>
      )}
    </>
  );
}
