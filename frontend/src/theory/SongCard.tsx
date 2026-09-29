// "From a song" (D-19): pick an analysed song, then load one of its key
// candidates into the shared selection. The song's chords become available to
// Chord finder, Progressions and Name that chord through useChosenSong.
// Candidates are probabilistic (R-05), so they are shown with their confidence
// and the player picks. With no analysed song there is nothing to pick, and the
// card says so in full rather than in a clipped select.
import { useSongs } from '../api/queries';
import { pretty } from '../music/spell';
import { useSelection } from './selection';
import styles from './Theory.module.css';
import { useTheoryDoc } from './TheoryDoc';
import { candidateRoot, useChosenSong } from './useChosenSong';

export function SongCard() {
  const { doc, update } = useTheoryDoc();
  const songs = useSongs();
  const chosen = useChosenSong();
  const [, select] = useSelection();
  const analysed = (songs.data ?? [])
    .filter((e) => e.song && e.files?.has_analysis)
    .sort((a, b) => (b.song!.last_played_at ?? '').localeCompare(a.song!.last_played_at ?? ''));

  const choose = (songId: string) => update((d) => ({ ...d, song_id: songId || null }));

  return (
    <div className={chosen.state === 'missing' || chosen.state === 'unanalysed' || chosen.state === 'error' ? `${styles.songCard} ${styles.songCardWarn}` : styles.songCard}>
      <span className={styles.cap}>from a song</span>
      {songs.isSuccess && analysed.length === 0 ? (
        <span className={styles.dimText}>No analysed songs yet</span>
      ) : (
        <select
          className={styles.select}
          aria-label="Song"
          value={doc?.song_id ?? ''}
          onChange={(e) => choose(e.target.value)}
          disabled={!doc}
        >
          <option value="">Pick a song</option>
          {analysed.map((e) => (
            <option key={e.song!.id} value={e.song!.id}>
              {e.song!.title}
            </option>
          ))}
        </select>
      )}
      {chosen.state === 'missing' && <span className={styles.warnText}>That song no longer exists. Pick another.</span>}
      {chosen.state === 'unanalysed' && (
        <span className={styles.warnText}>{chosen.title} has no analysis yet. The analyze job hasn&apos;t run.</span>
      )}
      {chosen.state === 'error' && <span className={styles.warnText}>{chosen.message}</span>}
      {chosen.state === 'ready' && (
        <>
          <span>
            {chosen.distinct.length} chords · load a key:
          </span>
          <div className={styles.candidates}>
            {chosen.candidates.map((c) => {
              const { root, mode } = candidateRoot(c);
              return (
                <button
                  key={`${c.tonic}-${c.mode}`}
                  type="button"
                  className={styles.chip}
                  onClick={() => select({ root, mode, scale: mode === 'minor' ? 'minor' : 'major', chord: null })}
                >
                  {pretty(root)} {mode} {Math.round(c.confidence * 100)}%
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
