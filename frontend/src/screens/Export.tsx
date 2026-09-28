// UI spec §6, screen 5, and design/ui/src/pages/screens/export.html. The stem
// picker is prefilled from the current mix, the tempo-and-pitch choice is
// explicit, and the D-10 banner is not optional chrome: it is the thing that
// stops "the file sounds different from the preview" being filed as a bug.
//
// The recipe is *not* edited here. This screen chooses which stems to include
// and whether to apply the practice tempo/pitch at all; the API snapshots the
// live values out of song.json when it enqueues (D7-02).
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';

import { exportUrl } from '../api/client';
import { queryKeys, useExports, useJobs, useQueueExport, useSong } from '../api/queries';
import { STEM_ORDER, type StemName } from '../engine/types';
import { proposeExportName } from './exportName';
import styles from './Export.module.css';

function formatBytes(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

function formatSeconds(seconds: number): string {
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

export function Export() {
  const { songId } = useParams();
  const songQuery = useSong(songId);
  const exportsQuery = useExports(songId);
  const jobsQuery = useJobs();
  const queueExport = useQueueExport(songId);
  const client = useQueryClient();

  const song = songQuery.data?.song ?? null;
  const hasStems = songQuery.data?.files?.has_stems ?? false;

  const [picked, setPicked] = useState<readonly StemName[] | null>(null);
  const [applyRecipe, setApplyRecipe] = useState(true);
  // null means "still following the proposal"; a string means the user typed.
  const [typedName, setTypedName] = useState<string | null>(null);
  const [jobId, setJobId] = useState<number | null>(null);

  // Prefilled from the mix, once, when the song arrives: a muted stem is
  // unticked, which is what "matches your current mix" means.
  useEffect(() => {
    if (song && picked === null) {
      setPicked(STEM_ORDER.filter((name) => !song.mix[name]?.muted));
    }
  }, [song, picked]);

  const tempo = song?.playback.tempo ?? 1;
  const pitch = song?.playback.pitch_semitones ?? 0;
  const stems = picked ?? [];

  const proposed = useMemo(
    () =>
      proposeExportName(song?.title ?? '', stems, {
        tempo: applyRecipe ? tempo : 1,
        pitchSemitones: applyRecipe ? pitch : 0,
      }),
    [song?.title, stems, applyRecipe, tempo, pitch],
  );
  const name = typedName ?? proposed;

  const job = jobsQuery.data?.find((candidate) => candidate.id === jobId) ?? null;

  // The exports list is a directory listing; it changes when the worker finishes.
  // The WebSocket already invalidates ['jobs'] on every job event, so the job
  // reaching `done` is the signal -- no polling of our own.
  useEffect(() => {
    if (job?.state === 'done') {
      void client.invalidateQueries({ queryKey: queryKeys.exports(songId) });
    }
  }, [job?.state, client, songId]);

  const reason = !hasStems
    ? 'This song has not been separated yet, so there are no stems to mix.'
    : stems.length === 0
      ? 'Pick at least one stem to export.'
      : null;

  // N-08: a genuine fetch failure (404, dropped connection, malformed
  // response) is not "this song has not been separated" -- that would be a
  // fabricated diagnosis. Say what actually happened, the way SongView.tsx
  // does for the same query.
  if (songQuery.isError) {
    return (
      <p role="alert" className={styles.error}>
        {String(songQuery.error)}
      </p>
    );
  }

  // The picker is prefilled from song.mix, so it must not render (unchecked,
  // wrongly) before that data -- and the proposed name -- actually exist. A
  // song that failed to parse (song === null, §9/U-09) has no mix to wait for.
  if (songQuery.isPending || (song !== null && picked === null)) {
    return <p className={styles.note}>Loading export…</p>;
  }

  return (
    <section className={styles.screen}>
      <header className={styles.head}>
        <div>
          <h1>Export</h1>
          <p className={styles.sub}>
            {song ? `${song.title}${song.artist ? ` — ${song.artist}` : ''}` : songId}
          </p>
        </div>
        <Link className={styles.link} to={`/songs/${songId}`}>
          Back to the song
        </Link>
      </header>

      {songQuery.data?.unreadable && <p className={styles.error}>{songQuery.data.unreadable}</p>}

      <fieldset className={styles.group}>
        <legend>Stems to include</legend>
        {STEM_ORDER.map((stem) => (
          <label className={styles.check} key={stem}>
            <input
              type="checkbox"
              checked={stems.includes(stem)}
              onChange={(event) =>
                setPicked(
                  event.target.checked
                    ? STEM_ORDER.filter((name) => name === stem || stems.includes(name))
                    : stems.filter((name) => name !== stem),
                )
              }
            />
            <span className={styles.stemName}>{stem}</span>
            {song?.mix[stem]?.gain_db ? (
              <span className={styles.gain}>{song.mix[stem].gain_db} dB</span>
            ) : null}
          </label>
        ))}
        <p className={styles.note}>
          Matches your current mix — a muted stem is off here too. One stem alone exports the
          same way.
        </p>
      </fieldset>

      <fieldset className={styles.group}>
        <legend>Tempo &amp; pitch</legend>
        <label className={styles.radio}>
          <input
            type="radio"
            name="recipe"
            checked={applyRecipe}
            onChange={() => setApplyRecipe(true)}
          />
          {`As practiced — ${Math.round(tempo * 100)}%, ${pitch < 0 ? '−' : ''}${Math.abs(pitch)} st`}
        </label>
        <label className={styles.radio}>
          <input
            type="radio"
            name="recipe"
            checked={!applyRecipe}
            onChange={() => setApplyRecipe(false)}
          />
          Original — 100%, 0 st
        </label>

        {/* D-10, stated in the UI on purpose. */}
        <div className={styles.banner} role="status" aria-label="Export quality">
          <strong>The export will not sound identical to the preview.</strong> Playback runs on
          a real-time budget; the export does not. The file is rendered server-side from the
          untouched WAV masters at higher quality — better than what you practised to, never
          worse.
        </div>
      </fieldset>

      <div className={styles.row}>
        <div className={styles.field}>
          <label htmlFor="export-name">File name</label>
          <input
            id="export-name"
            value={name}
            onChange={(event) => setTypedName(event.target.value)}
          />
        </div>
        <div className={styles.field}>
          <span>Format</span>
          <span className={styles.format}>MP3 320</span>
        </div>
      </div>
      <p className={styles.note}>
        Lands in <code>exports/{name}.mp3</code>. Re-exporting the same name overwrites it.
      </p>

      {reason && <p className={styles.note}>{reason}</p>}

      <button
        className={styles.submit}
        type="button"
        disabled={Boolean(reason) || queueExport.isPending}
        onClick={() =>
          queueExport.mutate(
            { stems: [...stems], apply_recipe: applyRecipe, name },
            {
              onSuccess: (queued) => {
                setJobId(queued.job_id);
                // The server slugifies (and caps the length of) the typed
                // name; the 201 carries the name it actually used, and that
                // is what the note under the field and the exports list
                // below should agree with.
                setTypedName(queued.name);
              },
            },
          )
        }
      >
        {queueExport.isPending ? 'Queueing…' : 'Queue export'}
      </button>

      {/* N-08: the API's own message, verbatim. */}
      {queueExport.isError && <p className={styles.error}>{String(queueExport.error)}</p>}

      {job && job.state !== 'done' && (
        <p className={styles.progressRow}>
          <span>{job.state}</span>
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
      {job?.state === 'failed' && <p className={styles.error}>{job.error}</p>}

      <h2>Exports</h2>
      {/* N-08: the failed listing itself, not a silently empty list. */}
      {exportsQuery.isError && <p className={styles.error}>{String(exportsQuery.error)}</p>}
      {exportsQuery.data?.length === 0 && <p className={styles.note}>Nothing exported yet.</p>}
      <ul className={styles.exports}>
        {(exportsQuery.data ?? []).map((item) => (
          <li className={styles.exportRow} key={item.name}>
            {/* D7-10: a link, never an automatic download. */}
            <a
              className={styles.link}
              href={exportUrl(songId ?? '', item.name)}
              download={`${item.name}.mp3`}
            >
              {item.name}.mp3
            </a>
            <span className={styles.meta}>{formatBytes(item.bytes)}</span>
            {job?.state === 'done' &&
              typeof job.result?.duration_seconds === 'number' &&
              String(job.result?.file ?? '') === item.file && (
                <span className={styles.meta}>
                  {formatSeconds(job.result.duration_seconds as number)}
                </span>
              )}
          </li>
        ))}
      </ul>
    </section>
  );
}
