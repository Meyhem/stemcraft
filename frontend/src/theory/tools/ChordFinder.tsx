// Chord finder (D-19): pick a root and quality or type any chord tonal can
// read. Shows the chord's notes and intervals on the whole neck and where it is
// diatonic. A typed chord it can't read is an inline error and the last chord
// stays on screen; nothing is guessed (N-08).
import { useState, type FormEvent } from 'react';

import { DEFAULT_THEORY } from '../../api/client';
import { chordHomes, chordInfo, chordSymbol, pcOf, pretty, QUALITIES, rootName, type ChordInfo } from '../../music/spell';
import { neckFrets } from '../../music/tuning';
import { Button } from '../../ui';
import { ChipRow, HelpBox, NoteChips, NotePicker, ToolHeader } from '../controls';
import { noteDots } from '../neckDots';
import { useSelection } from '../selection';
import styles from '../Theory.module.css';
import { TheoryNeck } from '../TheoryNeck';
import { useTheoryDoc } from '../TheoryDoc';
import { useChosenSong } from '../useChosenSong';

/** The chord the selection names: a typed one if any, else root + quality (+ bass). */
export function selectedChord(sel: { chord: string | null; root: string; quality: (typeof QUALITIES)[number]['id']; bass: string | null }): ChordInfo {
  const typed = sel.chord ? chordInfo(sel.chord) : null;
  if (typed?.ok) return typed.chord;
  const built = chordInfo(chordSymbol(sel.root, sel.quality, sel.bass));
  if (built.ok) return built.chord;
  throw new Error(`chord finder cannot build ${sel.root} ${sel.quality}`);
}

/** Check if sel.chord is set but unreadable. Returns null if it's null or readable,
 * else the chordInfo error reason (N-08, fail-loud). Other theory tools reuse it. */
export function chordLinkProblem(sel: { chord: string | null; root: string; quality: (typeof QUALITIES)[number]['id']; bass: string | null }): string | null {
  if (!sel.chord) return null;
  const parsed = chordInfo(sel.chord);
  return parsed.ok ? null : parsed.reason;
}

export function ChordFinder() {
  const { doc } = useTheoryDoc();
  const inst = doc?.instrument ?? DEFAULT_THEORY.instrument;
  const [sel, select] = useSelection();
  const song = useChosenSong();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const chord = selectedChord(sel);
  const linkProblem = chordLinkProblem(sel);
  const notes = chord.extraBass ? [...chord.notes, chord.extraBass] : chord.notes;
  const homes = chordHomes(chord);
  const frets = neckFrets(inst);

  const typeChord = (event: FormEvent) => {
    event.preventDefault();
    const parsed = chordInfo(text);
    if (!parsed.ok) {
      setError(parsed.reason);
      return;
    }
    setError(null);
    setText('');
    // The root follows the typed chord so the next tool opens on it; a double
    // sharp or flat root (rare) has no note-picker button and is left as it was.
    const root = /^[A-G](#|b)?$/.test(parsed.chord.root) ? parsed.chord.root : sel.root;
    select({ chord: parsed.chord.symbol, root });
  };

  return (
    <>
      <ToolHeader title="Chord finder">
        <form className={styles.row} onSubmit={typeChord}>
          <input
            className={styles.select}
            aria-label="Type a chord"
            placeholder="or type a chord: Am7, C/E, F#m7b5…"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <Button type="submit">Show</Button>
        </form>
      </ToolHeader>
      {linkProblem && (
        <p className={styles.errorText} role="alert">
          {linkProblem}. The link's chord was ignored; showing {pretty(chord.symbol)} instead.
        </p>
      )}
      {error && (
        <p className={styles.errorText} role="alert">
          {error}. Nothing is guessed; the last chord stays shown.
        </p>
      )}
      <div className={styles.stack}>
        <span className={styles.cap}>root</span>
        <NotePicker label="Root" selected={[pcOf(chord.root)!]} onPick={(pc) => select({ root: rootName(pc, 'major'), chord: null, bass: null })} />
      </div>
      <ChipRow
        label="Quality"
        value={sel.chord ? null : sel.quality}
        onChange={(quality) => select({ quality, chord: null })}
        options={QUALITIES.map((q) => ({ value: q.id, label: q.label }))}
      />
      {song.state === 'ready' && song.distinct.length > 0 && (
        <ChipRow
          label={`In ${song.title}`}
          value={sel.chord}
          onChange={(symbol) => select({ chord: symbol })}
          options={song.distinct.map((s) => ({ value: s, label: pretty(s) }))}
        />
      )}
      <div className={styles.row}>
        <span className={styles.big}>{pretty(chord.symbol)}</span>
        <span className={styles.dimText}>{pretty(chord.name)}</span>
        <NoteChips notes={notes} />
      </div>
      <div className={styles.neck}>
        <TheoryNeck
          instrument={inst}
          frets={frets}
          label={`${pretty(chord.symbol)} on ${inst.kind}`}
          dots={noteDots(inst, notes, { lo: 0, hi: frets, labels: 'interval' })}
        />
      </div>
      <HelpBox>
        <b>{pretty(chord.symbol)}</b>: {notes.map((n) => `${pretty(n.name)} (${n.interval})`).join(', ')}.{' '}
        {homes.length > 0 ? (
          <>
            It is the <b>{homes.slice(0, 3).join(', ')}</b>.
          </>
        ) : (
          'It is not a chord of any major key.'
        )}
      </HelpBox>
    </>
  );
}
