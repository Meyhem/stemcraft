// Domain spec, "Song library": one table row per Song, sorted by last played;
// delete removes the Song folder after a confirmation.
import { Link, useLocation } from 'react-router-dom';

import type { SongEntry } from '../api/client';
import { useDeleteSong, useSongs } from '../api/queries';
import { importLinkState } from './import/importLink';
import { When } from './When';
import { Banner, Button, ButtonLink, Chip, EmptyState, type ChipTone } from '../ui';
import styles from './Library.module.css';

// Song state is derived from which files exist (CLAUDE.md: "Prefer deriving state over
// storing it"), so these are the only three values. 'analyzed' is the finished state and
// takes the ok tone; the two intermediate states are neutral, because a song that is
// merely imported is not a warning.
const STATE_TONE: Record<string, ChipTone> = {
  imported: 'neutral',
  separated: 'neutral',
  analyzed: 'ok',
};

function sortKey(entry: SongEntry): string {
  return entry.song?.last_played_at ?? entry.song?.created_at ?? '';
}

export function Library() {
  const location = useLocation();
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
    <section className={styles.screen}>
      <div className={styles.header}>
        <h1>Library</h1>
        <ButtonLink variant="primary" to="/import" state={importLinkState(location)}>
          New Song
        </ButtonLink>
      </div>

      {songs.isError && (
        <Banner tone="error" title="The library could not be listed" trace={String(songs.error)} />
      )}

      {songs.data?.length === 0 && (
        <EmptyState title="No songs yet.">
          <ButtonLink variant="primary" to="/import" state={importLinkState(location)}>
            Import your first song
          </ButtonLink>
        </EmptyState>
      )}

      {entries.length > 0 && (
        <table className={styles.table} aria-label="Songs">
          <thead>
            <tr>
              <th scope="col">Title</th>
              <th scope="col">Artist</th>
              <th scope="col">State</th>
              <th scope="col" className={styles.narrowHide}>Added</th>
              <th scope="col" className={styles.narrowHide}>Last played</th>
              <th scope="col"><span className={styles.srOnly}>Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.dir}>
                {entry.song ? (
                  <>
                    {/* The Song view is one click from the row. It renders its own
                        explanation for a song that has no stems yet, so the link is not
                        gated on state. */}
                    <td>
                      <Link className={styles.title} to={`/songs/${entry.song.id}`}>
                        {entry.song.title}
                      </Link>
                    </td>
                    <td className={styles.artist}>{entry.song.artist}</td>
                    <td>
                      <Chip tone={STATE_TONE[entry.state ?? ''] ?? 'neutral'} dot>
                        {entry.state}
                      </Chip>
                    </td>
                    <td className={`${styles.num} ${styles.narrowHide}`}><When iso={entry.song.created_at} /></td>
                    <td className={`${styles.num} ${styles.narrowHide}`}><When iso={entry.song.last_played_at} /></td>
                  </>
                ) : (
                  <>
                    <td className={styles.title}>{entry.dir}</td>
                    {/* §9: one bad file never breaks the library -- shown, not hidden. */}
                    <td colSpan={4}>
                      <Banner tone="error" title="This song could not be read" trace={entry.unreadable} />
                    </td>
                  </>
                )}
                <td className={styles.action}>
                  <Button variant="danger" onClick={() => handleDelete(entry)}>
                    Delete
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
