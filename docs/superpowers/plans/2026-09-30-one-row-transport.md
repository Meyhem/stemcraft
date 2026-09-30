# One-row Transport Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two wrapped rows of 56 px boxes in `Transport` with one calm row: play, bar/chord readout, tempo and pitch steppers, a loop split button and a Practice popover.

**Architecture:** Two new `src/ui` primitives (`Stepper`, `Popover`). `LoopBars` is rebuilt on `Stepper`; `SavedLoops` becomes an inline panel (its own trigger and popover go away) so both live inside one loop-editor popover. `Transport` keeps its props, keys and readout painter unchanged; only its markup and CSS change. Nothing outside `src/ui`, `src/songview`, `src/playalong/LoopBars*` changes except test adjustments.

**Tech Stack:** React 19, TypeScript, CSS modules over `tokens.css`, Vitest + Testing Library.

**Spec:** [design/ui-spec.md](../../../design/ui-spec.md) §5 (Transport bar, Stepper, Slider rows) and the rendered pages `design/ui/src/pages/components/transport.html`, `components/inputs.html`. Decisions: U-01 (accent is chrome), U-03 (56 px performance tier), U-04 (mono tabular numerals), D-18 (session owns the recipe), C-05 (phone width).

## Global Constraints

- Transport props (`TransportProps`) and every keyboard shortcut are unchanged: Space, L, A, B, M, 1–4, ↑/↓ tempo ±5 %, ←/→ one bar.
- Tempo range 50–150 % (`TEMPO_MIN`/`TEMPO_MAX` in `engine/types.ts`); the **buttons** step 10 %, the ↑/↓ keys stay 5 %. Pitch −12…+12 semitones, whole steps.
- Performance tier = 56 px targets on the bar; setup tier = 40 px inside popovers (U-03).
- Every numeral is mono + `tabular-nums` (U-04). A value at its default renders muted.
- A pressed/lit control is **accent**, never a stem hue (U-01).
- No transition/animation on anything the rAF loop paints (bar and chord readouts stay painted by `usePlayhead`, not React).
- Fail loudly (N-08): no loop without a grid is withheld *with a reason* (`title`), never a silent no-op.
- No emoji glyphs for icons; inline SVG only.
- Run commands from `frontend/`: `npx vitest run <file>`, `npm run typecheck`.

---

### Task 1: `Stepper` primitive

**Files:**
- Create: `frontend/src/ui/Stepper.tsx`, `frontend/src/ui/Stepper.module.css`, `frontend/src/ui/Stepper.test.tsx`
- Modify: `frontend/src/ui/index.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface StepperProps {
    /** Accessible name of the value, e.g. "Tempo". Default button names are `${label} down` / `${label} up`. */
    label: string;
    value: number;
    min: number;
    max: number;
    step: number;
    format(value: number): string;
    onChange(value: number): void;
    tier?: 'setup' | 'perform'; // default 'setup'
    /** Render the value muted: it is at its default. */
    atDefault?: boolean;
    downLabel?: string;
    upLabel?: string;
  }
  ```
  Down is disabled at `value <= min`, up at `value >= max`; a click moves to `clamp(value ± step, min, max)`.

- [ ] **Step 1: Write the failing test** — `Stepper.test.tsx`

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Stepper } from './Stepper';

function setup(over: Partial<Parameters<typeof Stepper>[0]> = {}) {
  const props = {
    label: 'Tempo',
    value: 100,
    min: 50,
    max: 150,
    step: 10,
    format: (v: number) => `${v}%`,
    onChange: vi.fn(),
    ...over,
  };
  render(<Stepper {...props} />);
  return props;
}

describe('Stepper', () => {
  it('shows the formatted value under the label', () => {
    setup({ value: 90 });
    expect(screen.getByLabelText('Tempo')).toHaveTextContent('90%');
  });

  it('steps by `step` in either direction', async () => {
    const props = setup({ value: 85 });
    await userEvent.click(screen.getByRole('button', { name: 'Tempo up' }));
    expect(props.onChange).toHaveBeenLastCalledWith(95);
    await userEvent.click(screen.getByRole('button', { name: 'Tempo down' }));
    expect(props.onChange).toHaveBeenLastCalledWith(75);
  });

  it('clamps a step that would overshoot, and disables the button at the end', async () => {
    const props = setup({ value: 145 });
    await userEvent.click(screen.getByRole('button', { name: 'Tempo up' }));
    expect(props.onChange).toHaveBeenLastCalledWith(150);
  });

  it('disables a button at its range end rather than silently clamping', () => {
    setup({ value: 150 });
    expect(screen.getByRole('button', { name: 'Tempo up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Tempo down' })).toBeEnabled();
  });

  it('marks a default value so it can render muted', () => {
    setup({ atDefault: true });
    expect(screen.getByLabelText('Tempo')).toHaveAttribute('data-default', 'true');
  });

  it('takes custom button names (the loop bar steppers)', () => {
    setup({ label: 'Loop start bar', downLabel: 'Start bar earlier', upLabel: 'Start bar later' });
    expect(screen.getByRole('button', { name: 'Start bar earlier' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start bar later' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it, expect FAIL** — `npx vitest run src/ui/Stepper.test.tsx` → "Cannot find module './Stepper'".

- [ ] **Step 3: Implement** — `Stepper.tsx`

```tsx
// UI spec §5 "Stepper": - value + for small stepped ranges where a slider is overkill
// (tempo in 10 % steps, pitch in semitones, loop bars). Performance tier on the
// transport, setup tier in popovers. A button at the end of the range is disabled,
// never a silent clamp; a value at its default renders muted (U-04, UI spec §5).
import styles from './Stepper.module.css';

export type StepperTier = 'setup' | 'perform';

export interface StepperProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format(value: number): string;
  onChange(value: number): void;
  tier?: StepperTier;
  atDefault?: boolean;
  downLabel?: string;
  upLabel?: string;
}

export function Stepper({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
  tier = 'setup',
  atDefault = false,
  downLabel = `${label} down`,
  upLabel = `${label} up`,
}: StepperProps) {
  const move = (delta: number) => onChange(Math.min(max, Math.max(min, value + delta)));
  return (
    <div className={[styles.stepper, tier === 'perform' ? styles.perform : undefined].filter(Boolean).join(' ')}>
      <button type="button" aria-label={downLabel} disabled={value <= min} onClick={() => move(-step)}>
        −
      </button>
      <output aria-label={label} data-default={atDefault ? 'true' : 'false'}>
        {format(value)}
      </output>
      <button type="button" aria-label={upLabel} disabled={value >= max} onClick={() => move(step)}>
        +
      </button>
    </div>
  );
}
```

`Stepper.module.css`

```css
/* UI spec §5 "Stepper". Setup tier 40 px, .perform 56 px (U-03). The value is mono
   tabular (U-04) and muted at its default; no transition, nothing here is animated. */
.stepper {
  display: inline-flex;
  align-items: stretch;
  border: 1px solid var(--ds-border-strong);
  border-radius: var(--ds-r-btn);
  background: var(--ds-raised);
  overflow: hidden;
}

.stepper > button {
  width: var(--ds-hit-setup);
  min-height: var(--ds-hit-setup);
  border: 0;
  background: transparent;
  color: var(--ds-text);
  font: 600 var(--ds-t-lg) / 1 var(--ds-font);
  cursor: pointer;
}

.stepper > button:hover { background: var(--ds-overlay); }

.stepper > button:disabled {
  color: var(--ds-text-3);
  pointer-events: none;
}

.stepper > output {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 5ch;
  padding: 0 var(--ds-2);
  border-inline: 1px solid var(--ds-border);
  font: 600 var(--ds-t-md) / 1 var(--ds-mono);
  font-variant-numeric: tabular-nums;
  color: var(--ds-text);
}

.stepper > output[data-default='true'] {
  font-weight: 400;
  color: var(--ds-text-3);
}

.perform > button {
  width: var(--ds-hit-perform);
  min-height: var(--ds-hit-perform);
}

.perform > output { min-width: 7ch; }
```

`index.ts` — append:

```ts
export { Stepper } from './Stepper';
export type { StepperProps, StepperTier } from './Stepper';
```

- [ ] **Step 4: Run, expect PASS** — `npx vitest run src/ui/Stepper.test.tsx`
- [ ] **Step 5: Commit** — `feat(ui): Stepper primitive (- value +) for tempo, pitch and loop bars`

---

### Task 2: `Popover` primitive

**Files:**
- Create: `frontend/src/ui/Popover.tsx`, `frontend/src/ui/Popover.module.css`, `frontend/src/ui/Popover.test.tsx`
- Modify: `frontend/src/ui/index.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface PopoverProps {
    open: boolean;
    onClose(): void;
    /** The control(s) that open it; the caller owns aria-expanded. */
    trigger: ReactNode;
    /** Accessible name of the dialog. */
    label: string;
    children: ReactNode;
    /** Which edge of the trigger the panel lines up with. Default 'end' (right-aligned). */
    align?: 'start' | 'end';
  }
  ```
  Closes on Escape and on a pointer press outside the trigger + panel. Renders `role="dialog"` only while open.

- [ ] **Step 1: Failing test** — `Popover.test.tsx`

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Popover } from './Popover';

const setup = (open: boolean) => {
  const onClose = vi.fn();
  render(
    <div>
      <button>elsewhere</button>
      <Popover open={open} onClose={onClose} label="Practice" trigger={<button>Practice</button>}>
        <p>inside</p>
      </Popover>
    </div>,
  );
  return onClose;
};

describe('Popover', () => {
  it('renders nothing but the trigger while closed', () => {
    setup(false);
    expect(screen.getByRole('button', { name: 'Practice' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows a named dialog while open', () => {
    setup(true);
    expect(screen.getByRole('dialog', { name: 'Practice' })).toHaveTextContent('inside');
  });

  it('closes on Escape', async () => {
    const onClose = setup(true);
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('closes on a press outside, not on a press inside', async () => {
    const onClose = setup(true);
    await userEvent.click(screen.getByText('inside'));
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'elsewhere' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('does not listen while closed', async () => {
    const onClose = setup(false);
    await userEvent.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run, expect FAIL** (module missing).
- [ ] **Step 3: Implement** — `Popover.tsx`

```tsx
// A small floating panel anchored to its trigger. The transport's Loop and Practice
// editors use it; SavedLoops used to carry a private copy of this dismiss logic.
// Above the pinned transport's own layer and the time axis under it (z 10).
import { useEffect, useRef, type ReactNode } from 'react';

import styles from './Popover.module.css';

export interface PopoverProps {
  open: boolean;
  onClose(): void;
  trigger: ReactNode;
  label: string;
  children: ReactNode;
  align?: 'start' | 'end';
}

export function Popover({ open, onClose, trigger, label, children, align = 'end' }: PopoverProps) {
  const root = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    const onPointer = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) onClose();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onPointer);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onPointer);
    };
  }, [open, onClose]);

  return (
    <div className={styles.anchor} ref={root}>
      {trigger}
      {open && (
        <div role="dialog" aria-label={label} className={[styles.panel, align === 'start' ? styles.start : styles.end].join(' ')}>
          {children}
        </div>
      )}
    </div>
  );
}
```

`Popover.module.css`

```css
.anchor {
  position: relative;
  flex: none;
}

.panel {
  position: absolute;
  top: 100%;
  z-index: 10;
  min-width: 320px;
  max-width: calc(100vw - var(--ds-6));
  margin-top: var(--ds-2);
  display: flex;
  flex-direction: column;
  gap: var(--ds-4);
  padding: var(--ds-4);
  background: var(--ds-overlay);
  border: 1px solid var(--ds-border-strong);
  border-radius: var(--ds-r-panel);
  box-shadow: var(--ds-shadow-overlay);
}

.end { right: 0; }
.start { left: 0; }
```

`index.ts` — append `export { Popover } from './Popover'; export type { PopoverProps } from './Popover';`

- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — `feat(ui): Popover primitive with Escape and outside-press dismissal`

---

### Task 3: Loop editor parts — `LoopBars` on `Stepper`, `SavedLoops` inline

**Files:**
- Modify: `frontend/src/playalong/LoopBars.tsx`, `frontend/src/playalong/PlayAlong.module.css` (drop `.loopBars`, `.barValue`, keep `.picker`/`.caption`/`.to`), `frontend/src/songview/SavedLoops.tsx`, `frontend/src/songview/SavedLoops.module.css`
- Test: `frontend/src/playalong/LoopBars.test.tsx` (unchanged, must still pass), `frontend/src/songview/SavedLoops.test.tsx`

**Interfaces:**
- Consumes: `Stepper` (Task 1).
- Produces: `LoopBars` keeps its props; its output/button names are unchanged (`Loop start bar`, `Start bar earlier`, `Start bar later`, `Loop end bar`, `End bar earlier`, `End bar later`). `SavedLoops` keeps its props but renders **inline content only** (no trigger button, no `role="dialog"`, no own dismissal): a caption, the recall/delete rows and the save form.

- [ ] **Step 1: Update `SavedLoops.test.tsx`** — remove the `open()` helper and every test about the trigger button (`is closed until asked…`, `says Unsaved…`, `closes on Escape`, `recalls … and closes`'s closing assertion). The remaining tests render the list directly:

```tsx
describe('SavedLoops', () => {
  it('shows bars 1-based and inclusive, like the loop steppers', () => {
    renderMenu();
    expect(screen.getByRole('button', { name: 'Recall loop Bridge, bars 41–48' })).toBeInTheDocument();
  });

  it('marks the active loop', () => {
    renderMenu();
    expect(screen.getByRole('button', { name: /Recall loop Chorus/ })).toHaveAttribute('aria-current', 'true');
  });

  it('says so when there are none', () => {
    renderMenu({ savedLoops: [] });
    expect(screen.getByText('No saved loops yet.')).toBeInTheDocument();
  });

  it('recalls a saved loop', async () => {
    const props = renderMenu();
    await userEvent.click(screen.getByRole('button', { name: /Recall loop Bridge/ }));
    expect(props.onRecallLoop).toHaveBeenCalledWith({ name: 'Bridge', start_bar: 40, end_bar: 48 });
  });

  it('deletes a saved loop by name, not by row position', async () => {
    const props = renderMenu();
    await userEvent.click(screen.getByRole('button', { name: /Delete loop Bridge/ }));
    expect(props.onDeleteLoop).toHaveBeenCalledWith('Bridge');
  });

  it('saves the active loop under a typed name', async () => {
    const props = renderMenu({ activeLoop: { name: '', start_bar: 4, end_bar: 8 } });
    await userEvent.type(screen.getByRole('textbox', { name: 'Loop name' }), 'Verse 2{Enter}');
    expect(props.onSaveActiveLoop).toHaveBeenCalledWith('Verse 2');
  });

  it('cannot save when there is no active loop', () => {
    renderMenu({ activeLoop: null });
    expect(screen.getByRole('textbox', { name: 'Loop name' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save loop' })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run** `npx vitest run src/songview/SavedLoops.test.tsx src/playalong/LoopBars.test.tsx` — SavedLoops fails (still a closed menu).
- [ ] **Step 3: Rewrite `SavedLoops.tsx`** — delete the `open` state, the `root` ref, the dismissal effect, the trigger `Button` and the `role="dialog"` wrapper; return

```tsx
return (
  <div className={styles.root}>
    <span className={styles.caption}>Saved loops</span>
    {savedLoops.length === 0 && <p className={styles.note}>No saved loops yet.</p>}
    <ul className={styles.list}> …rows exactly as before, minus setOpen(false) in the recall handler… </ul>
    <form className={styles.save} onSubmit={save}> …unchanged… </form>
  </div>
);
```

(imports shrink to `useState, type FormEvent`). In `SavedLoops.module.css`: `.root` becomes `display:flex;flex-direction:column;gap:var(--ds-2)` (drop `position: relative; flex: none`), delete `.root > .button` and `.pop`, keep the rest.

- [ ] **Step 4: Rewrite `LoopBars.tsx`** on `Stepper` (setup tier, 1-based inclusive display, same push-the-end-along rule):

```tsx
import type { Loop } from '../api/client';
import { Stepper } from '../ui';
import styles from './PlayAlong.module.css';

export interface LoopBarsProps {
  loop: Loop | null;
  barCount: number;
  onLoopBars(startBar: number, endBar: number): void;
}

export function LoopBars({ loop, barCount, onLoopBars }: LoopBarsProps) {
  const start = loop?.start_bar ?? 0;
  const end = loop?.end_bar ?? 1;
  const bar = (v: number) => String(v);

  return (
    <div className={styles.picker}>
      <span className={styles.caption}>Loop bars</span>
      <div className={styles.loopBars}>
        {/* Displayed 1-based: v = start_bar + 1. Like Set A, a start moved onto or past
            the end pushes the end along rather than inverting the loop. */}
        <Stepper
          label="Loop start bar"
          downLabel="Start bar earlier"
          upLabel="Start bar later"
          value={start + 1}
          min={1}
          max={barCount}
          step={1}
          format={bar}
          onChange={(v) => onLoopBars(v - 1, Math.max(end, v))}
        />
        <span className={styles.to}>to</span>
        <Stepper
          label="Loop end bar"
          downLabel="End bar earlier"
          upLabel="End bar later"
          value={end}
          min={start + 1}
          max={barCount}
          step={1}
          format={bar}
          onChange={(v) => onLoopBars(start, v)}
        />
      </div>
    </div>
  );
}
```

In `PlayAlong.module.css` keep `.loopBars { display:inline-flex; align-items:center; gap: var(--ds-3); }`, delete `.barValue` and the `@media (max-width:520px)` grid override (the row now wraps by itself: add `flex-wrap: wrap` to `.loopBars`).

- [ ] **Step 5: Run** both test files → PASS (existing LoopBars tests assert on the same names and disabled states).
- [ ] **Step 6: Commit** — `refactor(loop): LoopBars on Stepper, SavedLoops as inline panel`

---

### Task 4: `Transport` — one row

**Files:**
- Modify: `frontend/src/songview/Transport.tsx`, `frontend/src/songview/Transport.module.css`, `frontend/src/songview/Transport.test.tsx`

**Interfaces:**
- Consumes: `Stepper`, `Popover`, `Button`, `Segmented` (`../ui`); `LoopBars`; `SavedLoops` (inline, Task 3); `TEMPO_MIN/TEMPO_MAX/clampTempo`.
- Produces: unchanged `TransportProps`/`Transport`. New accessible names: `Tempo`, `Pitch` (steppers: `Tempo down/up`, `Pitch down/up`), `Arm loop` (loop body), `Edit loop` (chevron, `aria-expanded`), `Practice` (`aria-expanded`), inside Practice `Metronome` (`aria-pressed`) and group `Count-in`.

- [ ] **Step 1: Update `Transport.test.tsx`** — replace/adjust these tests, leave the keyboard, chord-readout and text-field tests as they are:

  - `shows tempo as a percentage…` → `expect(screen.getByLabelText('Tempo')).toHaveTextContent('75%')`, `getByLabelText('Pitch')` → `'-2 st'`.
  - Replace the slider range test with:
    ```tsx
    it('steps tempo 10% with the buttons inside N-04’s 50-150% range', async () => {
      const props = renderTransport({ tempo: 1 });
      await userEvent.click(screen.getByRole('button', { name: 'Tempo up' }));
      expect(props.onTempoChange).toHaveBeenLastCalledWith(1.1);
      await userEvent.click(screen.getByRole('button', { name: 'Tempo down' }));
      expect(props.onTempoChange).toHaveBeenLastCalledWith(0.9);
    });

    it('stops the tempo buttons at 50% and 150%', () => {
      renderTransport({ tempo: 1.5 });
      expect(screen.getByRole('button', { name: 'Tempo up' })).toBeDisabled();
    });

    it('steps pitch a semitone at a time within ±12', async () => {
      const props = renderTransport({ pitchSemitones: 12 });
      expect(screen.getByRole('button', { name: 'Pitch up' })).toBeDisabled();
      await userEvent.click(screen.getByRole('button', { name: 'Pitch down' }));
      expect(props.onPitchChange).toHaveBeenLastCalledWith(11);
    });

    it('mutes the tempo and pitch values at their defaults', () => {
      renderTransport({ tempo: 1, pitchSemitones: 0 });
      expect(screen.getByLabelText('Tempo')).toHaveAttribute('data-default', 'true');
      expect(screen.getByLabelText('Pitch')).toHaveAttribute('data-default', 'true');
    });
    ```
  - `Space still plays and pauses after a slider has been used` → keep the intent on a stepper button: focus `Tempo up`, press Space, expect `onPlayPause` once and `onTempoChange` not called.
  - Delete `a slider keeps its own arrow keys…` (no slider remains in the transport; the lane-gain version lives in `StemLane.test.tsx`).
  - Loop tests: open the editor first:
    ```tsx
    const openLoop = () => userEvent.click(screen.getByRole('button', { name: 'Edit loop' }));
    ```
    `loops by bar numbers…` → `await openLoop()` before querying `Loop start bar`. `never steps a loop end past the last bar` → `await openLoop()` (make the test async).
  - `without a grid…` → assert `Edit loop` is disabled too, and `Loop start bar` is absent.
  - `sets the count-in` → `await userEvent.click(screen.getByRole('button', { name: 'Practice' }))` first.
  - `carries the saved loops menu` → `await openLoop()`; the recall button is then directly available.
  - New tests:
    ```tsx
    it('names the loop bars on the Loop button, 1-based inclusive', () => {
      renderTransport({ loop: LOOP });
      expect(screen.getByRole('button', { name: 'Arm loop' })).toHaveTextContent('5–6');
    });

    it('arms from the button body and opens the editor from the chevron, separately', async () => {
      const props = renderTransport({ loop: LOOP });
      await userEvent.click(screen.getByRole('button', { name: 'Arm loop' }));
      expect(props.onLoopArmToggle).toHaveBeenCalledOnce();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Edit loop' }));
      expect(screen.getByRole('dialog', { name: 'Loop' })).toBeInTheDocument();
    });

    it('keeps the metronome behind Practice, and the M key still works', async () => {
      const props = renderTransport();
      expect(screen.queryByRole('button', { name: 'Metronome' })).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Practice' }));
      await userEvent.click(screen.getByRole('button', { name: 'Metronome' }));
      expect(props.onMetronomeToggle).toHaveBeenCalledOnce();
    });

    it('opens only one popover at a time', async () => {
      renderTransport({ loop: LOOP });
      await userEvent.click(screen.getByRole('button', { name: 'Edit loop' }));
      await userEvent.click(screen.getByRole('button', { name: 'Practice' }));
      expect(screen.getAllByRole('dialog')).toHaveLength(1);
      expect(screen.getByRole('dialog', { name: 'Practice' })).toBeInTheDocument();
    });
    ```
- [ ] **Step 2: Run** `npx vitest run src/songview/Transport.test.tsx` → FAIL (old markup).
- [ ] **Step 3: Rewrite the render section of `Transport.tsx`.** Keep everything above `return` (readout painter, `usePlayhead`, key handler) unchanged. Add `useState` to the react import, `Popover`/`Stepper` to the `../ui` import, and:

```tsx
type Editor = 'loop' | 'practice' | null;
const PLAY = 'M8 5v14l11-7z';
const PAUSE = 'M6 5h4v14H6zm8 0h4v14h-4z';
const LOOP_ICON = 'M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z';
const CHEVRON = 'M7 10l5 5 5-5z';
const PRACTICE_ICON = 'M3 17v2h6v-2H3zM3 5v2h10V5H3zm10 16v-2h8v-2h-8v-2h-2v6h2zM7 9v2H3v2h4v2h2V9H7zm14 4v-2H11v2h10zm-6-4h2V7h4V5h-4V3h-2v6z';

function Icon({ path }: { path: string }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
      <path d={path} />
    </svg>
  );
}
```

Inside the component: `const [editor, setEditor] = useState<Editor>(null); const closeEditor = useCallback(() => setEditor(null), []); const toggle = (which: Exclude<Editor, null>) => setEditor((now) => (now === which ? null : which));` and

```tsx
const loopLabel = loop ? `${loop.start_bar + 1}–${loop.end_bar}` : '';
return (
  <div className={styles.bar}>
    <Button tier="perform" variant="primary" className={styles.play} aria-label={playing ? 'Pause' : 'Play'} onClick={onPlayPause}>
      <Icon path={playing ? PAUSE : PLAY} />
    </Button>

    <div className={styles.readout}>
      <span className={styles.caption}>Bar</span>
      <span className={styles.barNumber} data-testid="bar-readout" ref={barRef}>--</span>
    </div>
    <div className={styles.readout}>
      <span className={styles.caption}>Chord</span>
      <span className={styles.chord}>
        <span data-testid="chord-readout" ref={chordRef}>--</span>{' '}
        <span className={styles.nextChord} data-testid="chord-next" ref={nextChordRef} />
      </span>
    </div>

    <div className={styles.readout}>
      <span className={styles.caption}>Tempo</span>
      <Stepper tier="perform" label="Tempo" value={Math.round(tempo * 100)} min={TEMPO_MIN * 100} max={TEMPO_MAX * 100}
        step={10} format={(v) => `${v}%`} atDefault={tempo === 1} onChange={(v) => onTempoChange(clampTempo(v / 100))} />
    </div>
    <div className={styles.readout}>
      <span className={styles.caption}>Pitch</span>
      <Stepper tier="perform" label="Pitch" value={pitchSemitones} min={-12} max={12} step={1}
        format={(v) => `${v} st`} atDefault={pitchSemitones === 0} onChange={onPitchChange} />
    </div>

    <span className={styles.spacer} />

    <Popover open={editor === 'loop'} onClose={closeEditor} label="Loop"
      trigger={
        <div className={styles.split}>
          <Button tier="perform" aria-label="Arm loop" aria-pressed={loopArmed} disabled={!hasLoop}
            title={!barsAvailable ? NO_BARS : !loop ? 'Set the loop bars first' : undefined} onClick={onLoopArmToggle}>
            <Icon path={LOOP_ICON} />
            Loop <span className={styles.loopBars}>{loopLabel}</span>
          </Button>
          <Button tier="perform" aria-label="Edit loop" aria-haspopup="dialog" aria-expanded={editor === 'loop'}
            aria-pressed={loopArmed} disabled={!barsAvailable} title={!barsAvailable ? NO_BARS : undefined}
            onClick={() => toggle('loop')}>
            <Icon path={CHEVRON} />
          </Button>
        </div>
      }>
      {grid && <LoopBars loop={loop} barCount={grid.barCount} onLoopBars={onLoopBars} />}
      <span className={styles.hint}>A / B set an end to the bar under the playhead</span>
      <SavedLoops savedLoops={savedLoops} activeLoop={loop} onRecallLoop={onRecallLoop}
        onSaveActiveLoop={onSaveActiveLoop} onDeleteLoop={onDeleteLoop} />
    </Popover>

    <Popover open={editor === 'practice'} onClose={closeEditor} label="Practice"
      trigger={
        <Button tier="perform" aria-haspopup="dialog" aria-expanded={editor === 'practice'} onClick={() => toggle('practice')}>
          <Icon path={PRACTICE_ICON} />
          Practice
        </Button>
      }>
      <div className={styles.prow}>
        <span className={styles.label}>Metronome</span>
        <Button aria-label="Metronome" aria-pressed={metronome} onClick={onMetronomeToggle}>
          {metronome ? 'On' : 'Off'}
        </Button>
      </div>
      <div className={styles.prow} title={COUNT_IN_NOTE}>
        <span className={styles.label} aria-hidden="true">Count-in</span>
        <Segmented label="Count-in" value={String(countInBars)}
          options={COUNT_IN.map((bars) => ({ value: String(bars), label: `${bars} ${bars === 1 ? 'bar' : 'bars'}` }))}
          onChange={(value) => onCountInChange(Number(value))} />
      </div>
      <span className={styles.hint}>{COUNT_IN_NOTE}.</span>
    </Popover>
  </div>
);
```

Also remove the now-unused imports (`datalist` bits are gone with the JSX). Update the file-top comment to describe the one-row layout.

- [ ] **Step 4: Rewrite `Transport.module.css`:**

```css
/* UI spec §5, "Transport bar": one row, performance tier -- 56 px targets, the bar
   number in mono, an untouched tempo/pitch muted so the eye finds the one that moved.
   Wraps rather than overflows on a narrow window. No transition/animation: the bar
   and chord readouts are painted by usePlayhead's rAF loop, not React. */
.bar {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: var(--ds-3) var(--ds-5);
  padding: var(--ds-3) var(--ds-4);
  background: var(--ds-surface);
  border: 1px solid var(--ds-border);
  border-radius: var(--ds-r-panel);
}

.bar > .play { flex: none; width: var(--ds-hit-perform); padding: 0; }
.spacer { flex: 1; }

.readout { display: flex; flex-direction: column; gap: var(--ds-1); flex: none; }

.caption {
  font: 600 var(--ds-t-xs) / 1 var(--ds-font);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ds-text-3);
}

.barNumber {
  min-width: 2ch;
  font: 600 var(--ds-t-xl) / 1 var(--ds-mono);
  font-variant-numeric: tabular-nums; /* U-04 */
  color: var(--ds-text);
}

.chord {
  min-width: 6ch;
  font: 600 var(--ds-t-lg) / 1 var(--ds-font);
  color: var(--ds-text);
  white-space: nowrap;
}

.nextChord { font-weight: 400; color: var(--ds-text-3); }

/* The loop split button: the body arms (L), the chevron opens the editor. */
.split { display: inline-flex; }
.split > button:first-child { border-radius: var(--ds-r-btn) 0 0 var(--ds-r-btn); }
.split > button + button {
  border-radius: 0 var(--ds-r-btn) var(--ds-r-btn) 0;
  border-left-width: 0;
  padding-inline: var(--ds-3);
}

.loopBars {
  font: 400 var(--ds-t-sm) / 1 var(--ds-mono);
  font-variant-numeric: tabular-nums;
}

.prow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--ds-4);
}

.label { color: var(--ds-text-2); font-size: var(--ds-t-sm); }
.hint { color: var(--ds-text-3); font-size: var(--ds-t-xs); line-height: var(--ds-lh-xs); }
```

- [ ] **Step 5: Run** `npx vitest run src/songview` → PASS.
- [ ] **Step 6: Commit** — `feat(transport): one row with tempo and pitch steppers, loop and practice popovers`

---

### Task 5: Ripple, docs and full verification

**Files:**
- Modify: `frontend/src/screens/SongScreen.test.tsx` (lines ~141-149), `frontend/src/screens/PlayAlong.test.tsx` (~161-186), `frontend/src/screens/SongView.test.tsx` (~147-156), `README.md`, `docs/screenshots/song-view.png`, `docs/screenshots/play-along.png`, `design/ui/src/pages/components/transport.html`

- [ ] **Step 1: Fix the dependent screen tests.**
  - `SongScreen.test.tsx` "has the full transport in the Tabs view": `expect(await screen.findByLabelText('Pitch')).toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Practice' })).toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Edit loop' })).toBeInTheDocument(); expect(screen.getAllByLabelText('Tempo')).toHaveLength(1);` (the bar's own `Tempo` output; the popovers are closed).
  - `PlayAlong.test.tsx`: `plays on Space while the tempo slider has focus` → `…while a tempo button has focus`, focusing `findByRole('button', { name: 'Tempo up' })`. `plays on Space while a button has focus…` → use `Arm loop`? It needs a loop; instead open Practice first: click `Practice`, find `Metronome`, keep the rest of the test as is.
  - `SongView.test.tsx` "has no right rail": open Practice and assert `group Count-in`; `Edit loop` replaces `Saved loops`. The test that mutes the metronome via `countInAndPlay` does not touch the UI and stays.
- [ ] **Step 2: Full suite + types** — `npm run typecheck && npx vitest run` from `frontend/`; expect all green. Fix any leftover reference to `role="slider" name="Tempo"|"Pitch"`, `Saved loops` button, or an always-visible `Metronome`/`Count-in` (`grep -rn` for each).
- [ ] **Step 3: Transport design page** — in `design/ui/src/pages/components/transport.html`, replace the saved-loop chips with the shipped rows (name, bars, ×) so the design page matches; `python3 design/ui/build.py`.
- [ ] **Step 4: Look at it running** — `scripts/dev.sh up`, open `/songs/<id>` in the browser pane, check: one row at 1440 px, wraps cleanly at ~900 px, both popovers open/close (Escape, outside click, one at a time), Space/L/M/↑↓ still work, tempo shows muted at 100 %. Retake `docs/screenshots/song-view.png` and `play-along.png` (see the `dev-setup` skill for the screenshot command).
- [ ] **Step 5: README** — update the feature bullets and any description of the transport (tempo/pitch steppers, loop and Practice popovers) and confirm run instructions are unchanged.
- [ ] **Step 6: Commit and push to `main`** — `feat(transport): one-row transport` (per CLAUDE.md: tests passing, README done, `git push origin main`).

---

## Self-review

- **Spec coverage:** one row ✔ (Task 4); tempo 10 % buttons + 5 % keys ✔; pitch stepper ✔; loop split button with editor (bars + saved loops) ✔ (Tasks 3–4); Practice popover with metronome + count-in ✔; Stepper primitive + inputs page ✔ (Task 1, design already pushed); no emoji play icon ✔; keys unchanged ✔; muted defaults ✔.
- **Placeholders:** none; every code step carries code. The two CSS deletions in Task 3 name exact selectors.
- **Type consistency:** `Stepper` props (`label/value/min/max/step/format/onChange/tier/atDefault/downLabel/upLabel`) are used identically in `LoopBars` and `Transport`; `Popover` props (`open/onClose/trigger/label/children/align`) match both call sites; accessible names in Task 4's tests match the names the JSX emits.
