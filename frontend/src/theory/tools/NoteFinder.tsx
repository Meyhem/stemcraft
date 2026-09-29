// Note finder (D-19): pick one or more notes and see every place each one sits,
// labelled with its octave (E1, E2…) so the same letter in two places reads as
// two different pitches. All picked notes use the same neutral dot; the label
// says which note it is (U-13 keeps stem and signal hues for their own jobs).
import { DEFAULT_THEORY } from '../../api/client';
import { positionsOf } from '../../music/positions';
import { pretty, rootName } from '../../music/spell';
import { neckFrets } from '../../music/tuning';
import { HelpBox, NotePicker, ToolHeader } from '../controls';
import { useSelection } from '../selection';
import styles from '../Theory.module.css';
import { TheoryNeck, type NeckDot } from '../TheoryNeck';
import { useTheoryDoc } from '../TheoryDoc';

export function NoteFinder() {
  const { doc } = useTheoryDoc();
  const inst = doc?.instrument ?? DEFAULT_THEORY.instrument;
  const [sel, select] = useSelection();
  const frets = neckFrets(inst);
  const toggle = (pc: number) =>
    select({ notes: sel.notes.includes(pc) ? sel.notes.filter((n) => n !== pc) : [...sel.notes, pc] });

  const dots: NeckDot[] = positionsOf(inst, new Set(sel.notes), 0, frets).map((p) => {
    const letter = rootName(p.pc, 'major');
    // Scientific pitch octave: MIDI 12 is C0, so E1 is the open low E on a bass.
    return { string: p.string, fret: p.fret, marker: 'tone', label: `${pretty(letter)}${Math.floor(p.midi / 12) - 1}` };
  });

  return (
    <>
      <ToolHeader title="Note finder" />
      <div className={styles.stack}>
        <span className={styles.cap}>notes</span>
        <NotePicker label="Notes" selected={sel.notes} onPick={toggle} />
      </div>
      <div className={styles.neck}>
        <TheoryNeck instrument={inst} frets={frets} dots={dots} label={`Picked notes on ${inst.kind}`} />
      </div>
      <HelpBox>
        {sel.notes.length === 0 ? (
          'Pick one or more notes to see every place they sit on the neck.'
        ) : (
          <>
            <b>{dots.length}</b> places from the open strings to fret {frets}. The number after the letter is the octave:
            the same letter with a higher number sounds higher.
          </>
        )}
      </HelpBox>
    </>
  );
}
