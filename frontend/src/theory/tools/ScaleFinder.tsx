// Scale finder (D-19): a root and a scale, every scale note on the neck, one
// position highlighted at a time, and a help box that says what the scale is
// for, which chords it fits over and which scales share its notes.
import { useState } from 'react';

import { DEFAULT_THEORY } from '../../api/client';
import { positionWindows } from '../../music/positions';
import { fitsOver, pcOf, pretty, rootName, sameNotes, scaleDef, scaleNotes, SCALES, type ScaleId } from '../../music/spell';
import { neckFrets } from '../../music/tuning';
import { Segmented } from '../../ui';
import { ChipRow, HelpBox, NoteChips, NotePicker, ToolHeader } from '../controls';
import { SCALE_HELP } from '../help';
import { noteDots, type LabelMode } from '../neckDots';
import { useSelection } from '../selection';
import styles from '../Theory.module.css';
import { TheoryNeck } from '../TheoryNeck';
import { useTheoryDoc } from '../TheoryDoc';

const GROUP_LABEL = { common: 'Common', modes: 'Modes', more: 'More' } as const;

export function ScaleFinder() {
  const { doc } = useTheoryDoc();
  const inst = doc?.instrument ?? DEFAULT_THEORY.instrument;
  const [sel, select] = useSelection();
  const [labels, setLabels] = useState<LabelMode>('note');
  const [position, setPosition] = useState<{ key: string; index: number } | null>(null);

  const notes = scaleNotes(sel.root, sel.scale);
  const frets = neckFrets(inst);
  const windows = positionWindows(inst, pcOf(sel.root)!, notes.map((n) => n.pc));
  const key = `${sel.root}-${sel.scale}-${inst.tuning.join('')}`;
  // A position belongs to one root, scale and tuning; changing any of them shows the whole neck again.
  const active = position?.key === key ? windows.find((w) => w.index === position.index) ?? null : null;
  const fits = fitsOver(sel.root, sel.scale);
  const same = sameNotes(sel.root, sel.scale);
  const title = `${pretty(sel.root)} ${scaleDef(sel.scale).label.toLowerCase()}`;

  const pickScale = (scale: ScaleId) => select({ scale, mode: scaleDef(scale).mode, root: rootName(pcOf(sel.root)!, scaleDef(scale).mode) });

  return (
    <>
      <ToolHeader title="Scale finder">
        <Segmented<LabelMode>
          label="Labels"
          value={labels}
          onChange={setLabels}
          options={[
            { value: 'note', label: 'Note' },
            { value: 'interval', label: 'Interval' },
            { value: 'degree', label: 'Degree' },
          ]}
        />
      </ToolHeader>
      <div className={styles.stack}>
        <span className={styles.cap}>root</span>
        <NotePicker label="Root" selected={[pcOf(sel.root)!]} onPick={(pc) => select({ root: rootName(pc, scaleDef(sel.scale).mode) })} />
      </div>
      <div className={styles.stack}>
        {(['common', 'modes', 'more'] as const).map((group) => (
          <ChipRow
            key={group}
            label={GROUP_LABEL[group]}
            large={group === 'common'}
            value={sel.scale}
            onChange={pickScale}
            options={SCALES.filter((s) => s.group === group).map((s) => ({ value: s.id, label: s.label }))}
          />
        ))}
      </div>
      <div className={styles.neck}>
        <TheoryNeck
          instrument={inst}
          frets={frets}
          window={active}
          label={`${title} on ${inst.kind}`}
          dots={noteDots(inst, notes, { lo: 0, hi: frets, labels, window: active })}
        />
      </div>
      <div className={styles.row}>
        <NoteChips notes={notes} />
        <span className={styles.cap}>highlight position</span>
        <Segmented<string>
          label="Highlight position"
          value={active ? String(active.index) : 'all'}
          onChange={(v) => setPosition(v === 'all' ? null : { key, index: Number(v) })}
          options={[{ value: 'all', label: 'All' }, ...windows.map((w) => ({ value: String(w.index), label: String(w.index) }))]}
        />
        {active && <span className={styles.dimText}>frets {active.lo}–{active.hi}</span>}
      </div>
      <HelpBox>
        <b>{title}</b>: {SCALE_HELP[sel.scale]}{' '}
        {fits.length > 0 && (
          <>
            <b>Fits over:</b> {fits.map(pretty).join(', ')}.{' '}
          </>
        )}
        {same.length > 0 && (
          <>
            <b>Same notes as</b> {same.map(pretty).join(', ')}.
          </>
        )}
      </HelpBox>
    </>
  );
}
