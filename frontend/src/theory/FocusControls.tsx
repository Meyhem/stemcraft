// The "practise" row the fretboard quizzes share: which strings, which frets,
// naturals or all notes. The values are saved per quiz; this only draws them.
import { pretty } from '../music/spell';
import { neckFrets, type Instrument } from '../music/tuning';
import { Segmented } from '../ui';
import styles from './Theory.module.css';

export interface Focus {
  strings: number[];
  frets: [number, number];
  accidentals: boolean;
}

const sameSet = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((x) => b.includes(x));

export function FocusControls({ inst, focus, onChange }: { inst: Instrument; focus: Focus; onChange: (patch: Partial<Focus>) => void }) {
  const rows = inst.tuning.length;
  const frets = neckFrets(inst);
  const lowTwo = [rows - 1, rows - 2];
  const stringsValue = focus.strings.length === 0 || sameSet(focus.strings, Array.from({ length: rows }, (_, i) => i)) ? 'all' : sameSet(focus.strings, lowTwo) ? 'low' : 'custom';
  const lowNames = lowTwo.map((r) => pretty(inst.tuning[rows - 1 - r]!.replace(/-?\d+$/, ''))).join(' + ');
  const fretOptions = [[0, 5], [0, 12], [0, frets]] as const;

  return (
    <div className={styles.row}>
      <span className={styles.cap}>practise</span>
      <Segmented<string>
        label="Strings"
        value={stringsValue}
        onChange={(v) => onChange({ strings: v === 'all' ? [] : lowTwo })}
        options={[
          { value: 'all', label: 'All strings' },
          { value: 'low', label: `${lowNames} only` },
        ]}
      />
      <Segmented<string>
        label="Frets"
        // A range to the end of the neck or past it (saved on a longer neck) is the every-fret chip: that is what is asked.
        value={focus.frets[0] === 0 && focus.frets[1] >= frets ? `0-${frets}` : focus.frets.join('-')}
        onChange={(v) => onChange({ frets: v.split('-').map(Number) as [number, number] })}
        options={fretOptions.map(([lo, top]) => ({ value: `${lo}-${top}`, label: `Frets ${lo}–${top}` }))}
      />
      <Segmented<string>
        label="Notes"
        value={focus.accidentals ? 'all' : 'naturals'}
        onChange={(v) => onChange({ accidentals: v === 'all' })}
        options={[
          { value: 'naturals', label: 'Naturals' },
          { value: 'all', label: '+ sharps/flats' },
        ]}
      />
    </div>
  );
}
