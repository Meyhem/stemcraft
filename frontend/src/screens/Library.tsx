// Domain spec, "Song library": one card per Song, sorted by last played;
// delete removes the Song folder after a confirmation.
import { Link } from 'react-router-dom';

import type { SongEntry } from '../api/client';
import { useDeleteSong, useSongs } from '../api/queries';
import styles from './Library.module.css';

function sortKey(entry: SongEntry): string {
  return entry.song?.last_played_at ?? entry.song?.created_at ?? '';
}

export function Library() {
  const songs = useSongs();
  const del = useDeleteSong();

  const entries = [...(songs.data ?? [])].sort((a, b) => sortKey(b).localeCompare(sortKey(a)));

  function handleDelete(entry: SongEntry) {
    const label = entry.song?.title ?? entry.dir;
    if (window.confirm(`Delete "${label}"? This cannot be undone.`)) {
      const songId = entry.song?.id ?? entry.dir.split('-', 1)[0] ?? entry.dir;
      del.mutate(songId);
    }
  }

  return (
    <section>
      <div className={styles.header}>
        <h1>Library</h1>
        <Link className={styles.new} to="/import">
          New Song
        </Link>
      </div>

      {songs.isError && <p role="alert">{String(songs.error)}</p>}
      {songs.data?.length === 0 && <p>No songs yet.</p>}

      <ul className={styles.grid}>
        {entries.map((entry) => (
          <li key={entry.dir} className={styles.card}>
            {entry.song ? (
              <>
                <span className={styles.title}>{entry.song.title}</span>
                <span className={styles.artist}>{entry.song.artist}</span>
                <span className={styles.state}>{entry.state}</span>
              </>
            ) : (
              <>
                <span className={styles.title}>{entry.dir}</span>
                {/* §9: one bad file never breaks the library -- shown, not hidden. */}
                <pre className={styles.unreadable}>{entry.unreadable}</pre>
              </>
            )}
            <button className={styles.delete} onClick={() => handleDelete(entry)}>
              Delete
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
