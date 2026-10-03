// The Practice settings panel (D-22): the key, then the chosen exercise's own
// pickers. Every change is a whole new InstrumentSettings, saved through the
// screen's one funnel. Drills have no key; the panel says so instead.
import type { ReactNode } from 'react';

import type { BarsPerChord, InstrumentSettings, LineRhythm, PracticeInstrument } from '../api/client';
import { HAND_SPAN } from '../music/practice/neck';
import { PROGRESSIONS } from '../music/progressions';
import { SCALES } from '../music/spell';
import { Segmented, Stepper } from '../ui';
import styles from './Practice.module.css';

export const KEY_NAMES = ['C', 'C♯/D♭', 'D', 'D♯/E♭', 'E', 'F', 'F♯/G♭', 'G', 'G♯/A♭', 'A', 'A♯/B♭', 'B'] as const;

const opts = <T extends string>(pairs: readonly (readonly [T, string])[]) => pairs.map(([value, label]) => ({ value, label }));
const LINE_RHYTHM = opts<LineRhythm>([['quarter', 'Quarter'], ['eighth', 'Eighth'], ['triplet', 'Triplet'], ['sixteenth', '16th']]);
const BARS = opts<'1' | '2' | '4'>([['1', '1'], ['2', '2'], ['4', '4']]);

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.field}>
      <span className={styles.cap}>{label}</span>
      {children}
    </div>
  );
}

function ProgressionSelect({ value, onChange }: { value: string; onChange(id: string): void }) {
  return (
    <Field label="Progression">
      <select className={styles.select} aria-label="Progression" value={value} onChange={(e) => onChange(e.target.value)}>
        {PROGRESSIONS.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function SettingsPanel({
  instrument,
  settings: s,
  onChange,
}: {
  instrument: PracticeInstrument;
  settings: InstrumentSettings;
  onChange(next: InstrumentSettings): void;
}) {
  const groove = (patch: Partial<InstrumentSettings['groove']>) => onChange({ ...s, groove: { ...s.groove, ...patch } });
  const scale = (patch: Partial<InstrumentSettings['scale']>) => onChange({ ...s, scale: { ...s.scale, ...patch } });
  const arp = (patch: Partial<InstrumentSettings['arpeggio']>) => onChange({ ...s, arpeggio: { ...s.arpeggio, ...patch } });
  const drill = (patch: Partial<InstrumentSettings['drill']>) => onChange({ ...s, drill: { ...s.drill, ...patch } });

  return (
    <div className={styles.settings}>
      {s.exercise === 'drill' ? (
        <p className={styles.dim}>Drills are fret-based: no key.</p>
      ) : (
        <Field label="Key">
          <div className={styles.keys} role="group" aria-label="Key">
            {KEY_NAMES.map((name, pc) => (
              <button key={name} type="button" aria-pressed={s.key === pc} onClick={() => onChange({ ...s, key: pc })}>
                {name}
              </button>
            ))}
          </div>
        </Field>
      )}

      {s.exercise === 'groove' && (
        <>
          <ProgressionSelect value={s.groove.progression} onChange={(id) => groove({ progression: id as never })} />
          <Field label="Bars per chord">
            <Segmented label="Bars per chord" value={String(s.groove.bars_per_chord) as '1'} options={BARS} onChange={(v) => groove({ bars_per_chord: Number(v) as BarsPerChord })} />
          </Field>
          {instrument === 'bass' ? (
            <>
              <Field label="Notes">
                <Segmented label="Notes" value={s.groove.notes} onChange={(notes) => groove({ notes })}
                  options={opts([['root', 'Root'], ['root_fifth', '1–5'], ['root_fifth_octave', '1–5–8'], ['octave_pump', 'Octave'], ['triad_chord', 'Triad'], ['triad_diatonic', 'Diatonic triad'], ['seventh', '7th']] as const)} />
              </Field>
              <Field label="Rhythm">
                <Segmented label="Rhythm" value={s.groove.rhythm} onChange={(rhythm) => groove({ rhythm })}
                  options={opts([['whole', 'Whole'], ['half', 'Half'], ['quarter', 'Quarter'], ['eighth', 'Eighth']] as const)} />
              </Field>
              <Field label="Approach">
                <Segmented label="Approach" value={s.groove.approach} onChange={(approach) => groove({ approach })}
                  options={opts([['none', 'None'], ['chromatic', 'Chromatic'], ['scale', 'Scale'], ['fifth', 'Fifth']] as const)} />
              </Field>
            </>
          ) : (
            <>
              <Field label="Shapes">
                <Segmented label="Shapes" value={s.groove.style} onChange={(style) => groove({ style })}
                  options={opts([['open', 'Open'], ['barre', 'Barre'], ['power', 'Power'], ['triad', 'Triad']] as const)} />
              </Field>
              <Field label="Strum">
                <Segmented label="Strum" value={s.groove.strum} onChange={(strum) => groove({ strum })}
                  options={opts([['whole', 'Whole'], ['half', 'Half'], ['quarters', 'Quarters'], ['eighths', 'Eighths'], ['folk', 'Folk'], ['push', 'Push']] as const)} />
              </Field>
              <Field label="Position">
                <Segmented label="Position" value={s.groove.position} onChange={(position) => groove({ position })}
                  options={opts([['auto', 'Auto'], ['low', 'Low'], ['mid', 'Mid']] as const)} />
              </Field>
            </>
          )}
        </>
      )}

      {s.exercise === 'scale' && (
        <>
          <Field label="Scale">
            <select className={styles.select} aria-label="Scale" value={s.scale.scale} onChange={(e) => scale({ scale: e.target.value as never })}>
              {SCALES.map((sc) => (
                <option key={sc.id} value={sc.id}>
                  {sc.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Shape">
            <Segmented label="Shape" value={s.scale.shape} onChange={(shape) => scale({ shape })}
              options={opts([['position', 'One position'], ['two_octaves', 'Two octaves']] as const)} />
          </Field>
          <Field label="From fret">
            <Stepper label="From fret" value={s.scale.from_fret} min={0} max={12 - HAND_SPAN[instrument]} step={1} format={String} onChange={(from_fret) => scale({ from_fret })} />
          </Field>
          <Field label="Path">
            <Segmented label="Path" value={s.scale.path} onChange={(path) => scale({ path })}
              options={opts([['up', 'Up'], ['down', 'Down'], ['up_down', 'Up + down'], ['thirds', 'In 3rds'], ['groups3', 'Groups of 3'], ['groups4', 'Groups of 4']] as const)} />
          </Field>
          <Field label="Rhythm">
            <Segmented label="Rhythm" value={s.scale.rhythm} options={LINE_RHYTHM} onChange={(rhythm) => scale({ rhythm })} />
          </Field>
        </>
      )}

      {s.exercise === 'arpeggio' && (
        <>
          <Field label="Over">
            <Segmented label="Over" value={s.arpeggio.over} onChange={(over) => arp({ over })}
              options={opts([['chord', 'One chord'], ['progression', 'Progression']] as const)} />
          </Field>
          {s.arpeggio.over === 'progression' ? (
            <ProgressionSelect value={s.arpeggio.progression} onChange={(id) => arp({ progression: id as never })} />
          ) : (
            <Field label="Chord">
              <Segmented label="Chord" value={s.arpeggio.quality} onChange={(quality) => arp({ quality })}
                options={opts([['maj', 'maj'], ['min', 'm'], ['7', '7'], ['maj7', 'maj7'], ['min7', 'm7'], ['dim', 'dim'], ['hdim7', 'm7♭5']] as const)} />
            </Field>
          )}
          <Field label="Bars per chord">
            <Segmented label="Bars per chord" value={String(s.arpeggio.bars_per_chord) as '1'} options={BARS} onChange={(v) => arp({ bars_per_chord: Number(v) as BarsPerChord })} />
          </Field>
          <Field label="Tones">
            <Segmented label="Tones" value={s.arpeggio.tones} onChange={(tones) => arp({ tones })}
              options={opts([['triad', 'Triad'], ['seventh', '7th chord']] as const)} />
          </Field>
          <Field label="Path">
            <Segmented label="Path" value={s.arpeggio.path} onChange={(path) => arp({ path })}
              options={opts([['up', 'Up'], ['down', 'Down'], ['up_down', 'Up + down'], ['inversions', 'Inversions']] as const)} />
          </Field>
          <Field label="Rhythm">
            <Segmented label="Rhythm" value={s.arpeggio.rhythm} options={LINE_RHYTHM} onChange={(rhythm) => arp({ rhythm })} />
          </Field>
        </>
      )}

      {s.exercise === 'drill' && (
        <>
          <Field label="Drill">
            <Segmented label="Drill" value={s.drill.drill} onChange={(d) => drill({ drill: d })}
              options={opts([['chromatic', '1-2-3-4'], ['permutations', 'Permutations'], ['spider', 'Spider'], ['crossing', 'String crossing'], ['octaves', 'Octaves']] as const)} />
          </Field>
          <Field label="From fret">
            <Stepper label="From fret" value={s.drill.from_fret} min={1} max={9} step={1} format={String} onChange={(from_fret) => drill({ from_fret })} />
          </Field>
          <Field label="Direction">
            <Segmented label="Direction" value={s.drill.direction} onChange={(direction) => drill({ direction })}
              options={opts([['up', 'Across, up'], ['up_back', 'Up + back']] as const)} />
          </Field>
          <Field label="Rhythm">
            <Segmented label="Rhythm" value={s.drill.rhythm} options={LINE_RHYTHM} onChange={(rhythm) => drill({ rhythm })} />
          </Field>
        </>
      )}
    </div>
  );
}
