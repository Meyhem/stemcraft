// The Tab content of the song screen (D-21): the bass line the worker transcribed,
// as a tab staff on the shared time axis with the Play along neck under it. Before a
// tab exists it is the extract flow: an empty state, the job's own steps (D-17), the
// real error (U-09). The transport above keeps playing through all of it (D-18).
//
// U-16: a note is drawn as heard -- unsure and shifted notes are marked and counted,
// never hidden or corrected. Mockups: design/ui/src/pages/screens/tab.html and
// tab-states.html.
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';

import type { Job } from '../api/client';
import { useSongJobs, useStartTranscription, useTranscription } from '../api/queries';
import { placeTranscription, tabBars, tabCounts } from '../music/bassTab';
import { resolveKey } from '../music/patterns';
import { nextBarOf } from '../music/tabSource';
import { TabNeck } from '../playalong/TabNeck';
import { useSongSession } from '../session/SongSession';
import { TabStaff } from '../songview/TabStaff';
import { TimeAxis } from '../songview/TimeAxis';
import { Banner, Button, Chip, EmptyState, Panel, StepList, TextLink } from '../ui';
import styles from './TabView.module.css';

/** Where the staff opens: about four bars in view, wide enough to read sixteenths. */
const TAB_PX_PER_BAR = 280;

export function TabView() {
  const { songId, entry, analysis, grid, song, engine, playing, loopArmed, seekNonce, getPosition } =
    useSongSession();
  const client = useQueryClient();
  const hasTab = entry?.files?.has_transcription === true;
  const transcription = useTranscription(songId, hasTab);
  const jobs = useSongJobs(songId);
  const start = useStartTranscription(songId);

  // Jobs come newest first: the latest transcribe job says what is happening now.
  const latest = jobs.data?.find((j) => j.kind === 'transcribe');
  const live = latest && (latest.state === 'queued' || latest.state === 'running') ? latest : null;
  const failed = latest?.state === 'failed' ? latest : null;

  // A finished job wrote a new file: fetch it, and the entry that says it exists.
  const latestId = latest?.id;
  const latestState = latest?.state;
  useEffect(() => {
    if (latestState !== 'done') return;
    void client.invalidateQueries({ queryKey: ['transcription', songId] });
    void client.invalidateQueries({ queryKey: ['song', songId] });
  }, [client, songId, latestId, latestState]);

  const pitch = song?.playback.pitch_semitones ?? 0;
  const playAlongKey = song?.play_along.key ?? null;
  const key = useMemo(
    () => (analysis ? resolveKey(playAlongKey, analysis.key_candidates, pitch) : null),
    [analysis, playAlongKey, pitch],
  );
  const notes = useMemo(
    () => (transcription.data ? placeTranscription(transcription.data.notes, pitch, { key }) : null),
    [transcription.data, pitch, key],
  );
  const bars = useMemo(() => (notes && grid ? tabBars(notes, grid) : null), [notes, grid]);
  const loopStart = song?.active_loop?.start_bar ?? null;
  const loopEnd = song?.active_loop?.end_bar ?? null;
  const nextOf = useMemo(
    () =>
      nextBarOf(
        bars?.length ?? 0,
        loopArmed && loopStart !== null && loopEnd !== null ? { startBar: loopStart, endBar: loopEnd } : null,
      ),
    [bars, loopArmed, loopStart, loopEnd],
  );

  // Loading and engine errors are SongScreen's to say.
  if (!engine || !song) return null;

  const extract = () => start.mutate();
  const startError = start.error && (
    <Banner tone="error" title="Could not start extracting" trace={start.error.message} />
  );

  if (!hasTab) {
    if (live) return <Extracting job={live} songId={songId} />;
    if (failed) {
      return (
        <Panel className={styles.wait}>
          <StepList steps={failed.steps} error={failed.error} />
          <div className={styles.waitFoot}>
            <Button onClick={extract} disabled={start.isPending}>
              Retry
            </Button>
            <TextLink to={`/jobs?song=${songId}`}>Open in job queue →</TextLink>
          </div>
          {startError}
        </Panel>
      );
    }
    const bassSilent = engine.stemSummaries.find((s) => s.name === 'bass')?.nearSilent === true;
    return (
      <EmptyState title="No tab for this song yet" className={styles.empty}>
        {bassSilent && (
          <Banner tone="warn" title="The bass stem is near-silent">
            Separation found almost no bass in this song, so there may be little or nothing to transcribe. You can
            still try.
          </Banner>
        )}
        <p>
          Transcribe the bass stem into tab. It takes about half a minute on the GPU, and playback keeps going while it
          runs.
        </p>
        <Button variant="primary" tier="perform" onClick={extract} disabled={start.isPending}>
          Extract bass tab
        </Button>
        <p className={styles.fine}>A starting point, not a checked tab. Unsure notes are marked, never hidden.</p>
        {startError}
      </EmptyState>
    );
  }

  if (transcription.error) {
    return <Banner tone="error" title="The tab could not be read" trace={String(transcription.error)} />;
  }
  const t = transcription.data;
  if (!t || !notes) return null;

  if (notes.length === 0) {
    return (
      <EmptyState title="No notes found in the bass stem" className={styles.empty}>
        <p>
          The tracker heard nothing pitched above its confidence floor across the whole song. Extracting again gives
          the same result: the bass stem is the only input, and it never changes.
        </p>
        <p className={styles.fine}>
          {t.model} on {t.device} · {formatWhen(t.written_at)} · 0 notes
        </p>
      </EmptyState>
    );
  }

  const counts = tabCounts(notes);
  const running = live?.steps.find((s) => s.state === 'running');

  return (
    <>
      {failed && (
        <Banner tone="error" title="Extracting again failed; this is the previous tab" trace={failed.error} />
      )}
      <TimeAxis
        defaultZoom={TAB_PX_PER_BAR}
        rows={(scale, scroller) => (
          <TabStaff
            notes={notes}
            scale={scale}
            scroller={scroller}
            grid={grid}
            getPosition={getPosition}
            playing={playing}
            seekNonce={seekNonce}
          />
        )}
      />
      <Panel className={styles.panel}>
        {grid && bars ? (
          <div className={styles.board}>
            <TabNeck
              bars={bars}
              nextOf={nextOf}
              grid={grid}
              getPosition={getPosition}
              playing={playing}
              seekNonce={seekNonce}
            />
          </div>
        ) : (
          <p className={styles.fine}>
            The neck groups notes by bar, which needs the song&apos;s analysis. The tab above does not.
          </p>
        )}
        <ul className={styles.legend}>
          <li>
            <i className={styles.kNote} />
            transcribed note · its tail is how long it rings
          </li>
          <li>
            <i className={styles.kHot} />
            sounding now
          </li>
          <li>
            <i className={styles.kUnsure} />
            <b>?</b>&nbsp;unsure · the tracker&apos;s confidence was low
          </li>
          <li>
            <i className={styles.kShift} />
            <b className={styles.warn}>↑8</b>&nbsp;moved an octave to fit the neck
          </li>
          <li>
            <i className={styles.kNext} />
            next bar
          </li>
        </ul>
      </Panel>
      <Banner tone="warn" role="note" title="Transcribed from the bass stem: a starting point, not a checked tab">
        <div className={styles.provenance}>
          <span>
            {t.model} on {t.device} · {formatWhen(t.written_at)} · {counts.total} notes, {counts.unsure} unsure,{' '}
            {counts.shifted} moved an octave. Rhythm is drawn as played, not snapped to the beat grid.
          </span>
          {live ? (
            <Chip tone="run" dot>
              re-extracting · {running ? `${running.label.toLowerCase()} ${Math.round(running.progress * 100)}%` : 'queued'}
            </Chip>
          ) : (
            <Button variant="ghost" onClick={extract} disabled={start.isPending}>
              Re-extract
            </Button>
          )}
        </div>
      </Banner>
      {startError}
    </>
  );
}

function Extracting({ job, songId }: { job: Job; songId: string }) {
  return (
    <Panel className={styles.wait}>
      <div className={styles.waitHead}>
        <span className={styles.waitTitle}>Extracting the bass tab</span>
        {job.state === 'queued' ? (
          <Chip dot>queued</Chip>
        ) : (
          <Chip tone="run" dot>
            running · {job.device ?? 'device unknown'}
          </Chip>
        )}
      </div>
      <StepList steps={job.steps} error={job.error} />
      <div className={styles.waitFoot}>
        <span className={styles.fine}>Leaving this screen does not stop it.</span>
        <TextLink to={`/jobs?song=${songId}`}>Open job queue →</TextLink>
      </div>
    </Panel>
  );
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}
