// Circle of fifths (D-19): the same circle as on Chords in a key, drawn large,
// with the chosen key's signature, relative key, neighbours and chords. All of
// it is derived from the key on every render; nothing is stored.
import { Link } from 'react-router-dom';

import { keyAccidentalCount, keyChords, keySignature, pcOf, pretty, relativeKey, type KeyMode } from '../../music/spell';
import { CircleOfFifths, circleKeyName, circleNeighbours, signatureText } from '../CircleOfFifths';
import { HelpBox, ToolHeader } from '../controls';
import { selectionParams, useSelection } from '../selection';
import styles from '../Theory.module.css';

export function CircleOfFifthsTool() {
  const [sel, select] = useSelection();
  const setKey = (root: string, mode: KeyMode) => select({ root, mode, scale: mode === 'minor' ? 'minor' : 'major' });

  // D# major has nine sharps and no signature to show. Such a key is drawn as the circle's own
  // spelling of the same key and says so, rather than showing a signature cut to seven (N-08).
  const count = keyAccidentalCount(sel.root, sel.mode);
  const key = count <= 7 ? sel.root : circleKeyName(pcOf(sel.root)!, sel.mode);
  const respelled =
    count <= 7 ? null : `${pretty(sel.root)} ${sel.mode} would need ${count} ${keySignature(sel.root, sel.mode).sharps ? 'sharps' : 'flats'}`;

  const rel = relativeKey(key, sel.mode);
  const neighbours = circleNeighbours(key, sel.mode);
  const chords = keyChords(key, sel.mode, 'triads');
  const toKey = (root: string, mode: KeyMode) =>
    `/theory/chords-in-key?${selectionParams({ ...sel, root, mode, scale: mode === 'minor' ? 'minor' : 'major' }).toString()}`;

  return (
    <>
      <ToolHeader title="Circle of fifths" />
      <div className={styles.split}>
        <CircleOfFifths root={key} mode={sel.mode} size={460} onPick={setKey} />
        <div className={styles.grow}>
          <h2 className={styles.big}>
            {pretty(key)} {sel.mode}
          </h2>
          {respelled && (
            <p className={styles.dimText}>
              {respelled}, so it is shown as {pretty(key)} {sel.mode}, the same key.
            </p>
          )}
          <p>Key signature: {signatureText(key, sel.mode)}</p>
          <p>
            Relative {rel.mode}: <Link to={toKey(rel.root, rel.mode)}>{pretty(rel.root)} {rel.mode}</Link>
          </p>
          <p>
            Neighbours (a fifth away; they share six of their seven notes):{' '}
            {neighbours.map((k, n) => (
              <span key={k.dir}>
                {n > 0 && ' · '}
                <button
                  type="button"
                  className={styles.chip}
                  aria-label={`${pretty(k.root)} ${k.mode}, a fifth ${k.dir}`}
                  onClick={() => setKey(k.root, k.mode)}
                >
                  {pretty(k.root)} {k.mode}
                </button>
              </span>
            ))}
          </p>
          <p>
            Chords: {chords.map((c) => `${c.numeral} ${pretty(c.symbol)}`).join(' · ')} ·{' '}
            <Link to={toKey(key, sel.mode)}>open in Chords in a key</Link>
          </p>
          <HelpBox>
            Going clockwise adds a sharp (or removes a flat); counter-clockwise adds a flat. Keys next to each other share
            six of their seven notes, which is why songs so often move between them.
          </HelpBox>
        </div>
      </div>
    </>
  );
}
