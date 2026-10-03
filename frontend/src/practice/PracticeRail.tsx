// The Practice rail (D-22): the instrument, the four exercises, and this
// instrument's presets. Saving under a name that exists asks before replacing
// it (the States mockup).
import { useState } from 'react';

import type { ExerciseKind, PracticeDoc, PracticeInstrument, PracticePreset } from '../api/client';
import { Button, Segmented, TextField } from '../ui';
import styles from './Practice.module.css';

const EXERCISES: { kind: ExerciseKind; label: string; sub: (i: PracticeInstrument) => string }[] = [
  { kind: 'groove', label: 'Groove over chords', sub: (i) => (i === 'bass' ? 'Progression + pattern' : 'Progression + strum') },
  { kind: 'scale', label: 'Scales & modes', sub: () => 'Positions and sequences' },
  { kind: 'arpeggio', label: 'Arpeggios', sub: () => 'Chord tones, triads and 7ths' },
  { kind: 'drill', label: 'Technique drills', sub: () => 'Chromatic, spider, crossing' },
];

export function PracticeRail({
  doc,
  onInstrument,
  onExercise,
  onLoadPreset,
  onSavePreset,
}: {
  doc: PracticeDoc;
  onInstrument(instrument: PracticeInstrument): void;
  onExercise(kind: ExerciseKind): void;
  onLoadPreset(preset: PracticePreset): void;
  onSavePreset(name: string): void;
}) {
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const settings = doc[doc.instrument];
  const presets = doc.presets.filter((p) => p.instrument === doc.instrument);

  const save = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const existing = doc.presets.find((p) => p.name.toLowerCase() === trimmed.toLowerCase());
    if (existing && !window.confirm(`Replace the preset "${existing.name}"?`)) return;
    onSavePreset(existing?.name ?? trimmed);
    setSaving(false);
    setName('');
  };

  return (
    <aside className={styles.rail}>
      <span className={styles.cap}>Instrument</span>
      <Segmented
        label="Instrument"
        value={doc.instrument}
        onChange={onInstrument}
        options={[
          { value: 'bass', label: 'Bass' },
          { value: 'guitar', label: 'Guitar' },
        ]}
      />
      <span className={styles.cap}>Exercise</span>
      {EXERCISES.map((e) => (
        <button
          key={e.kind}
          type="button"
          className={styles.railItem}
          aria-current={settings.exercise === e.kind ? 'page' : undefined}
          onClick={() => onExercise(e.kind)}
        >
          <span>{e.label}</span>
          <small>{e.sub(doc.instrument)}</small>
        </button>
      ))}
      <span className={styles.cap}>Presets</span>
      {presets.length === 0 && <p className={styles.dim}>No presets for {doc.instrument} yet.</p>}
      {presets.map((p) => (
        <button key={p.name} type="button" className={styles.railItem} onClick={() => onLoadPreset(p)}>
          <span>{p.name}</span>
          <small>
            {p.settings.exercise} · {p.settings.bpm} bpm
          </small>
        </button>
      ))}
      <div className={styles.railFoot}>
        {saving ? (
          <>
            <TextField id="preset-name" label="Preset name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
            <div className={styles.row}>
              <Button variant="ghost" onClick={() => setSaving(false)}>
                Cancel
              </Button>
              <Button variant="primary" onClick={save} disabled={!name.trim()}>
                Save preset
              </Button>
            </div>
          </>
        ) : (
          <Button onClick={() => setSaving(true)}>Save as preset…</Button>
        )}
        <small className={styles.dim}>Settings are kept between visits, per instrument. Presets are named snapshots of them.</small>
      </div>
    </aside>
  );
}
