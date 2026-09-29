// Scale positions (D-19): step through one playable shape of the scale at a
// time. Pentatonic boxes (5-note scales) and three-notes-per-string patterns
// (7-note scales on guitar) are computed from the tuning; CAGED needs standard
// guitar tuning and says so when it can't apply; plain position boxes work for
// every scale and instrument. Notes outside the shape stay on the neck, dimmed.
// A system with no shape that fits the neck is disabled with that reason, never
// shown empty (N-08).
import { useState } from 'react';

import { DEFAULT_THEORY } from '../../api/client';
import { positionsOf, positionWindows, type Cell } from '../../music/positions';
import { cagedWindows, pentatonicBoxes, threeNotesPerString } from '../../music/shapes';
import { pcOf, pretty, rootName, scaleDef, scaleNotes, SCALES, type Spelled } from '../../music/spell';
import { neckFrets, type Instrument } from '../../music/tuning';
import { Button, Segmented } from '../../ui';
import { ChipRow, HelpBox, NotePicker, ToolHeader } from '../controls';
import { useSelection } from '../selection';
import styles from '../Theory.module.css';
import { TheoryNeck, type NeckDot } from '../TheoryNeck';
import { useTheoryDoc } from '../TheoryDoc';

type System = 'boxes' | '3nps' | 'caged' | 'positions';

interface Step {
  /** Carries the shape's own number, which can skip when shapes were dropped. */
  label: string;
  /** The step button's text, the same number or letter as `label`: "4" for Box 4, "C" for the C shape. */
  short: string;
  /** Low to high pitch, which is play order. */
  cells: Cell[];
}

export interface SystemDef {
  id: System;
  label: string;
  /** Why it is unavailable for this scale, instrument and tuning, or null. */
  unavailable: string | null;
  /** Never empty when `unavailable` is null. */
  steps: () => Step[];
}

/** Scale notes inside a fret window, low to high (play order). */
function windowCells(inst: Instrument, notes: readonly Spelled[], lo: number, hi: number): Cell[] {
  return positionsOf(inst, new Set(notes.map((n) => n.pc)), lo, hi).sort((a, b) => a.midi - b.midi);
}

/**
 * A system that cannot apply says why; one that applies but yields no shape on
 * this neck says that instead, so the shape stepper never has nothing to show.
 */
function system(id: System, label: string, blocked: string | null, none: string, build: () => Step[]): SystemDef {
  if (blocked) return { id, label, unavailable: blocked, steps: () => [] };
  const steps = build();
  if (steps.length === 0) return { id, label, unavailable: none, steps: () => [] };
  return { id, label, unavailable: null, steps: () => steps };
}

export function systems(inst: Instrument, notes: readonly Spelled[], frets: number): SystemDef[] {
  const rootPc = notes[0]!.pc;
  const guitar = inst.kind === 'guitar';
  const caged = cagedWindows(inst, rootPc);
  const fits = (what: string) => `No ${what} fits within ${frets} frets in this tuning`;
  return [
    system('boxes', 'Pentatonic boxes', notes.length === 5 ? null : 'Pentatonic boxes are for 5-note scales', fits('pentatonic box'), () =>
      pentatonicBoxes(inst, notes, frets).map((s) => ({ ...s, short: String(s.number) })),
    ),
    system(
      '3nps',
      '3 notes per string',
      !guitar ? 'Three notes per string is a guitar system' : notes.length === 7 ? null : 'Three notes per string is for 7-note scales',
      fits('three-notes-per-string pattern'),
      () => threeNotesPerString(inst, notes, frets).map((s) => ({ ...s, short: String(s.number) })),
    ),
    system('caged', 'CAGED', !guitar ? 'CAGED is a guitar system' : caged ? null : 'CAGED shapes assume standard guitar tuning (E A D G B E)', fits('CAGED shape'), () =>
      (caged ?? [])
        .map((w) => ({ label: `${w.label} · frets ${w.lo}–${w.hi}`, short: w.label[0]!, cells: windowCells(inst, notes, w.lo, w.hi) }))
        .filter((s) => s.cells.length > 0),
    ),
    system('positions', guitar ? 'Positions' : '1 finger per fret', null, fits('position'), () =>
      positionWindows(inst, rootPc, notes.map((n) => n.pc)).map((w) => ({
        label: `Position ${w.index} · frets ${w.lo}–${w.hi}`,
        short: String(w.index),
        cells: windowCells(inst, notes, w.lo, w.hi),
      })),
    ),
  ];
}

export function ScalePositions() {
  const { doc } = useTheoryDoc();
  const inst = doc?.instrument ?? DEFAULT_THEORY.instrument;
  const [sel, select] = useSelection();
  const [chosen, setChosen] = useState<System | null>(null);
  const [step, setStep] = useState(0);
  const [order, setOrder] = useState(false);

  const notes = scaleNotes(sel.root, sel.scale);
  const frets = neckFrets(inst);
  const defs = systems(inst, notes, frets);
  const active = defs.find((d) => d.id === chosen && !d.unavailable) ?? defs.find((d) => !d.unavailable);
  const steps = active?.steps() ?? [];
  const at = Math.min(step, steps.length - 1);
  const current = steps[at];
  const inShape = new Map((current?.cells ?? []).map((c, i) => [`${c.string}:${c.fret}`, i]));
  const rootPc = notes[0]!.pc;

  const dots: NeckDot[] = positionsOf(inst, new Set(notes.map((n) => n.pc)), 0, frets).map((p) => {
    const idx = inShape.get(`${p.string}:${p.fret}`);
    const note = notes.find((n) => n.pc === p.pc)!;
    return {
      string: p.string,
      fret: p.fret,
      marker: p.pc === rootPc ? 'root' : 'tone',
      label: idx !== undefined && order ? String(idx + 1) : note.interval,
      dim: idx === undefined,
    };
  });

  const choose = (id: System) => {
    setChosen(id);
    setStep(0);
  };

  return (
    <>
      <ToolHeader title="Scale positions">
        <label className={styles.check}>
          <input type="checkbox" checked={order} onChange={(e) => setOrder(e.target.checked)} />
          Play order
        </label>
      </ToolHeader>
      <div className={styles.row}>
        <span className={styles.cap}>root</span>
        <NotePicker label="Root" selected={[pcOf(sel.root)!]} onPick={(pc) => { select({ root: rootName(pc, scaleDef(sel.scale).mode) }); setStep(0); }} />
      </div>
      <ChipRow
        label="Scale"
        value={sel.scale}
        onChange={(scale) => { select({ scale, mode: scaleDef(scale).mode }); setStep(0); }}
        options={SCALES.map((s) => ({ value: s.id, label: s.label }))}
      />
      <div className={styles.choices} role="group" aria-label="System">
        {defs.map((d) => (
          <button
            key={d.id}
            type="button"
            className={styles.chip}
            aria-pressed={d.id === active?.id}
            disabled={d.unavailable !== null}
            title={d.unavailable ?? undefined}
            onClick={() => choose(d.id)}
          >
            {d.label}
          </button>
        ))}
      </div>
      {current ? (
        <div className={styles.row}>
          <Button onClick={() => setStep((s) => (Math.min(s, steps.length - 1) - 1 + steps.length) % steps.length)} aria-label="Previous shape">
            ←
          </Button>
          <Segmented<string>
            label="Shape"
            value={String(at)}
            onChange={(v) => setStep(Number(v))}
            options={steps.map((s, i) => ({ value: String(i), label: s.short }))}
          />
          <Button onClick={() => setStep((s) => (Math.min(s, steps.length - 1) + 1) % steps.length)} aria-label="Next shape">
            →
          </Button>
          <b>{current.label}</b>
        </div>
      ) : (
        <p className={styles.errorText} role="alert">
          No shape system fits this scale on this neck. Every scale note is shown.
        </p>
      )}
      <div className={styles.neck}>
        <TheoryNeck instrument={inst} frets={frets} dots={dots} label={`${pretty(sel.root)} ${scaleDef(sel.scale).label}${current ? `, ${current.label}` : ''}`} />
      </div>
      <HelpBox>
        Learn one shape at a time: play it low to high and back{order ? ' in the numbered order' : ''}, then move to the next.
        Neighbouring shapes share notes, so together they cover the neck. The dimmed notes are the rest of the scale.
      </HelpBox>
    </>
  );
}
