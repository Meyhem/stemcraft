// Chords in a key (D-19): the seven chords with numerals and what each one
// does (home / sub / tension, from tonal's harmonic function), one of them on
// the neck, common progressions in the key and a small circle of fifths.
import { useState } from 'react';

import { DEFAULT_THEORY } from '../../api/client';
import { progressionChords, PROGRESSIONS } from '../../music/progressions';
import { chordInfo, keyChords, pcOf, pretty, relativeKey, rootName } from '../../music/spell';
import { Segmented } from '../../ui';
import { CircleOfFifths } from '../CircleOfFifths';
import { HelpBox, NoteChips, NotePicker, ToolHeader } from '../controls';
import { noteDots } from '../neckDots';
import { useSelection } from '../selection';
import styles from '../Theory.module.css';
import { TheoryNeck } from '../TheoryNeck';
import { useTheoryDoc } from '../TheoryDoc';

const FN_TEXT = { home: 'feels like home', sub: 'moves away from home', tension: 'pulls back to home' } as const;

export function ChordsInKey() {
  const { doc } = useTheoryDoc();
  const inst = doc?.instrument ?? DEFAULT_THEORY.instrument;
  const [sel, select] = useSelection();
  const [kind, setKind] = useState<'triads' | 'sevenths'>('triads');
  const [picked, setPicked] = useState(0);

  const chords = keyChords(sel.root, sel.mode, kind);
  const current = chords[picked] ?? chords[0]!;
  const info = chordInfo(current.symbol);
  const rel = relativeKey(sel.root, sel.mode);
  const progressions = PROGRESSIONS.filter((p) => p.mode === sel.mode);

  const setKey = (root: string, mode: typeof sel.mode) => select({ root, mode, scale: mode === 'minor' ? 'minor' : 'major' });

  return (
    <>
      <ToolHeader title="Chords in a key">
        <Segmented
          label="Chord size"
          value={kind}
          onChange={setKind}
          options={[
            { value: 'triads', label: 'Triads' },
            { value: 'sevenths', label: '7th chords' },
          ]}
        />
      </ToolHeader>
      <div className={styles.row}>
        <span className={styles.cap}>key</span>
        <NotePicker label="Key" selected={[pcOf(sel.root)!]} onPick={(pc) => setKey(rootName(pc, sel.mode), sel.mode)} />
        <Segmented
          label="Mode"
          value={sel.mode}
          onChange={(mode) => setKey(rootName(pcOf(sel.root)!, mode), mode)}
          options={[
            { value: 'major', label: 'Major' },
            { value: 'minor', label: 'Minor' },
          ]}
        />
      </div>
      <p className={styles.dimText}>
        Relative {rel.mode}: <b>{pretty(rel.root)} {rel.mode}</b>, the same chords with a different home.
      </p>
      <div className={styles.split}>
        <div className={styles.grow}>
          <div className={styles.keyCards} role="group" aria-label="Chords">
            {chords.map((c, i) => (
              <button key={c.numeral} type="button" className={styles.keyCard} aria-pressed={i === picked} onClick={() => setPicked(i)}>
                <span className={styles.numeral}>{c.numeral}</span>
                <span className={styles.keyChord}>{pretty(c.symbol)}</span>
                <span className={styles.fn}>{c.fn}</span>
              </button>
            ))}
          </div>
          {info.ok && (
            <>
              <div className={styles.row}>
                <b>
                  {current.numeral} · {pretty(info.chord.name)}
                </b>
                <NoteChips notes={info.chord.notes} />
              </div>
              <div className={styles.neck}>
                <TheoryNeck
                  instrument={inst}
                  frets={12}
                  label={`${pretty(current.symbol)} on ${inst.kind}`}
                  dots={noteDots(inst, info.chord.notes, { lo: 0, hi: 12, labels: 'interval' })}
                />
              </div>
            </>
          )}
          <HelpBox>
            <b>{current.numeral}</b> {FN_TEXT[current.fn]}. Common progressions in {pretty(sel.root)} {sel.mode}:{' '}
            {progressions.map((p, i) => (
              <span key={p.id}>
                {i > 0 && ' · '}
                <b>{p.label}</b> {progressionChords(p, sel.root).map(pretty).join(' ')}
              </span>
            ))}
          </HelpBox>
        </div>
        <div className={styles.circleCol}>
          <CircleOfFifths root={sel.root} mode={sel.mode} onPick={setKey} />
          <span className={styles.dimText}>Click a key to jump. Neighbours share 6 of 7 notes.</span>
        </div>
      </div>
    </>
  );
}
