// frontend/src/screens/PlayAlong.tsx
// The Play along content of the song screen (D-18, D-20): where Stems shows the
// audio, this shows what to play in this bar and the next, generated from the
// chord chart. For bass, a neck of notes and a beat lane (patternSource); for
// guitar, a neck with the chord shape and a strum lane (guitarSource). It
// shares the song session (and so the engine, and the transport above it)
// with Stems, so switching between them never stops the music.
//
// Both are arithmetic over detected chords: exact given the chords, but the
// chords are probabilistic (R-05). The banner says so, and every empty or
// substituted bar is labelled rather than guessed (N-08).
import { useMemo } from 'react';

import { guitarSource, guitarSummaries } from '../music/guitarSource';
import { bassSummaries, patternSource } from '../music/tabSource';
import { BeatLane } from '../playalong/BeatLane';
import { ChordRibbon } from '../playalong/ChordRibbon';
import { GuitarNeck } from '../playalong/GuitarNeck';
import { Neck } from '../playalong/Neck';
import { NowReadout } from '../playalong/NowReadout';
import { PatternPanel } from '../playalong/PatternPanel';
import styles from '../playalong/PlayAlong.module.css';
import { StrumLane } from '../playalong/StrumLane';
import { useSongSession } from '../session/SongSession';
import { Banner, EmptyState, Panel } from '../ui';

export function PlayAlong() {
  const session = useSongSession();
  const { analysis, notAnalyzedYet, grid, song, engine, playing, loopArmed, seekNonce, getPosition } = session;

  const loopStart = song?.active_loop?.start_bar ?? null;
  const loopEnd = song?.active_loop?.end_bar ?? null;
  const armedLoop = useMemo(
    () => (loopArmed && loopStart !== null && loopEnd !== null ? { startBar: loopStart, endBar: loopEnd } : null),
    [loopArmed, loopStart, loopEnd],
  );

  const guitar = song?.play_along.instrument === 'guitar';
  const bass = useMemo(
    () => (!guitar && song && analysis && grid ? patternSource.barsFor({ song, analysis, grid, loop: armedLoop }) : null),
    [guitar, song, analysis, grid, armedLoop],
  );
  const strums = useMemo(
    () => (guitar && song && analysis && grid ? guitarSource.barsFor({ song, analysis, grid, loop: armedLoop }) : null),
    [guitar, song, analysis, grid, armedLoop],
  );
  const result = bass ?? strums;
  const summaries = useMemo(() => {
    if (bass?.ok) return bassSummaries(bass.bars, bass.key);
    if (strums?.ok) return guitarSummaries(strums.bars);
    return null;
  }, [bass, strums]);

  // The transport above still plays; only this content has nothing to draw.
  if (notAnalyzedYet) {
    return (
      <EmptyState title="This song needs analysis">
        Play along is built from the chord chart and the beat grid, which appear after analysis.
      </EmptyState>
    );
  }
  // Loading and engine errors are SongScreen's to say.
  if (!engine || !song) return null;

  return (
    <>
      {analysis && !grid && (
        <Banner tone="error" title="The beat grid is unusable">
          The analysis found fewer than two downbeats, so there are no bars to play along to.
        </Banner>
      )}
      {result && !result.ok && <Banner tone="error" title="No patterns" trace={result.error} />}

      {grid && result?.ok && summaries && (
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
              bars={summaries}
              nextOf={result.nextOf}
              instrument={song.play_along.instrument}
              grid={grid}
              pitchSemitones={song.playback.pitch_semitones}
              getPosition={getPosition}
              playing={playing}
              seekNonce={seekNonce}
            />
            <div className={styles.board}>
              {bass?.ok && (
                <>
                  <Neck
                    bars={bass.bars}
                    nextOf={bass.nextOf}
                    songKey={bass.key}
                    grid={grid}
                    getPosition={getPosition}
                    playing={playing}
                    seekNonce={seekNonce}
                  />
                  <BeatLane
                    bars={bass.bars}
                    nextOf={bass.nextOf}
                    songKey={bass.key}
                    grid={grid}
                    getPosition={getPosition}
                    playing={playing}
                    seekNonce={seekNonce}
                  />
                </>
              )}
              {strums?.ok && (
                <>
                  <GuitarNeck
                    bars={strums.bars}
                    nextOf={strums.nextOf}
                    grid={grid}
                    getPosition={getPosition}
                    playing={playing}
                    seekNonce={seekNonce}
                  />
                  <StrumLane
                    bars={strums.bars}
                    nextOf={strums.nextOf}
                    grid={grid}
                    strum={song.play_along.guitar.strum}
                    getPosition={getPosition}
                    playing={playing}
                    seekNonce={seekNonce}
                  />
                </>
              )}
            </div>
            <ChordRibbon
              bars={summaries}
              loop={song.active_loop}
              grid={grid}
              getPosition={getPosition}
              playing={playing}
              seekNonce={seekNonce}
              onLoopBars={session.onLoopBars}
              onSeekBar={session.onSeekBar}
            />
          </Panel>

          {guitar && (
            <Banner tone="warn" title="Guitar shares the other stem with keys and synths">
              It cannot be separated on its own, so turn other down rather than muting it.
            </Banner>
          )}
          <Banner tone="warn" role="note" title="A practice pattern over the detected chords, not a transcription">
            {guitar
              ? 'These shapes are generated from the chord chart and the style you pick. The arithmetic is exact, but the chords themselves are detected and can be wrong. A bar with no chord shows an empty neck saying so, and a substituted shape says what it replaced; nothing is guessed.'
              : 'These notes are generated from the chord chart and the key you pick. The arithmetic is exact, but the chords themselves are detected and can be wrong. A bar with no chord shows an empty neck saying so; nothing is guessed.'}
          </Banner>
        </>
      )}
    </>
  );
}
