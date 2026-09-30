// Domain spec, "Song library": one card per Song, sorted by last played;
// delete removes the Song folder after a confirmation.
import { Link, useLocation } from 'react-router-dom';

import type { SongEntry } from '../api/client';
import { useDeleteSong, useSongs } from '../api/queries';
import { importLinkState } from './import/importLink';
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

      <ul className={styles.grid}>
        {entries.map((entry) => (
          <li key={entry.dir} className={styles.card}>
            {entry.song ? (
              <>
                {/* The Song view is one click from the card. It renders its
                    own explanation for a song that has no stems yet, so the
                    link is not gated on state. */}
                <Link className={styles.title} to={`/songs/${entry.song.id}`}>
                  {entry.song.title}
                </Link>
                <span className={styles.artist}>{entry.song.artist}</span>
                <Chip tone={STATE_TONE[entry.state ?? ''] ?? 'neutral'} dot>
                  {entry.state}
                </Chip>
              </>
            ) : (
              <>
                <span className={styles.title}>{entry.dir}</span>
                {/* §9: one bad file never breaks the library -- shown, not hidden. */}
                <Banner tone="error" title="This song could not be read" trace={entry.unreadable} />
              </>
            )}
            <Button className={styles.delete} variant="danger" onClick={() => handleDelete(entry)}>
              Delete
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
