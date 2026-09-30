// The song's title and artist, renamed in place. The heading is the display; Rename
// swaps it for two fields. Only song.json changes: the song's folder keeps the slug it
// was imported with, because the id prefix is what names a song (D-01).
import { useState, type FormEvent, type KeyboardEvent } from 'react';

import { Button } from '../ui';
import styles from './TitleEditor.module.css';

export interface TitleEditorProps {
  title: string;
  artist: string;
  onRename(title: string, artist: string): void;
}

export function TitleEditor({ title, artist, onRename }: TitleEditorProps) {
  const [draft, setDraft] = useState<{ title: string; artist: string } | null>(null);

  if (draft === null) {
    return (
      <div className={styles.view}>
        <div className={styles.titles}>
          <h1>{title}</h1>
          <p className={styles.artist}>{artist}</p>
        </div>
        <Button variant="ghost" aria-label="Rename" title="Rename" onClick={() => setDraft({ title, artist })}>
          ✎
        </Button>
      </div>
    );
  }

  const blank = draft.title.trim() === '';
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (blank) return;
    onRename(draft.title.trim(), draft.artist.trim());
    setDraft(null);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') setDraft(null);
  };

  return (
    <form className={styles.edit} onSubmit={submit} onKeyDown={onKeyDown}>
      <input
        className={styles.input}
        aria-label="Title"
        autoFocus
        value={draft.title}
        onChange={(e) => setDraft({ ...draft, title: e.target.value })}
      />
      <input
        className={styles.input}
        aria-label="Artist"
        placeholder="Artist"
        value={draft.artist}
        onChange={(e) => setDraft({ ...draft, artist: e.target.value })}
      />
      <Button variant="primary" type="submit" disabled={blank}>
        Save
      </Button>
      <Button variant="ghost" onClick={() => setDraft(null)}>
        Cancel
      </Button>
    </form>
  );
}
