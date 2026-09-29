// Arpeggios (D-19): a chord's tones across the whole neck, with one position
// highlighted at a time and the notes in that position numbered low to high.
// A chord link the app cannot read is an alert, never a silent default (N-08).
import { useState } from 'react';

import { DEFAULT_THEORY } from '../../api/client';
import { positionsOf, positionWindows } from '../../music/positions';
import { pcOf, pretty, QUALITIES, rootName } from '../../music/spell';
import { neckFrets } from '../../music/tuning';
import { Segmented } from '../../ui';
import { ChipRow, HelpBox, NoteChips, NotePicker, ToolHeader } from '../controls';
import { useSelection } from '../selection';
import styles from '../Theory.module.css';
import { TheoryNeck, type NeckDot } from '../TheoryNeck';
import { useTheoryDoc } from '../TheoryDoc';
import { chordLinkProblem, selectedChord } from './ChordFinder';

export function Arpeggios() {
  const { doc } = useTheoryDoc();
  const inst = doc?.instrument ?? DEFAULT_THEORY.instrument;
  const [sel, select] = useSelection();
  const [position, setPosition] = useState<{ key: string; index: number } | null>(null);
  const [order, setOrder] = useState(true);

  const chord = selectedChord(sel);
  const linkProblem = chordLinkProblem(sel);
  const frets = neckFrets(inst);
  const rootPc = pcOf(chord.root)!;
  const windows = positionWindows(inst, rootPc, chord.notes.map((n) => n.pc));
  // A remembered position belongs to the chord and tuning it was picked for; anything else reads as All.
  const key = `${chord.symbol}-${inst.tuning.join('')}`;
  const active = position?.key === key ? (windows.find((w) => w.index === position.index) ?? null) : null;
  const all = positionsOf(inst, new Set(chord.notes.map((n) => n.pc)), 0, frets);
  // Low to high; the same pitch on two strings (unison tunings) goes lower string first, and row 0 is the highest string.
  const inWindow = active
    ? all.filter((p) => p.fret >= active.lo && p.fret <= active.hi).sort((a, b) => a.midi - b.midi || b.string - a.string)
    : [];

  // A 4-fret box can miss a chord tone, the root included; say which rather than number it as if it were whole (N-08).
  const present = new Set(inWindow.map((p) => p.pc));
  const missing = active ? chord.notes.filter((n) => !present.has(n.pc)) : [];
  const chips = chord.extraBass ? [...chord.notes, chord.extraBass] : chord.notes;

  const dots: NeckDot[] = all.map((p) => {
    const idx = inWindow.findIndex((q) => q.string === p.string && q.fret === p.fret);
    const note = chord.notes.find((n) => n.pc === p.pc)!;
    return {
      string: p.string,
      fret: p.fret,
      marker: p.pc === rootPc ? 'root' : 'tone',
      label: idx >= 0 && order ? String(idx + 1) : note.interval,
      dim: active ? idx < 0 : false,
    };
  });

  return (
    <>
      <ToolHeader title="Arpeggios">
        <label className={styles.check} title={active ? undefined : 'Choose a position to number its notes'}>
          <input type="checkbox" checked={order} disabled={!active} onChange={(e) => setOrder(e.target.checked)} />
          Play order
        </label>
      </ToolHeader>
      {linkProblem && (
        <p className={styles.errorText} role="alert">
          {linkProblem}. The link's chord was ignored; showing {pretty(chord.symbol)} instead.
        </p>
      )}
      <div className={styles.row}>
        <span className={styles.cap}>root</span>
        <NotePicker label="Root" selected={[rootPc]} onPick={(pc) => select({ root: rootName(pc, 'major'), chord: null, bass: null })} />
      </div>
      <ChipRow label="Quality" value={sel.chord ? null : sel.quality} onChange={(q) => select({ quality: q, chord: null })} options={QUALITIES.map((q) => ({ value: q.id, label: q.label }))} />
      <div className={styles.row}>
        <b>{pretty(chord.symbol)}</b>
        <NoteChips notes={chips} />
        <span className={styles.cap}>position</span>
        {windows.length === 0 ? (
          <span className={styles.dimText}>No position of {pretty(chord.symbol)} to highlight in this tuning.</span>
        ) : (
          <Segmented<string>
            label="Position"
            value={active ? String(active.index) : 'all'}
            onChange={(v) => setPosition(v === 'all' ? null : { key, index: Number(v) })}
            options={[{ value: 'all', label: 'All' }, ...windows.map((w) => ({ value: String(w.index), label: String(w.index) }))]}
          />
        )}
        {active && <span className={styles.dimText}>frets {active.lo}–{active.hi}</span>}
      </div>
      {missing.length > 0 && active && (
        <p className={styles.dimText} role="status">
          This box has no {missing.map((n) => `${pretty(n.name)} (${n.interval})`).join(' or ')} — it sits outside frets {active.lo}–{active.hi}.
        </p>
      )}
      {chord.extraBass && (
        <p className={styles.dimText}>
          The slash bass {pretty(chord.extraBass.name)} is not a chord tone and is not drawn on the neck.
        </p>
      )}
      <div className={styles.neck}>
        <TheoryNeck instrument={inst} frets={frets} dots={dots} window={active} label={`${pretty(chord.symbol)} arpeggio`} />
      </div>
      <HelpBox>
        An arpeggio is a chord played one note at a time. Pick a position and play the numbered notes up and back down;
        the root is filled.
      </HelpBox>
    </>
  );
}
