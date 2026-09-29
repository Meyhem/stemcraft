// Scales over a chord (D-19): the scales built on the chord's root that hold
// every chord tone, safest first. The neck shows the picked scale with the
// chord tones at full strength: they are the notes to land on. A chord link the
// app cannot read is an alert, and a chord no listed scale holds is said out
// loud rather than shown as an empty list (N-08).
import { useState } from 'react';
import { Link } from 'react-router-dom';

import { DEFAULT_THEORY } from '../../api/client';
import { scalesOverChord } from '../../music/harmony';
import { positionAt } from '../../music/positions';
import { pcOf, pretty, QUALITIES, rootName, scaleDef, scaleNotes, type ScaleId } from '../../music/spell';
import { neckFrets } from '../../music/tuning';
import { ChipRow, HelpBox, NoteChips, NotePicker, ToolHeader } from '../controls';
import { noteDots } from '../neckDots';
import { selectionParams, useSelection } from '../selection';
import styles from '../Theory.module.css';
import { TheoryNeck } from '../TheoryNeck';
import { useTheoryDoc } from '../TheoryDoc';
import { chordLinkProblem, selectedChord } from './ChordFinder';

export function ScalesOverChord() {
  const { doc } = useTheoryDoc();
  const inst = doc?.instrument ?? DEFAULT_THEORY.instrument;
  const [sel, select] = useSelection();
  // A pick belongs to the chord it was made for; for any other chord the list starts again at the safest scale.
  const [picked, setPicked] = useState<{ chord: string; scale: ScaleId } | null>(null);

  const chord = selectedChord(sel);
  const linkProblem = chordLinkProblem(sel);
  const fits = scalesOverChord(chord);
  const activeIndex = picked?.chord === chord.symbol ? fits.findIndex((f) => f.scale === picked.scale) : -1;
  const current = fits[Math.max(activeIndex, 0)];
  const frets = neckFrets(inst);
  const tones = new Set(chord.notes.map((n) => n.pc));
  // Chord tones at full strength (the notes to land on), the rest of the scale dimmed.
  const dots = current
    ? noteDots(inst, scaleNotes(current.root, current.scale), { lo: 0, hi: frets, labels: 'interval' }).map((d) => ({ ...d, dim: !tones.has(positionAt(inst, d).pc) }))
    : [];
  const chips = chord.extraBass ? [...chord.notes, chord.extraBass] : chord.notes;
  // Scale finder can only take a plain note name for the root; anything else would open on the default silently.
  const finderRoot = (root: string, scale: ScaleId) => (/^[A-G](#|b)?$/.test(root) ? root : rootName(pcOf(root)!, scaleDef(scale).mode));

  return (
    <>
      <ToolHeader title="Scales over a chord" />
      {linkProblem && (
        <p className={styles.errorText} role="alert">
          {linkProblem}. The link's chord was ignored; showing {pretty(chord.symbol)} instead.
        </p>
      )}
      <div className={styles.row}>
        <span className={styles.cap}>root</span>
        <NotePicker label="Root" selected={[pcOf(chord.root)!]} onPick={(pc) => select({ root: rootName(pc, 'major'), chord: null, bass: null })} />
      </div>
      <ChipRow label="Quality" value={sel.chord ? null : sel.quality} onChange={(q) => select({ quality: q, chord: null })} options={QUALITIES.map((q) => ({ value: q.id, label: q.label }))} />
      <div className={styles.row}>
        <b>{pretty(chord.symbol)}</b>
        <NoteChips notes={chips} />
      </div>
      {chord.extraBass && (
        <p className={styles.dimText}>
          The slash bass {pretty(chord.extraBass.name)} is not a chord tone; the scales are chosen for the chord above it.
        </p>
      )}
      {fits.length === 0 ? (
        <p className={styles.dimText} role="status">
          No scale in the list holds every note of {pretty(chord.symbol)}.
        </p>
      ) : (
        <ol className={styles.list} aria-label={`Scales over ${pretty(chord.symbol)}`}>
          {fits.map((f, i) => (
            <li key={f.scale} className={styles.listRow} aria-current={f === current}>
              <button type="button" className={styles.chip} aria-pressed={f === current} onClick={() => setPicked({ chord: chord.symbol, scale: f.scale })}>
                {i + 1}. {pretty(f.label)}
              </button>
              <span className={styles.dimText}>{scaleNotes(f.root, f.scale).map((n) => pretty(n.name)).join(' ')}</span>
              <Link to={`/theory/scale-finder?${selectionParams({ ...sel, root: finderRoot(f.root, f.scale), scale: f.scale, mode: scaleDef(f.scale).mode, chord: null }).toString()}`}>
                Open in Scale finder
              </Link>
            </li>
          ))}
        </ol>
      )}
      {current && (
        <div className={styles.neck}>
          <TheoryNeck instrument={inst} frets={frets} dots={dots} label={`${pretty(current.label)} over ${pretty(chord.symbol)}`} />
        </div>
      )}
      <HelpBox>
        Safest first: fewer notes means fewer to get wrong. The full-strength notes are the chord&apos;s own, the ones to
        land on; the faded ones are passing notes.
      </HelpBox>
    </>
  );
}
