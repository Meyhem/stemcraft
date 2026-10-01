// The Stems content of the song screen (UI spec §6, screen 3): the shared time axis
// (TimeAxis -- ruler, chord row, zoom, follow, pan, drag-to-zoom) with the four stem
// lanes as its rows. The header, the transport and the view switch are SongScreen's;
// the engine and the recipe are the session's (D-18).
import { useSongSession } from '../session/SongSession';
import { StemLane } from '../songview/StemLane';
import { TimeAxis } from '../songview/TimeAxis';
import styles from './SongView.module.css';

export function SongView() {
  const { song, engine, soloed, onMuteToggle, onSoloToggle, onGainChange } = useSongSession();

  // Loading, errors and the no-stems case are SongScreen's to say.
  if (!engine || !song) return null;

  return (
    <TimeAxis
      rows={(scale, scroller) => (
        <div className={styles.lanes}>
          {engine.stemSummaries.map((summary) => (
            <StemLane
              key={summary.name}
              summary={summary}
              scroller={scroller}
              width={scale.contentWidth}
              muted={song.mix[summary.name]?.muted ?? false}
              soloed={soloed.has(summary.name)}
              gainDb={song.mix[summary.name]?.gain_db ?? 0}
              anySoloed={soloed.size > 0}
              onMuteToggle={() => onMuteToggle(summary.name)}
              onSoloToggle={() => onSoloToggle(summary.name)}
              onGainChange={(db) => onGainChange(summary.name, db)}
            />
          ))}
        </div>
      )}
    />
  );
}
