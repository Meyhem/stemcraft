// Play along (D-18): key, notes, rhythm and approach, three independent
// choices plus the key to think in. Every change is a whole new play_along
// recipe, saved through the session's one funnel.
import type {
  KeyCandidate,
  PatternApproach,
  PatternNotes,
  PatternRhythm,
  PlayAlong,
} from '../api/client';
import { keyName, resolveKey } from '../music/patterns';
import { Segmented } from '../ui';
import styles from './PlayAlong.module.css';

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

  return (
    <div className={styles.pickers}>
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
    </div>
  );
}
