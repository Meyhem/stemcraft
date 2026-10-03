// Instrument, tuning and left-handed (D-19). Applies to every tool and is
// saved to theory.json. Play along keeps its own EADG (D-18). A custom tuning
// that doesn't parse is refused with the reason, never corrected (N-08). The
// fretboard and ear quizzes' strings and frets are neck rows and frets, so another
// instrument carries them over in the same save (focusFor).
import { useState, type FormEvent } from 'react';

import { DEFAULT_THEORY } from '../api/client';
import { focusFor } from '../music/quiz';
import {
  choiceOf,
  INSTRUMENT_CHOICES,
  instrumentFor,
  parseTuning,
  presetOf,
  presetsFor,
  tuningLabel,
  type Instrument,
  type InstrumentChoiceId,
} from '../music/tuning';
import { Button } from '../ui';
import styles from './Theory.module.css';
import { useTheoryDoc } from './TheoryDoc';

const CUSTOM = 'custom';

export function InstrumentFooter() {
  const { doc, update } = useTheoryDoc();
  const inst = doc?.instrument ?? DEFAULT_THEORY.instrument;
  const preset = presetOf(inst);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const set = (next: Instrument) =>
    update((d) => {
      const fretboard = focusFor(d.quiz.settings.fretboard, d.instrument, next);
      // A document saved before the ear quiz existed (kept from an unsaved tab) may lack it.
      const ear = focusFor(d.quiz.settings.ear ?? DEFAULT_THEORY.quiz.settings.ear, d.instrument, next);
      const unchanged = fretboard === d.quiz.settings.fretboard && ear === d.quiz.settings.ear;
      const quiz = unchanged ? d.quiz : { ...d.quiz, settings: { ...d.quiz.settings, fretboard, ear } };
      return { ...d, instrument: next, quiz };
    });

  const onTuning = (id: string) => {
    if (id === CUSTOM) {
      setText(inst.tuning.join(' '));
      setError(null);
      setEditing(true);
      return;
    }
    const p = presetsFor(inst).find((x) => x.id === id);
    if (p) set({ ...inst, tuning: [...p.notes] });
  };

  const apply = (event: FormEvent) => {
    event.preventDefault();
    const parsed = parseTuning(text, inst.strings);
    if (!parsed.ok) {
      setError(parsed.reason);
      return;
    }
    set({ ...inst, tuning: parsed.notes });
    setEditing(false);
  };

  return (
    <div className={styles.railFoot}>
      <span className={styles.cap}>instrument</span>
      <select
        className={styles.select}
        aria-label="Instrument"
        value={choiceOf(inst)}
        disabled={!doc}
        onChange={(e) => set(instrumentFor(e.target.value as InstrumentChoiceId, inst.left_handed))}
      >
        {INSTRUMENT_CHOICES.map((c) => (
          <option key={c.id} value={c.id}>
            {c.label}
          </option>
        ))}
      </select>
      <label className={styles.stack}>
        Tuning {tuningLabel(inst)}
        <select className={styles.select} aria-label="Tuning" value={editing ? CUSTOM : preset?.id ?? CUSTOM} disabled={!doc} onChange={(e) => onTuning(e.target.value)}>
          {presetsFor(inst).map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
          <option value={CUSTOM}>Custom…</option>
        </select>
      </label>
      {editing && (
        <form className={styles.stack} onSubmit={apply}>
          <input
            className={styles.select}
            aria-label="Custom tuning, low string first"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          {error && (
            <p className={styles.errorText} role="alert">
              {error}
            </p>
          )}
          <div className={styles.row}>
            <Button type="submit">Apply</Button>
            <Button variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
      <label className={styles.check}>
        <input
          type="checkbox"
          checked={inst.left_handed}
          disabled={!doc}
          onChange={(e) => set({ ...inst, left_handed: e.target.checked })}
        />
        Left-handed
      </label>
    </div>
  );
}
