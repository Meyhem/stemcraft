// Domain spec, "Album splitter": one long file in, a set of tagged MP3s out.
// Upload, look at where the silences are, move the boundaries, name the
// tracks, render, download the zip.
//
// Three rules shape this file:
//
//  * D8-02 -- `tracks.length` must always equal `split_points.length + 1`.
//    The server rejects anything else with a 422 and this screen autosaves on
//    every edit, so a single unbalanced edit would be a 422 per keystroke.
//    EVERY change goes through `applyEdit`, which enforces it.
//  * D8-04 -- the silence proposals live in their own file and are applied
//    only when the user asks. Boundaries already placed are never disturbed by
//    proposals merely existing.
//  * §2 -- the API owns album.json and the worker cannot write it, so the
//    measured length reaches album.json only by a PUT from here. See
//    `useStampedLength` below.
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';

import {
  albumMedia,
  albumTrackUrl,
  albumZipUrl,
  type Album,
  type AlbumEntry,
  type Job,
  type PeaksDoc,
} from '../api/client';
import {
  useAlbum,
  useAlbumPeaks,
  useAlbums,
  useAlbumTracks,
  useDeleteAlbum,
  useJobs,
  useProposals,
  useQueueSplit,
  useUpdateAlbum,
  useUploadAlbum,
} from '../api/queries';
import { trackSpans } from '../splitter/spans';
import { TrackTable } from '../splitter/TrackTable';
import { WaveformMarkers } from '../splitter/WaveformMarkers';
import styles from './AlbumSplitter.module.css';

// D-03: the one sample rate. The <audio> element speaks seconds; album.json
// speaks samples; this is the only place the two meet.
const SAMPLE_RATE = 48000;

const ALBUM_JOB_KINDS = new Set(['import_album', 'split_album']);

/**
 * The single funnel every edit passes through (D8-02).
 *
 * Split points are re-sorted (a safety net -- the marker component already
 * clamps a drag to its neighbours) and the track list is grown or trimmed at
 * the end until it has exactly one more entry than there are boundaries. The
 * *semantics* of an insert or a delete live in the callers, which splice the
 * track list at the right index so titles stay attached to their audio; this
 * only guarantees the count.
 */
function withConsistentTracks(album: Album): Album {
  const split_points = [...album.split_points].sort((a, b) => a - b);
  const wanted = split_points.length + 1;
  const tracks = album.tracks.slice(0, wanted);
  while (tracks.length < wanted) tracks.push({ title: '' });
  return { ...album, split_points, tracks };
}

// peaks.json is min/max pairs per channel; WaveformMarkers wants one 0..1
// envelope. Channel 0 is enough for a boundary-placing view.
function envelopeOf(doc: PeaksDoc | undefined): number[] | null {
  const channel = doc?.peaks?.[0];
  if (!channel || channel.length === 0) return null;
  const envelope: number[] = [];
  for (let i = 0; i < channel.length; i += 2) {
    envelope.push(Math.max(Math.abs(channel[i] ?? 0), Math.abs(channel[i + 1] ?? 0)));
  }
  return envelope;
}

function latestAlbumJob(jobs: Job[] | undefined, albumId: string): Job | null {
  const mine = (jobs ?? []).filter(
    (job) => ALBUM_JOB_KINDS.has(job.kind) && job.payload?.album_id === albumId,
  );
  return mine.length === 0 ? null : mine.reduce((a, b) => (b.id > a.id ? b : a));
}

export function AlbumSplitter() {
  const { albumId } = useParams();
  return albumId ? <AlbumEditor albumId={albumId} /> : <AlbumPicker />;
}

// ---------------------------------------------------------------------------
// Picking or creating an album
// ---------------------------------------------------------------------------

function AlbumPicker() {
  const navigate = useNavigate();
  const albums = useAlbums();
  const upload = useUploadAlbum();
  const del = useDeleteAlbum();

  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');

  // Import.tsx's form idiom: FormData built here, optional fields omitted
  // rather than sent blank, and the server's own error shown verbatim (N-08).
  function handleUpload(event: FormEvent) {
    event.preventDefault();
    if (!file) return;
    const form = new FormData();
    form.set('file', file);
    if (title) form.set('title', title);
    if (artist) form.set('artist', artist);
    upload.mutate(form, {
      onSuccess: (created) => navigate(`/splitter/${created.album.id}`),
    });
  }

  function handleDelete(entry: AlbumEntry) {
    const label = entry.album?.title ?? entry.dir;
    if (!window.confirm(`Delete "${label}"? This cannot be undone.`)) return;
    del.mutate(entry.album?.id ?? entry.dir.split('-', 1)[0] ?? entry.dir);
  }

  return (
    <section className={styles.screen}>
      <h1>Album splitter</h1>
      <p className={styles.note}>
        One long file in — an album side, a live set, a tape transfer — and a set of tagged MP3s
        out. Upload it, move the boundaries where you want them, name the tracks, then render.
      </p>

      <form className={styles.form} onSubmit={handleUpload}>
        <h2>Upload an album</h2>
        <div className={styles.field}>
          <label htmlFor="album-file">Audio or video file</label>
          <input
            id="album-file"
            type="file"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
        </div>
        <div className={styles.field}>
          <label htmlFor="album-upload-title">Album title</label>
          <input
            id="album-upload-title"
            placeholder="From the file name, if left blank"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </div>
        <div className={styles.field}>
          <label htmlFor="album-upload-artist">Artist</label>
          <input
            id="album-upload-artist"
            value={artist}
            onChange={(event) => setArtist(event.target.value)}
          />
        </div>
        <button className={styles.submit} type="submit" disabled={!file || upload.isPending}>
          {upload.isPending ? 'Uploading…' : 'Upload album'}
        </button>
        {/* N-08: the server's real message, not a generic failure notice. */}
        {upload.isError && <p className={styles.error}>{String(upload.error)}</p>}
      </form>

      <h2>Albums</h2>
      {albums.isError && <p role="alert">{String(albums.error)}</p>}
      {albums.data?.length === 0 && <p className={styles.note}>No albums yet.</p>}
      {del.isError && <p className={styles.error}>{String(del.error)}</p>}
      <ul className={styles.grid}>
        {(albums.data ?? []).map((entry) => (
          <li key={entry.dir} className={styles.card}>
            {entry.album ? (
              <>
                <Link className={styles.link} to={`/splitter/${entry.album.id}`}>
                  {entry.album.title}
                </Link>
                <span className={styles.artist}>{entry.album.artist}</span>
                <span className={styles.state}>{entry.state}</span>
              </>
            ) : (
              <>
                <span>{entry.dir}</span>
                {/* §9: one unreadable album never breaks the list. */}
                <pre className={styles.error}>{entry.unreadable}</pre>
              </>
            )}
            <button className={styles.delete} type="button" onClick={() => handleDelete(entry)}>
              Delete
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Editing one album
// ---------------------------------------------------------------------------

function AlbumEditor({ albumId }: { albumId: string }) {
  const client = useQueryClient();
  const albumQuery = useAlbum(albumId);
  const peaksQuery = useAlbumPeaks(albumId, albumQuery.data?.files?.has_peaks ?? false);
  const proposalsQuery = useProposals(albumId, albumQuery.data?.files?.has_proposals ?? false);
  const tracksQuery = useAlbumTracks(albumId);
  const jobsQuery = useJobs();
  const queueSplit = useQueueSplit();
  // `error` is not optional chrome (N-08): every control on this screen edits
  // the document silently, so an autosave that keeps failing -- a 422 from an
  // out-of-range boundary, a full disk -- would otherwise let the user type a
  // whole album of titles into nothing and find it gone after a reload.
  // Same reasoning, same treatment as SongView.
  const { save, error: saveError } = useUpdateAlbum(albumId);

  const fetched = albumQuery.data?.album ?? null;
  const files = albumQuery.data?.files ?? null;

  const [album, setAlbum] = useState<Album | null>(null);
  const [playheadSample, setPlayheadSample] = useState<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Seeded once per album id, never on every query result: a PUT's response
  // lands in the cache as a fresh object, and reseeding from it would clobber
  // edits made during the autosave debounce window. (Same reasoning as
  // SongView's seed effect.)
  const seededFor = useRef<string | null>(null);
  useEffect(() => {
    seededFor.current = null;
    setAlbum(null);
    setPlayheadSample(null);
  }, [albumId]);
  useEffect(() => {
    if (fetched && seededFor.current !== fetched.id) {
      seededFor.current = fetched.id;
      setAlbum(fetched);
    }
  }, [fetched]);

  // The one funnel. D8-02 is enforced here so no caller can forget it.
  const applyEdit = useCallback(
    (next: Album) => {
      const consistent = withConsistentTracks(next);
      setAlbum(consistent);
      save(consistent);
    },
    [save],
  );

  // §2: the worker measured the album and wrote the length into its own
  // proposals.json, but it may not touch album.json -- only the API may. So
  // the screen stamps it, exactly once, and stamps ONLY the length: adopting
  // the proposed boundaries at the same time would make applying a proposal
  // automatic, which is precisely what D8-04 forbids. Until this PUT lands,
  // trackSpans() is empty and POST /split answers 409.
  const proposals = proposalsQuery.data ?? null;
  const stampedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!album || album.total_samples > 0) return;
    if (!proposals || proposals.total_samples <= 0) return;
    if (stampedFor.current === album.id) return;
    stampedFor.current = album.id;
    applyEdit({ ...album, total_samples: proposals.total_samples });
  }, [album, proposals, applyEdit]);

  const job = latestAlbumJob(jobsQuery.data, albumId);
  const jobState = job?.state ?? null;

  // A finished job changes the directory listing -- audio, peaks, proposals,
  // tracks, the zip. The WebSocket already invalidates ['jobs'] on every job
  // event, so the job reaching `done` is the signal; no polling of our own.
  useEffect(() => {
    if (jobState !== 'done') return;
    void client.invalidateQueries({ queryKey: ['album', albumId] });
    void client.invalidateQueries({ queryKey: ['album-peaks', albumId] });
    void client.invalidateQueries({ queryKey: ['album-proposals', albumId] });
    void client.invalidateQueries({ queryKey: ['album-tracks', albumId] });
  }, [jobState, client, albumId]);

  const envelope = useMemo(() => envelopeOf(peaksQuery.data), [peaksQuery.data]);
  const spans = useMemo(() => (album ? trackSpans(album) : []), [album]);

  // ---- edits ------------------------------------------------------------

  function addBoundary(sample: number) {
    if (!album || album.total_samples <= 0) return;
    if (sample <= 0 || sample >= album.total_samples) return;
    if (album.split_points.includes(sample)) return;
    const index = album.split_points.filter((point) => point < sample).length;
    applyEdit({
      ...album,
      split_points: [
        ...album.split_points.slice(0, index),
        sample,
        ...album.split_points.slice(index),
      ],
      // The new boundary cuts track `index` in two; the second half is a new,
      // untitled track directly after it.
      tracks: [...album.tracks.slice(0, index + 1), { title: '' }, ...album.tracks.slice(index + 1)],
    });
  }

  function moveBoundary(index: number, sample: number) {
    if (!album) return;
    applyEdit({
      ...album,
      split_points: album.split_points.map((point, i) => (i === index ? sample : point)),
    });
  }

  function removeBoundary(index: number) {
    if (!album) return;
    applyEdit({
      ...album,
      split_points: album.split_points.filter((_, i) => i !== index),
      // Removing boundary i merges tracks i and i+1; the one after the
      // boundary is the one that disappears.
      tracks: album.tracks.filter((_, i) => i !== index + 1),
    });
  }

  function setTrackTitle(index: number, title: string) {
    if (!album) return;
    applyEdit({
      ...album,
      tracks: album.tracks.map((track, i) => (i === index ? { title } : track)),
    });
  }

  // D8-04: explicit, never automatic. The track count follows from the funnel.
  function applyProposals() {
    if (!album || !proposals) return;
    applyEdit({
      ...album,
      total_samples: album.total_samples > 0 ? album.total_samples : proposals.total_samples,
      split_points: [...proposals.split_points],
    });
  }

  function scrubTo(sample: number) {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = sample / SAMPLE_RATE;
    setPlayheadSample(sample);
  }

  // ---- render -----------------------------------------------------------

  // N-08: a genuine fetch failure is shown as itself, never translated into a
  // friendlier but invented diagnosis.
  if (albumQuery.isError) {
    return (
      <p role="alert" className={styles.error}>
        {String(albumQuery.error)}
      </p>
    );
  }

  if (albumQuery.isPending || (albumQuery.data?.album !== null && album === null)) {
    return <p className={styles.note}>Loading album…</p>;
  }

  if (!album) {
    // §9: an album.json that will not parse is still reachable, with the real
    // parse error in view.
    return (
      <section className={styles.screen}>
        <h1>Album splitter</h1>
        <pre className={styles.error}>{albumQuery.data?.unreadable}</pre>
        <Link className={styles.link} to="/splitter">
          Back to albums
        </Link>
      </section>
    );
  }

  const hasAudio = files?.has_audio ?? false;
  const reason = !hasAudio
    ? 'This album has no decoded audio yet — its import job has not finished, so there is nothing to split.'
    : album.total_samples <= 0
      ? 'This album has no measured length yet, so there are no tracks to render.'
      : null;
  const showWaveform = hasAudio && album.total_samples > 0 && envelope !== null;

  return (
    <section className={styles.screen}>
      <header className={styles.head}>
        <div>
          <h1>Album splitter</h1>
          <p className={styles.sub}>
            {album.title}
            {album.artist ? ` — ${album.artist}` : ''}
          </p>
        </div>
        <Link className={styles.link} to="/splitter">
          Back to albums
        </Link>
      </header>

      {/* ApiError's message already carries the server's own detail, so it is
          shown as it came rather than paraphrased into reassurance. */}
      {saveError && (
        <p role="alert" className={styles.error}>
          {saveError.message}
        </p>
      )}

      {/* Typed once, filled down by construction: these are fields on the
          album, so every rendered track carries them through SplitRecipe. */}
      <div className={styles.row}>
        <div className={styles.field}>
          <label htmlFor="album-title">Album title</label>
          <input
            id="album-title"
            value={album.title}
            onChange={(event) => applyEdit({ ...album, title: event.target.value })}
          />
        </div>
        <div className={styles.field}>
          <label htmlFor="album-artist">Album artist</label>
          <input
            id="album-artist"
            value={album.artist}
            onChange={(event) => applyEdit({ ...album, artist: event.target.value })}
          />
        </div>
      </div>
      <p className={styles.note}>
        Both are written into every track's tags — there is nothing to fill down.
      </p>

      {hasAudio && (
        // D8-11: preview is a plain <audio> element on the decoded master.
        // wavesurfer renders and never plays (invariant 7 / D-07), so the
        // playhead over the waveform is drawn from this element's clock.
        <audio
          ref={audioRef}
          className={styles.audio}
          src={albumMedia(albumId).audio}
          controls
          onTimeUpdate={(event) =>
            setPlayheadSample(Math.round(event.currentTarget.currentTime * SAMPLE_RATE))
          }
        />
      )}

      {showWaveform ? (
        <WaveformMarkers
          peaks={envelope}
          totalSamples={album.total_samples}
          splitPoints={album.split_points}
          playheadSample={playheadSample}
          onMove={moveBoundary}
          onAdd={addBoundary}
          onRemove={removeBoundary}
          onScrub={scrubTo}
        />
      ) : (
        <p className={styles.note}>{reason ?? 'Waiting for the waveform…'}</p>
      )}

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.action}
          disabled={!proposals || proposals.split_points.length === 0}
          onClick={applyProposals}
        >
          Use proposed boundaries
          {proposals ? ` (${proposals.split_points.length})` : ''}
        </button>
        <span className={styles.note}>
          {/* D8-04, stated in the UI: proposals never move a boundary on their
              own, so re-detecting can never undo a drag. */}
          Replaces every boundary with the detected silences. Nothing moves until you press it.
        </span>
      </div>
      {proposalsQuery.isError && <p className={styles.note}>{String(proposalsQuery.error)}</p>}

      <TrackTable spans={spans} onTitleChange={setTrackTitle} />

      {reason && (
        <p className={styles.note} id="split-reason">
          {reason}
        </p>
      )}

      <button
        type="button"
        className={styles.submit}
        disabled={Boolean(reason) || queueSplit.isPending}
        aria-describedby={reason ? 'split-reason' : undefined}
        onClick={() => queueSplit.mutate(albumId)}
      >
        {queueSplit.isPending ? 'Queueing…' : `Split into ${spans.length} tracks`}
      </button>

      {/* N-08: the API's own message, verbatim. */}
      {queueSplit.isError && <p className={styles.error}>{String(queueSplit.error)}</p>}

      {job && (job.state === 'queued' || job.state === 'running') && (
        <p className={styles.progressRow}>
          <span>
            {job.kind} — {job.state}
          </span>
          <progress
            className={styles.progress}
            role="progressbar"
            aria-valuenow={Math.round(job.progress * 100)}
            max={100}
            value={Math.round(job.progress * 100)}
          />
          <Link className={styles.link} to="/jobs">
            Job {job.id}
          </Link>
        </p>
      )}
      {/* N-08: the worker's real error text, never a generic message. */}
      {job?.state === 'failed' && <p className={styles.error}>{job.error}</p>}

      {/* Derived state (§6): the zip is offered because the server says the
          file exists, never because this session happened to press Split. */}
      {files?.has_zip && (
        <a className={styles.link} href={albumZipUrl(albumId)} download>
          Download album.zip
        </a>
      )}

      {files?.has_tracks && (tracksQuery.data?.length ?? 0) > 0 && (
        <ul className={styles.files}>
          {(tracksQuery.data ?? []).map((track) => (
            <li key={track.name}>
              <a className={styles.link} href={albumTrackUrl(albumId, track.name)}>
                {track.name}
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
