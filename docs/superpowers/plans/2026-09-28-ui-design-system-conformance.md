# UI Design System Conformance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the design system's missing component layer into the SPA as React
primitives, so every screen renders from one shared, spec-conformant vocabulary instead
of falling through to browser defaults.

**Architecture:** The frontend imports `tokens.css` and nothing else. The design
system's other half — `design/ui/src/components.css`, 246 lines covering buttons, chips,
banners, fields, drop zones, segmented controls, tables, progress bars and empty states —
was never ported. Every screen either hand-rolled a subset of it or inherited UA
defaults. This plan adds two layers underneath the existing screens: a **global base
stylesheet** (`src/styles/base.css`, a faithful port of the `/* base */` block) and a
**primitive layer** (`src/ui/`, one React component per design-system component, each
with a `.module.css` carrying that component's rules rule-for-rule from
`components.css`). Then each screen is converted to consume the primitives. No screen's
behaviour changes; only what it renders with.

**Tech Stack:** React 19, react-router-dom 7, CSS modules (D-16), Vite 6, Vitest 2,
@testing-library/react 16.

**Spec:** [design/ui-spec.md](../../../design/ui-spec.md). The component inventory is
§5; the tokens are §4; the decisions cited throughout are U-01…U-10.
Source of truth for the visual rules being ported: `design/ui/src/components.css`.

## Global Constraints

- **Tokens are the authority (U-02).** `design/ui/src/tokens.css` and
  `frontend/src/styles/tokens.css` are currently **byte-identical**, and Task 1 adds a
  test that keeps them that way. Any new token is added to the design source first, then
  mirrored. No raw hex may appear in any file under `frontend/src/` except `tokens.css`.
- **U-01 — saturation carries meaning.** Muted stem hues (`--ds-vocals`, `--ds-drums`,
  `--ds-bass`, `--ds-other`) appear **only where a stem is named**. A lit/pressed/selected
  control is chrome and takes `--ds-accent`, **never** a stem hue. Vivid signals
  (`--ds-ok`, `--ds-warn`, `--ds-error`) appear only in chrome.
- **U-03 — two hit-target tiers.** `--ds-hit-perform` 56px, `--ds-hit-setup` 40px,
  `--ds-hit-min` 32px absolute floor. Nothing interactive may be smaller than the floor.
- **U-04 — every numeral is mono and `tabular-nums`.** Bars, BPM, tempo %, semitones,
  timecode, durations, file sizes, percentages, confidences.
- **U-05 — the playhead is never animated by CSS.** No task here may add a
  `transition` or `animation` to any element in `Timeline`, `ChordStrip` or the
  splitter's `WaveformMarkers`.
- **U-07 — no webfont.** System stacks only, via `--ds-font` / `--ds-mono`.
- **U-08 — depth is surface steps plus 1px borders, not drop shadows.** The single
  exception is the modal, which is out of this plan's scope.
- **U-09 — every failure surface shows the real message from the real tool**, verbatim,
  in mono, copyable. No paraphrase, no truncation, no "something went wrong".
- **No format whitelist.** `ffmpeg` decodes what it decodes (CLAUDE.md, "Hard
  environment facts"). `DropZone` must **not** set an `accept` attribute by default, and
  no screen may pass one. Adding `accept="audio/*"` would silently reject video
  containers the pipeline handles fine.
- **Behaviour is preserved.** Every existing test must still pass unmodified unless a
  task explicitly says otherwise and says why. These are styling changes.

---

## What this plan fixes, and what it does not

The audit found 25 divergences across three layers. This plan covers layers 0 and 1
(findings F1–F20). Layer 2 — missing screen *structure* — is deliberately deferred to a
follow-up plan.

**Deliberately out of scope (Layer 2, spec §6):**

- **F21** — Import is a pair of inline forms, not a modal, and does not show the
  five-step pipeline (§6.2). This plan gives it a real drop zone and conformant fields;
  it does not make it a modal.
- **F22** — Library cards lack the mix-waveform thumbnail, key candidate, BPM, duration,
  one-line practice summary and inline job progress the spec asks for (§6.1).
- **F23** — Job queue lacks all-time stats split by kind and device, and full history
  (§6.6, §10).
- **F24** — No topbar or brand mark (`design/ui/src/components.css`, `.topbar`/`.brand`).
  The nav stays a nav.
- **U-Q1/U-Q2** — the two open questions in the UI spec stay open.

---

## File structure

**Created:**

| File | Responsibility |
| --- | --- |
| `frontend/src/styles/base.css` | Global base: reset, body ground + font, `:focus-visible`, type and `.num` utilities. Port of the `/* base */` block of `components.css`. |
| `frontend/src/styles/tokens.test.ts` | Guards that the two `tokens.css` files stay byte-identical. |
| `frontend/src/ui/Button.tsx` + `.module.css` + `.test.tsx` | `Button`, `ButtonLink`. Variants default/primary/ghost/danger; tiers setup/perform. |
| `frontend/src/ui/TextLink.tsx` + `.module.css` + `.test.tsx` | Prose link: accent, underline on hover/focus. |
| `frontend/src/ui/Chip.tsx` + `.module.css` + `.test.tsx` | State chip, device badge, key candidate chip. |
| `frontend/src/ui/Banner.tsx` + `.module.css` + `.test.tsx` | Warn/error banner carrying the verbatim trace (U-09). |
| `frontend/src/ui/TextField.tsx` + `.module.css` + `.test.tsx` | Labelled text input. |
| `frontend/src/ui/DropZone.tsx` + `.module.css` + `.test.tsx` | File drop zone wrapping a real `<input type="file">`. |
| `frontend/src/ui/Segmented.tsx` + `.module.css` + `.test.tsx` | Segmented control; pressed state is accent (U-01). |
| `frontend/src/ui/Panel.tsx` + `.module.css` | Surface container. |
| `frontend/src/ui/ProgressBar.tsx` + `.module.css` | Determinate progress. |
| `frontend/src/ui/EmptyState.tsx` + `.module.css` | Empty state. |
| `frontend/src/ui/Table.tsx` + `.module.css` | Setup-tier table; the only place 13px is permitted. |
| `frontend/src/ui/surfaces.test.tsx` | Covers Panel, ProgressBar, EmptyState, Table together. |
| `frontend/src/ui/index.ts` | Barrel. Screens import from `../ui`. |

**Modified:** `design/ui/src/tokens.css`, `design/ui/src/components.css`,
`frontend/src/styles/tokens.css`, `frontend/src/main.tsx`, `frontend/vite.config.ts`,
`frontend/src/app/AppShell.tsx` + `.module.css`, and each of
`Library`, `Import`, `JobQueue`, `Export`, `ScaleSheet`, `AlbumSplitter`,
`songview/Transport`, `songview/StemLane`, `songview/RightRail` (`.tsx` + `.module.css`).

---

## Task 1: Tokens, the global base layer, and a parity guard

The base layer alone fixes four reported symptoms: the white page frame, Times New
Roman, the off-scale headings and the invisible focus ring.

Three tokens are added because the design system's own `components.css` uses three raw
hex values for text-on-a-filled-control (`#04121F` on accent, `#180000` on error,
`#1A1200` on warn). Today `frontend/src/` contains zero raw hex outside `tokens.css`,
and that property is worth keeping — so the values become tokens in the design source,
and the design source is regenerated.

**Files:**
- Modify: `design/ui/src/tokens.css`
- Modify: `design/ui/src/components.css`
- Modify: `frontend/src/styles/tokens.css`
- Create: `frontend/src/styles/base.css`
- Create: `frontend/src/styles/tokens.test.ts`
- Modify: `frontend/src/main.tsx`
- Modify: `frontend/vite.config.ts`

**Interfaces:**
- Produces: CSS custom properties `--ds-on-accent`, `--ds-on-error`, `--ds-on-warn`,
  consumed by Tasks 2, 8 and 17. Global classes `num`, `t-display`, `t-xl`, `t-lg`,
  `t-md`, `t-sm`, `t-xs`, `dim`, `dim3`, `cap`, consumed by Tasks 11–17.
  Vitest resolves CSS-module class names to their unscoped names from here on, which
  every later task's `toHaveClass` assertion depends on.

- [ ] **Step 1: Write the failing parity test**

Create `frontend/src/styles/tokens.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

// U-02: design/ui/src/tokens.css is the authority; frontend/src/styles/tokens.css is a
// mirror of it. They are byte-identical today and this test exists to keep them that
// way -- a token added to one and not the other is a divergence that shows up as a
// wrong colour weeks later, in one place, and looks like a screen bug.
//
// Load-bearing: this asserts on the *bytes*, not on a parsed set of names. A
// reformatted mirror is still a divergence, because design/ui/build.py inlines the
// authority verbatim into the reference pages a human compares the app against.
// import.meta.url, not __dirname: package.json is "type": "module", so __dirname does
// not exist here and the test would throw before asserting anything.
const AUTHORITY = fileURLToPath(new URL('../../../design/ui/src/tokens.css', import.meta.url));
const MIRROR = fileURLToPath(new URL('tokens.css', import.meta.url));

test('the frontend token mirror is byte-identical to the design system authority', () => {
  expect(readFileSync(MIRROR, 'utf8')).toBe(readFileSync(AUTHORITY, 'utf8'));
});

test('the on-filled-control text tokens exist', () => {
  // Task 2 paints .primary with var(--ds-on-accent). If the token is missing the
  // button renders with `color: ` unset -- inheriting --ds-text, near-white text on a
  // near-white accent fill. The button still "works", which is exactly why this is
  // pinned here rather than left to the eye.
  const css = readFileSync(MIRROR, 'utf8');
  expect(css).toContain('--ds-on-accent:#04121F');
  expect(css).toContain('--ds-on-error:#180000');
  expect(css).toContain('--ds-on-warn:#1A1200');
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npm --prefix frontend test -- src/styles/tokens.test.ts
```

Expected: the parity test PASSES (the files are already identical), the token test
FAILS with the `--ds-on-accent` assertion.

- [ ] **Step 3: Add the three tokens to the design system authority**

In `design/ui/src/tokens.css`, immediately after the `--ds-accent` line inside `:root{`:

```css
  --ds-accent:#4FA3FF;   /* focus rings, selected chrome, links */

  /* text ON a filled control. A lit control is chrome (U-01), so these pair with
     accent/error/warn fills only -- never with a stem hue. */
  --ds-on-accent:#04121F;
  --ds-on-error:#180000;
  --ds-on-warn:#1A1200;
```

- [ ] **Step 4: Mirror the authority into the frontend**

```bash
cp design/ui/src/tokens.css frontend/src/styles/tokens.css
```

- [ ] **Step 5: Replace the raw hex in the design system's own component CSS**

In `design/ui/src/components.css`, replace every literal with its token. There are six
occurrences:

```bash
cd /home/meyhem/dev/stemcraft
sed -i 's/#04121F/var(--ds-on-accent)/g; s/#180000/var(--ds-on-error)/g; s/#1A1200/var(--ds-on-warn)/g' design/ui/src/components.css
grep -n 'ds-on-' design/ui/src/components.css
```

Expected: six lines — `.btn-primary`, `.iconbtn[aria-pressed=true]`,
`.check[data-on=true] .box::after`, `.loopregion::before/::after`,
`.ms button[aria-pressed=true][data-k=m]`, `.ms button[aria-pressed=true][data-k=s]`.

- [ ] **Step 6: Regenerate the design system preview pages**

`build.py` inlines `src/tokens.css` + `src/components.css` into every page in `dist/`,
so the reference pages a human compares the app against must be rebuilt or they still
carry the old CSS.

```bash
python3 design/ui/build.py
```

- [ ] **Step 7: Run the token test again**

```bash
npm --prefix frontend test -- src/styles/tokens.test.ts
```

Expected: both tests PASS.

- [ ] **Step 8: Create the global base stylesheet**

Create `frontend/src/styles/base.css`. This is a port of the
`/* ---------- base ---------- */` block of `design/ui/src/components.css`, plus one
deliberate addition noted inline.

```css
/* The global base layer. A port of the "base" block at the top of
   design/ui/src/components.css, which is the design system's authority for it.
   Everything else the design system defines lands as a React primitive in src/ui/
   (D-16: CSS modules), but this block cannot -- it styles the document itself.

   Before this file existed the app imported tokens.css alone, so `body` kept the UA
   background (transparent over a white canvas, an 8px white frame around the app),
   the UA font (Times New Roman), UA heading sizes (36px/27px, on no scale at all),
   and the UA focus ring, which is close to invisible on a #0B0C0E ground. */

*,
*::before,
*::after { box-sizing: border-box; }

html,
body { margin: 0; }

html { background: var(--ds-ground); }

body {
  background: var(--ds-ground);
  color: var(--ds-text);
  font: 400 var(--ds-t-md) / var(--ds-lh-md) var(--ds-font);
  -webkit-font-smoothing: antialiased;
}

/* Deliberate addition, absent from the design system source: its reference pages style
   every control explicitly, so they never needed this. The app has raw <input> and
   <button> elements in places, and form controls do not inherit font from an
   ancestor -- without this they render Arial 13.33px regardless of what body says. */
button,
input,
select,
textarea {
  font: inherit;
  color: inherit;
}

/* The one focus treatment for the whole app. --ds-accent is the token's documented
   job ("focus rings, selected chrome, links"). */
:focus-visible {
  outline: 2px solid var(--ds-accent);
  outline-offset: 2px;
}

/* Headings carry no UA margin: every screen lays itself out with flex/grid `gap`, so
   a UA margin is a second, invisible spacing system fighting the first. */
h1,
h2,
h3,
h4,
p,
figure,
pre { margin: 0; }

h1 { font: 600 var(--ds-t-xl) / var(--ds-lh-xl) var(--ds-font); }
h2 { font: 600 var(--ds-t-lg) / var(--ds-lh-lg) var(--ds-font); }
h3 { font: 600 var(--ds-t-md) / var(--ds-lh-md) var(--ds-font); }

/* U-04: one place that defines what a numeral looks like. Global rather than a module
   because it is applied to arbitrary spans inside screen markup, exactly as the design
   system uses it. */
.num {
  font-family: var(--ds-mono);
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.01em;
}

.t-display { font-size: var(--ds-t-display); line-height: var(--ds-lh-display); font-weight: 600; }
.t-xl { font-size: var(--ds-t-xl); line-height: var(--ds-lh-xl); font-weight: 600; }
.t-lg { font-size: var(--ds-t-lg); line-height: var(--ds-lh-lg); font-weight: 600; }
.t-md { font-size: var(--ds-t-md); line-height: var(--ds-lh-md); }
.t-sm { font-size: var(--ds-t-sm); line-height: var(--ds-lh-sm); }
.t-xs { font-size: var(--ds-t-xs); line-height: var(--ds-lh-xs); }

.dim { color: var(--ds-text-2); }
.dim3 { color: var(--ds-text-3); }

.cap {
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-size: var(--ds-t-xs);
  font-weight: 600;
  color: var(--ds-text-3);
}
```

- [ ] **Step 9: Import the base layer**

In `frontend/src/main.tsx`, change the single style import to two, base after tokens:

```ts
import './styles/tokens.css';
import './styles/base.css';
```

- [ ] **Step 10: Make CSS-module class names assertable in tests**

Vitest 2 already processes CSS modules, but it returns *hashed* names — `styles.primary`
is `'_primary_2b6b9a'`, not `'primary'`. Every `toHaveClass('primary')` assertion in
Tasks 2–9 is written against the literal name and fails without this setting.
`classNameStrategy: 'non-scoped'` makes a module's `.primary` resolve to the string
`'primary'`.

**This was measured, not assumed.** A throwaway module plus a one-line test was run
against this exact Vitest version before and after the setting: before it produced
`_btn_2b6b9a _primary_2b6b9a` and failed; after, it passed. The real baseline before any
of this plan's changes is **31 files, 247 tests** (an earlier draft said 32/248; that run
included the throwaway probe file).

In `frontend/vite.config.ts`, inside the existing `test: { ... }` block:

```ts
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/setupTests.ts'],
    // Vitest hashes CSS-module class names by default (`styles.primary` comes back as
    // '_primary_2b6b9a'), so the src/ui/*.test.tsx assertions -- which are written
    // against the literal names the design system uses -- cannot match. 'non-scoped'
    // resolves `.primary` to 'primary'. Verified against this Vitest version: the
    // assertions fail without it and pass with it.
    css: { modules: { classNameStrategy: 'non-scoped' } },
  },
```

- [ ] **Step 11: Run the whole suite**

```bash
npm --prefix frontend test
```

Expected: **31 files, 247 tests, all passing** (plus the 2 added by this task) — the baseline before any of
this plan's changes. Nothing existing asserts on class names, so unhashing them must not
change any result. If a test breaks here, it was depending on the hash — read it before
changing it.

- [ ] **Step 12: Verify in the browser that the four symptoms are gone**

The dev server on `:5173` picks this up via HMR; hard-reload it. Then evaluate:

```js
(() => {
  const b = getComputedStyle(document.body);
  const h1 = document.querySelector('h1');
  return {
    bodyBg: b.backgroundColor,      // expect rgb(11, 12, 14)
    bodyMargin: b.margin,           // expect 0px
    bodyFont: b.fontFamily,         // expect the --ds-font stack, not Times New Roman
    h1Size: h1 && getComputedStyle(h1).fontSize,   // expect 32px
    h1Margin: h1 && getComputedStyle(h1).margin,   // expect 0px
  };
})()
```

Expected exactly: `bodyBg: "rgb(11, 12, 14)"`, `bodyMargin: "0px"`, a `ui-sans-serif`
stack, `h1Size: "32px"`, `h1Margin: "0px"`.

- [ ] **Step 13: Commit**

```bash
git add design/ui/src design/ui/dist frontend/src/styles frontend/src/main.tsx frontend/vite.config.ts
git commit -m "feat(ui): global base layer and on-filled-control tokens

The frontend imported tokens.css alone, so body kept the UA background (a white
8px frame around the app), the UA font (Times New Roman, which form controls
inherited as Arial 13.33px), UA heading sizes and the UA focus ring. base.css
ports the design system's own base block. Three raw hex values in
components.css become --ds-on-accent/-error/-warn so frontend/src keeps zero
raw hex outside tokens.css, and a test keeps the two tokens.css byte-identical."
```

---

## Task 2: Button and ButtonLink

The single largest source of inconsistency: six screens render bare `<button>` elements
(light grey, 2px black border, square, Arial 13.33px) and seven files copy-paste a
near-identical raised-background rule with a different font in each.

**Files:**
- Create: `frontend/src/ui/Button.tsx`
- Create: `frontend/src/ui/Button.module.css`
- Create: `frontend/src/ui/Button.test.tsx`
- Create: `frontend/src/ui/index.ts`

**Interfaces:**
- Consumes: `--ds-on-accent` from Task 1; `classNameStrategy: 'non-scoped'` from Task 1.
- Produces:
  ```ts
  type ButtonVariant = 'default' | 'primary' | 'ghost' | 'danger';
  type ButtonTier = 'setup' | 'perform';
  function Button(props: ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: ButtonVariant; tier?: ButtonTier;
  }): JSX.Element;               // forwardRef to HTMLButtonElement
  function ButtonLink(props: LinkProps & {
    variant?: ButtonVariant; tier?: ButtonTier;
  }): JSX.Element;
  ```
  Used by Tasks 10–17.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/ui/Button.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FormEvent } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { expect, test, vi } from 'vitest';

import { Button, ButtonLink } from './Button';

test('a button carries the base class and no variant class by default', () => {
  render(<Button>Do it</Button>);
  const btn = screen.getByRole('button', { name: 'Do it' });
  expect(btn).toHaveClass('btn');
  expect(btn).not.toHaveClass('primary');
  expect(btn).not.toHaveClass('ghost');
  expect(btn).not.toHaveClass('danger');
});

test.each([
  ['primary', 'primary'],
  ['ghost', 'ghost'],
  ['danger', 'danger'],
] as const)('variant %s maps to class %s', (variant, cls) => {
  render(<Button variant={variant}>X</Button>);
  expect(screen.getByRole('button')).toHaveClass('btn', cls);
});

test('the performance tier adds its class and the setup tier does not', () => {
  const { rerender } = render(<Button tier="perform">X</Button>);
  expect(screen.getByRole('button')).toHaveClass('perform');
  rerender(<Button tier="setup">X</Button>);
  expect(screen.getByRole('button')).not.toHaveClass('perform');
});

test('a button defaults to type=button, so one inside a form does not submit it', async () => {
  // Load-bearing. Library, Export, Import and AlbumSplitter all put non-submitting
  // buttons (Delete, Cancel, Add boundary) inside or near <form>. A bare <button> is
  // type=submit, so the default here is the difference between a Delete button and a
  // Delete button that also submits the form it happens to sit in.
  const onSubmit = vi.fn((e: FormEvent) => e.preventDefault());
  render(
    <form onSubmit={onSubmit}>
      <Button>Not a submit</Button>
    </form>,
  );
  await userEvent.click(screen.getByRole('button'));
  expect(onSubmit).not.toHaveBeenCalled();
});

test('type can still be overridden to submit', () => {
  render(<Button type="submit">Go</Button>);
  expect(screen.getByRole('button')).toHaveAttribute('type', 'submit');
});

test('a ButtonLink is a link that wears the button classes', () => {
  render(
    <MemoryRouter>
      <ButtonLink to="/import" variant="primary">New Song</ButtonLink>
    </MemoryRouter>,
  );
  const link = screen.getByRole('link', { name: 'New Song' });
  expect(link).toHaveAttribute('href', '/import');
  expect(link).toHaveClass('btn', 'primary');
});

test('a caller-supplied className is kept alongside the variant classes', () => {
  render(<Button variant="danger" className="mine">X</Button>);
  expect(screen.getByRole('button')).toHaveClass('btn', 'danger', 'mine');
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npm --prefix frontend test -- src/ui/Button.test.tsx
```

Expected: FAIL — `Failed to resolve import "./Button"`.

- [ ] **Step 3: Write the stylesheet**

Create `frontend/src/ui/Button.module.css` — a port of the `/* buttons */` block of
`design/ui/src/components.css`:

```css
/* UI spec §5, "Button, icon button": setup tier by default (40px), performance tier
   (56px) for anything touched with an instrument in hand. "Pressed state uses accent,
   never a stem hue -- a lit control is chrome." */

.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--ds-2);
  min-height: var(--ds-hit-setup);
  padding: 0 var(--ds-4);
  border: 1px solid var(--ds-border-strong);
  border-radius: var(--ds-r-btn);
  background: var(--ds-raised);
  color: var(--ds-text);
  font: 600 var(--ds-t-sm) / 1 var(--ds-font);
  text-decoration: none;
  white-space: nowrap;
  cursor: pointer;
  transition:
    background var(--ds-m-flip) var(--ds-ease),
    border-color var(--ds-m-flip) var(--ds-ease);
}

.btn:hover { background: var(--ds-overlay); }

.primary {
  background: var(--ds-accent);
  border-color: var(--ds-accent);
  color: var(--ds-on-accent);
}

.primary:hover {
  background: var(--ds-accent);
  filter: brightness(1.1);
}

.ghost {
  background: transparent;
  border-color: transparent;
  color: var(--ds-text-2);
  font-weight: 500;
}

.ghost:hover {
  background: var(--ds-raised);
  color: var(--ds-text);
}

.danger {
  background: transparent;
  border-color: var(--ds-error);
  color: var(--ds-error);
}

.danger:hover { background: color-mix(in srgb, var(--ds-error) 12%, transparent); }

.perform {
  min-height: var(--ds-hit-perform);
  padding: 0 var(--ds-5);
  font-size: var(--ds-t-md);
}

/* The UA disabled style is dark text on a light fill -- unreadable on this ground and
   the reason every disabled submit in the app currently vanishes. Dimming the styled
   button keeps it legible as a disabled control. */
.btn:disabled,
.btn[aria-disabled='true'] {
  opacity: 0.4;
  pointer-events: none;
}

/* A pressed control is chrome, so it takes the accent -- never a stem hue (U-01). */
.btn[aria-pressed='true'] {
  background: var(--ds-accent);
  border-color: var(--ds-accent);
  color: var(--ds-on-accent);
}
```

- [ ] **Step 4: Write the component**

Create `frontend/src/ui/Button.tsx`:

```tsx
import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { Link, type LinkProps } from 'react-router-dom';

import styles from './Button.module.css';

export type ButtonVariant = 'default' | 'primary' | 'ghost' | 'danger';
export type ButtonTier = 'setup' | 'perform';

const VARIANT: Record<ButtonVariant, string | undefined> = {
  default: undefined,
  primary: styles.primary,
  ghost: styles.ghost,
  danger: styles.danger,
};

function buttonClass(variant: ButtonVariant, tier: ButtonTier, extra?: string): string {
  return [styles.btn, VARIANT[variant], tier === 'perform' ? styles.perform : undefined, extra]
    .filter(Boolean)
    .join(' ');
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  tier?: ButtonTier;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'default', tier = 'setup', className, type = 'button', ...rest },
  ref,
) {
  // type defaults to 'button', not the HTML default 'submit': most buttons in this app
  // sit inside a <form> and are not its submit.
  return <button ref={ref} type={type} className={buttonClass(variant, tier, className)} {...rest} />;
});

export interface ButtonLinkProps extends LinkProps {
  variant?: ButtonVariant;
  tier?: ButtonTier;
}

/** A navigation target that reads as a control. Prose links use TextLink instead. */
export function ButtonLink({
  variant = 'default',
  tier = 'setup',
  className,
  ...rest
}: ButtonLinkProps) {
  return <Link className={buttonClass(variant, tier, className)} {...rest} />;
}
```

- [ ] **Step 5: Create the barrel**

Create `frontend/src/ui/index.ts`:

```ts
export { Button, ButtonLink } from './Button';
export type { ButtonLinkProps, ButtonProps, ButtonTier, ButtonVariant } from './Button';
```

- [ ] **Step 6: Run the tests**

```bash
npm --prefix frontend test -- src/ui/Button.test.tsx
```

Expected: PASS, 8 tests.

- [ ] **Step 7: Prove the variant test is not vacuous**

Temporarily change `VARIANT.primary` to `undefined` in `Button.tsx` and re-run.
Expected: the `primary` case of the `test.each` FAILS. Revert.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/ui
git commit -m "feat(ui): Button and ButtonLink primitives

Ports the design system's .btn family. Six screens currently render bare
<button> elements as UA controls -- light grey, 2px black border, Arial
13.33px -- and disabled ones render dark-on-light, invisible on the ground."
```

---

## Task 3: TextLink, and the rule that ends the three-way link inconsistency

The app has three incompatible link treatments: UA blue `rgb(0,0,238)` underlined on a
`#0B0C0E` ground (≈1.3:1 contrast — effectively invisible), accent underlined, and
`--ds-text` with no underline. The rule from here on:

- **A link that is a navigation target** (the thing you click to go somewhere, standing
  on its own) → `ButtonLink`, `variant="ghost"` for secondary, `"primary"` for the
  screen's main action. It gets a 40px hit target from `.btn`.
- **A link inside prose or inside a row of text** → `TextLink`. Accent, no underline at
  rest, underline on hover and focus. No forced min-height, because forcing one inside a
  paragraph wrecks the line box.

**Files:**
- Create: `frontend/src/ui/TextLink.tsx`
- Create: `frontend/src/ui/TextLink.module.css`
- Create: `frontend/src/ui/TextLink.test.tsx`
- Modify: `frontend/src/ui/index.ts`

**Interfaces:**
- Produces: `function TextLink(props: LinkProps): JSX.Element`. Used by Tasks 11, 14, 15, 16.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/ui/TextLink.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { expect, test } from 'vitest';

import { TextLink } from './TextLink';

test('a TextLink routes and carries the link class', () => {
  render(
    <MemoryRouter>
      <TextLink to="/jobs">the job queue</TextLink>
    </MemoryRouter>,
  );
  const link = screen.getByRole('link', { name: 'the job queue' });
  expect(link).toHaveAttribute('href', '/jobs');
  expect(link).toHaveClass('link');
});

test('a caller className is kept', () => {
  render(
    <MemoryRouter>
      <TextLink to="/" className="mine">home</TextLink>
    </MemoryRouter>,
  );
  expect(screen.getByRole('link')).toHaveClass('link', 'mine');
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npm --prefix frontend test -- src/ui/TextLink.test.tsx
```

Expected: FAIL — cannot resolve `./TextLink`.

- [ ] **Step 3: Write the stylesheet**

Create `frontend/src/ui/TextLink.module.css`:

```css
/* The accent is the token's documented job: "focus rings, selected chrome, links".
   No underline at rest -- the app's links sit inside dense rows where a permanent
   underline turns the row into a fence -- but an underline on hover and focus, because
   colour alone must not be the only affordance. */
.link {
  color: var(--ds-accent);
  text-decoration: none;
}

.link:hover,
.link:focus-visible {
  text-decoration: underline;
}
```

- [ ] **Step 4: Write the component**

Create `frontend/src/ui/TextLink.tsx`:

```tsx
import { Link, type LinkProps } from 'react-router-dom';

import styles from './TextLink.module.css';

/**
 * A link inside prose or a text row. A link that stands on its own as a navigation
 * target is a control, not prose -- use ButtonLink so it gets a real hit target.
 */
export function TextLink({ className, ...rest }: LinkProps) {
  return <Link className={[styles.link, className].filter(Boolean).join(' ')} {...rest} />;
}
```

- [ ] **Step 5: Extend the barrel**

Append to `frontend/src/ui/index.ts`:

```ts
export { TextLink } from './TextLink';
```

- [ ] **Step 6: Run the tests and commit**

```bash
npm --prefix frontend test -- src/ui/TextLink.test.tsx
git add frontend/src/ui
git commit -m "feat(ui): TextLink primitive

Three incompatible link treatments today, one of them UA blue on a near-black
ground at about 1.3:1. TextLink is the prose case; ButtonLink is the
navigation-target case."
```

---

## Task 4: Chip

The spec's "State chip" (§5) does three jobs: job state, device badge, and key candidate
with confidence. None exist — job state is bare coloured text, library state is
uppercase mono text, and key candidates are unstyled buttons.

**Files:**
- Create: `frontend/src/ui/Chip.tsx`, `Chip.module.css`, `Chip.test.tsx`
- Modify: `frontend/src/ui/index.ts`

**Interfaces:**
- Produces:
  ```ts
  type ChipTone = 'neutral' | 'ok' | 'warn' | 'error' | 'run';
  function Chip(props: { tone?: ChipTone; size?: 'sm' | 'lg'; dot?: boolean;
                         className?: string; children: ReactNode }): JSX.Element;
  function jobStateTone(state: string): ChipTone;
  ```
  `jobStateTone` is used by Tasks 11, 13 and 16, which all render a job state.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/ui/Chip.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';

import { Chip, jobStateTone } from './Chip';

test('a neutral chip has the base class and no tone class', () => {
  render(<Chip>queued</Chip>);
  const chip = screen.getByText('queued');
  expect(chip).toHaveClass('chip');
  expect(chip).not.toHaveClass('ok', 'warn', 'error', 'run');
});

test.each([
  ['ok', 'ok'],
  ['warn', 'warn'],
  ['error', 'error'],
  ['run', 'run'],
] as const)('tone %s maps to class %s', (tone, cls) => {
  render(<Chip tone={tone}>x</Chip>);
  expect(screen.getByText('x')).toHaveClass('chip', cls);
});

test('a dot chip renders a decorative dot', () => {
  const { container } = render(<Chip tone="ok" dot>done</Chip>);
  // aria-hidden: the dot repeats the tone, which the text already carries. A screen
  // reader announcing "bullet done" is noise.
  expect(container.querySelector('.dot')).toHaveAttribute('aria-hidden', 'true');
});

test.each([
  ['queued', 'neutral'],
  ['running', 'run'],
  ['done', 'ok'],
  ['failed', 'error'],
  ['cancelled', 'neutral'],
  ['something-new', 'neutral'],
] as const)('job state %s is tone %s', (state, tone) => {
  // Load-bearing: the point of this map is that 'failed' and 'done' can never collide.
  // A default that returned 'ok' would make an unknown state read as success.
  expect(jobStateTone(state)).toBe(tone);
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npm --prefix frontend test -- src/ui/Chip.test.tsx
```

Expected: FAIL — cannot resolve `./Chip`.

- [ ] **Step 3: Write the stylesheet**

Create `frontend/src/ui/Chip.module.css` — a port of the `/* chips / badges */` block:

```css
/* UI spec §5, "State chip": setup tier. queued / running / done / failed / cancelled,
   and the device badge uses the same chip. The tones are vivid system signals (U-01);
   a chip never takes a stem hue. */

.chip {
  display: inline-flex;
  align-items: center;
  gap: var(--ds-2);
  height: 28px;
  padding: 0 var(--ds-3);
  border: 1px solid var(--ds-border-strong);
  border-radius: var(--ds-r-pill);
  background: var(--ds-raised);
  color: var(--ds-text-2);
  font: 600 var(--ds-t-xs) / 1 var(--ds-font);
  white-space: nowrap;
}

.dot {
  width: 8px;
  height: 8px;
  flex: none;
  border-radius: 50%;
  background: currentColor;
}

.ok {
  color: var(--ds-ok);
  border-color: color-mix(in srgb, var(--ds-ok) 40%, transparent);
  background: color-mix(in srgb, var(--ds-ok) 10%, transparent);
}

.warn {
  color: var(--ds-warn);
  border-color: color-mix(in srgb, var(--ds-warn) 40%, transparent);
  background: color-mix(in srgb, var(--ds-warn) 10%, transparent);
}

.error {
  color: var(--ds-error);
  border-color: color-mix(in srgb, var(--ds-error) 40%, transparent);
  background: color-mix(in srgb, var(--ds-error) 10%, transparent);
}

.run {
  color: var(--ds-accent);
  border-color: color-mix(in srgb, var(--ds-accent) 40%, transparent);
  background: color-mix(in srgb, var(--ds-accent) 10%, transparent);
}

.lg {
  height: var(--ds-hit-setup);
  padding: 0 var(--ds-4);
  font-size: var(--ds-t-sm);
}
```

- [ ] **Step 4: Write the component**

Create `frontend/src/ui/Chip.tsx`:

```tsx
import type { ReactNode } from 'react';

import styles from './Chip.module.css';

export type ChipTone = 'neutral' | 'ok' | 'warn' | 'error' | 'run';

const TONE: Record<ChipTone, string | undefined> = {
  neutral: undefined,
  ok: styles.ok,
  warn: styles.warn,
  error: styles.error,
  run: styles.run,
};

export interface ChipProps {
  tone?: ChipTone;
  size?: 'sm' | 'lg';
  dot?: boolean;
  className?: string;
  children: ReactNode;
}

export function Chip({ tone = 'neutral', size = 'sm', dot = false, className, children }: ChipProps) {
  const cls = [styles.chip, TONE[tone], size === 'lg' ? styles.lg : undefined, className]
    .filter(Boolean)
    .join(' ');
  return (
    <span className={cls}>
      {dot && <span className={styles.dot} aria-hidden="true" />}
      {children}
    </span>
  );
}

/**
 * The job states the API emits, mapped to chip tones. Anything unrecognised is
 * neutral: an unknown state must never read as success.
 */
export function jobStateTone(state: string): ChipTone {
  switch (state) {
    case 'running':
      return 'run';
    case 'done':
      return 'ok';
    case 'failed':
      return 'error';
    default:
      return 'neutral';
  }
}
```

- [ ] **Step 5: Extend the barrel, run, commit**

Append to `frontend/src/ui/index.ts`:

```ts
export { Chip, jobStateTone } from './Chip';
export type { ChipProps, ChipTone } from './Chip';
```

```bash
npm --prefix frontend test -- src/ui/Chip.test.tsx
git add frontend/src/ui
git commit -m "feat(ui): Chip primitive and the job-state tone map"
```

---

## Task 5: Banner, carrying the verbatim trace

U-09 says every failure surface shows the real message from the real tool, verbatim, in
mono, copyable. Today the app has four different treatments: AppShell's flat bordered
strip, a bare red `<pre>` on four screens, SongView's one-off `.alert`, and an unstyled
`<p role="alert">` on two more.

**Files:**
- Create: `frontend/src/ui/Banner.tsx`, `Banner.module.css`, `Banner.test.tsx`
- Modify: `frontend/src/ui/index.ts`

**Interfaces:**
- Produces:
  ```ts
  function Banner(props: { tone: 'warn' | 'error'; title?: ReactNode;
                           trace?: string | null; role?: string;
                           className?: string; children?: ReactNode }): JSX.Element;
  ```
  Used by Tasks 10, 11, 12, 13, 14, 15, 16.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/ui/Banner.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';

import { Banner } from './Banner';

test('an error banner is an alert and a warn banner is a status', () => {
  const { rerender } = render(<Banner tone="error">boom</Banner>);
  expect(screen.getByRole('alert')).toHaveClass('banner', 'error');
  rerender(<Banner tone="warn">careful</Banner>);
  expect(screen.getByRole('status')).toHaveClass('banner', 'warn');
});

test('the role can be overridden', () => {
  render(<Banner tone="error" role="status">quiet</Banner>);
  expect(screen.getByRole('status')).toBeInTheDocument();
});

test('the trace is rendered verbatim, whitespace and all', () => {
  // U-09 is the whole point of this component: ffmpeg stderr, yt-dlp stderr and Python
  // tracebacks are only actionable if their line breaks and indentation survive.
  // Load-bearing: this asserts on textContent of the <pre>, not on a normalised
  // string, because getByText collapses whitespace and would pass against a component
  // that rendered the trace into a <p>.
  const trace = 'Traceback (most recent call last):\n  File "x.py", line 3\n    boom\nRuntimeError: no';
  const { container } = render(<Banner tone="error" title="Separation failed" trace={trace} />);
  const pre = container.querySelector('pre');
  expect(pre).not.toBeNull();
  expect(pre!.textContent).toBe(trace);
});

test('no trace element is rendered when there is no trace', () => {
  const { container } = render(<Banner tone="warn">just a note</Banner>);
  expect(container.querySelector('pre')).toBeNull();
});

test('the title renders alongside the body', () => {
  render(<Banner tone="error" title="Import failed">check the URL</Banner>);
  expect(screen.getByText('Import failed')).toBeInTheDocument();
  expect(screen.getByText('check the URL')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npm --prefix frontend test -- src/ui/Banner.test.tsx
```

Expected: FAIL — cannot resolve `./Banner`.

- [ ] **Step 3: Write the stylesheet**

Create `frontend/src/ui/Banner.module.css` — a port of the `/* banners */` block:

```css
/* UI spec §5, "Banner": warn and error, carrying the verbatim trace (U-09). */

.banner {
  display: flex;
  gap: var(--ds-4);
  align-items: flex-start;
  padding: var(--ds-4) var(--ds-5);
  border: 1px solid;
  border-radius: var(--ds-r-panel);
  background: var(--ds-surface);
}

.warn {
  border-color: color-mix(in srgb, var(--ds-warn) 45%, transparent);
  background: color-mix(in srgb, var(--ds-warn) 8%, transparent);
  color: var(--ds-warn);
}

.error {
  border-color: color-mix(in srgb, var(--ds-error) 45%, transparent);
  background: color-mix(in srgb, var(--ds-error) 8%, transparent);
  color: var(--ds-error);
}

.body {
  display: flex;
  flex-direction: column;
  gap: var(--ds-1);
  min-width: 0;
  flex: 1;
}

/* The title takes the tone colour from .banner; the body text returns to --ds-text so
   a long explanation is not read through a saturated hue. */
.title { font-weight: 600; }

.text { color: var(--ds-text); }

/* U-09: verbatim, mono, copyable. `white-space: pre` and its own scroll container so a
   long ffmpeg command line neither wraps into nonsense nor widens the page. */
.trace {
  margin-top: var(--ds-3);
  padding: var(--ds-3);
  border: 1px solid var(--ds-border);
  border-radius: var(--ds-r-input);
  background: var(--ds-ground);
  color: var(--ds-text-2);
  font: 400 var(--ds-t-xs) / 1.6 var(--ds-mono);
  white-space: pre;
  overflow-x: auto;
  user-select: text;
}
```

- [ ] **Step 4: Write the component**

Create `frontend/src/ui/Banner.tsx`:

```tsx
import type { ReactNode } from 'react';

import styles from './Banner.module.css';

export interface BannerProps {
  tone: 'warn' | 'error';
  title?: ReactNode;
  /** U-09: the real message from the real tool. Rendered verbatim, never paraphrased. */
  trace?: string | null;
  role?: string;
  className?: string;
  children?: ReactNode;
}

export function Banner({ tone, title, trace, role, className, children }: BannerProps) {
  const cls = [styles.banner, tone === 'error' ? styles.error : styles.warn, className]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={cls} role={role ?? (tone === 'error' ? 'alert' : 'status')}>
      <div className={styles.body}>
        {title && <p className={styles.title}>{title}</p>}
        {children && <div className={styles.text}>{children}</div>}
        {trace && <pre className={styles.trace}>{trace}</pre>}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Extend the barrel, run, commit**

Append to `frontend/src/ui/index.ts`:

```ts
export { Banner } from './Banner';
export type { BannerProps } from './Banner';
```

```bash
npm --prefix frontend test -- src/ui/Banner.test.tsx
git add frontend/src/ui
git commit -m "feat(ui): Banner primitive carrying the verbatim trace (U-09)"
```

---

## Task 6: TextField

Four files duplicate a field pattern, none of them matching the design system: labels
inherit 18px full-brightness text (spec: 15px/600/`--ds-text-2`), inputs use `--ds-border`
(spec: `--ds-border-strong`), there is no focus treatment, no placeholder colour, and the
input font falls back to Arial 13.33px.

**Files:**
- Create: `frontend/src/ui/TextField.tsx`, `TextField.module.css`, `TextField.test.tsx`
- Modify: `frontend/src/ui/index.ts`

**Interfaces:**
- Produces:
  ```ts
  function TextField(props: InputHTMLAttributes<HTMLInputElement> & {
    id: string; label: ReactNode; hint?: ReactNode; fieldClassName?: string;
  }): JSX.Element;
  ```
  Used by Tasks 12, 14, 16. `id` is required because the label is bound with `htmlFor`
  and every existing screen test queries these inputs with `getByLabelText`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/ui/TextField.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';

import { TextField } from './TextField';

test('the label is bound to the input, so getByLabelText finds it', () => {
  // Load-bearing: Import.test, Export.test and AlbumSplitter.test all reach their
  // inputs through getByLabelText. A field that renders the label as a sibling <span>
  // instead of a bound <label> looks identical and breaks every one of them.
  render(<TextField id="title" label="Title" />);
  expect(screen.getByLabelText('Title')).toHaveClass('input');
});

test('typing reaches the change handler', async () => {
  const onChange = vi.fn();
  render(<TextField id="artist" label="Artist" value="" onChange={onChange} />);
  await userEvent.type(screen.getByLabelText('Artist'), 'CCR');
  expect(onChange).toHaveBeenCalled();
});

test('input attributes pass through', () => {
  render(<TextField id="u" label="URL" type="url" required placeholder="https://…" />);
  const input = screen.getByLabelText('URL');
  expect(input).toHaveAttribute('type', 'url');
  expect(input).toBeRequired();
  expect(input).toHaveAttribute('placeholder', 'https://…');
});

test('a hint renders and is described by the input', () => {
  render(<TextField id="t" label="Title" hint="From the file's tags, if present" />);
  expect(screen.getByLabelText('Title')).toHaveAccessibleDescription(
    "From the file's tags, if present",
  );
});

test('no hint element exists when there is no hint', () => {
  render(<TextField id="t" label="Title" />);
  expect(screen.getByLabelText('Title')).not.toHaveAttribute('aria-describedby');
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npm --prefix frontend test -- src/ui/TextField.test.tsx
```

Expected: FAIL — cannot resolve `./TextField`.

- [ ] **Step 3: Write the stylesheet**

Create `frontend/src/ui/TextField.module.css` — a port of the `/* fields */` block:

```css
/* UI spec §5, "Text field": setup tier. */

.field {
  display: flex;
  flex-direction: column;
  gap: var(--ds-2);
  min-width: 0;
}

.label {
  font-size: var(--ds-t-sm);
  font-weight: 600;
  color: var(--ds-text-2);
}

.input {
  width: 100%;
  height: var(--ds-hit-setup);
  padding: 0 var(--ds-3);
  border: 1px solid var(--ds-border-strong);
  border-radius: var(--ds-r-input);
  background: var(--ds-ground);
  color: var(--ds-text);
  font: 400 var(--ds-t-md) / 1 var(--ds-font);
}

.input::placeholder { color: var(--ds-text-3); }

/* The accent border replaces the global ring here: an outline on a field inside a dense
   form reads as a second border. The colour change is the same signal. */
.input:focus {
  border-color: var(--ds-accent);
  outline: none;
}

.hint {
  font-size: var(--ds-t-sm);
  color: var(--ds-text-3);
}
```

- [ ] **Step 4: Write the component**

Create `frontend/src/ui/TextField.tsx`:

```tsx
import type { InputHTMLAttributes, ReactNode } from 'react';

import styles from './TextField.module.css';

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Required: the label is bound with htmlFor, and screen tests query by label. */
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  /** Class for the wrapper, e.g. a screen's grid-column sizing. */
  fieldClassName?: string;
}

export function TextField({ id, label, hint, fieldClassName, className, ...rest }: TextFieldProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <div className={[styles.field, fieldClassName].filter(Boolean).join(' ')}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className={[styles.input, className].filter(Boolean).join(' ')}
        aria-describedby={hintId}
        {...rest}
      />
      {hint && (
        <p className={styles.hint} id={hintId}>
          {hint}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Extend the barrel, run, commit**

Append to `frontend/src/ui/index.ts`:

```ts
export { TextField } from './TextField';
export type { TextFieldProps } from './TextField';
```

```bash
npm --prefix frontend test -- src/ui/TextField.test.tsx
git add frontend/src/ui
git commit -m "feat(ui): TextField primitive"
```

---

## Task 7: DropZone

Neither Import nor Album splitter has a drop zone — both render a raw
`<input type="file">`. The design system has `.drop`.

**The input stays real.** It is not replaced by a click handler: it is the same
`<input type="file">`, bound to the same label, laid over the zone at `opacity: 0`. That
keeps native click-to-browse, native keyboard operation, and `userEvent.upload(...)` in
the existing Import and AlbumSplitter tests all working unchanged.

**No `accept` attribute.** There is no format whitelist — if ffmpeg decodes it, it is
accepted. `DropZone` takes no `accept` prop, so nobody can add one by habit.

**Files:**
- Create: `frontend/src/ui/DropZone.tsx`, `DropZone.module.css`, `DropZone.test.tsx`
- Modify: `frontend/src/ui/index.ts`

**Interfaces:**
- Produces:
  ```ts
  function DropZone(props: { id: string; label: ReactNode; file: File | null;
                             onFile: (file: File | null) => void;
                             hint?: ReactNode; className?: string }): JSX.Element;
  ```
  Used by Tasks 12 and 16.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/ui/DropZone.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';

import { DropZone } from './DropZone';

const mp3 = () => new File(['bytes'], 'song.mp3', { type: 'audio/mpeg' });

test('choosing a file through the input reports it', async () => {
  const onFile = vi.fn();
  render(<DropZone id="f" label="Audio or video file" file={null} onFile={onFile} />);
  await userEvent.upload(screen.getByLabelText('Audio or video file'), mp3());
  expect(onFile).toHaveBeenCalledWith(expect.objectContaining({ name: 'song.mp3' }));
});

test('dropping a file reports it and cancels the browser default', () => {
  // Without preventDefault on drop the browser navigates away to the dropped file,
  // which loses the whole page. That is the bug this asserts against, and it is
  // invisible in jsdom unless the call is checked directly.
  const onFile = vi.fn();
  const { container } = render(<DropZone id="f" label="File" file={null} onFile={onFile} />);
  const zone = container.querySelector('.drop')!;
  const dropEvent = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(dropEvent, 'dataTransfer', { value: { files: [mp3()] } });

  fireEvent(zone, dropEvent);

  expect(onFile).toHaveBeenCalledWith(expect.objectContaining({ name: 'song.mp3' }));
  expect(dropEvent.defaultPrevented).toBe(true);
});

test('dragging over marks the zone and leaving unmarks it', () => {
  const { container } = render(<DropZone id="f" label="File" file={null} onFile={vi.fn()} />);
  const zone = container.querySelector('.drop')!;
  fireEvent.dragOver(zone, { dataTransfer: { files: [] } });
  expect(zone).toHaveAttribute('data-over', 'true');
  fireEvent.dragLeave(zone);
  expect(zone).toHaveAttribute('data-over', 'false');
});

test('the chosen file name is shown instead of the prompt', () => {
  render(<DropZone id="f" label="File" file={mp3()} onFile={vi.fn()} />);
  expect(screen.getByText('song.mp3')).toBeInTheDocument();
  expect(screen.queryByText(/drop a file here/i)).toBeNull();
});

test('the input carries no accept filter', () => {
  // There is no format whitelist -- if ffmpeg decodes it, it is accepted. An accept
  // filter would silently hide video containers the pipeline handles fine.
  render(<DropZone id="f" label="File" file={null} onFile={vi.fn()} />);
  expect(screen.getByLabelText('File')).not.toHaveAttribute('accept');
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npm --prefix frontend test -- src/ui/DropZone.test.tsx
```

Expected: FAIL — cannot resolve `./DropZone`.

- [ ] **Step 3: Write the stylesheet**

Create `frontend/src/ui/DropZone.module.css`:

```css
/* UI spec §5, "drop zone": setup tier. Ported from the design system's .drop. */

.field {
  display: flex;
  flex-direction: column;
  gap: var(--ds-2);
  min-width: 0;
}

.label {
  font-size: var(--ds-t-sm);
  font-weight: 600;
  color: var(--ds-text-2);
}

.drop {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--ds-2);
  padding: var(--ds-8) var(--ds-5);
  border: 2px dashed var(--ds-border-strong);
  border-radius: var(--ds-r-panel);
  background: rgb(255 255 255 / 1.5%);
  color: var(--ds-text-2);
  text-align: center;
  transition: border-color var(--ds-m-flip) var(--ds-ease),
    background var(--ds-m-flip) var(--ds-ease);
}

.drop[data-over='true'] {
  border-color: var(--ds-accent);
  background: color-mix(in srgb, var(--ds-accent) 8%, transparent);
}

/* The real <input type="file"> covers the zone at zero opacity: native click-to-browse
   and native keyboard operation, no JS click forwarding, and the label stays bound to
   an element that is genuinely the input. */
.input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: pointer;
}

/* The global :focus-visible ring lands on an invisible element, so the zone wears it. */
.drop:has(.input:focus-visible) {
  outline: 2px solid var(--ds-accent);
  outline-offset: 2px;
}

.primary {
  font-size: var(--ds-t-md);
  color: var(--ds-text);
}

.hint {
  font-size: var(--ds-t-sm);
  color: var(--ds-text-3);
}
```

- [ ] **Step 4: Write the component**

Create `frontend/src/ui/DropZone.tsx`:

```tsx
import { useState, type DragEvent, type ReactNode } from 'react';

import styles from './DropZone.module.css';

export interface DropZoneProps {
  id: string;
  label: ReactNode;
  file: File | null;
  onFile: (file: File | null) => void;
  hint?: ReactNode;
  className?: string;
}

/**
 * A file drop zone wrapping a real <input type="file">.
 *
 * There is deliberately no `accept` prop: there is no format whitelist in this app --
 * whatever ffmpeg decodes is accepted -- and an accept filter would hide valid files
 * from the picker.
 */
export function DropZone({ id, label, file, onFile, hint, className }: DropZoneProps) {
  const [over, setOver] = useState(false);

  function take(files: FileList | File[] | null) {
    const list = files ? Array.from(files) : [];
    onFile(list.length > 0 ? list[0]! : null);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    // Without this the browser navigates to the dropped file and the page is gone.
    event.preventDefault();
    setOver(false);
    take(event.dataTransfer?.files ?? null);
  }

  return (
    <div className={[styles.field, className].filter(Boolean).join(' ')}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      <div
        className={styles.drop}
        data-over={over}
        onDragOver={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={handleDrop}
      >
        <input
          id={id}
          className={styles.input}
          type="file"
          onChange={(event) => take(event.target.files)}
        />
        <p className={styles.primary}>{file ? file.name : 'Drop a file here, or choose one'}</p>
        {hint && <p className={styles.hint}>{hint}</p>}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Extend the barrel, run, commit**

Append to `frontend/src/ui/index.ts`:

```ts
export { DropZone } from './DropZone';
export type { DropZoneProps } from './DropZone';
```

```bash
npm --prefix frontend test -- src/ui/DropZone.test.tsx
git add frontend/src/ui
git commit -m "feat(ui): DropZone primitive

Import and Album splitter both render a raw file input today. The real input
is kept, laid over the zone at zero opacity, so native browse, keyboard
operation and the existing getByLabelText/upload tests all keep working. No
accept attribute: there is no format whitelist."
```

---

## Task 8: Segmented, and the U-01 violation it fixes

`ScaleSheet.module.css` paints pressed segmented buttons `--ds-bass`. U-01 is explicit:
a lit control is chrome and takes the accent, **never** a stem hue. SongView's Transport
and RightRail already do it correctly with accent — so the app currently contradicts
itself about what a selected control looks like.

**Files:**
- Create: `frontend/src/ui/Segmented.tsx`, `Segmented.module.css`, `Segmented.test.tsx`
- Modify: `frontend/src/ui/index.ts`

**Interfaces:**
- Produces:
  ```ts
  interface SegmentedOption<T extends string> { value: T; label: ReactNode }
  function Segmented<T extends string>(props: {
    label: string; value: T; options: readonly SegmentedOption<T>[];
    onChange: (value: T) => void; className?: string;
  }): JSX.Element;
  ```
  Used by Tasks 14 and 15.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/ui/Segmented.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';

import { Segmented } from './Segmented';

const OPTIONS = [
  { value: 'bass', label: 'Bass · 4 string' },
  { value: 'guitar', label: 'Guitar · 6 string' },
] as const;

test('the selected option is the pressed one and the others are not', () => {
  render(<Segmented label="Instrument" value="bass" options={OPTIONS} onChange={vi.fn()} />);
  expect(screen.getByRole('button', { name: /bass/i })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('button', { name: /guitar/i })).toHaveAttribute('aria-pressed', 'false');
});

test('clicking an option reports its value', async () => {
  const onChange = vi.fn();
  render(<Segmented label="Instrument" value="bass" options={OPTIONS} onChange={onChange} />);
  await userEvent.click(screen.getByRole('button', { name: /guitar/i }));
  expect(onChange).toHaveBeenCalledWith('guitar');
});

test('the group carries its accessible name', () => {
  render(<Segmented label="Instrument" value="bass" options={OPTIONS} onChange={vi.fn()} />);
  expect(screen.getByRole('group', { name: 'Instrument' })).toBeInTheDocument();
});

test('the options are type=button so a segmented control inside a form cannot submit it', () => {
  render(<Segmented label="Format" value="bass" options={OPTIONS} onChange={vi.fn()} />);
  for (const button of screen.getAllByRole('button')) {
    expect(button).toHaveAttribute('type', 'button');
  }
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npm --prefix frontend test -- src/ui/Segmented.test.tsx
```

Expected: FAIL — cannot resolve `./Segmented`.

- [ ] **Step 3: Write the stylesheet**

Create `frontend/src/ui/Segmented.module.css` — a port of the `/* segmented */` block,
with the pressed state corrected to accent:

```css
/* UI spec §5, "segmented": setup tier.

   U-01, stated plainly because the app got this wrong once: the selected segment is
   ACCENT. It is chrome. It must never take --ds-bass or any other stem hue, even on a
   screen that is about the bass -- the muted stem hues identify a stem, and they appear
   only where a stem is named. */

.seg {
  display: inline-flex;
  gap: 3px;
  padding: 3px;
  border: 1px solid var(--ds-border-strong);
  border-radius: var(--ds-r-btn);
  background: var(--ds-ground);
}

.item {
  min-height: 34px;
  padding: 0 var(--ds-4);
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--ds-text-2);
  font: 600 var(--ds-t-sm) / 1 var(--ds-font);
  cursor: pointer;
  transition: background var(--ds-m-flip) var(--ds-ease);
}

.item:hover { color: var(--ds-text); }

.item[aria-pressed='true'] {
  background: var(--ds-accent);
  color: var(--ds-on-accent);
}
```

> **Note on the 34px item height.** `.seg` has 3px padding and a 1px border on each
> side, so a 34px item yields a 42px control — above the 40px setup tier. The item
> itself is not the hit target; the segment including its padding is. This matches the
> design system source exactly.

- [ ] **Step 4: Write the component**

Create `frontend/src/ui/Segmented.tsx`:

```tsx
import type { ReactNode } from 'react';

import styles from './Segmented.module.css';

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
}

export interface SegmentedProps<T extends string> {
  /** Accessible name for the group, e.g. "Instrument". */
  label: string;
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange: (value: T) => void;
  className?: string;
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
}: SegmentedProps<T>) {
  return (
    <div className={[styles.seg, className].filter(Boolean).join(' ')} role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={styles.item}
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Extend the barrel, run, commit**

Append to `frontend/src/ui/index.ts`:

```ts
export { Segmented } from './Segmented';
export type { SegmentedOption, SegmentedProps } from './Segmented';
```

```bash
npm --prefix frontend test -- src/ui/Segmented.test.tsx
git add frontend/src/ui
git commit -m "feat(ui): Segmented primitive with the accent pressed state (U-01)"
```

---

## Task 9: Panel, ProgressBar, EmptyState, Table

Four small surfaces, one task: a reviewer would accept or reject them together, and none
carries enough logic to earn its own cycle.

**Files:**
- Create: `frontend/src/ui/Panel.tsx`, `Panel.module.css`
- Create: `frontend/src/ui/ProgressBar.tsx`, `ProgressBar.module.css`
- Create: `frontend/src/ui/EmptyState.tsx`, `EmptyState.module.css`
- Create: `frontend/src/ui/Table.tsx`, `Table.module.css`
- Create: `frontend/src/ui/surfaces.test.tsx`
- Modify: `frontend/src/ui/index.ts`

**Interfaces:**
- Produces:
  ```ts
  function Panel(props: { className?: string; children: ReactNode }): JSX.Element;
  function ProgressBar(props: { value: number; label: string;
                                tone?: 'default' | 'ok' | 'error';
                                className?: string }): JSX.Element;
  function EmptyState(props: { title: ReactNode; className?: string;
                               children?: ReactNode }): JSX.Element;
  function Table(props: { className?: string; children: ReactNode }): JSX.Element;
  ```
  `value` is 0..1, not 0..100. Used by Tasks 11–16.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/ui/surfaces.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';

import { EmptyState, Panel, ProgressBar, Table } from './index';

test('a panel wraps its children', () => {
  render(<Panel>inside</Panel>);
  expect(screen.getByText('inside')).toBeInTheDocument();
});

test('a progress bar reports its percentage to assistive tech', () => {
  render(<ProgressBar value={0.42} label="Separation" />);
  const bar = screen.getByRole('progressbar', { name: 'Separation' });
  expect(bar).toHaveAttribute('aria-valuenow', '42');
  expect(bar).toHaveAttribute('aria-valuemin', '0');
  expect(bar).toHaveAttribute('aria-valuemax', '100');
});

test.each([
  [-0.5, '0'],
  [1.5, '100'],
])('a progress value of %s clamps to %s', (value, expected) => {
  // Load-bearing: job progress arrives from the worker and has been observed slightly
  // over 1.0 on a finishing job. Unclamped, the fill overflows its rounded container
  // and paints a square corner -- a visual artefact nobody would trace back to a
  // number. Clamping is asserted here rather than assumed.
  render(<ProgressBar value={value} label="Job" />);
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', expected);
});

test.each([
  ['ok', 'ok'],
  ['error', 'error'],
] as const)('progress tone %s maps to class %s', (tone, cls) => {
  render(<ProgressBar value={1} label="Job" tone={tone} />);
  expect(screen.getByRole('progressbar')).toHaveClass('bar', cls);
});

test('an empty state renders a title and an optional action', () => {
  render(<EmptyState title="No songs yet"><span>import one</span></EmptyState>);
  expect(screen.getByText('No songs yet')).toBeInTheDocument();
  expect(screen.getByText('import one')).toBeInTheDocument();
});

test('a table renders as a table', () => {
  render(
    <Table>
      <tbody><tr><td>cell</td></tr></tbody>
    </Table>,
  );
  expect(screen.getByRole('table')).toHaveClass('tbl');
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npm --prefix frontend test -- src/ui/surfaces.test.tsx
```

Expected: FAIL — `Panel`, `ProgressBar`, `EmptyState`, `Table` are not exported from
`./index`.

- [ ] **Step 3: Write the four stylesheets**

`frontend/src/ui/Panel.module.css`:

```css
/* U-08: depth is a surface step plus a 1px border, never a drop shadow. */
.panel {
  padding: var(--ds-5);
  border: 1px solid var(--ds-border);
  border-radius: var(--ds-r-panel);
  background: var(--ds-surface);
}
```

`frontend/src/ui/ProgressBar.module.css`:

```css
/* UI spec §5, "Progress bar, job row": setup tier. The 400ms is --ds-m-progress and is
   zeroed by the prefers-reduced-motion block in tokens.css. This is not a playhead:
   U-05 forbids CSS-driven motion for the playhead only. */
.bar {
  height: 6px;
  border: 1px solid var(--ds-border);
  border-radius: var(--ds-r-pill);
  background: var(--ds-ground);
  overflow: hidden;
}

.fill {
  display: block;
  height: 100%;
  background: var(--ds-accent);
  transition: width var(--ds-m-progress) linear;
}

.ok .fill { background: var(--ds-ok); }
.error .fill { background: var(--ds-error); }
```

`frontend/src/ui/EmptyState.module.css`:

```css
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--ds-4);
  padding: var(--ds-9) var(--ds-5);
  color: var(--ds-text-2);
  text-align: center;
}

.title {
  font-size: var(--ds-t-lg);
  line-height: var(--ds-lh-lg);
  color: var(--ds-text);
}
```

`frontend/src/ui/Table.module.css`:

```css
/* UI spec §5, "Table": setup tier, and the only place --ds-t-xs (13px) is permitted. */
.tbl {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--ds-t-sm);
}

.tbl th {
  padding: var(--ds-2) var(--ds-3);
  border-bottom: 1px solid var(--ds-border);
  font-size: var(--ds-t-xs);
  font-weight: 700;
  text-align: left;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--ds-text-3);
  white-space: nowrap;
}

.tbl td {
  height: var(--ds-hit-setup);
  padding: var(--ds-3);
  border-bottom: 1px solid var(--ds-border);
  vertical-align: middle;
}

.tbl tr:last-child td { border-bottom: 0; }

.tbl tbody tr:hover { background: var(--ds-raised); }
```

- [ ] **Step 4: Write the four components**

`frontend/src/ui/Panel.tsx`:

```tsx
import type { ReactNode } from 'react';

import styles from './Panel.module.css';

export function Panel({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={[styles.panel, className].filter(Boolean).join(' ')}>{children}</div>;
}
```

`frontend/src/ui/ProgressBar.tsx`:

```tsx
import styles from './ProgressBar.module.css';

export interface ProgressBarProps {
  /** 0..1. Values outside the range are clamped. */
  value: number;
  label: string;
  tone?: 'default' | 'ok' | 'error';
  className?: string;
}

export function ProgressBar({ value, label, tone = 'default', className }: ProgressBarProps) {
  // Job progress comes off the wire and is not guaranteed to be in range; an unclamped
  // fill overflows its rounded container.
  const fraction = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  const percent = Math.round(fraction * 100);
  const toneClass = tone === 'ok' ? styles.ok : tone === 'error' ? styles.error : undefined;
  return (
    <div
      className={[styles.bar, toneClass, className].filter(Boolean).join(' ')}
      role="progressbar"
      aria-label={label}
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <i className={styles.fill} style={{ width: `${percent}%` }} />
    </div>
  );
}
```

`frontend/src/ui/EmptyState.tsx`:

```tsx
import type { ReactNode } from 'react';

import styles from './EmptyState.module.css';

export function EmptyState({
  title,
  className,
  children,
}: {
  title: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div className={[styles.empty, className].filter(Boolean).join(' ')}>
      <p className={styles.title}>{title}</p>
      {children}
    </div>
  );
}
```

`frontend/src/ui/Table.tsx`:

```tsx
import type { ReactNode } from 'react';

import styles from './Table.module.css';

export function Table({ className, children }: { className?: string; children: ReactNode }) {
  return <table className={[styles.tbl, className].filter(Boolean).join(' ')}>{children}</table>;
}
```

- [ ] **Step 5: Extend the barrel**

Append to `frontend/src/ui/index.ts`:

```ts
export { EmptyState } from './EmptyState';
export { Panel } from './Panel';
export { ProgressBar } from './ProgressBar';
export type { ProgressBarProps } from './ProgressBar';
export { Table } from './Table';
```

- [ ] **Step 6: Run the tests and commit**

```bash
npm --prefix frontend test -- src/ui/surfaces.test.tsx
npm --prefix frontend run typecheck
git add frontend/src/ui
git commit -m "feat(ui): Panel, ProgressBar, EmptyState and Table primitives"
```

---

## Task 10: AppShell

The nav links have no accent affordance and the two dependency banners are hand-rolled
strips that do not match `Banner`. The brand and 64px topbar are Layer 2 and stay out.

**Files:**
- Modify: `frontend/src/app/AppShell.tsx`
- Modify: `frontend/src/app/AppShell.module.css`
- Modify: `frontend/src/app/routes.test.tsx` — only if it asserts on the banner markup

**Interfaces:**
- Consumes: `Banner` (Task 5).

- [ ] **Step 1: Check what the existing tests pin**

```bash
grep -n "banner\|role=\|alert\|status\|CPU\|Running separation" frontend/src/app/routes.test.tsx
```

Read the results before editing. The banners currently carry `role="alert"` and
`role="status"`; `Banner` produces the same roles by default, so tests querying by role
should survive untouched. Do not change a test that still passes.

- [ ] **Step 2: Replace the hand-rolled banners**

In `frontend/src/app/AppShell.tsx`, add the import:

```tsx
import { Banner } from '../ui';
```

Replace the dependency block:

```tsx
      {/* N-08: a missing dependency is visible, named, and quotes the real error. */}
      {broken.length > 0 && (
        <Banner
          className={styles.notice}
          tone="error"
          title={broken.length === 1 ? 'A dependency is not usable' : 'Dependencies are not usable'}
          trace={broken.map((dep) => `${dep.name}: ${dep.detail}`).join('\n')}
        />
      )}

      {broken.length === 0 && health.data?.device === 'cpu' && (
        <Banner className={styles.notice} tone="warn" title="Running separation on CPU">
          {health.data.fallback_reason ? `${health.data.fallback_reason}. ` : ''}
          This is slower than GPU (N-01).
        </Banner>
      )}
```

- [ ] **Step 3: Update the shell stylesheet**

In `frontend/src/app/AppShell.module.css`:

- Delete the `.banner` and `.bannerWarn` rules entirely — `Banner` owns that now.
- Add `.notice` for placement:

```css
/* The banners are full-bleed under the nav, so they get the main padding back. */
.notice {
  margin: var(--ds-4) var(--ds-4) 0;
}
```

- Replace the `.link` / `.active` pair so the active tab reads as chrome:

```css
.link,
.active {
  display: flex;
  align-items: center;
  min-height: var(--ds-hit-setup);
  padding: 0 var(--ds-3);
  border-radius: var(--ds-r-btn);
  color: var(--ds-text-2);
  font: 600 var(--ds-t-sm) / 1 var(--ds-font);
  text-decoration: none;
  transition: background var(--ds-m-flip) var(--ds-ease), color var(--ds-m-flip) var(--ds-ease);
}

.link:hover {
  background: var(--ds-raised);
  color: var(--ds-text);
}

/* The selected tab is chrome, so the marker is the accent (U-01). A left-to-right row
   of tabs needs a shape cue too, not just a hue -- the inset bottom border is it. */
.active {
  background: var(--ds-raised);
  box-shadow: inset 0 -2px 0 var(--ds-accent);
  color: var(--ds-text);
}
```

- Give `.main` the screen rhythm now that headings carry no margin:

```css
.main {
  display: flex;
  flex-direction: column;
  gap: var(--ds-5);
  padding: var(--ds-5);
}
```

- [ ] **Step 4: Run the suite**

```bash
npm --prefix frontend test
```

Expected: PASS. If a routes test fails on banner text, the wording changed — reconcile
the test to the new wording only after confirming the wording is the thing that moved,
not the role.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app
git commit -m "refactor(ui): AppShell uses Banner and an accent active tab"
```

---

## Task 11: Library

Everything the audit found on this screen: "New Song" renders as UA blue underlined text
(≈1.3:1 on the ground) where it is the landing screen's primary action; "Scale &
fretboard" is the same blue at a 23px hit target, below the 32px floor; Delete is a 21px
UA button with error-red text on light grey; the unreadable-song error is a bare `<pre>`;
"No songs yet." is a bare `<p>`; and `state` is uppercase mono text where the spec asks
for a badge.

**Files:**
- Modify: `frontend/src/screens/Library.tsx`
- Modify: `frontend/src/screens/Library.module.css`
- Modify: `frontend/src/screens/Library.test.tsx` — only if a query breaks

**Interfaces:**
- Consumes: `Banner`, `Button`, `ButtonLink`, `Chip`, `EmptyState` and the `ChipTone`
  type (Task 4). **Not** `jobStateTone`: the library's `entry.state` is a *song* state
  (`imported`/`separated`/`analyzed`) derived from which files exist, not a job state, so
  it gets its own map defined below.

- [ ] **Step 1: Read the existing test first**

```bash
cat frontend/src/screens/Library.test.tsx
```

Note every query it uses. The conversion must keep each one resolving. In particular
`Delete` must stay a `button` role with the same accessible name, and the song title
must stay a `link`.

- [ ] **Step 2: Convert the screen**

`frontend/src/screens/Library.tsx` — replace the imports and the returned JSX:

```tsx
import { Link } from 'react-router-dom';

import type { SongEntry } from '../api/client';
import { useDeleteSong, useSongs } from '../api/queries';
import { Banner, Button, ButtonLink, Chip, EmptyState, type ChipTone } from '../ui';
import styles from './Library.module.css';
```

Add the song-state tone map above the component:

```tsx
// Song state is derived from which files exist (CLAUDE.md: "Prefer deriving state over
// storing it"), so these are the only three values. 'analyzed' is the finished state and
// takes the ok tone; the two intermediate states are neutral, because a song that is
// merely imported is not a warning.
const STATE_TONE: Record<string, ChipTone> = {
  imported: 'neutral',
  separated: 'neutral',
  analyzed: 'ok',
};
```

Replace the returned JSX with:

```tsx
  return (
    <section className={styles.screen}>
      <div className={styles.header}>
        <h1>Library</h1>
        <ButtonLink variant="primary" to="/import">
          New Song
        </ButtonLink>
      </div>

      {songs.isError && (
        <Banner tone="error" title="The library could not be listed" trace={String(songs.error)} />
      )}

      {songs.data?.length === 0 && (
        <EmptyState title="No songs yet.">
          <ButtonLink variant="primary" to="/import">
            Import your first song
          </ButtonLink>
        </EmptyState>
      )}

      <ul className={styles.grid}>
        {entries.map((entry) => (
          <li key={entry.dir} className={styles.card}>
            {entry.song ? (
              <>
                {/* The Song view is one click from the card. It renders its
                    own explanation for a song that has no stems yet, so the
                    link is not gated on state. */}
                <Link className={styles.title} to={`/songs/${entry.song.id}`}>
                  {entry.song.title}
                </Link>
                <span className={styles.artist}>{entry.song.artist}</span>
                <Chip tone={STATE_TONE[entry.state] ?? 'neutral'} dot>
                  {entry.state}
                </Chip>
                {entry.state === 'analyzed' && (
                  <ButtonLink
                    className={styles.scale}
                    variant="ghost"
                    to={`/songs/${entry.song.id}/scale`}
                  >
                    Scale &amp; fretboard
                  </ButtonLink>
                )}
              </>
            ) : (
              <>
                <span className={styles.title}>{entry.dir}</span>
                {/* §9: one bad file never breaks the library -- shown, not hidden. */}
                <Banner tone="error" title="This song could not be read" trace={entry.unreadable} />
              </>
            )}
            <Button className={styles.delete} variant="danger" onClick={() => handleDelete(entry)}>
              Delete
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
```

- [ ] **Step 3: Update the stylesheet**

In `frontend/src/screens/Library.module.css`:

- Add the screen rhythm at the top, since headings no longer carry UA margins:

```css
.screen {
  display: flex;
  flex-direction: column;
  gap: var(--ds-5);
}
```

- Change `.grid` — the card grid no longer needs a top margin, `.screen` gap handles it,
  and the cards get a step up in spacing:

```css
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: var(--ds-4);
  margin: 0;
  padding: 0;
  list-style: none;
}
```

- Change `.card` padding and gap:

```css
.card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--ds-2);
  padding: var(--ds-4);
  background: var(--ds-surface);
  border: 1px solid var(--ds-border);
  border-radius: var(--ds-r-panel);
}
```

- Delete `.new` (the ButtonLink owns its size), delete `.state` (Chip owns it), delete
  `.unreadable` (Banner owns it).
- Keep `.title`, `.artist`, `.scale` and `.delete`, but `.scale` and `.delete` lose
  everything the primitives now supply:

```css
.scale,
.delete {
  align-self: flex-start;
}

.delete { margin-top: auto; }
```

- [ ] **Step 4: Run the screen's tests**

```bash
npm --prefix frontend test -- src/screens/Library.test.tsx
```

Expected: PASS unmodified. If the unreadable-song test queried the `<pre>` by text, it
still finds it — `Banner` renders the trace into a `<pre>` too.

- [ ] **Step 5: Add a test for the state chip**

Append to `frontend/src/screens/Library.test.tsx`:

```tsx
test('an analyzed song shows an ok-toned state chip and a separated one does not', async () => {
  // Load-bearing on the tone, not just the text: before the chip existed the state was
  // plain uppercase text, so a test asserting only on the word "analyzed" would have
  // passed against the old markup and proved nothing about this change.
  renderLibrary([
    { dir: 'a-x', state: 'analyzed', song: { id: 'a', title: 'Done', artist: 'X' } },
    { dir: 'b-y', state: 'separated', song: { id: 'b', title: 'Partway', artist: 'Y' } },
  ]);

  expect(await screen.findByText('analyzed')).toHaveClass('chip', 'ok');
  expect(screen.getByText('separated')).toHaveClass('chip');
  expect(screen.getByText('separated')).not.toHaveClass('ok');
});
```

> Adapt `renderLibrary(...)` to whatever helper the existing test file defines — read it
> in Step 1 and reuse it rather than writing a second render helper.

- [ ] **Step 6: Run, then commit**

```bash
npm --prefix frontend test -- src/screens/Library.test.tsx
git add frontend/src/screens/Library.tsx frontend/src/screens/Library.module.css frontend/src/screens/Library.test.tsx
git commit -m "refactor(ui): Library uses the primitive layer

New Song was UA blue at about 1.3:1 on the ground where it is the landing
screen's primary action; Scale & fretboard was the same blue at a 23px hit
target, under the 32px floor; Delete was a 21px UA button."
```

---

## Task 12: Import

**Files:**
- Modify: `frontend/src/screens/Import.tsx`
- Modify: `frontend/src/screens/Import.module.css`

**Interfaces:**
- Consumes: `Banner`, `Button`, `DropZone`, `Panel`, `TextField`.

Note: this task does **not** make Import a modal and does not add the five-step pipeline
display (§6.2). Both are Layer 2, deferred.

- [ ] **Step 1: Convert the screen**

In `frontend/src/screens/Import.tsx`, replace the style/JSX layer. Imports:

```tsx
import { Banner, Button, DropZone, Panel, TextField } from '../ui';
```

Replace the returned JSX:

```tsx
  return (
    <section className={styles.screen}>
      <h1>Import</h1>
      <div className={styles.forms}>
        <Panel className={styles.form}>
          <form className={styles.inner} onSubmit={handleUpload}>
            <h2>From a file</h2>
            <DropZone
              id="upload-file"
              label="Audio or video file"
              file={file}
              onFile={setFile}
              hint="Anything ffmpeg can decode, including video containers."
            />
            <TextField
              id="upload-title"
              label="Title"
              placeholder="From the file's tags, if present"
              value={uploadTitle}
              onChange={(e) => setUploadTitle(e.target.value)}
            />
            <TextField
              id="upload-artist"
              label="Artist"
              value={uploadArtist}
              onChange={(e) => setUploadArtist(e.target.value)}
            />
            <Button
              className={styles.submit}
              type="submit"
              variant="primary"
              disabled={!file || uploadSong.isPending}
            >
              {uploadSong.isPending ? 'Importing…' : 'Import file'}
            </Button>
            {/* N-08: the server's real message, not a generic failure notice. */}
            {uploadSong.isError && (
              <Banner tone="error" title="Import failed" trace={String(uploadSong.error)} />
            )}
          </form>
        </Panel>

        <Panel className={styles.form}>
          <form className={styles.inner} onSubmit={handleUrl}>
            <h2>From a URL</h2>
            <TextField
              id="url-value"
              label="URL"
              type="url"
              placeholder="https://…"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
            <TextField
              id="url-title"
              label="Title"
              required
              hint="A URL import has nothing to probe before the download runs."
              value={urlTitle}
              onChange={(e) => setUrlTitle(e.target.value)}
            />
            <TextField
              id="url-artist"
              label="Artist"
              value={urlArtist}
              onChange={(e) => setUrlArtist(e.target.value)}
            />
            <Button
              className={styles.submit}
              type="submit"
              variant="primary"
              disabled={!url || !urlTitle || urlSong.isPending}
            >
              {urlSong.isPending ? 'Importing…' : 'Import from URL'}
            </Button>
            {urlSong.isError && (
              <Banner tone="error" title="Import failed" trace={String(urlSong.error)} />
            )}
          </form>
        </Panel>
      </div>
    </section>
  );
```

- [ ] **Step 2: Rewrite the stylesheet**

Replace the whole of `frontend/src/screens/Import.module.css`:

```css
.screen {
  display: flex;
  flex-direction: column;
  gap: var(--ds-5);
}

.forms {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: var(--ds-5);
  align-items: start;
}

/* Panel supplies the surface, border, radius and padding; the screen supplies only
   where it sits. */
.form { min-width: 0; }

.inner {
  display: flex;
  flex-direction: column;
  gap: var(--ds-4);
}

.submit { align-self: flex-start; }
```

- [ ] **Step 3: Run the screen's tests**

```bash
npm --prefix frontend test -- src/screens/Import.test.tsx
```

Expected: PASS unmodified. `userEvent.upload(screen.getByLabelText(/audio or video
file/i), file)` still resolves because `DropZone` keeps a real bound
`<input type="file">`, and `getAllByLabelText(/^title$/i)[0]` still resolves because
`TextField` binds with `htmlFor`.

If the error-message test asserted on `String(uploadSong.error)` appearing as text, it
still passes — `Banner` renders it verbatim into the trace `<pre>`.

- [ ] **Step 4: Add a drop test at the screen level**

Append to `frontend/src/screens/Import.test.tsx`:

```tsx
test('dropping a file on the zone arms the submit button', async () => {
  // The submit is disabled until a file is chosen. Before the drop zone existed the
  // only way to choose one was the file picker, so this asserts the drop path is wired
  // to the same state -- not merely that a dashed border is on screen.
  renderImport(async () => new Response('{}', { status: 201 }));

  const submit = screen.getByRole('button', { name: /import file/i });
  expect(submit).toBeDisabled();

  const zone = document.querySelector('.drop')!;
  const dropEvent = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(dropEvent, 'dataTransfer', {
    value: { files: [new File(['b'], 'dropped.flac', { type: 'audio/flac' })] },
  });
  fireEvent(zone, dropEvent);

  expect(await screen.findByText('dropped.flac')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /import file/i })).toBeEnabled();
});
```

Add `fireEvent` to the existing `@testing-library/react` import in that file.

- [ ] **Step 5: Run and commit**

```bash
npm --prefix frontend test -- src/screens/Import.test.tsx
git add frontend/src/screens/Import.tsx frontend/src/screens/Import.module.css frontend/src/screens/Import.test.tsx
git commit -m "refactor(ui): Import uses DropZone, TextField, Banner and Button

Adds the drop zone the spec calls for (§6.2) -- the screen had a raw file
input -- and fixes disabled submits that rendered dark-on-light, invisible on
the ground. Import is still not a modal; that is Layer 2."
```

---

## Task 13: Job queue

The operational dashboard (§10). Its rows are a grid of `<li>` where the spec asks for a
setup-tier table, job state is bare coloured text where the spec asks for a state chip,
the device is plain text where the spec says the device badge uses the same chip, cancel
is a UA button, and the traceback is a bare `<pre>` where U-09 asks for a real failure
surface. The stats and history panels are Layer 2 and stay out.

**Files:**
- Modify: `frontend/src/screens/JobQueue.tsx`
- Modify: `frontend/src/screens/JobQueue.module.css`
- Modify: `frontend/src/screens/JobQueue.test.tsx` — the row markup changes from `li` to
  `tr`, so any query anchored on list structure must move with it.

**Interfaces:**
- Consumes: `Banner`, `Button`, `Chip`, `EmptyState`, `ProgressBar`, `Table`,
  `jobStateTone`.

- [ ] **Step 1: Read the existing test first**

```bash
cat frontend/src/screens/JobQueue.test.tsx
```

Any `getByRole('listitem')` or `closest('li')` becomes `getByRole('row')` /
`closest('tr')`. Any query by accessible name is unaffected.

- [ ] **Step 2: Convert the screen**

Replace `frontend/src/screens/JobQueue.tsx`:

```tsx
// §10: this is the real operational dashboard. Everything the spec asks the
// queue to expose — state, duration, device, error, traceback — is here.
import { useCancelJob, useEnqueueProbe, useJobs } from '../api/queries';
import type { Job } from '../api/client';
import { Banner, Button, Chip, EmptyState, ProgressBar, Table, jobStateTone } from '../ui';
import styles from './JobQueue.module.css';

function duration(job: Job): string {
  if (job.started_at === null) return '—';
  const end = job.finished_at ?? Date.now() / 1000;
  return `${(end - job.started_at).toFixed(1)} s`;
}

export function JobQueue() {
  const jobs = useJobs();
  const cancel = useCancelJob();
  const probe = useEnqueueProbe();

  return (
    <section className={styles.screen}>
      <div className={styles.header}>
        <h1>Job queue</h1>
        <Button onClick={() => probe.mutate()}>Enqueue probe job</Button>
      </div>

      {jobs.isError && (
        <Banner tone="error" title="The queue could not be listed" trace={String(jobs.error)} />
      )}

      {jobs.data?.length === 0 && <EmptyState title="No jobs yet." />}

      {jobs.data && jobs.data.length > 0 && (
        <Table>
          <thead>
            <tr>
              <th>Kind</th>
              <th>State</th>
              <th>Device</th>
              <th>Duration</th>
              <th className={styles.progressHead}>Progress</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {jobs.data.map((job) => (
              <tr key={job.id}>
                <td>{job.kind}</td>
                <td>
                  <Chip tone={jobStateTone(job.state)} dot>
                    {job.state}
                  </Chip>
                </td>
                <td>{job.device ? <Chip>{job.device}</Chip> : <span className="dim3">—</span>}</td>
                {/* U-04: a ticking duration must not jitter. */}
                <td className="num">{duration(job)}</td>
                <td>
                  <ProgressBar
                    value={job.progress}
                    label={`${job.kind} progress`}
                    tone={job.state === 'failed' ? 'error' : job.state === 'done' ? 'ok' : 'default'}
                  />
                </td>
                <td className={styles.actions}>
                  {(job.state === 'queued' || job.state === 'running') && (
                    <Button variant="danger" onClick={() => cancel.mutate(job.id)}>
                      Cancel
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      {/* U-09: a failed job's traceback is the thing the queue exists to show, and it
          needs the full row width -- it does not fit in a table cell. */}
      {jobs.data
        ?.filter((job) => job.error)
        .map((job) => (
          <Banner
            key={`error-${job.id}`}
            tone="error"
            title={`${job.kind} job ${job.id} failed`}
            trace={job.error}
          />
        ))}
    </section>
  );
}
```

- [ ] **Step 3: Rewrite the stylesheet**

Replace the whole of `frontend/src/screens/JobQueue.module.css`:

```css
.screen {
  display: flex;
  flex-direction: column;
  gap: var(--ds-5);
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--ds-4);
}

/* Progress takes the slack; everything else is sized by its content. */
.progressHead { width: 30%; }

.actions { text-align: right; }
```

- [ ] **Step 4: Fix the test's structural queries and run**

```bash
npm --prefix frontend test -- src/screens/JobQueue.test.tsx
```

Fix only what the row-element change breaks. Do not weaken an assertion to make it pass
— if a test asserted the traceback text appears, it must still assert that.

- [ ] **Step 5: Add a state-chip test**

Append to `frontend/src/screens/JobQueue.test.tsx`:

```tsx
test('a failed job and a done job never share a chip tone', async () => {
  // U-01's whole reason for splitting the palette by saturation is that "drums red"
  // and "failed red" must not collide. The weaker version of this test -- asserting
  // the words "failed" and "done" are on screen -- passed against the old bare-text
  // markup and would pass against a queue that painted both green.
  renderQueue([
    { id: 1, kind: 'separate', state: 'failed', progress: 1, device: 'cuda', error: 'boom' },
    { id: 2, kind: 'analyze', state: 'done', progress: 1, device: 'cuda', error: null },
  ]);

  expect(await screen.findByText('failed')).toHaveClass('chip', 'error');
  expect(screen.getByText('done')).toHaveClass('chip', 'ok');
});
```

> Adapt `renderQueue(...)` and the `Job` shape to the helper and fixtures the existing
> file already defines.

- [ ] **Step 6: Run and commit**

```bash
npm --prefix frontend test -- src/screens/JobQueue.test.tsx
git add frontend/src/screens/JobQueue.tsx frontend/src/screens/JobQueue.module.css frontend/src/screens/JobQueue.test.tsx
git commit -m "refactor(ui): Job queue is a table of chips, progress bars and banners

The spec asks for a setup-tier table (§5) and a state chip; the screen had a
grid of <li> with bare coloured text and a UA cancel button. Tracebacks move
into Banner, which gives them the full width and a copyable mono block (U-09)."
```

---

## Task 14: Export

**Files:**
- Modify: `frontend/src/screens/Export.tsx`
- Modify: `frontend/src/screens/Export.module.css`

**Interfaces:**
- Consumes: `Banner`, `Button`, `Panel`, `ProgressBar`, `Segmented`, `TextField`,
  `TextLink`.

- [ ] **Step 1: Read the screen and its test**

```bash
cat frontend/src/screens/Export.tsx
cat frontend/src/screens/Export.test.tsx
```

The screen has a format control and an "as practiced" vs "original" radio pair. The
format control is a `.format` div today; the radio pair is a pair of `.radio` rows.

- [ ] **Step 2: Convert, in this order**

1. `<Link className={styles.link} …>` → `<TextLink …>` for the two in-prose links (back
   to the song, and to the job queue). Delete `.link` from the stylesheet.
2. The submit `<button className={styles.submit}>` → `<Button type="submit"
   variant="primary" className={styles.submit}>`. Keep the class only for
   `align-self: flex-start`.
3. `.group` blocks → `<Panel className={styles.group}>`; strip the surface, border,
   radius and padding from `.group`, leaving only its flex layout.
4. The filename `<input>` inside `.field` → `<TextField id="export-name" label="File
   name" … fieldClassName={styles.field} />`; delete `.field input` from the stylesheet.
5. The "as practiced" / "original" choice → `<Segmented label="Mix" value={…}
   options={[{value:'practiced', label:'As practiced'}, {value:'original', label:'Original'}]}
   onChange={…} />`, **only if** the existing test does not query it by radio role. If it
   does, leave the radios and style them instead — a segmented control is not a radio
   group to assistive tech, and changing that is a behaviour change, not a styling one.
   Check first:

```bash
grep -n "radio\|getByRole" frontend/src/screens/Export.test.tsx
```

6. `<p className={styles.error}>` → `<Banner tone="error" title="Export failed"
   trace={String(…)} />`. Delete `.error`.
7. `.banner` (the D-10 "will not sound identical" notice) is **not** a failure — it is
   an explanation that must not look like one. Keep it as its own styled block, but move
   it to `<Panel className={styles.notice}>` and leave the copy untouched.
8. `.progress` → `<ProgressBar value={…} label="Export" className={styles.progress} />`.
9. The exports list rows keep `.exportRow`, but their download `<a>` stays a plain
   anchor (it is a real file download, not a route) — give it the `TextLink` look by
   adding to the stylesheet:

```css
.download {
  color: var(--ds-accent);
  text-decoration: none;
}

.download:hover,
.download:focus-visible { text-decoration: underline; }
```

- [ ] **Step 3: Add the screen rhythm**

At the top of `frontend/src/screens/Export.module.css`, change `.screen`:

```css
.screen {
  display: flex;
  flex-direction: column;
  gap: var(--ds-5);
  max-width: 640px;
}
```

- [ ] **Step 4: Run and commit**

```bash
npm --prefix frontend test -- src/screens/Export.test.tsx
npm --prefix frontend run typecheck
git add frontend/src/screens/Export.tsx frontend/src/screens/Export.module.css
git commit -m "refactor(ui): Export uses the primitive layer"
```

---

## Task 15: Scale & fretboard, and the U-01 fix

This screen carries the plan's one outright spec violation: pressed segmented buttons
and the selected key-candidate button are painted `--ds-bass`. A lit control is chrome
and takes the accent. `--ds-bass` may stay in exactly one place on this screen — the
fretboard's root-note dots in `Fretboard.module.css` — because that is where a stem is
named. Everything else moves to accent.

Also: the "← Back" link has no class at all, so it renders UA blue at ≈1.3:1.

**Files:**
- Modify: `frontend/src/screens/ScaleSheet.tsx`
- Modify: `frontend/src/screens/ScaleSheet.module.css`
- Modify: `frontend/src/screens/ScaleSheet.test.tsx` — only if a query breaks

**Interfaces:**
- Consumes: `Banner`, `Button`, `ButtonLink`, `Chip`, `Panel`, `Segmented`.

- [ ] **Step 1: Read the existing test first**

```bash
grep -n "aria-pressed\|getByRole\|getByText" frontend/src/screens/ScaleSheet.test.tsx
```

`Segmented` renders `<button aria-pressed>` exactly as the screen does today, so
role-and-pressed queries survive. Confirm before editing.

- [ ] **Step 2: Convert the screen**

In `frontend/src/screens/ScaleSheet.tsx`:

```tsx
import { Banner, Button, ButtonLink, Panel, Segmented } from '../ui';
```

Replace the back link:

```tsx
        <ButtonLink variant="ghost" to={`/songs/${songId}`}>
          &larr; Back
        </ButtonLink>
```

Replace the instrument buttons with the primitive:

```tsx
        <Segmented
          className={styles.seg}
          label="Instrument"
          value={instrument}
          options={[
            { value: 'bass', label: 'Bass · 4 string' },
            { value: 'guitar', label: 'Guitar · 6 string' },
          ]}
          onChange={setInstrument}
        />
```

Replace the full-scale/pentatonic pair the same way:

```tsx
            <Segmented
              label="Scale shape"
              value={pentatonic ? 'pentatonic' : 'full'}
              options={[
                { value: 'full', label: 'Full scale' },
                { value: 'pentatonic', label: 'Pentatonic' },
              ]}
              onChange={(value) => setPentatonic(value === 'pentatonic')}
            />
```

The key candidates stay individual buttons (they are a variable-length set, not a fixed
segmented control), but become `Button`s so the pressed state comes from
`.btn[aria-pressed='true']` — accent, from Task 2:

```tsx
              <Button
                key={`${c.tonic}-${c.mode}`}
                aria-pressed={i === selected}
                onClick={() => setSelected(i)}
              >
                {candidateLabel} {c.mode} <b className="num">{Math.round(c.confidence * 100)}%</b>
              </Button>
```

Replace the two bare error paragraphs:

```tsx
      {analysis.isError && !notAnalyzedYet && (
        <Banner tone="error" title="The analysis could not be read" trace={String(analysis.error)} />
      )}
```

Wrap the scale body in `Panel`:

```tsx
            <Panel className={styles.panel}>
```

- [ ] **Step 3: Strip the stem hue out of the chrome**

In `frontend/src/screens/ScaleSheet.module.css`:

- **Delete** `.seg button[aria-pressed='true']` entirely — `Segmented` owns it.
- **Delete** `.candidates button[aria-pressed='true']` entirely — `Button` owns it.
- Change `.root` (the scale's root-note chip in the note row). This one is genuinely
  arguable, but it is chrome: a note name is not a stem. It takes the accent:

```css
/* U-01: the root note marker is chrome, so it is accent -- not --ds-bass, even on the
   bass tab. The one place a stem hue belongs on this screen is the fretboard's own
   root dots in Fretboard.module.css, where the instrument is what is being named. */
.root {
  background: var(--ds-accent);
  border-color: var(--ds-accent);
  color: var(--ds-on-accent);
}
```

Drop both `!important`s — they were only needed to beat the `.notes b` rule, and raising
specificity is not required once the declaration order is right. If it still loses,
write `.notes b.root` rather than reaching for `!important`.

- Change `.cap` to use the global utility instead of redefining it: delete the `.cap`
  rule and use `className="cap"` in the TSX.
- Change `.panel` to keep only its flex layout, since `Panel` supplies the surface:

```css
.panel {
  display: flex;
  flex-direction: column;
  gap: var(--ds-4);
}
```

- Change `.page` gap to `var(--ds-5)` to match the other screens.

- [ ] **Step 4: Add a test that pins the U-01 rule**

Append to `frontend/src/screens/ScaleSheet.test.tsx`:

```tsx
test('the selected instrument segment is chrome, not a stem hue', () => {
  // U-01, and the specific regression this screen shipped: the pressed state was
  // painted --ds-bass. Asserting on aria-pressed alone would not have caught it --
  // aria-pressed was already correct. What was wrong was what the pressed state looked
  // like, so this asserts the class that carries the paint.
  renderScaleSheet();
  const bass = screen.getByRole('button', { name: /bass/i });
  expect(bass).toHaveAttribute('aria-pressed', 'true');
  expect(bass).toHaveClass('item');
  expect(bass.className).not.toMatch(/bass|stem/i);
});
```

> Adapt `renderScaleSheet()` to the existing helper in that file.

- [ ] **Step 5: Verify no stem hue survives in this screen's chrome**

```bash
grep -n "ds-vocals\|ds-drums\|ds-bass\|ds-other" frontend/src/screens/ScaleSheet.module.css
```

Expected: **no output.** The only remaining stem-hue reference for this feature is
`frontend/src/music/Fretboard.module.css:.root`, which is correct and stays.

- [ ] **Step 6: Run and commit**

```bash
npm --prefix frontend test -- src/screens/ScaleSheet.test.tsx
git add frontend/src/screens/ScaleSheet.tsx frontend/src/screens/ScaleSheet.module.css frontend/src/screens/ScaleSheet.test.tsx
git commit -m "fix(ui): ScaleSheet pressed states are accent, not a stem hue

U-01: a lit control is chrome and takes the accent. This screen painted its
segmented control and its selected key candidate --ds-bass, which contradicted
SongView's Transport and RightRail on the same question. The one place a stem
hue still belongs is the fretboard's own root dots."
```

---

## Task 16: Album splitter

**Files:**
- Modify: `frontend/src/screens/AlbumSplitter.tsx`
- Modify: `frontend/src/screens/AlbumSplitter.module.css`
- Modify: `frontend/src/splitter/TrackTable.tsx`
- Modify: `frontend/src/splitter/TrackTable.module.css`

**Interfaces:**
- Consumes: `Banner`, `Button`, `ButtonLink`, `Chip`, `DropZone`, `EmptyState`, `Panel`,
  `ProgressBar`, `Table`, `TextField`, `TextLink`.

- [ ] **Step 1: Read the screen and its test**

```bash
grep -n "getByLabelText\|getByRole\|getByText" frontend/src/screens/AlbumSplitter.test.tsx frontend/src/splitter/TrackTable.test.tsx
```

- [ ] **Step 2: Convert `AlbumSplitter.tsx`**

Apply the same conversions as Import and Library:

1. The album file `<input type="file">` → `<DropZone id="album-file" label="Album
   file" file={file} onFile={setFile} hint="One long file; anything ffmpeg can
   decode." />`. Keep the existing label text exactly so `getByLabelText` still resolves.
2. The album title and artist inputs → `TextField`.
3. Every `<button className={styles.action|submit}>` → `<Button>`; the primary action of
   each panel (Upload album, Split) → `variant="primary"`; Delete → `variant="danger"`.
4. `<Link className={styles.link}>` → `<TextLink>`. Delete `.link`.
5. The two `<a className={styles.link} href={albumZipUrl(...)} download>` anchors stay
   plain anchors — they are file downloads, not routes. Give them `.download` in
   `AlbumSplitter.module.css`:

```css
/* A real file download, not a route, so it is an <a> rather than a TextLink -- but it
   reads as the same kind of thing and takes the same treatment. */
.download {
  color: var(--ds-accent);
  text-decoration: none;
}

.download:hover,
.download:focus-visible { text-decoration: underline; }
```
6. `<p className={styles.error}>` → `<Banner tone="error" title="…" trace={…} />`.
   Delete `.error`.
7. `<span className={styles.state}>` → `<Chip>`, with the album-state tone map declared
   above the component:

```tsx
// Album state, like song state, is derived from which files exist. 'split' is the
// finished state; anything earlier is neutral, because an album that has only been
// uploaded is not a warning.
const STATE_TONE: Record<string, ChipTone> = {
  uploaded: 'neutral',
  proposed: 'neutral',
  split: 'ok',
};
```

Import `type ChipTone` from `'../ui'` alongside the components. If the album states this
screen actually emits differ from the three above, read them out of
`frontend/src/api/client.ts` and use those — the map must be exhaustive over the real
values, and the `?? 'neutral'` fallback must never turn a failure into a neutral chip.
8. `.form` and `.card` blocks → `<Panel>`; strip surface/border/radius/padding from
   those rules.
9. `.progress` → `<ProgressBar value={…} label="Split" />`.
10. The "no albums yet" case → `<EmptyState title="No albums yet." />`.

- [ ] **Step 3: Convert `TrackTable.tsx`**

`TrackTable` hand-rolls the table the design system defines. Replace its `<table
className={styles.table}>` with `<Table className={styles.table}>`, delete the `.table`
and `.table th` rules from `TrackTable.module.css` (Table owns them), and:

- `.title` (the per-track title input) → keep as a raw input styled by the module, but
  align it to `TextField`'s input rule — `--ds-border-strong`, the accent focus border,
  and `--ds-t-md`. It stays a raw input rather than a `TextField` because the table cell
  supplies its own label via the column header, and a second visible label per row would
  be wrong:

```css
.title {
  inline-size: 100%;
  min-block-size: var(--ds-hit-setup);
  padding: 0 var(--ds-3);
  background: var(--ds-ground);
  border: 1px solid var(--ds-border-strong);
  border-radius: var(--ds-r-input);
  color: var(--ds-text);
  font: 400 var(--ds-t-md) / 1 var(--ds-font);
}

.title:focus {
  border-color: var(--ds-accent);
  outline: none;
}
```

- `.number` and `.meta` get the global `num` class in the TSX instead of redeclaring
  mono/tabular; delete their `font:` declarations, keep only `color` and `white-space`.

- [ ] **Step 4: Add the screen rhythm**

In `frontend/src/screens/AlbumSplitter.module.css`, change `.screen` gap to
`var(--ds-5)` and delete `.field input` (TextField owns it).

- [ ] **Step 5: Run both test files**

```bash
npm --prefix frontend test -- src/screens/AlbumSplitter.test.tsx src/splitter/TrackTable.test.tsx
```

Expected: PASS. If a query broke, it was anchored on markup this task moved — fix the
query, never the assertion.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/screens/AlbumSplitter.tsx frontend/src/screens/AlbumSplitter.module.css frontend/src/splitter
git commit -m "refactor(ui): Album splitter and TrackTable use the primitive layer"
```

---

## Task 17: Collapse the duplicated button rules in the song view

The songview components are the most spec-faithful in the app, and their behaviour must
not move — `Transport`, `StemLane`, `Timeline` and `ChordStrip` sit on the rAF playhead
path (U-05) and on R-01, the project's main risk. This task changes **class names only**:
every place that re-declares the raised-background button rule adopts `Button` instead.

**Do not touch** `Timeline.module.css` or `ChordStrip.module.css`. Neither contains a
button rule, and both carry U-05 comments explaining why they have no transitions.

**Files:**
- Modify: `frontend/src/songview/Transport.tsx`, `Transport.module.css`
- Modify: `frontend/src/songview/StemLane.tsx`, `StemLane.module.css`
- Modify: `frontend/src/songview/RightRail.tsx`, `RightRail.module.css`

**Interfaces:**
- Consumes: `Button`, `TextLink`, `Segmented`.

- [ ] **Step 1: Capture the current state of the suite**

```bash
npm --prefix frontend test -- src/songview src/screens/SongView.test.tsx
```

Expected: PASS. Record the test count — it must be identical at the end.

- [ ] **Step 2: Transport**

- `.play` and `.bar > button:not(.play)` → `<Button tier="perform">`. The transport is
  the performance tier throughout, so every button here is `tier="perform"` — `.btn
  .perform` gives 56px min-height, which is what those rules hand-rolled.
- Delete `.play`, `.bar > button:not(.play)`, `.bar > button[aria-pressed='true']` and
  `.bar > button:disabled` from `Transport.module.css`. `Button` supplies all four,
  including the accent pressed state, which was already correct here.
- Keep `.bar`, `.barNumber`, `.slider` and every slider rule untouched: the slider's
  padded hit area is the implementation note from spec §5 and is not a button.

- [ ] **Step 3: StemLane**

- The M/S buttons → `<Button tier="perform" className={styles.ms} aria-pressed={…}>`.
- In `StemLane.module.css`, replace the whole `.buttons button` block with just the one
  thing `Button` cannot express — the 44px height the spec pins for M/S:

```css
/* UI spec §5, Stem strip: "M/S are 56x44". Button's perform tier gives the 56px width
   via min-height/padding; the 44px height is the literal the spec names, and tokens.css
   has no 44px token -- inventing one for this single use would be worse. */
.ms {
  min-height: 44px;
  width: var(--ds-hit-perform);
  padding: 0;
  font-family: var(--ds-mono);
}
```

- Delete `.buttons button[aria-pressed='true']` and `.buttons button:disabled` — `Button`
  supplies both, with the same accent pressed state.
- Leave everything else in this file alone, especially `.lane[data-silenced]`,
  `.lane[data-near-silent]` and `.pill` (U-01, U-10).

- [ ] **Step 4: RightRail**

- `.link` → `<TextLink>`; delete the `.link` rule.
- `.saveRow > button` and `.delete` → `<Button>`; delete both rules' visual
  declarations, keeping `.delete { width: var(--ds-hit-setup); }`.
- `.loopRow > button:first-child` stays hand-rolled — it is a left-aligned row button
  with a flexible width and an inner `.loopBars` readout, which is not what `.btn`'s
  centred, nowrap layout does. Add a comment saying so, so a later reader does not
  "finish the job":

```css
/* Deliberately not a Button: this is a full-width, left-aligned row with a trailing
   mono readout, which .btn's centred nowrap layout does not express. */
```

- `.seg` → `<Segmented>`; delete `.seg` and `.seg button` and `.seg
  button[aria-pressed='true']`.

- [ ] **Step 5: Run the songview suite and compare**

```bash
npm --prefix frontend test -- src/songview src/screens/SongView.test.tsx
```

Expected: PASS, with **the same number of tests as Step 1**. A changed count means a
test file was edited, which this task has no reason to do.

- [ ] **Step 6: Confirm no transition reached the playhead path**

```bash
grep -n "transition\|animation" frontend/src/songview/Timeline.module.css frontend/src/songview/ChordStrip.module.css frontend/src/splitter/WaveformMarkers.module.css
```

Expected: **no output.** U-05 is one-way in practice and this is the cheap guard.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/songview
git commit -m "refactor(ui): song view adopts Button, TextLink and Segmented

Class-name changes only. These components were already spec-faithful; they
were also three of the seven files re-declaring the same raised-background
button rule with a different font in each."
```

---

## Task 18: Verification

The plan is not done until the measurements that opened it come back different. jsdom
applies no stylesheet cascade, so **none of the above can be verified by a unit test** —
the unit tests pin the variant-to-class mapping, and this task pins the paint.

**Files:**
- Modify: `docs/superpowers/plans/2026-09-28-ui-design-system-conformance.md` (fill in
  the verification log below)

- [ ] **Step 1: Full suite and typecheck**

```bash
npm --prefix frontend test && npm --prefix frontend run typecheck && npm --prefix frontend run build
```

Expected: all PASS. Paste the real counts into the log; do not write "all tests pass"
without them.

- [ ] **Step 2: Confirm no raw hex leaked into the frontend**

```bash
grep -rn "#[0-9a-fA-F]\{3,8\}" frontend/src --include=*.css | grep -v "styles/tokens.css"
```

Expected: **no output.**

- [ ] **Step 3: Confirm the token mirror still matches**

```bash
diff -u design/ui/src/tokens.css frontend/src/styles/tokens.css && echo IDENTICAL
```

Expected: `IDENTICAL`.

- [ ] **Step 4: Re-run the measurement that found the bugs**

With the dev server up, hard-reload `/` and evaluate in the page:

```js
(() => {
  const cs = (el) => getComputedStyle(el);
  const b = cs(document.body);
  return {
    bodyBg: b.backgroundColor,
    bodyMargin: b.margin,
    bodyFont: b.fontFamily.slice(0, 20),
    h1: (() => { const h = document.querySelector('h1'); return h && [cs(h).fontSize, cs(h).margin]; })(),
    links: [...document.querySelectorAll('a')].map((a) => [
      a.textContent.trim().slice(0, 22), cs(a).color, Math.round(a.getBoundingClientRect().height),
    ]),
    buttons: [...document.querySelectorAll('button')].map((x) => [
      x.textContent.trim().slice(0, 18), cs(x).backgroundColor, cs(x).color,
      cs(x).fontFamily.slice(0, 14), cs(x).fontSize, Math.round(x.getBoundingClientRect().height),
    ]),
  };
})()
```

Assert, one by one:

- `bodyBg` is `rgb(11, 12, 14)`, not `rgba(0, 0, 0, 0)`.
- `bodyMargin` is `0px`, not `8px`.
- `bodyFont` starts `ui-sans-serif`, not `"Times New Roman"`.
- `h1` is `["32px", "0px"]`, not `["36px", "24.12px 0px"]`.
- **No link** reports `rgb(0, 0, 238)`.
- **No link or button** reports a height below `32`.
- **No button** reports `rgb(239, 239, 239)` or `Arial`.

- [ ] **Step 5: Repeat on every screen**

Run the same snippet on `/import`, `/jobs`, `/splitter`, a song's `/scale`, and a song's
`/export`. On `/import` and `/splitter` additionally confirm:

```js
document.querySelectorAll('.drop').length
```

Expected: at least `1` on each, where it was `0`.

- [ ] **Step 6: Check the disabled state that was invisible**

On `/import` with no file chosen:

```js
(() => { const b = [...document.querySelectorAll('button')].find((x) => x.disabled);
  const s = getComputedStyle(b); return [s.backgroundColor, s.color, s.opacity]; })()
```

Expected: the accent background at `opacity: 0.4` — **not** `rgba(239, 239, 239, 0.3)`
with `rgba(16, 16, 16, 0.3)` text.

- [ ] **Step 7: Compare against the design system's own pages**

The reference pages regenerated in Task 1 serve from `design/ui/dist`. Start them and
open each screen's reference beside the real one:

```bash
python3 -m http.server 8777 --directory design/ui/dist
```

Walk `screens/library.html`, `screens/import.html`, `screens/job-queue.html`,
`screens/export.html`, `screens/scale-sheet.html`, `screens/album-splitter.html` against
the live app. Record any remaining difference in the log below as either **fixed**,
**deferred to Layer 2**, or **a divergence we accept and why** — the project's convention
(see the Phase 8 plan) is that an accepted divergence is written down, not left implied.

- [ ] **Step 8: Fill in the verification log and commit**

```bash
git add docs/superpowers/plans/2026-09-28-ui-design-system-conformance.md
git commit -m "docs: verification log for the UI conformance plan"
```

---

## Execution notes: where the plan was wrong

Executed on branch `ui-design-system-conformance`, inline. The plan was right about the
diagnosis and the architecture; these are the places its *details* were wrong, found by
running it. Each is fixed in the code, not just noted here.

| Plan said | Reality | Resolution |
| --- | --- | --- |
| `tokens.test.ts` reads files via `node:fs` / `import.meta.url` | No `@types/node`, and `npm run build` typechecks tests; under jsdom `import.meta.url` is not a `file:` URL | Read through a `?source` import (see next row) |
| Vite `?raw` returns the CSS text | Under Vitest `foo.css?raw` is `''` and `foo.module.css?raw` is the class map. **The first draft of the parity test passed vacuously** against two empty strings; a mutation check caught it | `cssSource()` plugin in `vite.config.ts` serves `?source` via a virtual id (`.source.js` suffix: Vite and Vitest blank any id ending `.css`). Both parity and hex guards were re-mutated after |
| ScaleSheet U-01 test asserts the segment's class is `item` and not `/bass/` | Vacuous: passes whatever colour the CSS paints | Replaced by `src/styles/chrome.test.ts`, a static guard over every CSS module. It failed on `ScaleSheet.module.css` first (red), then passed after the fix |
| Album states include `proposed` | `AlbumState = 'uploaded' \| 'ready' \| 'split'` | Tone map uses the real values |
| `git add design/ui/dist` | `dist/` is gitignored | Left out |
| CPU notice as `title` + body | Existing `routes.test.tsx` finds the element containing the wording and expects the reason inside it | Kept the original one-element wording so that test passes **unmodified** |
| Proposals fetch error as a `Banner` | A 404 there is the normal "not proposed yet" state; an alert is a false alarm, and it broke two existing tests | Reverted to the original plain note |
| Export's D-10 notice and native checkboxes/radios | Tests address them by role; the notice carries `role=status` + `aria-label` which `Banner` lacks | Kept native inputs (styled with `accent-color`) and the notice's own markup |
| "← Back" style links as `TextLink` | Standalone navigation targets need a hit target | `ButtonLink variant="ghost"`, matching the Task 3 rule |

Three defects were invisible to every unit test and found only by measuring the rendered
app (jsdom applies no cascade):

1. Library and Album splitter **card titles were 27px** tall (U-03 floor is 32px), on each
   card's primary navigation. Now 40px.
2. The transport's **Play button was 32px wide** against a 56px performance target: the
   bar is a flex row and shrank the fixed-width button. `flex: none`.
3. The transport's text buttons were squeezed to their `min-width` with **labels spilling
   out** (`scrollWidth` 67 vs `clientWidth` 54). The `min-width` predates this plan; it
   replaces the browser's content-based minimum. `flex: none` on the buttons, and the bar
   wraps instead of overflowing.

## Known divergences left open

- **Mute/Solo pressed colour.** The design system's reference CSS paints pressed M red
  (`--ds-error`) and pressed S amber (`--ds-warn`); the UI spec §5 table says a pressed
  control "uses accent, never a stem hue", and the app implements that. The two sources
  disagree, this pass did not change the behaviour, and it needs a decision.
- **Narrow widths.** At a 1024px viewport the song view's main column is ~617px and the
  transport wraps to three rows (196px tall). At 1440px it is one row. Wrapping is the
  deliberate trade against clipped labels; a leaner transport at narrow widths is a
  Layer 2 question.
- **Layer 2** (F21-F24), as scoped at the top: Import as a modal with the five-step
  pipeline, library card metadata, job queue stats and history, the topbar and brand.

## Verification log

Suite: **43 files, 314 tests** passing (baseline 31 files / 247 tests; +67 tests, all in
new primitives, guards and previously-uncovered screens). `tsc --noEmit` clean.
`vite build` succeeds.

| Check | Before | After |
| --- | --- | --- |
| `body` background | `rgba(0, 0, 0, 0)` | `rgb(11, 12, 14)` |
| `body` margin | `8px` | `0px` |
| `body` font | `"Times New Roman"` | `ui-sans-serif` stack |
| `h1` size / margin | `36px` / `24.12px 0px` | `32px` / `0px` |
| Links at UA blue `rgb(0,0,238)` | 3 on Library alone | 0 on every screen |
| Worst link contrast | ≈1.3:1 | 7.0:1 (accent on ground) |
| Buttons at `rgb(239,239,239)` or Arial | every button | 0 on every screen |
| Smallest hit target | 21px (Delete) | 40px (32px floor respected everywhere measured) |
| Disabled submit | `rgba(16,16,16,.3)` on `rgba(239,239,239,.3)` | accent fill at `opacity: .4`, legible |
| Drop zones on `/import` | 0 | 1 |
| Drop zones on `/splitter` | 0 | 1 |
| Stem hues in chrome | `ScaleSheet` pressed = `--ds-bass` | none; only `Fretboard` root dots (guarded) |
| Files re-declaring the button rule | 7 | 1, deliberate and commented (RightRail loop row) |
| Raw hex outside `tokens.css` | 0 | 0 (guarded, comment-stripped) |
| Horizontal page scroll | n/a | none on any screen |

Reference comparison (Step 7): default, primary, ghost and danger buttons, the text
input and the state chip match the design system's own reference pages property-for-
property (background, border, radius, font size and weight, padding, height). The drop
zone matches except height, which is content-driven (the app adds a hint and the chosen
file name). Verified with `getComputedStyle` on both, not by eye.

Screens measured live: `/`, `/import`, `/jobs`, `/splitter`, a song's `/scale` and
`/export`, and a song's Song view (M/S measure 56×44 per spec; Play and the text buttons
56px tall, none clipped at 1440px).
