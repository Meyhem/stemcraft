// Domain spec, "Import": file upload (any format ffmpeg decodes, no
// whitelist) or a URL fetched with yt-dlp. Title/artist are prefilled from
// the file's own tags server-side when left blank; a URL import has nothing
// to probe before the download runs, so its title is required here too.
import { type FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useCreateSongFromUpload, useCreateSongFromUrl } from '../api/queries';
import styles from './Import.module.css';

export function Import() {
  const navigate = useNavigate();
  const uploadSong = useCreateSongFromUpload();
  const urlSong = useCreateSongFromUrl();

  const [file, setFile] = useState<File | null>(null);
  const [uploadTitle, setUploadTitle] = useState('');
  const [uploadArtist, setUploadArtist] = useState('');

  const [url, setUrl] = useState('');
  const [urlTitle, setUrlTitle] = useState('');
  const [urlArtist, setUrlArtist] = useState('');

  function handleUpload(event: FormEvent) {
    event.preventDefault();
    if (!file) return;
    const form = new FormData();
    form.set('file', file);
    if (uploadTitle) form.set('title', uploadTitle);
    if (uploadArtist) form.set('artist', uploadArtist);
    uploadSong.mutate(form, { onSuccess: () => navigate('/') });
  }

  function handleUrl(event: FormEvent) {
    event.preventDefault();
    urlSong.mutate(
      { url, title: urlTitle, artist: urlArtist || undefined },
      { onSuccess: () => navigate('/') },
    );
  }

  return (
    <section>
      <h1>Import</h1>
      <div className={styles.forms}>
        <form className={styles.form} onSubmit={handleUpload}>
          <h2>From a file</h2>
          <div className={styles.field}>
            <label htmlFor="upload-file">Audio or video file</label>
            <input
              id="upload-file"
              type="file"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="upload-title">Title</label>
            <input
              id="upload-title"
              placeholder="From the file's tags, if present"
              value={uploadTitle}
              onChange={(e) => setUploadTitle(e.target.value)}
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="upload-artist">Artist</label>
            <input
              id="upload-artist"
              value={uploadArtist}
              onChange={(e) => setUploadArtist(e.target.value)}
            />
          </div>
          <button className={styles.submit} type="submit" disabled={!file || uploadSong.isPending}>
            {uploadSong.isPending ? 'Importing…' : 'Import file'}
          </button>
          {/* N-08: the server's real message, not a generic failure notice. */}
          {uploadSong.isError && <p className={styles.error}>{String(uploadSong.error)}</p>}
        </form>

        <form className={styles.form} onSubmit={handleUrl}>
          <h2>From a URL</h2>
          <div className={styles.field}>
            <label htmlFor="url-value">URL</label>
            <input
              id="url-value"
              type="url"
              placeholder="https://…"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="url-title">Title</label>
            <input
              id="url-title"
              required
              value={urlTitle}
              onChange={(e) => setUrlTitle(e.target.value)}
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="url-artist">Artist</label>
            <input
              id="url-artist"
              value={urlArtist}
              onChange={(e) => setUrlArtist(e.target.value)}
            />
          </div>
          <button
            className={styles.submit}
            type="submit"
            disabled={!url || !urlTitle || urlSong.isPending}
          >
            {urlSong.isPending ? 'Importing…' : 'Import from URL'}
          </button>
          {urlSong.isError && <p className={styles.error}>{String(urlSong.error)}</p>}
        </form>
      </div>
    </section>
  );
}
