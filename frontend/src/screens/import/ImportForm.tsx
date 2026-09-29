// Import, step one: one form, one source zone (UI spec §6.2). Title/artist are
// filled from the file's own tags server-side when left blank (C-06: no online
// lookup). A link has nothing to read before download, so its title is required.
import { type FormEvent, useState } from 'react';

import { useCreateSongFromUpload, useCreateSongFromUrl } from '../../api/queries';
import type { CreatedSong } from '../../api/client';
import { Banner, Button, Modal, TextField } from '../../ui';
import styles from './ImportForm.module.css';
import { SourceZone } from './SourceZone';

export interface CreatedImport {
  songId: string;
  jobId: number;
  title: string;
  artist: string;
  source: string;
}

export interface ImportFormProps {
  onCreated: (created: CreatedImport) => void;
  onClose: () => void;
}

function linkHost(link: string): string {
  try {
    return new URL(link).host;
  } catch {
    return link; // The server is the judge of the link (N-08); this is only a subtitle.
  }
}

export function ImportForm({ onCreated, onClose }: ImportFormProps) {
  const upload = useCreateSongFromUpload();
  const fromUrl = useCreateSongFromUrl();
  const [file, setFile] = useState<File | null>(null);
  const [link, setLink] = useState('');
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');

  const isLink = file === null && link.trim() !== '';
  const pending = upload.isPending || fromUrl.isPending;
  const error = upload.error ?? fromUrl.error;
  const ready = file !== null || (isLink && title.trim() !== '');

  function chooseFile(next: File | null) {
    setFile(next);
    if (next) setLink('');
  }

  function typeLink(next: string) {
    setLink(next);
    if (next) setFile(null);
  }

  function done(source: string) {
    return (data: CreatedSong) =>
      onCreated({
        songId: data.song.id,
        jobId: data.job_id,
        title: data.song.title,
        artist: data.song.artist,
        source,
      });
  }

  // The one submit path: the footer button (outside the <form>, tied to it by
  // form="import-form") and Enter in a field both fire the form's onSubmit.
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready || pending) return;
    // Only the current attempt's error may show (N-08), not a stale one from
    // the other mutation.
    upload.reset();
    fromUrl.reset();
    if (file) {
      const form = new FormData();
      form.set('file', file);
      if (title) form.set('title', title);
      if (artist) form.set('artist', artist);
      upload.mutate(form, { onSuccess: done(file.name) });
    } else {
      fromUrl.mutate(
        { url: link.trim(), title, artist: artist || undefined },
        { onSuccess: done(linkHost(link.trim())) },
      );
    }
  }

  return (
    <Modal
      title="Add song"
      subtitle="No format whitelist. If ffmpeg decodes it, it is accepted."
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="import-form" variant="primary" disabled={!ready || pending}>
            {pending ? 'Importing…' : 'Import & separate'}
          </Button>
        </>
      }
    >
      <form id="import-form" className={styles.form} onSubmit={submit}>
        <SourceZone file={file} link={link} onFile={chooseFile} onLink={typeLink} />
        <div className={styles.fields}>
          <TextField
            id="import-title"
            label={isLink ? 'Title · required' : 'Title'}
            required={isLink}
            placeholder={isLink ? undefined : "From the file's tags"}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
          <TextField
            id="import-artist"
            label="Artist"
            placeholder={isLink ? undefined : "From the file's tags"}
            value={artist}
            onChange={(event) => setArtist(event.target.value)}
          />
        </div>
        <p className={styles.hint}>
          {isLink
            ? "A link has no tags to read before it's downloaded."
            : "Left blank, these come from the file's own tags. There's no online lookup anywhere."}
        </p>
        {/* N-08: the server's real message, not a generic failure notice. */}
        {error && <Banner tone="error" title="Import failed" trace={String(error)} />}
      </form>
    </Modal>
  );
}
