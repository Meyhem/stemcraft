// Domain spec, "Scale view": pure lookup from a chosen key candidate to its
// notes and fretboard positions -- no model, no failure mode (R-05). Key
// candidates themselves come from analysis.json (probabilistic, shown with
// confidence); everything below that is arithmetic.
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

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

  return (
    <section className={styles.page}>
      <div className={styles.topbar}>
        <Link to={`/songs/${songId}`}>&larr; Back</Link>
        <h1>Scale &amp; fretboard &middot; {entry?.song?.title ?? songId}</h1>
        <div className={styles.seg}>
          <button aria-pressed={instrument === 'bass'} onClick={() => setInstrument('bass')}>
            Bass &middot; 4 string
          </button>
          <button aria-pressed={instrument === 'guitar'} onClick={() => setInstrument('guitar')}>
            Guitar &middot; 6 string
          </button>
        </div>
      </div>

      {analysis.isError && <p role="alert">{String(analysis.error)}</p>}
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
