// The Tabs pattern panel: the instrument, the key to think in, then that
// instrument's choices. Bass (D-18): notes, rhythm, approach. Guitar (D-20):
// style, strum, position, simplify. Each instrument keeps its own settings
// while the other is shown. Every change is a whole new play_along recipe,
// saved through the session's one funnel.
import type {
  GuitarPosition,
  GuitarStrum,
  GuitarStyle,
  KeyCandidate,
  PatternApproach,
  PatternNotes,
  PatternRhythm,
  PlayAlong,
} from '../api/client';
import { keyName, resolveKey } from '../music/patterns';
import { Segmented } from '../ui';
import styles from './PlayAlong.module.css';

const INSTRUMENT: { value: PlayAlong['instrument']; label: string }[] = [
  { value: 'bass', label: 'Bass' },
  { value: 'guitar', label: 'Guitar' },
];
const NOTES: { value: PatternNotes; label: string }[] = [
  { value: 'root', label: 'Root' },
  { value: 'root_fifth', label: '1–5' },
  { value: 'root_fifth_octave', label: '1–5–8' },
  { value: 'octave_pump', label: 'Octave' },
  { value: 'triad_chord', label: 'Triad' },
  { value: 'triad_diatonic', label: 'Diatonic triad' },
  { value: 'seventh', label: '7th' },
];
const RHYTHM: { value: PatternRhythm; label: string }[] = [
  { value: 'whole', label: 'Whole' },
  { value: 'half', label: 'Half' },
  { value: 'quarter', label: 'Quarter' },
  { value: 'eighth', label: 'Eighth' },
];
const APPROACH: { value: PatternApproach; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'chromatic', label: 'Chromatic' },
  { value: 'scale', label: 'Scale' },
  { value: 'fifth', label: 'Fifth' },
];
const STYLE: { value: GuitarStyle; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'barre', label: 'Barre' },
  { value: 'power', label: 'Power' },
  { value: 'triad', label: 'Triad' },
];
const STRUM: { value: GuitarStrum; label: string }[] = [
  { value: 'whole', label: 'Whole' },
  { value: 'half', label: 'Half' },
  { value: 'quarters', label: 'Quarters' },
  { value: 'eighths', label: 'Eighths' },
  { value: 'folk', label: 'Folk' },
  { value: 'push', label: 'Push' },
];
const POSITION: { value: GuitarPosition; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'low', label: 'Low' },
  { value: 'mid', label: 'Mid' },
];

const keyId = (k: { tonic: string; mode: string }) => `${k.tonic}:${k.mode}`;

export interface PatternPanelProps {
  candidates: KeyCandidate[];
  value: PlayAlong;
  onChange(next: PlayAlong): void;
  /** The song's playback pitch; key labels are shown as heard. */
  pitchSemitones: number;
}

export function PatternPanel({ candidates, value, onChange, pitchSemitones }: PatternPanelProps) {
  const chosenKey = value.key ?? candidates[0] ?? null;
  const setPattern = (patch: Partial<PlayAlong['pattern']>) =>
    onChange({ ...value, pattern: { ...value.pattern, ...patch } });
  const setGuitar = (patch: Partial<PlayAlong['guitar']>) => onChange({ ...value, guitar: { ...value.guitar, ...patch } });
  const openShapes = value.guitar.style === 'open';

  return (
    <div className={styles.pickers}>
      <div className={styles.picker}>
        <span className={styles.caption}>Instrument</span>
        <Segmented
          label="Instrument"
          value={value.instrument}
          options={INSTRUMENT}
          onChange={(instrument) => onChange({ ...value, instrument })}
        />
      </div>
      {candidates.length > 0 && chosenKey && (
        <div className={styles.picker}>
          <span className={styles.caption}>Key</span>
          <Segmented
            label="Key"
            value={keyId(chosenKey)}
            options={candidates.map((c) => ({
              value: keyId(c),
              label: `${keyName(resolveKey(c, [], pitchSemitones)!)} ${Math.round(c.confidence * 100)}%`,
            }))}
            onChange={(id) => {
              const picked = candidates.find((c) => keyId(c) === id);
              if (picked) onChange({ ...value, key: { tonic: picked.tonic, mode: picked.mode } });
            }}
          />
        </div>
      )}
      {value.instrument === 'bass' ? (
        <>
          <div className={styles.picker}>
            <span className={styles.caption}>Notes</span>
            <Segmented label="Notes" value={value.pattern.notes} options={NOTES} onChange={(notes) => setPattern({ notes })} />
          </div>
          <div className={styles.picker}>
            <span className={styles.caption}>Rhythm</span>
            <Segmented label="Rhythm" value={value.pattern.rhythm} options={RHYTHM} onChange={(rhythm) => setPattern({ rhythm })} />
          </div>
          <div className={styles.picker}>
            <span className={styles.caption}>Approach</span>
            <Segmented
              label="Approach"
              value={value.pattern.approach}
              options={APPROACH}
              onChange={(approach) => setPattern({ approach })}
            />
          </div>
        </>
      ) : (
        <>
          <div className={styles.picker}>
            <span className={styles.caption}>Style</span>
            <Segmented label="Style" value={value.guitar.style} options={STYLE} onChange={(style) => setGuitar({ style })} />
          </div>
          <div className={styles.picker}>
            <span className={styles.caption}>Strum</span>
            <Segmented label="Strum" value={value.guitar.strum} options={STRUM} onChange={(strum) => setGuitar({ strum })} />
          </div>
          <div className={styles.picker}>
            <span className={styles.caption}>Position</span>
            <Segmented
              label="Position"
              value={value.guitar.position}
              options={POSITION}
              onChange={(position) => setGuitar({ position })}
              disabled={openShapes}
            />
            {openShapes && <span className={styles.hint}>open shapes sit at frets 0–4</span>}
          </div>
          <div className={styles.picker}>
            <span className={styles.caption}>Simplify</span>
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={value.guitar.simplify}
                onChange={(event) => setGuitar({ simplify: event.target.checked })}
              />
              7ths &amp; 6ths → triads
            </label>
          </div>
        </>
      )}
    </div>
  );
}
