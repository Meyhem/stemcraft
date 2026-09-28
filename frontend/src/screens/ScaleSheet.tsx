// Domain spec, "Scale view": pure lookup from a chosen key candidate to its
// notes and fretboard positions -- no model, no failure mode (R-05). Key
// candidates themselves come from analysis.json (probabilistic, shown with
// confidence); everything below that is arithmetic.
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { ApiError } from '../api/client';
import { useAnalysis, useSongs } from '../api/queries';
import { Fretboard } from '../music/Fretboard';
import { BASS_TUNING, GUITAR_TUNING, pitchClassOf, scaleNoteNames, scaleSemitones } from '../music/theory';
import type { Mode } from '../music/theory';
import styles from './ScaleSheet.module.css';

export function ScaleSheet() {
  const { songId } = useParams();
  const songs = useSongs();
  const analysis = useAnalysis(songId);
  const [instrument, setInstrument] = useState<'bass' | 'guitar'>('bass');
  const [pentatonic, setPentatonic] = useState(false);
  const [selected, setSelected] = useState(0);

  const entry = songs.data?.find((e) => e.song?.id === songId);
  const candidates = analysis.data?.key_candidates ?? [];
  const active = candidates[selected];

  const tonicPc = active ? pitchClassOf(active.tonic) : null;
  const mode = (active?.mode ?? 'major') as Mode;

  const scaleNotes = useMemo(() => {
    if (tonicPc === null) return new Set<number>();
    return new Set(scaleSemitones(mode, pentatonic).map((s) => (tonicPc + s) % 12));
  }, [tonicPc, mode, pentatonic]);

  const noteNames = useMemo(() => {
    if (tonicPc === null) return [];
    return scaleNoteNames(tonicPc, mode, pentatonic);
  }, [tonicPc, mode, pentatonic]);

  // A 404 here means "this song hasn't been analyzed yet" -- the normal state
  // for a song that's only been imported/separated so far, not a failure.
  // Any other error (network, 500, ...) keeps the loud N-08 treatment below.
  const notAnalyzedYet = analysis.error instanceof ApiError && analysis.error.status === 404;

  return (
    <section className={styles.page}>
      <div className={styles.topbar}>
        <Link to={`/songs/${songId}`}>&larr; Back</Link>
        <div className={styles.titles}>
          <h1>{entry?.song?.title ?? songId}</h1>
          <h2 className={styles.subtitle}>Scale &amp; fretboard</h2>
        </div>
        <div className={styles.seg}>
          <button aria-pressed={instrument === 'bass'} onClick={() => setInstrument('bass')}>
            Bass &middot; 4 string
          </button>
          <button aria-pressed={instrument === 'guitar'} onClick={() => setInstrument('guitar')}>
            Guitar &middot; 6 string
          </button>
        </div>
      </div>

      {analysis.isPending && <p className={styles.note}>Loading analysis&hellip;</p>}

      {notAnalyzedYet && (
        <p className={styles.note}>
          This song hasn&apos;t been analyzed yet. Analysis runs automatically after separation
          finishes.
        </p>
      )}

      {analysis.isError && !notAnalyzedYet && <p role="alert">{String(analysis.error)}</p>}

      {analysis.data && candidates.length === 0 && <p>No key candidates in this analysis.</p>}

      {candidates.length > 0 && (
        <>
          <div className={styles.candidates}>
            <span className={styles.cap}>key candidates</span>
            {candidates.map((c, i) => (
              <button key={`${c.tonic}-${c.mode}`} aria-pressed={i === selected} onClick={() => setSelected(i)}>
                {c.tonic} {c.mode} <b>{Math.round(c.confidence * 100)}%</b>
              </button>
            ))}
            <div className={styles.seg}>
              <button aria-pressed={!pentatonic} onClick={() => setPentatonic(false)}>
                Full scale
              </button>
              <button aria-pressed={pentatonic} onClick={() => setPentatonic(true)}>
                Pentatonic
              </button>
            </div>
          </div>

          {active && (
            <div className={styles.panel}>
              <h2>
                {active.tonic} {active.mode}
              </h2>
              <div className={styles.notes}>
                {noteNames.map((n, i) => (
                  <b key={`${n}-${i}`} className={i === 0 ? styles.root : undefined}>
                    {n}
                  </b>
                ))}
              </div>
              <Fretboard
                tuning={instrument === 'bass' ? BASS_TUNING : GUITAR_TUNING}
                tonic={active.tonic}
                mode={mode}
                scaleNotes={scaleNotes}
              />
              <p className={styles.note}>
                Detected on the bass and other stems, not the full mix -- key detection is
                probabilistic (R-05), which is why candidates are shown with confidence
                instead of one answer as fact. But the map from a key to its notes and
                fretboard positions is arithmetic: no model, no failure mode.
              </p>
            </div>
          )}
        </>
      )}
    </section>
  );
}
