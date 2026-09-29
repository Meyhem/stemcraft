// Progressions (D-19): ~15 common progressions in any key, stepped through bar
// by bar on the neck. With a song chosen, "This song" is its chord chart with
// numerals against the key. A chord outside the key is labelled "borrowed", not
// forced into a numeral, and a chord this app cannot read is labelled
// "unreadable" with the reason, never "borrowed" (N-08). A song that cannot be
// shown (loading, failed, deleted, unanalysed, no chords) says so in place of
// the chart; it never quietly turns into a stock progression.
import { useState } from 'react';

import { DEFAULT_THEORY } from '../../api/client';
import { numeralInKey } from '../../music/harmony';
import { progressionChords, PROGRESSIONS } from '../../music/progressions';
import { chordInfo, pcOf, pretty, rootName, type KeyMode } from '../../music/spell';
import { neckFrets } from '../../music/tuning';
import { Button } from '../../ui';
import { ChipRow, HelpBox, NoteChips, NotePicker, ToolHeader } from '../controls';
import { noteDots } from '../neckDots';
import { useSelection } from '../selection';
import styles from '../Theory.module.css';
import { TheoryNeck } from '../TheoryNeck';
import { useTheoryDoc } from '../TheoryDoc';
import { useChosenSong, type ChosenSong } from '../useChosenSong';

const THIS_SONG = 'this-song';

export type BarLabel =
  | { kind: 'numeral'; text: string }
  | { kind: 'borrowed'; text: 'borrowed' }
  | { kind: 'unreadable'; text: 'unreadable'; reason: string };

/** A song chord against a key: its numeral, "borrowed" (outside the key), or unreadable (with the reason). */
export function barLabel(tonic: string, mode: KeyMode, symbol: string): BarLabel {
  const info = chordInfo(symbol);
  if (!info.ok) return { kind: 'unreadable', text: 'unreadable', reason: info.reason };
  const numeral = numeralInKey(tonic, mode, symbol);
  return numeral === null ? { kind: 'borrowed', text: 'borrowed' } : { kind: 'numeral', text: numeral };
}

/** Why the song's chart cannot be shown, or null when it can. */
export function songProblem(song: ChosenSong): { text: string; alert: boolean } | null {
  switch (song.state) {
    case 'none':
      return { text: 'No song is chosen. Pick an analysed song under "from a song".', alert: false };
    case 'missing':
      return { text: 'That song no longer exists. Pick another under "from a song".', alert: true };
    case 'unanalysed':
      return { text: `${song.title} has no analysis yet. The analyze job hasn't run.`, alert: true };
    case 'error':
      return { text: song.message, alert: true };
    case 'loading':
      return { text: song.title ? `Loading the chords of ${song.title}…` : 'Loading the song…', alert: false };
    case 'ready':
      return song.sequence.length === 0 ? { text: `No chords were found in ${song.title}, so there is no chart to show.`, alert: false } : null;
  }
}

export function Progressions() {
  const { doc } = useTheoryDoc();
  const inst = doc?.instrument ?? DEFAULT_THEORY.instrument;
  const [sel, select] = useSelection();
  const song = useChosenSong();
  const [id, setId] = useState('pop');
  const [bar, setBar] = useState(0);

  const wantsSong = id === THIS_SONG;
  const problem = wantsSong ? songProblem(song) : null;
  const fromSong = wantsSong && song.state === 'ready' && problem === null;
  const def = PROGRESSIONS.find((p) => p.id === id) ?? PROGRESSIONS[0]!;
  const mode: KeyMode = wantsSong ? sel.mode : def.mode;
  // A stock progression is in its own mode: the key is spelled as that mode spells it, so a minor progression after
  // D♭ major is in C♯ minor (C♯m B A G♯), not D♭ minor (D♭m C♭ B𝄫 A♭).
  const root = wantsSong ? sel.root : rootName(pcOf(sel.root)!, def.mode);

  const chords: string[] = fromSong ? song.sequence : wantsSong ? [] : progressionChords(def, root);
  const labels: BarLabel[] = fromSong
    ? chords.map((c) => barLabel(sel.root, sel.mode, c))
    : chords.map((_, i) => ({ kind: 'numeral', text: def.numerals[i]! }));
  // Every list is guarded: with no bars there is nothing to point at.
  const current = chords.length === 0 ? -1 : Math.min(bar, chords.length - 1);
  const symbol = current >= 0 ? chords[current]! : null;
  const label = current >= 0 ? labels[current]! : null;
  const info = symbol ? chordInfo(symbol) : null;
  const frets = neckFrets(inst);

  const title = 'title' in song ? song.title : '';
  const options = [
    ...(wantsSong || (song.state === 'ready' && song.sequence.length > 0)
      ? [{ value: THIS_SONG, label: title ? `This song · ${title}` : 'This song' }]
      : []),
    ...PROGRESSIONS.map((p) => ({ value: p.id, label: p.label })),
  ];
  const step = (by: number) => setBar((current + by + chords.length) % chords.length);

  return (
    <>
      <ToolHeader title="Progressions" />
      <ChipRow label="Progression" value={id} onChange={(v) => { setId(v); setBar(0); }} options={options} />
      <div className={styles.row}>
        <span className={styles.cap}>key</span>
        <NotePicker label="Key" selected={[pcOf(sel.root)!]} onPick={(pc) => select({ root: rootName(pc, mode), mode })} />
        <span>
          <b>{pretty(root)} {mode}</b>
        </span>
      </div>
      {problem && (
        <p className={problem.alert ? styles.errorText : styles.dimText} role={problem.alert ? 'alert' : 'status'}>
          {problem.text}
        </p>
      )}
      {chords.length > 0 && (
        <ol className={styles.choices} aria-label="Bars">
          {chords.map((c, i) => (
            <li key={`${c}-${i}`}>
              <button
                type="button"
                className={styles.keyCard}
                aria-pressed={i === current}
                title={labels[i]!.kind === 'unreadable' ? labels[i]!.reason : undefined}
                onClick={() => setBar(i)}
              >
                <span className={styles.numeral}>{labels[i]!.text}</span>
                <span className={styles.keyChord}>{pretty(c)}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
      {chords.length > 0 && (
        <div className={styles.row}>
          <Button onClick={() => step(-1)} disabled={chords.length < 2} aria-label="Previous bar">
            ←
          </Button>
          <Button onClick={() => step(1)} disabled={chords.length < 2} aria-label="Next bar">
            →
          </Button>
          {info?.ok && label && (
            <>
              <b>
                {label.text} · {pretty(info.chord.symbol)}
              </b>
              <NoteChips notes={info.chord.notes} />
            </>
          )}
        </div>
      )}
      {info && !info.ok && (
        <p className={styles.errorText} role="alert">
          {info.reason}. The neck is not drawn for this bar.
        </p>
      )}
      {info?.ok && (
        <div className={styles.neck}>
          <TheoryNeck
            instrument={inst}
            frets={frets}
            dots={noteDots(inst, info.chord.notes, { lo: 0, hi: frets, labels: 'interval' })}
            label={`${pretty(info.chord.symbol)} on ${inst.kind}`}
          />
        </div>
      )}
      <HelpBox>
        {wantsSong
          ? `One entry per chord change in the song (a chord that repeats is shown once). Numerals are read against ${pretty(sel.root)} ${sel.mode}; load the song's own key from "from a song", or pick another above. A chord marked borrowed is outside the key: it is not built from the key's notes. Bars with no chord (N) are left out.`
          : 'Roman numerals name each chord by its step in the key, so the same progression works in any key: pick another key above.'}
      </HelpBox>
    </>
  );
}
