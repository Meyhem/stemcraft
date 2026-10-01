// Add album: one long file in, an album to cut up out. Opened from the album list's
// header (local state, not a route: unlike Import there is no second step to survive a
// reload). The title and artist are read from the file's tags server-side when blank.
import { type FormEvent, useState } from 'react';

import { useUploadAlbum } from '../api/queries';
import { Banner, Button, DropZone, Modal, TextField } from '../ui';
import styles from './AlbumUploadModal.module.css';

export interface AlbumUploadModalProps {
  onCreated: (albumId: string) => void;
  onClose: () => void;
}

export function AlbumUploadModal({ onCreated, onClose }: AlbumUploadModalProps) {
  const upload = useUploadAlbum();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');

  // Import's form idiom: FormData built here, optional fields omitted rather than sent
  // blank, and the server's own error shown verbatim (N-08).
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!file || upload.isPending) return;
    const form = new FormData();
    form.set('file', file);
    if (title.trim()) form.set('title', title.trim());
    if (artist.trim()) form.set('artist', artist.trim());
    upload.mutate(form, { onSuccess: (created) => onCreated(created.album.id) });
  }

  return (
    <Modal
      title="Add album"
      subtitle="An album side, a live set or a tape transfer."
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="album-upload-form"
            variant="primary"
            disabled={!file || upload.isPending}
          >
            {upload.isPending ? 'Uploading…' : 'Upload album'}
          </Button>
        </>
      }
    >
      <form id="album-upload-form" className={styles.form} onSubmit={submit}>
        <DropZone
          id="album-file"
          label="Audio or video file"
          file={file}
          onFile={setFile}
          hint="One long file; anything ffmpeg can decode."
        />
        <div className={styles.fields}>
          <TextField
            id="album-upload-title"
            label="Album title"
            placeholder="From the file name, if left blank"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
          <TextField
            id="album-upload-artist"
            label="Artist"
            value={artist}
            onChange={(event) => setArtist(event.target.value)}
          />
        </div>
        {/* N-08: the server's real message, not a generic failure notice. */}
        {upload.isError && <Banner tone="error" title="Upload failed" trace={String(upload.error)} />}
      </form>
    </Modal>
  );
}
