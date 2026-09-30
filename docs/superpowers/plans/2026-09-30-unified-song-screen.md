# Unified Song Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One song screen with one pinned transport and swappable Stems / Tabs content, bar-number looping everywhere, tempo up to 150 %, and in-place rename of title and artist.

**Architecture:** A new layout route, `SongScreen`, sits between `SongScope` (which keeps owning the session and the engine, D-18) and the two content routes. It renders the header, the alerts, the one `Transport` and the Stems/Tabs switch; `SongView` and `PlayAlong` shrink to content only and hand their view-specific tools to the switch row through a small portal (`ViewTools`). The right rail is deleted: count-in and saved loops move into the transport, key candidates live only in the Tabs key picker.

**Tech Stack:** React 18 + TypeScript, React Router, TanStack Query, CSS modules, Vitest + Testing Library; Python 3.12, pydantic, pytest.

**Spec:** the approved clickable mockup `docs/superpowers/specs/2026-09-30-unified-song-screen-mockup.html`, plus the decisions below (agreed in chat on 2026-09-30).

## Design decisions

- **URLs stay (D-14).** `/songs/:songId` is Stems, `/songs/:songId/play` is Tabs. The switch is two links.
- **Tempo range is 50–150 %.** This amends **N-04** (was 50–100 %). 100 % is marked with a tick on the slider.
- **Looping is by bar numbers** (the `LoopBars` steppers). The Set A / Set B buttons are removed; the `A` and `B` keys stay and set the loop start / end to the current bar.
- **No right rail.** Count-in and a Saved loops menu are in the transport. "Scale & fretboard" is a link in the Tabs tools.
- **Rename** edits `title` and `artist` in `song.json` through the session's one funnel (`applyRecipe`). The song's folder name does not change: the id prefix is authoritative (D-01), the slug is decoration.
- **Deliberate differences from the mockup:** the tempo slider is a native range input, so its fill runs from the left rather than from the centre tick; the transport shows the bar number without a beat number; the Tabs content keeps the existing `NowReadout` row because it carries the substitution label (N-08).
- **Saved loop bars are shown 1-based inclusive** ("5–8" for `start_bar` 4, `end_bar` 8), matching `LoopBars`. The old rail showed `end_bar + 1`, one bar too many.

## Global Constraints

- The API never imports torch. The API is the only writer of `song.json`; rename goes through the existing `PUT /api/songs/{id}`.
- Stems are immutable. Tempo, pitch, loops, title are recipe values in `song.json`.
- 48 kHz everywhere; loops are stored as integer bar numbers.
- Never seek the time-stretcher (D-06). Nothing in this plan touches the loop wrap.
- Fail loudly (N-08): out-of-range tempo in an export recipe is rejected, never clamped.
- Performance-tier controls are 56 px (`tier="perform"`); setup-tier are 40 px.
- Work on `main`. Commit after each task. Push only at the end of Task 6, after README upkeep.
- Test commands, from the repo root: `uv run pytest`, `uv run ruff check packages ops`, `npm --prefix frontend test -- --run`, `npm --prefix frontend run typecheck`.

## File map

| File | Change |
|---|---|
| `packages/stemcraft_lib/src/stemcraft_lib/song.py` | add `TEMPO_MIN`, `TEMPO_MAX` |
| `packages/stemcraft_lib/src/stemcraft_lib/export.py` | recipe tempo bound uses them |
| `frontend/src/engine/types.ts` | add `TEMPO_MIN`, `TEMPO_MAX`, `clampTempo` |
| `frontend/src/engine/EngineController.ts` | `setTempo` uses `clampTempo` |
| `frontend/src/songview/TitleEditor.tsx` (+ css, test) | new: title/artist display and in-place edit |
| `frontend/src/songview/SavedLoops.tsx` (+ css, test) | new: saved loops menu |
| `frontend/src/songview/ZoomTools.tsx` (+ css, test) | new: zoom and Follow playhead, moved out of Transport |
| `frontend/src/songview/ViewTools.tsx` | new: portal into the switch row |
| `frontend/src/songview/Transport.tsx` (+ css, test) | the one transport: loop bars, saved loops, count-in; no Set A/B, no zoom |
| `frontend/src/screens/SongScreen.tsx` (+ css, test) | new: layout route |
| `frontend/src/screens/SongView.tsx`, `PlayAlong.tsx` | content only |
| `frontend/src/session/SongSession.tsx` | add `onRename` |
| `frontend/src/app/routes.tsx` | nest the two routes under `SongScreen` |
| `frontend/src/songview/RightRail.*`, `frontend/src/playalong/PlayAlongTransport.tsx` | deleted |
| `design/`, `README.md`, `docs/screenshots/` | specs, design pages, screenshots |

---

### Task 1: Tempo range 50–150 %

**Files:**
- Modify: `packages/stemcraft_lib/src/stemcraft_lib/song.py`
- Modify: `packages/stemcraft_lib/src/stemcraft_lib/export.py:55-58`
- Modify: `packages/stemcraft_api/src/stemcraft_api/routes/songs.py:322`
- Modify: `frontend/src/engine/types.ts`, `frontend/src/engine/EngineController.ts:175-176`
- Modify: `frontend/src/songview/Transport.tsx`, `frontend/src/playalong/PlayAlongTransport.tsx`
- Test: `packages/stemcraft_lib/tests/test_export.py`, `packages/stemcraft_api/tests/test_songs_export.py`, `frontend/src/engine/types.test.ts`, `frontend/src/songview/Transport.test.tsx`

**Interfaces:**
- Produces (Python): `stemcraft_lib.song.TEMPO_MIN = 0.5`, `TEMPO_MAX = 1.5`.
- Produces (TS, `engine/types.ts`): `TEMPO_MIN`, `TEMPO_MAX`, `clampTempo(ratio: number): number`.

- [ ] **Step 1: Write the failing Python tests**

In `packages/stemcraft_lib/tests/test_export.py`, in `test_out_of_range_tempo_or_pitch_is_rejected_not_clamped`, change `_recipe(tempo=1.5)` to `_recipe(tempo=1.51)`, and add below that test:

```python
def test_tempo_up_to_150_percent_is_accepted():
    # N-04 (amended 2026-09-30): the practice range is 50-150 %.
    assert _recipe(tempo=1.5).tempo == 1.5
    assert not _recipe(tempo=1.5).is_identity
```

In `packages/stemcraft_api/tests/test_songs_export.py`, in `test_a_recipe_outside_the_allowed_range_is_422_not_a_500`, change `tempo=1.4` to `tempo=1.6`.

- [ ] **Step 2: Run them and see the new one fail**

Run: `uv run pytest packages/stemcraft_lib/tests/test_export.py packages/stemcraft_api/tests/test_songs_export.py -q`
Expected: `test_tempo_up_to_150_percent_is_accepted` FAILS with a `ValidationError` (less than or equal to 1).

- [ ] **Step 3: Implement the Python side**

`song.py`, after `STEM_NAMES`:

```python
# N-04: the practice tempo range, as a ratio of the original tempo. Defined once
# here; the export recipe validates against it and the browser mirrors it.
TEMPO_MIN = 0.5
TEMPO_MAX = 1.5
```

`export.py`: add `TEMPO_MAX, TEMPO_MIN` to the existing import from `.song`, and replace the tempo field and its comment:

```python
    # N-04: tempo 50-150%, pitch in semitones. Out of range is rejected,
    # never clamped (N-08) -- a recipe the song screen could not have produced
    # means the caller is wrong, and a clamp would hide that behind audio.
    tempo: float = Field(default=1.0, ge=TEMPO_MIN, le=TEMPO_MAX)
```

`routes/songs.py`, in the comment inside `queue_export`'s `except ValidationError`: change "a tempo above 1.0" to "a tempo above 1.5".

- [ ] **Step 4: Run the Python tests**

Run: `uv run pytest -q && uv run ruff check packages ops`
Expected: all pass.

- [ ] **Step 5: Write the failing frontend tests**

Append to `frontend/src/engine/types.test.ts` (add `clampTempo, TEMPO_MAX, TEMPO_MIN` to its import from `./types`):

```ts
describe('clampTempo', () => {
  it('keeps the N-04 range of 50 to 150 %', () => {
    expect(TEMPO_MIN).toBe(0.5);
    expect(TEMPO_MAX).toBe(1.5);
    expect(clampTempo(0.2)).toBe(0.5);
    expect(clampTempo(1.2)).toBe(1.2);
    expect(clampTempo(1.7)).toBe(1.5);
  });
});
```

In `frontend/src/songview/Transport.test.tsx` replace the test `'clamps tempo to N-04’s 50-100% range'` with:

```tsx
  it('offers N-04’s 50-150% tempo range, with 100% marked', () => {
    renderTransport();
    const slider = screen.getByRole('slider', { name: /tempo/i }) as HTMLInputElement;
    expect(slider.min).toBe('50');
    expect(slider.max).toBe('150');
    expect(document.querySelector('datalist#tempo-ticks option')).toHaveAttribute('value', '100');
  });

  it('steps tempo past 100% with the arrow keys, and stops at 150%', async () => {
    const props = renderTransport({ tempo: 1.45 });
    await userEvent.keyboard('{ArrowUp}');
    expect(props.onTempoChange).toHaveBeenLastCalledWith(1.5);
    await userEvent.keyboard('{ArrowUp}');
    // The prop did not change (the mock does not feed back), so 1.45 + 0.05 again.
    expect(props.onTempoChange).toHaveBeenLastCalledWith(1.5);
  });
```

- [ ] **Step 6: Run them and see them fail**

Run: `npm --prefix frontend test -- --run src/engine/types.test.ts src/songview/Transport.test.tsx`
Expected: FAIL — `clampTempo` is not exported; slider max is `100`.

- [ ] **Step 7: Implement the frontend side**

Append to `frontend/src/engine/types.ts`:

```ts
/** N-04: the practice tempo range, as a ratio of the original. Mirrors stemcraft_lib.song. */
export const TEMPO_MIN = 0.5;
export const TEMPO_MAX = 1.5;

export function clampTempo(ratio: number): number {
  return Math.min(TEMPO_MAX, Math.max(TEMPO_MIN, ratio));
}
```

`EngineController.ts` `setTempo`: import `clampTempo` from `./types` and replace the clamp line with:

```ts
    const clamped = clampTempo(ratio); // N-04: 50-150%
```

`songview/Transport.tsx`: import `clampTempo, TEMPO_MAX, TEMPO_MIN` from `'../engine/types'` (merge with the existing `SampleIndex` type import). Change the prop comment to `tempo: number; // 0.5..1.5`. Replace the two arrow-key actions:

```ts
        ArrowUp: () => onTempoChange(clampTempo(Number((tempo + TEMPO_STEP).toFixed(2)))),
        ArrowDown: () => onTempoChange(clampTempo(Number((tempo - TEMPO_STEP).toFixed(2)))),
```

and the tempo slider:

```tsx
        <input
          type="range"
          aria-label="Tempo"
          min={TEMPO_MIN * 100}
          max={TEMPO_MAX * 100}
          step={1}
          list="tempo-ticks"
          value={Math.round(tempo * 100)}
          onChange={(e) => onTempoChange(Number(e.target.value) / 100)}
        />
        {/* The original tempo, so 100% can be found again by eye. */}
        <datalist id="tempo-ticks">
          <option value="100" />
        </datalist>
```

`playalong/PlayAlongTransport.tsx`: change `max={100}` to `max={150}` (this file is deleted in Task 5; until then both transports agree).

- [ ] **Step 8: Run the frontend checks**

Run: `npm --prefix frontend test -- --run && npm --prefix frontend run typecheck`
Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add -A packages frontend
git commit -m "feat(tempo): practice tempo range is 50-150% (amends N-04)"
```

---

### Task 2: Rename title and artist

**Files:**
- Create: `frontend/src/songview/TitleEditor.tsx`, `frontend/src/songview/TitleEditor.module.css`, `frontend/src/songview/TitleEditor.test.tsx`
- Modify: `frontend/src/session/SongSession.tsx`, `frontend/src/screens/SongView.tsx:331-334`
- Test: `frontend/src/screens/SongView.test.tsx`

**Interfaces:**
- Produces: `TitleEditor({ title: string; artist: string; onRename(title: string, artist: string): void })`.
- Produces: `SongSession.onRename(title: string, artist: string): void` — trims both; ignores a blank title.

- [ ] **Step 1: Write the failing component test**

`frontend/src/songview/TitleEditor.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { TitleEditor } from './TitleEditor';

function renderEditor() {
  const onRename = vi.fn();
  render(<TitleEditor title="Tightrope" artist="Walk the Moon" onRename={onRename} />);
  return onRename;
}

describe('TitleEditor', () => {
  it('shows the title as the page heading and the artist under it', () => {
    renderEditor();
    expect(screen.getByRole('heading', { name: 'Tightrope' })).toBeInTheDocument();
    expect(screen.getByText('Walk the Moon')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('renames title and artist on Save', async () => {
    const onRename = renderEditor();
    await userEvent.click(screen.getByRole('button', { name: 'Rename' }));
    const title = screen.getByRole('textbox', { name: 'Title' });
    expect(title).toHaveFocus();
    await userEvent.clear(title);
    await userEvent.type(title, 'Tightrope (live)');
    await userEvent.clear(screen.getByRole('textbox', { name: 'Artist' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Artist' }), 'WTM{Enter}');
    expect(onRename).toHaveBeenCalledWith('Tightrope (live)', 'WTM');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('refuses a blank title', async () => {
    const onRename = renderEditor();
    await userEvent.click(screen.getByRole('button', { name: 'Rename' }));
    await userEvent.clear(screen.getByRole('textbox', { name: 'Title' }));
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    await userEvent.keyboard('{Enter}');
    expect(onRename).not.toHaveBeenCalled();
  });

  it('Cancel and Escape abandon the edit', async () => {
    const onRename = renderEditor();
    await userEvent.click(screen.getByRole('button', { name: 'Rename' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Title' }), 'x');
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('heading', { name: 'Tightrope' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Rename' }));
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('Tightrope');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onRename).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `npm --prefix frontend test -- --run src/songview/TitleEditor.test.tsx`
Expected: FAIL — cannot resolve `./TitleEditor`.

- [ ] **Step 3: Implement the component**

`frontend/src/songview/TitleEditor.tsx`:

```tsx
// The song's title and artist, renamed in place. The heading is the display; Rename
// swaps it for two fields. Only song.json changes: the song's folder keeps the slug it
// was imported with, because the id prefix is what names a song (D-01).
import { useState, type FormEvent, type KeyboardEvent } from 'react';

import { Button } from '../ui';
import styles from './TitleEditor.module.css';

export interface TitleEditorProps {
  title: string;
  artist: string;
  onRename(title: string, artist: string): void;
}

export function TitleEditor({ title, artist, onRename }: TitleEditorProps) {
  const [draft, setDraft] = useState<{ title: string; artist: string } | null>(null);

  if (draft === null) {
    return (
      <div className={styles.view}>
        <div className={styles.titles}>
          <h1>{title}</h1>
          <p className={styles.artist}>{artist}</p>
        </div>
        <Button variant="ghost" aria-label="Rename" title="Rename" onClick={() => setDraft({ title, artist })}>
          ✎
        </Button>
      </div>
    );
  }

  const blank = draft.title.trim() === '';
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (blank) return;
    onRename(draft.title.trim(), draft.artist.trim());
    setDraft(null);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') setDraft(null);
  };

  return (
    <form className={styles.edit} onSubmit={submit} onKeyDown={onKeyDown}>
      <input
        className={styles.input}
        aria-label="Title"
        autoFocus
        value={draft.title}
        onChange={(e) => setDraft({ ...draft, title: e.target.value })}
      />
      <input
        className={styles.input}
        aria-label="Artist"
        placeholder="Artist"
        value={draft.artist}
        onChange={(e) => setDraft({ ...draft, artist: e.target.value })}
      />
      <Button variant="primary" type="submit" disabled={blank}>
        Save
      </Button>
      <Button variant="ghost" onClick={() => setDraft(null)}>
        Cancel
      </Button>
    </form>
  );
}
```

`frontend/src/songview/TitleEditor.module.css`:

```css
/* Setup tier: renaming is done with both hands free. */
.view,
.edit {
  display: flex;
  align-items: center;
  gap: var(--ds-3);
  min-width: 0;
}

.titles {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.titles h1 {
  margin: 0;
  font: 600 var(--ds-t-xl) / var(--ds-lh-xl) var(--ds-font);
}

.artist {
  margin: 0;
  font-size: var(--ds-t-sm);
  color: var(--ds-text-2);
}

.edit {
  flex-wrap: wrap;
}

.input {
  min-height: var(--ds-hit-setup);
  min-width: 220px;
  padding-inline: var(--ds-3);
  font: 400 var(--ds-t-md) / 1 var(--ds-font);
  color: var(--ds-text);
  background: var(--ds-raised);
  border: 1px solid var(--ds-border-strong);
  border-radius: var(--ds-r-input);
}

.input:focus {
  border-color: var(--ds-accent);
  outline: none;
}
```

- [ ] **Step 4: Run the component test**

Run: `npm --prefix frontend test -- --run src/songview/TitleEditor.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Write the failing screen test**

Append inside `describe('SongView', ...)` in `frontend/src/screens/SongView.test.tsx`:

```tsx
  it('renames the song in place and saves it to song.json', async () => {
    renderSongView();
    await userEvent.click(await screen.findByRole('button', { name: 'Rename' }));
    const title = screen.getByRole('textbox', { name: 'Title' });
    await userEvent.clear(title);
    await userEvent.type(title, 'New Name{Enter}');
    expect(await screen.findByRole('heading', { name: 'New Name' })).toBeInTheDocument();
    await waitFor(
      () => {
        const put = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === 'PUT');
        const body = JSON.parse(String(put![1]!.body));
        expect(body.title).toBe('New Name');
        expect(body.artist).toBe('Someone');
      },
      { timeout: 3000 },
    );
  });
```

Run: `npm --prefix frontend test -- --run src/screens/SongView.test.tsx -t "renames the song"`
Expected: FAIL — no button named "Rename".

- [ ] **Step 6: Add `onRename` to the session and use the editor**

`frontend/src/session/SongSession.tsx` — in `interface SongSession`, after `onPlayAlongChange`:

```ts
  /** Renames the song in song.json. Both are trimmed; a blank title is ignored. */
  onRename(title: string, artist: string): void;
```

After `handlePlayAlongChange`:

```ts
  // The title is recipe-adjacent metadata in the same document, so it takes the
  // same funnel: state, then the debounced PUT, which also refreshes the library.
  const handleRename = useCallback(
    (title: string, artist: string) => {
      const { song: currentSong } = latest.current;
      if (!currentSong || title.trim() === '') return;
      applyRecipe({ ...currentSong, title: title.trim(), artist: artist.trim() });
    },
    [applyRecipe],
  );
```

Add `onRename: handleRename,` to the returned object and `handleRename,` to the `useMemo` dependency array.

`frontend/src/screens/SongView.tsx` — destructure `onRename` from `useSongSession()`, import `TitleEditor` from `'../songview/TitleEditor'`, and replace the `<div className={styles.titles}>…</div>` block in the main header with:

```tsx
          <TitleEditor
            title={song?.title ?? fetchedSong?.title ?? songId}
            artist={song?.artist ?? fetchedSong?.artist ?? ''}
            onRename={onRename}
          />
```

Change `.header` in `SongView.module.css` from `align-items: baseline` to `align-items: center`, and delete the now-unused `.titles`, `.titles h1` and `.artist` rules there.

- [ ] **Step 7: Run everything**

Run: `npm --prefix frontend test -- --run && npm --prefix frontend run typecheck`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add -A frontend
git commit -m "feat(song): rename title and artist in place"
```

---

### Task 3: Saved loops menu

**Files:**
- Create: `frontend/src/songview/SavedLoops.tsx`, `frontend/src/songview/SavedLoops.module.css`, `frontend/src/songview/SavedLoops.test.tsx`

**Interfaces:**
- Consumes: `Loop` from `'../api/client'` (`{ name: string; start_bar: number; end_bar: number }`, 0-based, end exclusive).
- Produces: `SavedLoops({ savedLoops: Loop[]; activeLoop: Loop | null; onRecallLoop(loop: Loop): void; onSaveActiveLoop(name: string): void; onDeleteLoop(name: string): void })`.

- [ ] **Step 1: Write the failing test**

`frontend/src/songview/SavedLoops.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { SavedLoops } from './SavedLoops';

function renderMenu(over = {}) {
  const props = {
    savedLoops: [
      { name: 'Chorus', start_bar: 16, end_bar: 24 },
      { name: 'Bridge', start_bar: 40, end_bar: 48 },
    ],
    activeLoop: { name: 'Chorus', start_bar: 16, end_bar: 24 },
    onRecallLoop: vi.fn(),
    onSaveActiveLoop: vi.fn(),
    onDeleteLoop: vi.fn(),
    ...over,
  };
  render(<SavedLoops {...props} />);
  return props;
}

const open = () => userEvent.click(screen.getByRole('button', { name: /saved loops/i }));

describe('SavedLoops', () => {
  it('is closed until asked, and names the active loop on its button', () => {
    renderMenu();
    const button = screen.getByRole('button', { name: /saved loops/i });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).toHaveTextContent('Chorus');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows bars 1-based and inclusive, like the loop steppers', async () => {
    renderMenu();
    await open();
    expect(screen.getByRole('button', { name: 'Recall loop Bridge, bars 41–48' })).toBeInTheDocument();
  });

  it('recalls a saved loop and closes', async () => {
    const props = renderMenu();
    await open();
    await userEvent.click(screen.getByRole('button', { name: /Recall loop Bridge/ }));
    expect(props.onRecallLoop).toHaveBeenCalledWith({ name: 'Bridge', start_bar: 40, end_bar: 48 });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('deletes a saved loop by name, not by row position', async () => {
    const props = renderMenu();
    await open();
    await userEvent.click(screen.getByRole('button', { name: /Delete loop Bridge/ }));
    expect(props.onDeleteLoop).toHaveBeenCalledWith('Bridge');
  });

  it('saves the active loop under a typed name', async () => {
    const props = renderMenu({ activeLoop: { name: '', start_bar: 4, end_bar: 8 } });
    await open();
    await userEvent.type(screen.getByRole('textbox', { name: 'Loop name' }), 'Verse 2{Enter}');
    expect(props.onSaveActiveLoop).toHaveBeenCalledWith('Verse 2');
  });

  it('cannot save when there is no active loop', async () => {
    renderMenu({ activeLoop: null });
    await open();
    expect(screen.getByRole('textbox', { name: 'Loop name' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save loop' })).toBeDisabled();
  });

  it('closes on Escape', async () => {
    renderMenu();
    await open();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `npm --prefix frontend test -- --run src/songview/SavedLoops.test.tsx`
Expected: FAIL — cannot resolve `./SavedLoops`.

- [ ] **Step 3: Implement**

`frontend/src/songview/SavedLoops.tsx`:

```tsx
// Saved loops, as a menu in the transport (they lived in the right rail until the
// song screen was unified). The button is performance tier: recalling a loop happens
// mid-practice. Naming and deleting are setup tier, inside the popover.
// Bars read 1-based and inclusive, like LoopBars: start_bar 4, end_bar 8 is "5–8".
import { useEffect, useRef, useState, type FormEvent } from 'react';

import type { Loop } from '../api/client';
import { Button } from '../ui';
import styles from './SavedLoops.module.css';

export interface SavedLoopsProps {
  savedLoops: Loop[];
  activeLoop: Loop | null;
  onRecallLoop(loop: Loop): void;
  onSaveActiveLoop(name: string): void;
  onDeleteLoop(name: string): void;
}

const bars = (loop: Loop) => `${loop.start_bar + 1}–${loop.end_bar}`;

export function SavedLoops({ savedLoops, activeLoop, onRecallLoop, onSaveActiveLoop, onDeleteLoop }: SavedLoopsProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const root = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const onPointer = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onPointer);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onPointer);
    };
  }, [open]);

  const save = (event: FormEvent) => {
    event.preventDefault();
    if (!activeLoop || name.trim() === '') return;
    onSaveActiveLoop(name.trim());
    setName('');
  };

  return (
    <div className={styles.root} ref={root}>
      <span className={styles.caption} aria-hidden="true">
        Saved loops
      </span>
      <Button
        tier="perform"
        className={styles.button}
        aria-label="Saved loops"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
      >
        <span>{activeLoop?.name || 'None'}</span>
        <span className={styles.bars}>{activeLoop ? bars(activeLoop) : ''} ▾</span>
      </Button>

      {open && (
        <div role="dialog" aria-label="Saved loops" className={styles.pop}>
          {savedLoops.length === 0 && <p className={styles.note}>No saved loops yet.</p>}
          <ul className={styles.list}>
            {savedLoops.map((loop) => (
              <li key={loop.name} className={styles.row}>
                <button
                  type="button"
                  className={styles.recall}
                  aria-label={`Recall loop ${loop.name}, bars ${bars(loop)}`}
                  aria-current={loop.name === activeLoop?.name ? 'true' : undefined}
                  onClick={() => {
                    onRecallLoop(loop);
                    setOpen(false);
                  }}
                >
                  <span>{loop.name}</span>
                  <span className={styles.bars}>{bars(loop)}</span>
                </button>
                <Button
                  variant="ghost"
                  className={styles.delete}
                  aria-label={`Delete loop ${loop.name}, bars ${bars(loop)}`}
                  onClick={() => onDeleteLoop(loop.name)}
                >
                  &times;
                </Button>
              </li>
            ))}
          </ul>
          <form className={styles.save} onSubmit={save}>
            <input
              type="text"
              aria-label="Loop name"
              className={styles.input}
              value={name}
              disabled={!activeLoop}
              onChange={(e) => setName(e.target.value)}
              placeholder={activeLoop ? `Name bars ${bars(activeLoop)}` : 'Set loop bars first'}
            />
            <Button type="submit" disabled={!activeLoop || name.trim() === ''}>
              Save loop
            </Button>
          </form>
        </div>
      )}
    </div>
  );
}
```

`frontend/src/songview/SavedLoops.module.css`:

```css
.root {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--ds-1);
  flex: none;
}

.caption {
  font: 600 var(--ds-t-xs) / 1 var(--ds-font);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ds-text-3);
}

.root > .button {
  min-width: 180px;
  justify-content: space-between;
  gap: var(--ds-3);
  padding-inline: var(--ds-4);
  font-size: var(--ds-t-sm);
}

.bars {
  font: 400 var(--ds-t-sm) / 1 var(--ds-mono);
  font-variant-numeric: tabular-nums; /* U-04 */
  color: var(--ds-text-2);
}

/* Above the pinned transport's own layer and the time axis under it. */
.pop {
  position: absolute;
  top: 100%;
  left: 0;
  z-index: 10;
  margin-top: var(--ds-2);
  width: 340px;
  display: flex;
  flex-direction: column;
  gap: var(--ds-2);
  padding: var(--ds-3);
  background: var(--ds-overlay);
  border: 1px solid var(--ds-border-strong);
  border-radius: var(--ds-r-panel);
}

.note {
  margin: 0;
  font-size: var(--ds-t-sm);
  color: var(--ds-text-2);
}

.list {
  display: flex;
  flex-direction: column;
  gap: var(--ds-1);
  margin: 0;
  padding: 0;
  list-style: none;
}

.row {
  display: flex;
  gap: var(--ds-1);
}

.recall {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: var(--ds-hit-setup);
  padding-inline: var(--ds-3);
  font: 400 var(--ds-t-sm) / 1 var(--ds-font);
  color: var(--ds-text);
  background: var(--ds-raised);
  border: 1px solid var(--ds-border-strong);
  border-radius: var(--ds-r-btn);
  text-align: left;
  cursor: pointer;
}

.recall[aria-current='true'] {
  border-color: var(--ds-accent);
  background: color-mix(in srgb, var(--ds-accent) 12%, var(--ds-raised));
}

.row > .delete {
  width: var(--ds-hit-setup);
  padding: 0;
}

.save {
  display: flex;
  gap: var(--ds-2);
  padding-top: var(--ds-2);
  border-top: 1px solid var(--ds-border);
}

.input {
  flex: 1;
  min-width: 0;
  min-height: var(--ds-hit-setup);
  padding-inline: var(--ds-3);
  font: 400 var(--ds-t-sm) / 1 var(--ds-font);
  color: var(--ds-text);
  background: var(--ds-raised);
  border: 1px solid var(--ds-border-strong);
  border-radius: var(--ds-r-input);
}
```

- [ ] **Step 4: Run the test**

Run: `npm --prefix frontend test -- --run src/songview/SavedLoops.test.tsx`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/songview/SavedLoops.tsx frontend/src/songview/SavedLoops.module.css frontend/src/songview/SavedLoops.test.tsx
git commit -m "feat(song): saved loops menu component"
```

---

### Task 4: One transport — loop bars, saved loops, count-in; the rail goes

After this task the Stems screen has the final transport and no right rail. Play along still uses its own transport until Task 5.

**Files:**
- Create: `frontend/src/songview/ZoomTools.tsx`, `frontend/src/songview/ZoomTools.module.css`, `frontend/src/songview/ZoomTools.test.tsx`
- Modify: `frontend/src/songview/Transport.tsx`, `Transport.module.css`, `Transport.test.tsx`
- Modify: `frontend/src/screens/SongView.tsx`, `SongView.module.css`, `SongView.test.tsx`
- Delete: `frontend/src/songview/RightRail.tsx`, `RightRail.module.css`, `RightRail.test.tsx`

**Interfaces:**
- Consumes: `SavedLoops` (Task 3); `LoopBars({ loop, barCount, onLoopBars })` from `'../playalong/LoopBars'`; `Grid.barCount`; session handlers `onLoopBars`, `onCountInChange`, `onRecallLoop`, `onSaveActiveLoop`, `onDeleteLoop`.
- Produces: `ZoomTools({ zoomLabel, onZoomIn, onZoomOut, onZoomFit, follow, onFollowToggle })`.
- Produces: the new `TransportProps` (below). `hasLoop`, the zoom props and `follow` are gone.

- [ ] **Step 1: ZoomTools, test first**

`frontend/src/songview/ZoomTools.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ZoomTools } from './ZoomTools';

function renderTools(over = {}) {
  const props = {
    zoomLabel: '12 bars in view',
    onZoomIn: vi.fn(),
    onZoomOut: vi.fn(),
    onZoomFit: vi.fn(),
    follow: false,
    onFollowToggle: vi.fn(),
    ...over,
  };
  render(<ZoomTools {...props} />);
  return props;
}

describe('ZoomTools', () => {
  it('offers zoom out / in / Fit with a readout of what is in view', async () => {
    const props = renderTools();
    expect(screen.getByRole('group', { name: 'Zoom' })).toHaveTextContent('12 bars in view');
    await userEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(props.onZoomIn).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect(props.onZoomOut).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole('button', { name: 'Fit' }));
    expect(props.onZoomFit).toHaveBeenCalledOnce();
  });

  it('toggles follow-playhead, reporting its state through aria-pressed', async () => {
    const props = renderTools();
    const follow = screen.getByRole('button', { name: 'Follow playhead' });
    expect(follow).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(follow);
    expect(props.onFollowToggle).toHaveBeenCalledOnce();
  });
});
```

Run: `npm --prefix frontend test -- --run src/songview/ZoomTools.test.tsx` — Expected: FAIL, module missing.

`frontend/src/songview/ZoomTools.tsx`:

```tsx
// How the Stems time axis is drawn: zoom and follow. View state, set up with both
// hands free, so setup tier (40 px). It sits beside the Stems/Tabs switch because it
// means nothing in the Tabs view. The wheel and drag-to-zoom on the axis reach the
// same zoom (U-12).
import { Button } from '../ui';
import styles from './ZoomTools.module.css';

export interface ZoomToolsProps {
  /** What the zoom shows: "Whole song", or how much of it is in view. */
  zoomLabel: string;
  onZoomIn(): void;
  onZoomOut(): void;
  onZoomFit(): void;
  follow: boolean;
  onFollowToggle(): void;
}

export function ZoomTools({ zoomLabel, onZoomIn, onZoomOut, onZoomFit, follow, onFollowToggle }: ZoomToolsProps) {
  return (
    <div className={styles.tools}>
      <div className={styles.readout}>
        <span className={styles.caption} aria-hidden="true">
          Zoom
        </span>
        <div role="group" aria-label="Zoom" className={styles.zoom}>
          <Button aria-label="Zoom out" onClick={onZoomOut}>
            −
          </Button>
          <output className={styles.zoomValue} data-testid="song-zoom">
            {zoomLabel}
          </output>
          <Button aria-label="Zoom in" onClick={onZoomIn}>
            +
          </Button>
          <Button onClick={onZoomFit}>Fit</Button>
        </div>
      </div>
      <Button aria-pressed={follow} onClick={onFollowToggle}>
        Follow playhead
      </Button>
    </div>
  );
}
```

`frontend/src/songview/ZoomTools.module.css` — move the `.view` (renamed `.tools`, without `margin-left: auto`), `.zoom` and `.zoomValue` rules out of `Transport.module.css`, and copy `.readout` and `.caption`:

```css
.tools {
  display: flex;
  align-items: flex-end;
  gap: var(--ds-3);
}

.readout {
  display: flex;
  flex-direction: column;
  gap: var(--ds-1);
  flex: none;
}

.caption {
  font: 600 var(--ds-t-xs) / 1 var(--ds-font);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ds-text-3);
}

.zoom {
  display: flex;
  align-items: center;
  gap: var(--ds-2);
}

.zoomValue {
  min-inline-size: 11ch;
  text-align: center;
  font: 400 var(--ds-t-sm) / 1 var(--ds-mono);
  font-variant-numeric: tabular-nums; /* U-04 */
  color: var(--ds-text-2);
  white-space: nowrap;
}
```

Run the ZoomTools test again — Expected: PASS.

- [ ] **Step 2: Rewrite the Transport tests for the new props**

In `frontend/src/songview/Transport.test.tsx`:

Replace the `props` object in `renderTransport` with:

```tsx
  const props = {
    playing: false,
    grid: grid8(),
    getPosition: () => sampleIndex(0),
    seekNonce: 0,
    tempo: 1,
    pitchSemitones: 0,
    metronome: false,
    countInBars: 0,
    loop: null as { name: string; start_bar: number; end_bar: number } | null,
    loopArmed: false,
    savedLoops: [],
    onPlayPause: vi.fn(),
    onTempoChange: vi.fn(),
    onPitchChange: vi.fn(),
    onMetronomeToggle: vi.fn(),
    onCountInChange: vi.fn(),
    onLoopArmToggle: vi.fn(),
    onLoopBars: vi.fn(),
    onSetLoopStart: vi.fn(),
    onSetLoopEnd: vi.fn(),
    onRecallLoop: vi.fn(),
    onSaveActiveLoop: vi.fn(),
    onDeleteLoop: vi.fn(),
    onNudgeBars: vi.fn(),
    onMuteLane: vi.fn(),
    chords: [],
    ...over,
  };
```

Add above `describe`:

```tsx
const LOOP = { name: '', start_bar: 4, end_bar: 6 };
```

Everywhere a test passes `hasLoop: true`, pass `loop: LOOP`; everywhere `hasLoop: false`, pass `loop: null`.

Delete these four tests: `'withholds Set A/Set B when there is no grid to snap them to'`, `'withholds Set B until there is an A behind it'`, `'offers zoom out / in / Fit with a readout of what is in view'`, `'toggles follow-playhead, reporting its state through aria-pressed'`. Add in their place:

```tsx
  it('loops by bar numbers: there are no Set A / Set B buttons', async () => {
    const props = renderTransport({ loop: LOOP });
    expect(screen.queryByRole('button', { name: /set a/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /set b/i })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Loop start bar')).toHaveTextContent('5');
    expect(screen.getByLabelText('Loop end bar')).toHaveTextContent('6');
    await userEvent.click(screen.getByRole('button', { name: 'End bar later' }));
    expect(props.onLoopBars).toHaveBeenCalledWith(4, 7);
  });

  it('never steps a loop end past the last bar', () => {
    // grid8 has 8 bars.
    renderTransport({ loop: { name: '', start_bar: 6, end_bar: 8 } });
    expect(screen.getByRole('button', { name: 'End bar later' })).toBeDisabled();
  });

  it('without a grid there are no bars: no steppers, no A/B keys, and the Loop button says why', async () => {
    const props = renderTransport({ grid: null });
    expect(screen.queryByLabelText('Loop start bar')).not.toBeInTheDocument();
    const arm = screen.getByRole('button', { name: 'Arm loop' });
    expect(arm).toBeDisabled();
    expect(arm).toHaveAttribute('title', expect.stringMatching(/analysis/i));
    await userEvent.keyboard('a');
    expect(props.onSetLoopStart).not.toHaveBeenCalled();
  });

  it('the B key waits for a loop to end; the A key starts one', async () => {
    const props = renderTransport({ loop: null });
    await userEvent.keyboard('b');
    expect(props.onSetLoopEnd).not.toHaveBeenCalled();
    await userEvent.keyboard('a');
    expect(props.onSetLoopStart).toHaveBeenCalledOnce();
  });

  it('sets the count-in', async () => {
    const props = renderTransport({ countInBars: 1 });
    const group = screen.getByRole('group', { name: 'Count-in' });
    expect(group).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '2 bars' }));
    expect(props.onCountInChange).toHaveBeenCalledWith(2);
  });

  it('carries the saved loops menu', async () => {
    const props = renderTransport({ loop: LOOP, savedLoops: [{ name: 'Chorus', start_bar: 16, end_bar: 24 }] });
    await userEvent.click(screen.getByRole('button', { name: 'Saved loops' }));
    await userEvent.click(screen.getByRole('button', { name: /Recall loop Chorus/ }));
    expect(props.onRecallLoop).toHaveBeenCalledWith({ name: 'Chorus', start_bar: 16, end_bar: 24 });
  });
```

Run: `npm --prefix frontend test -- --run src/songview/Transport.test.tsx`
Expected: FAIL (type errors on unknown props, missing elements).

- [ ] **Step 3: Rewrite `Transport.tsx`**

Replace the whole file with:

```tsx
// The one transport of the song screen, identical over the Stems and the Tabs content
// (UI spec §5 "Transport bar", §7 keyboard). Performance tier throughout: 56 px
// targets, mono tabular numerals (U-04), and an untouched tempo or pitch renders muted
// so the eye finds the one that is not at its default. Loops are set by bar number;
// the A and B keys set the ends to the bar under the playhead.
import { useCallback, useEffect, useMemo, useRef } from 'react';

import type { ChordSegment, Loop } from '../api/client';
import { clampTempo, TEMPO_MAX, TEMPO_MIN, type SampleIndex } from '../engine/types';
import { chordIndexAt, displayChord, mergeChords } from '../music/chords';
import { barAt, type Grid } from '../music/grid';
import { LoopBars } from '../playalong/LoopBars';
import { Button, Segmented } from '../ui';
import { SavedLoops } from './SavedLoops';
import { usePlayhead } from './usePlayhead';
import styles from './Transport.module.css';

const TEMPO_STEP = 0.05; // UI spec §7: up/down arrows move 5%
const NO_BARS = 'Looping needs bars, and bars need analysis to have run';
const COUNT_IN = [0, 1, 2];
// The count-in is played out of the bars *before* the start point, so there has to be
// room for it. Said on the control rather than left to be discovered mid-practice.
const COUNT_IN_NOTE = 'Played from the bars before your start point, so starting at the top of a song plays none';

export interface TransportProps {
  playing: boolean;
  grid: Grid | null;
  getPosition(): SampleIndex;
  /**
   * Bumped by the owner whenever it moves the engine cursor, so this readout
   * repaints after a scrub or a bar nudge made while paused (usePlayhead).
   */
  seekNonce: number;
  tempo: number; // 0.5..1.5
  pitchSemitones: number; // -12..12
  metronome: boolean;
  countInBars: number;
  /** The active loop, 0-based bars, end exclusive. */
  loop: Loop | null;
  loopArmed: boolean;
  savedLoops: Loop[];
  onPlayPause(): void;
  onTempoChange(tempo: number): void;
  onPitchChange(semitones: number): void;
  onMetronomeToggle(): void;
  onCountInChange(bars: number): void;
  onLoopArmToggle(): void;
  onLoopBars(startBar: number, endBar: number): void;
  /** The A and B keys: loop start / end at the bar under the playhead. */
  onSetLoopStart(): void;
  onSetLoopEnd(): void;
  onRecallLoop(loop: Loop): void;
  onSaveActiveLoop(name: string): void;
  onDeleteLoop(name: string): void;
  onNudgeBars(delta: number): void;
  onMuteLane(index: number): void;
  /** The analysis's per-bar chord segments, for the current/next readout. */
  chords: ChordSegment[];
}

export function Transport({
  playing,
  grid,
  getPosition,
  seekNonce,
  tempo,
  pitchSemitones,
  metronome,
  countInBars,
  loop,
  loopArmed,
  savedLoops,
  onPlayPause,
  onTempoChange,
  onPitchChange,
  onMetronomeToggle,
  onCountInChange,
  onLoopArmToggle,
  onLoopBars,
  onSetLoopStart,
  onSetLoopEnd,
  onRecallLoop,
  onSaveActiveLoop,
  onDeleteLoop,
  onNudgeBars,
  onMuteLane,
  chords,
}: TransportProps) {
  const barRef = useRef<HTMLSpanElement | null>(null);
  const chordRef = useRef<HTMLSpanElement | null>(null);
  const nextChordRef = useRef<HTMLSpanElement | null>(null);
  const segments = useMemo(() => mergeChords(chords), [chords]);

  // Derived, never props: `grid === null` *is* "analysis hasn't run", and a loop
  // without a grid has no bars to resolve to samples.
  const barsAvailable = grid !== null;
  const hasLoop = barsAvailable && loop !== null;

  const paint = useCallback(
    (position: SampleIndex) => {
      if (!barRef.current) return;
      // 1-indexed on screen; barAt returns -1 before the first downbeat.
      const bar = grid ? barAt(grid, position) : -1;
      barRef.current.textContent = bar >= 0 ? String(bar + 1) : '--';
      // The chord readout, from the same frame: what is sounding and what
      // comes next -- the merged list, so "next" is the next *change*.
      const i = chordIndexAt(segments, position);
      const now = segments[i];
      const next = segments[i + 1];
      if (chordRef.current) chordRef.current.textContent = now ? displayChord(now.chord).text : '--';
      if (nextChordRef.current) {
        nextChordRef.current.textContent = next ? `→ ${displayChord(next.chord).text}` : '';
      }
    },
    [grid, segments],
  );
  usePlayhead(getPosition, paint, playing, seekNonce);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      // Never steal a key from a text field: the title and loop names are typed here.
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(TEXTAREA|SELECT)$/.test(target.tagName))) {
        return;
      }
      if (target instanceof HTMLInputElement) {
        // A slider (tempo, pitch, lane gain) keeps focus after it is used. It is not text
        // entry, so Space must still reach play/pause -- but its arrow keys are its own,
        // and every other key stays with it as before.
        const isSlider = target.type === 'range';
        if (!(isSlider && event.key === ' ')) return;
      }
      // Never hijack an OS/browser chord (Ctrl/Cmd+A select-all, Ctrl/Cmd+B
      // bookmark bar, etc.). Shift is left alone: the uppercase A/B/L/M
      // entries below exist so a shift-held letter still works.
      if (event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }
      const key = event.key;
      const actions: Record<string, () => void> = {
        ' ': onPlayPause,
        l: () => hasLoop && onLoopArmToggle(),
        L: () => hasLoop && onLoopArmToggle(),
        a: () => barsAvailable && onSetLoopStart(),
        A: () => barsAvailable && onSetLoopStart(),
        b: () => hasLoop && onSetLoopEnd(),
        B: () => hasLoop && onSetLoopEnd(),
        m: onMetronomeToggle,
        M: onMetronomeToggle,
        ArrowUp: () => onTempoChange(clampTempo(Number((tempo + TEMPO_STEP).toFixed(2)))),
        ArrowDown: () => onTempoChange(clampTempo(Number((tempo - TEMPO_STEP).toFixed(2)))),
        ArrowRight: () => onNudgeBars(1),
        ArrowLeft: () => onNudgeBars(-1),
      };
      if (key >= '1' && key <= '4') {
        event.preventDefault();
        onMuteLane(Number(key) - 1);
        return;
      }
      const action = actions[key];
      if (action) {
        event.preventDefault();
        action();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [
    tempo,
    hasLoop,
    barsAvailable,
    onPlayPause,
    onLoopArmToggle,
    onSetLoopStart,
    onSetLoopEnd,
    onMetronomeToggle,
    onTempoChange,
    onNudgeBars,
    onMuteLane,
  ]);

  return (
    <div className={styles.bar}>
      <Button tier="perform" className={styles.play} aria-label={playing ? 'Pause' : 'Play'} onClick={onPlayPause}>
        {playing ? '⏸' : '▶'}
      </Button>

      <span className={styles.barNumber} data-testid="bar-readout" ref={barRef}>
        --
      </span>

      <div className={styles.readout}>
        <span className={styles.caption}>Chord</span>
        <span className={styles.chord}>
          <span data-testid="chord-readout" ref={chordRef}>
            --
          </span>{' '}
          <span className={styles.nextChord} data-testid="chord-next" ref={nextChordRef} />
        </span>
      </div>

      <label className={styles.slider}>
        Tempo
        <input
          type="range"
          aria-label="Tempo"
          min={TEMPO_MIN * 100}
          max={TEMPO_MAX * 100}
          step={1}
          list="tempo-ticks"
          value={Math.round(tempo * 100)}
          onChange={(e) => onTempoChange(Number(e.target.value) / 100)}
        />
        {/* The original tempo, so 100% can be found again by eye. */}
        <datalist id="tempo-ticks">
          <option value="100" />
        </datalist>
        {/* Untouched values render muted (UI spec §5). */}
        <output data-default={tempo === 1 ? 'true' : 'false'}>{Math.round(tempo * 100)}%</output>
      </label>

      <label className={styles.slider}>
        Pitch
        <input
          type="range"
          aria-label="Pitch"
          min={-12}
          max={12}
          step={1}
          value={pitchSemitones}
          onChange={(e) => onPitchChange(Number(e.target.value))}
        />
        <output data-default={pitchSemitones === 0 ? 'true' : 'false'}>{pitchSemitones} st</output>
      </label>

      {/* Bars come from analysis; without a grid there is nothing to loop over, so the
          control is withheld and says why rather than no-opping. */}
      <Button
        tier="perform"
        className={styles.action}
        aria-label="Arm loop"
        aria-pressed={loopArmed}
        disabled={!hasLoop}
        title={!barsAvailable ? NO_BARS : !loop ? 'Set the loop bars first' : undefined}
        onClick={onLoopArmToggle}
      >
        Loop
      </Button>
      {grid && <LoopBars loop={loop} barCount={grid.barCount} onLoopBars={onLoopBars} />}
      <SavedLoops
        savedLoops={savedLoops}
        activeLoop={loop}
        onRecallLoop={onRecallLoop}
        onSaveActiveLoop={onSaveActiveLoop}
        onDeleteLoop={onDeleteLoop}
      />

      <Button
        tier="perform"
        className={styles.action}
        aria-label="Metronome"
        aria-pressed={metronome}
        onClick={onMetronomeToggle}
      >
        Metronome
      </Button>
      <div className={styles.readout} title={COUNT_IN_NOTE}>
        <span className={styles.caption} aria-hidden="true">
          Count-in
        </span>
        <Segmented
          label="Count-in"
          value={String(countInBars)}
          options={COUNT_IN.map((bars) => ({ value: String(bars), label: `${bars} ${bars === 1 ? 'bar' : 'bars'}` }))}
          onChange={(value) => onCountInChange(Number(value))}
        />
      </div>
    </div>
  );
}
```

In `Transport.module.css`: delete the `.view`, `.zoom` and `.zoomValue` rules (moved to `ZoomTools.module.css`), and change `.bar`'s `align-items: center` to `align-items: flex-end` with `gap: var(--ds-3) var(--ds-4)` so captioned controls (loop bars, saved loops, count-in) share a baseline with the buttons.

- [ ] **Step 4: Run the Transport tests**

Run: `npm --prefix frontend test -- --run src/songview/Transport.test.tsx`
Expected: PASS.

- [ ] **Step 5: Update the SongView tests**

In `frontend/src/screens/SongView.test.tsx`, test `'disarms the loop when the user scrubs, visibly (U-06)'`: replace the two lines clicking `set a` and `set b` with:

```tsx
    // No loop yet: the steppers start from bar 1, and stepping the end makes it 1-2.
    await userEvent.click(await screen.findByRole('button', { name: 'End bar later' }));
```

Add:

```tsx
  it('has no right rail: count-in and saved loops are in the transport', async () => {
    renderSongView();
    await screen.findByRole('group', { name: 'vocals stem' });
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
    expect(screen.queryByText(/key candidates/i)).not.toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Count-in' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Saved loops' })).toBeInTheDocument();
  });
```

Run: `npm --prefix frontend test -- --run src/screens/SongView.test.tsx`
Expected: FAIL (rail still present, `End bar later` absent).

- [ ] **Step 6: Rewire `SongView.tsx`**

- Remove the `RightRail` import and the whole `<RightRail … />` element. Add `import { ZoomTools } from '../songview/ZoomTools';`.
- In the `useSongSession()` destructuring, remove `analysis` and add `onLoopBars: handleLoopBars,` (keep `onSetLoopStart`, `onSetLoopEnd`, the three loop-library handlers and `onCountInChange`).
- Replace the `<div className={styles.transport}>…</div>` block with:

```tsx
            <div className={styles.transport}>
              <Transport
                playing={playing}
                grid={grid}
                getPosition={getPosition}
                seekNonce={seekNonce}
                tempo={song.playback.tempo}
                pitchSemitones={song.playback.pitch_semitones}
                metronome={song.metronome}
                countInBars={song.count_in_bars}
                loop={song.active_loop}
                loopArmed={loopArmed}
                savedLoops={song.loops}
                onPlayPause={handlePlayPause}
                onTempoChange={handleTempoChange}
                onPitchChange={handlePitchChange}
                onMetronomeToggle={handleMetronomeToggle}
                onCountInChange={handleCountInChange}
                onLoopArmToggle={handleLoopArmToggle}
                onLoopBars={handleLoopBars}
                onSetLoopStart={handleSetLoopStart}
                onSetLoopEnd={handleSetLoopEnd}
                onRecallLoop={handleRecallLoop}
                onSaveActiveLoop={handleSaveActiveLoop}
                onDeleteLoop={handleDeleteLoop}
                onNudgeBars={handleNudgeBars}
                onMuteLane={handleMuteLane}
                chords={chords}
              />
            </div>

            <div className={styles.viewBar}>
              <ZoomTools
                zoomLabel={zoomLabel}
                onZoomIn={handleZoomIn}
                onZoomOut={handleZoomOut}
                onZoomFit={handleZoomFit}
                follow={follow}
                onFollowToggle={handleFollowToggle}
              />
            </div>
```

- The outer `<section className={styles.page}>` now has one child; remove the `<div className={styles.main}>` wrapper and give the section the flex column itself.

In `SongView.module.css`: replace the `.page` rule's grid with a column and delete `.main`; add `.viewBar`:

```css
.page {
  display: flex;
  flex-direction: column;
  gap: var(--ds-4);
  min-width: 0;
  /* The lane height is the readability budget at 1.5 m, so the screen claims
     the viewport minus AppShell's nav and main padding and hands the slack to
     the lanes. */
  min-height: calc(100dvh - var(--ds-9));
}

/* Tools of the chosen view; Task 5 puts the Stems/Tabs switch at its left. */
.viewBar {
  display: flex;
  justify-content: flex-end;
  align-items: flex-end;
}
```

Update the file's header comment to drop the mention of the 320 px rail.

- [ ] **Step 7: Delete the rail**

```bash
git rm frontend/src/songview/RightRail.tsx frontend/src/songview/RightRail.module.css frontend/src/songview/RightRail.test.tsx
```

- [ ] **Step 8: Run everything**

Run: `npm --prefix frontend test -- --run && npm --prefix frontend run typecheck`
Expected: all pass. (`grep -rn RightRail frontend/src` prints nothing.)

- [ ] **Step 9: Commit**

```bash
git add -A frontend
git commit -m "feat(song): one transport with bar looping, saved loops and count-in; right rail removed"
```

---

### Task 5: SongScreen layout with swappable Stems / Tabs content

**Files:**
- Create: `frontend/src/screens/SongScreen.tsx`, `frontend/src/screens/SongScreen.module.css`, `frontend/src/screens/SongScreen.test.tsx`, `frontend/src/songview/ViewTools.tsx`
- Modify: `frontend/src/app/routes.tsx`, `frontend/src/screens/SongView.tsx`, `SongView.module.css`, `SongView.test.tsx`, `frontend/src/screens/PlayAlong.tsx`, `PlayAlong.test.tsx`, `frontend/src/playalong/PlayAlong.module.css`
- Delete: `frontend/src/playalong/PlayAlongTransport.tsx`

**Interfaces:**
- Consumes: `useSongSession()` incl. `onRename` (Task 2); `Transport` (Task 4); `TitleEditor`; `ZoomTools`.
- Produces: `SongScreen` — a layout route element rendering `<Outlet />`.
- Produces: `ViewTools({ children })` — renders its children into the tools slot beside the Stems/Tabs switch; renders nothing outside a `SongScreen`.

- [ ] **Step 1: Write the failing layout test**

`frontend/src/screens/SongScreen.test.tsx` — copy the `engine` fake, the `vi.mock('../engine/EngineController', …)` block, `songEntry`, `analysis`, `mockFetch`, `beforeEach` and `afterEach` verbatim from `frontend/src/screens/PlayAlong.test.tsx` (lines 12–112), with these imports and this renderer and suite:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SongScope } from '../session/SongScope';
import { PlayAlong } from './PlayAlong';
import { SongScreen } from './SongScreen';
import { SongView } from './SongView';

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/songs/:songId" element={<SongScope />}>
            <Route element={<SongScreen />}>
              <Route index element={<SongView />} />
              <Route path="play" element={<PlayAlong />} />
            </Route>
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('SongScreen', () => {
  it('swaps Stems and Tabs content under the same transport', async () => {
    renderAt('/songs/abc123');
    expect(await screen.findByTestId('time-axis')).toBeInTheDocument();
    const play = screen.getByRole('button', { name: 'Play' });
    const stems = screen.getByRole('link', { name: 'Stems' });
    expect(stems).toHaveAttribute('aria-current', 'page');

    await userEvent.click(screen.getByRole('link', { name: 'Tabs' }));
    expect(await screen.findByTestId('neck-canvas')).toBeInTheDocument();
    expect(screen.queryByTestId('time-axis')).not.toBeInTheDocument();
    // The very same button element: the transport did not remount.
    expect(screen.getByRole('button', { name: 'Play' })).toBe(play);
    expect(screen.getByRole('link', { name: 'Tabs' })).toHaveAttribute('aria-current', 'page');

    await userEvent.click(screen.getByRole('link', { name: 'Stems' }));
    expect(await screen.findByTestId('time-axis')).toBeInTheDocument();
  });

  it('shows each view’s own tools beside the switch', async () => {
    renderAt('/songs/abc123');
    expect(await screen.findByRole('button', { name: 'Follow playhead' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('link', { name: 'Tabs' }));
    expect(await screen.findByRole('link', { name: /scale & fretboard/i })).toHaveAttribute('href', '/songs/abc123/scale');
    expect(screen.queryByRole('button', { name: 'Follow playhead' })).not.toBeInTheDocument();
  });

  it('has the full transport in the Tabs view: pitch, loop bars, saved loops', async () => {
    renderAt('/songs/abc123/play');
    expect(await screen.findByRole('slider', { name: 'Pitch' })).toBeInTheDocument();
    expect(screen.getByLabelText('Loop start bar')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Saved loops' })).toBeInTheDocument();
    // One of each: the Tabs view no longer brings a transport of its own.
    expect(screen.getAllByRole('slider', { name: 'Tempo' })).toHaveLength(1);
  });

  it('keeps the transport when the Tabs content has nothing to show', async () => {
    mockFetch(404);
    renderAt('/songs/abc123/play');
    expect(await screen.findByText(/needs analysis/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument());
  });

  it('renames from either view', async () => {
    renderAt('/songs/abc123/play');
    await userEvent.click(await screen.findByRole('button', { name: 'Rename' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Title' }), ' 2{Enter}');
    expect(await screen.findByRole('heading', { name: 'Test Song 2' })).toBeInTheDocument();
  });
});
```

Run: `npm --prefix frontend test -- --run src/screens/SongScreen.test.tsx`
Expected: FAIL — cannot resolve `./SongScreen`.

- [ ] **Step 2: `ViewTools`**

`frontend/src/songview/ViewTools.tsx`:

```tsx
// The row under the transport holds the Stems/Tabs switch and, beside it, the tools
// that belong to whichever view is showing (zoom and follow for Stems, the scale link
// for Tabs). The views are child routes, so they hand their tools up through a portal
// into the slot SongScreen owns.
import { createContext, useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export const ViewToolsContext = createContext<HTMLElement | null>(null);

export function ViewTools({ children }: { children: ReactNode }) {
  const slot = useContext(ViewToolsContext);
  return slot ? createPortal(children, slot) : null;
}
```

- [ ] **Step 3: `SongScreen`**

`frontend/src/screens/SongScreen.tsx`:

```tsx
// The song screen (UI spec §6, screen 3): one header, one transport, and under them
// the content the player switches between -- Stems (the time axis and mixer) or Tabs
// (the play-along neck). The session and the engine live one route up, in SongScope
// (D-18), so switching content never stops the music; this layout only makes sure the
// controls do not move either.
import { useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';

import { useSongSession } from '../session/SongSession';
import { TitleEditor } from '../songview/TitleEditor';
import { Transport } from '../songview/Transport';
import { ViewToolsContext } from '../songview/ViewTools';
import styles from './SongScreen.module.css';

export function SongScreen() {
  const session = useSongSession();
  const {
    songId,
    entry,
    isPending,
    loadError,
    fetchedSong,
    hasStems,
    analysisError,
    notAnalyzedYet,
    chords,
    grid,
    song,
    engine,
    engineError,
    saveError,
    playing,
    loopArmed,
    seekNonce,
    getPosition,
  } = session;
  // As state, so the views' ViewTools re-render once the slot element exists.
  const [toolsSlot, setToolsSlot] = useState<HTMLDivElement | null>(null);

  if (isPending) return <p className={styles.note}>Loading song&hellip;</p>;
  if (loadError !== null) {
    return (
      <p role="alert" className={styles.alert}>
        {String(loadError)}
      </p>
    );
  }

  // §9 / U-09: a song.json we could not parse says so in the server's own
  // words, and offers nothing that would need it.
  if (entry?.unreadable) {
    return (
      <section className={styles.empty}>
        <h1>{songId}</h1>
        <p role="alert" className={styles.alert}>
          {entry.unreadable}
        </p>
      </section>
    );
  }

  if (!hasStems) {
    return (
      <section className={styles.empty}>
        <h1>{fetchedSong?.title ?? songId}</h1>
        <p className={styles.note}>
          This song has not been separated yet &mdash; playback needs its four stems.
        </p>
        <Link className={styles.link} to="/jobs">
          Job queue &rarr;
        </Link>
      </section>
    );
  }

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <Link className={styles.link} to="/">
          &larr; Library
        </Link>
        <TitleEditor
          title={song?.title ?? fetchedSong?.title ?? songId}
          artist={song?.artist ?? fetchedSong?.artist ?? ''}
          onRename={session.onRename}
        />
        <Link className={`${styles.link} ${styles.export}`} to={`/songs/${songId}/export`}>
          Export
        </Link>
      </header>

      {engineError && (
        <p role="alert" className={styles.alert}>
          {engineError}
        </p>
      )}
      {/* ApiError's message already carries the server's own detail, so it is
          shown as it came rather than paraphrased into reassurance. */}
      {saveError && (
        <p role="alert" className={styles.alert}>
          {saveError.message}
        </p>
      )}
      {analysisError !== null && !notAnalyzedYet && (
        <p role="alert" className={styles.alert}>
          {String(analysisError)}
        </p>
      )}
      {!engine && !engineError && <p className={styles.note}>Loading stems&hellip;</p>}

      {/* Pinned while the page scrolls: the one surface touched with an instrument in
          hand, found in the same place whichever content is showing. */}
      {engine && song && (
        <div className={styles.transport}>
          <Transport
            playing={playing}
            grid={grid}
            getPosition={getPosition}
            seekNonce={seekNonce}
            tempo={song.playback.tempo}
            pitchSemitones={song.playback.pitch_semitones}
            metronome={song.metronome}
            countInBars={song.count_in_bars}
            loop={song.active_loop}
            loopArmed={loopArmed}
            savedLoops={song.loops}
            onPlayPause={session.onPlayPause}
            onTempoChange={session.onTempoChange}
            onPitchChange={session.onPitchChange}
            onMetronomeToggle={session.onMetronomeToggle}
            onCountInChange={session.onCountInChange}
            onLoopArmToggle={session.onLoopArmToggle}
            onLoopBars={session.onLoopBars}
            onSetLoopStart={session.onSetLoopStart}
            onSetLoopEnd={session.onSetLoopEnd}
            onRecallLoop={session.onRecallLoop}
            onSaveActiveLoop={session.onSaveActiveLoop}
            onDeleteLoop={session.onDeleteLoop}
            onNudgeBars={session.onNudgeBars}
            onMuteLane={session.onMuteLane}
            chords={chords}
          />
        </div>
      )}

      <div className={styles.viewBar}>
        {/* Links, not buttons: each view keeps its own URL (D-14). */}
        <nav className={styles.switch} aria-label="View">
          <NavLink end to={`/songs/${songId}`}>
            Stems
          </NavLink>
          <NavLink to={`/songs/${songId}/play`}>Tabs</NavLink>
        </nav>
        <div className={styles.tools} ref={setToolsSlot} />
      </div>

      <ViewToolsContext.Provider value={toolsSlot}>
        <Outlet />
      </ViewToolsContext.Provider>
    </section>
  );
}
```

`frontend/src/screens/SongScreen.module.css` — `.alert`, `.note`, `.empty`, `.empty h1`, `.link` and `.transport` are **moved** here unchanged from `SongView.module.css`; the rest is new:

```css
/* UI spec §6, screen 3. A column: header, the pinned transport, the Stems/Tabs switch
   with the chosen view's tools, then the content, which takes the remaining height. */
.page {
  display: flex;
  flex-direction: column;
  gap: var(--ds-4);
  min-width: 0;
  /* The lane height is the readability budget at 1.5 m, so the screen claims
     the viewport minus AppShell's nav and main padding and hands the slack to
     the content. */
  min-height: calc(100dvh - var(--ds-9));
}

.header {
  display: flex;
  align-items: center;
  gap: var(--ds-4);
}

.link {
  color: var(--ds-accent);
  min-height: var(--ds-hit-setup);
  display: inline-flex;
  align-items: center;
}

.export {
  margin-left: auto;
}

/* Stays pinned at the top while the page scrolls. Above the axis's sticky head
   column (z 2). */
.transport {
  position: sticky;
  top: 0;
  z-index: 4;
  padding-bottom: var(--ds-2);
  background: var(--ds-ground);
}

.viewBar {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--ds-4);
}

/* The segmented control's look (design system .seg), on links. 48 px: it is reached
   for between takes, more often than setup controls, less than the transport. */
.switch {
  display: inline-flex;
  gap: 3px;
  padding: 3px;
  background: var(--ds-ground);
  border: 1px solid var(--ds-border-strong);
  border-radius: var(--ds-r-btn);
}

.switch a {
  display: inline-flex;
  align-items: center;
  min-height: 48px;
  padding: 0 var(--ds-6);
  border-radius: 5px;
  color: var(--ds-text-2);
  font: 600 var(--ds-t-md) / 1 var(--ds-font);
  text-decoration: none;
}

.switch a[aria-current='page'] {
  background: var(--ds-overlay);
  color: var(--ds-text);
}

.tools {
  display: flex;
  align-items: flex-end;
  gap: var(--ds-4);
}

.note {
  color: var(--ds-text-2);
  font-size: var(--ds-t-sm);
}

.alert {
  margin: 0;
  padding: var(--ds-3) var(--ds-4);
  border: 1px solid var(--ds-error);
  border-radius: var(--ds-r-panel);
  background: color-mix(in srgb, var(--ds-error) 12%, transparent);
  color: var(--ds-text);
  font-family: var(--ds-mono);
  font-size: var(--ds-t-sm);
  white-space: pre-wrap;
}

.empty {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--ds-3);
  padding: var(--ds-6);
  background: var(--ds-surface);
  border: 1px solid var(--ds-border);
  border-radius: var(--ds-r-panel);
}

.empty h1 {
  margin: 0;
  font: 600 var(--ds-t-lg) / var(--ds-lh-lg) var(--ds-font);
}
```

- [ ] **Step 4: Routes**

`frontend/src/app/routes.tsx`: import `SongScreen` from `'../screens/SongScreen'` and replace the song-scope block with:

```tsx
          {/* D-18: one session per song, above the content that plays it. SongScreen is
              the shared header, transport and Stems/Tabs switch; the two child routes
              are only the content under it, so switching never stops playback and
              never moves a control. */}
          <Route path="songs/:songId" element={<SongScope />}>
            <Route element={<SongScreen />}>
              <Route index element={<SongView />} />
              <Route path="play" element={<PlayAlong />} />
            </Route>
          </Route>
```

- [ ] **Step 5: `SongView` becomes the Stems content**

In `frontend/src/screens/SongView.tsx`:

- Header comment: replace the first paragraph with `// The Stems content of the song screen (UI spec §6, screen 3): one time axis -- ruler, chord row, four stem lanes. The header, the transport and the view switch are SongScreen's; the engine and the recipe are the session's (D-18). This file owns only how the time axis is drawn: zoom, follow, pan and drag-to-zoom.`
- Remove imports `Link` and `TitleEditor` and `Transport`; add `import { ViewTools } from '../songview/ViewTools';`.
- Reduce the `useSongSession()` destructuring to what is still used: `chords, grid, song, engine, soloed, playing, loopArmed, seekNonce, getPosition, onScrub: handleScrub, onMuteToggle: handleMuteToggle, onSoloToggle: handleSoloToggle, onGainChange: handleGainChange`.
- Replace everything from `if (isPending)` to the end of the component with:

```tsx
  // Loading, errors and the no-stems case are SongScreen's to say.
  if (!engine || !song) return null;

  return (
    <>
      <ViewTools>
        <ZoomTools
          zoomLabel={zoomLabel}
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
          onZoomFit={handleZoomFit}
          follow={follow}
          onFollowToggle={handleFollowToggle}
        />
      </ViewTools>

      {/* One time axis: ruler, chords and the four lanes are rows of a
          single horizontally scrolling canvas, so a chord, its bar line
          and the waveform under it always move together. */}
      <div
        ref={setScroller}
        data-testid="time-axis-scroller"
        className={styles.scroller}
        onWheel={handleAxisWheel}
        onPointerDown={handleAxisPointerDown}
        onPointerMove={handleAxisPointerMove}
        onPointerUp={handleAxisPointerUp}
        onPointerCancel={handleAxisPointerCancel}
      >
        {/* …the existing <div data-testid="time-axis"> subtree, unchanged: selection,
            Timeline, ChordStrip, the four StemLanes… */}
      </div>
    </>
  );
```

  The `time-axis` subtree (from `<div data-testid="time-axis"` through its closing `</div>`) is kept exactly as it is today; only its wrappers change.

- `SongView.module.css`: delete `.page`, `.header`, `.link`, `.transport`, `.viewBar`, `.note`, `.alert`, `.empty`, `.empty h1` (all now in `SongScreen.module.css`). Keep `.scroller` and its scrollbar rules, `.axis`, `.selection`, `.lanes`. Replace the file's header comment with `/* The Stems content: one horizontally scrolling time axis. Layout around it is SongScreen's. */`.

- [ ] **Step 6: `PlayAlong` becomes the Tabs content**

Replace the component body of `frontend/src/screens/PlayAlong.tsx` (keep the file's opening comment, changing "Play along (D-18): the practice screen. Song view is where a song is edited; this is where you play with it" to "The Tabs content of the song screen (D-18): where Stems shows the audio, this shows what to play"):

```tsx
import { useMemo } from 'react';

import { patternSource } from '../music/tabSource';
import { BeatLane } from '../playalong/BeatLane';
import { ChordRibbon } from '../playalong/ChordRibbon';
import { Neck } from '../playalong/Neck';
import { NowReadout } from '../playalong/NowReadout';
import { PatternPanel } from '../playalong/PatternPanel';
import styles from '../playalong/PlayAlong.module.css';
import { useSongSession } from '../session/SongSession';
import { ViewTools } from '../songview/ViewTools';
import { Banner, EmptyState, Panel, TextLink } from '../ui';

export function PlayAlong() {
  const session = useSongSession();
  const { songId, analysis, notAnalyzedYet, grid, song, engine, playing, loopArmed, seekNonce, getPosition } = session;

  const loopStart = song?.active_loop?.start_bar ?? null;
  const loopEnd = song?.active_loop?.end_bar ?? null;
  const armedLoop = useMemo(
    () => (loopArmed && loopStart !== null && loopEnd !== null ? { startBar: loopStart, endBar: loopEnd } : null),
    [loopArmed, loopStart, loopEnd],
  );

  const result = useMemo(
    () => (song && analysis && grid ? patternSource.barsFor({ song, analysis, grid, loop: armedLoop }) : null),
    [song, analysis, grid, armedLoop],
  );

  // The transport above still plays; only this content has nothing to draw.
  if (notAnalyzedYet) {
    return (
      <EmptyState title="This song needs analysis">
        Tabs are built from the chord chart and the beat grid, which appear after analysis.
      </EmptyState>
    );
  }
  // Loading and engine errors are SongScreen's to say.
  if (!engine || !song) return null;

  return (
    <>
      <ViewTools>
        <TextLink to={`/songs/${songId}/scale`}>Scale &amp; fretboard &rarr;</TextLink>
      </ViewTools>

      {analysis && !grid && (
        <Banner tone="error" title="The beat grid is unusable">
          The analysis found fewer than two downbeats, so there are no bars to play along to.
        </Banner>
      )}
      {result && !result.ok && <Banner tone="error" title="No patterns" trace={result.error} />}

      {grid && result?.ok && (
        <>
          <Panel className={styles.panel}>
            <PatternPanel
              candidates={analysis?.key_candidates ?? []}
              value={song.play_along}
              onChange={session.onPlayAlongChange}
              pitchSemitones={song.playback.pitch_semitones}
            />
          </Panel>

          <Panel className={styles.panel}>
            <NowReadout
              bars={result.bars}
              nextOf={result.nextOf}
              songKey={result.key}
              grid={grid}
              pitchSemitones={song.playback.pitch_semitones}
              getPosition={getPosition}
              playing={playing}
              seekNonce={seekNonce}
            />
            <div className={styles.board}>
              <Neck
                bars={result.bars}
                nextOf={result.nextOf}
                songKey={result.key}
                grid={grid}
                getPosition={getPosition}
                playing={playing}
                seekNonce={seekNonce}
              />
              <BeatLane
                bars={result.bars}
                nextOf={result.nextOf}
                songKey={result.key}
                grid={grid}
                getPosition={getPosition}
                playing={playing}
                seekNonce={seekNonce}
              />
            </div>
            <ChordRibbon
              bars={result.bars}
              songKey={result.key}
              loop={song.active_loop}
              grid={grid}
              getPosition={getPosition}
              playing={playing}
              seekNonce={seekNonce}
              onLoopBars={session.onLoopBars}
              onSeekBar={session.onSeekBar}
            />
          </Panel>

          <Banner tone="warn" role="note" title="A practice pattern over the detected chords, not a transcription">
            These notes are generated from the chord chart and the key you pick. The arithmetic is exact, but the chords
            themselves are detected and can be wrong. A bar with no chord shows an empty neck saying so; nothing is
            guessed.
          </Banner>
        </>
      )}
    </>
  );
}
```

Then:

```bash
git rm frontend/src/playalong/PlayAlongTransport.tsx
```

In `frontend/src/playalong/PlayAlong.module.css` delete the rules nothing uses any more: `.page`, `.header`, `.titles h1`, `.sub`, `.transport`, `.slider`, `.slider output`. Update the file's first comment line to drop the reference to `play-along.html` mirroring a standalone screen: `/* The Tabs content of the song screen (D-18), and the loop-bar steppers the transport shares. */`. Confirm with `grep -n "styles\.\(page\|header\|titles\|sub\|transport\|slider\)\b" -r frontend/src/playalong frontend/src/screens/PlayAlong.tsx` — expected: no output.

- [ ] **Step 7: Update the two existing screen test harnesses**

`frontend/src/screens/SongView.test.tsx`: import `SongScreen` from `'./SongScreen'` and nest the index route in `renderSongView`:

```tsx
          <Route path="/songs/:songId" element={<SongScope />}>
            <Route element={<SongScreen />}>
              <Route index element={<SongView />} />
            </Route>
          </Route>
```

`frontend/src/screens/PlayAlong.test.tsx`: same nesting in `renderAt` (import `SongScreen`), wrapping both the index and the `play` routes. Replace the test `'is linked from Song view, and links back'` with:

```tsx
  it('is one click from the Stems content, and back', async () => {
    renderAt('/songs/abc123');
    await userEvent.click(await screen.findByRole('link', { name: 'Tabs' }));
    expect(await screen.findByTestId('neck-canvas')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('link', { name: 'Stems' }));
    expect(await screen.findByTestId('time-axis')).toBeInTheDocument();
  });
```

- [ ] **Step 8: Run everything**

Run: `npm --prefix frontend test -- --run && npm --prefix frontend run typecheck && npm --prefix frontend run build`
Expected: all pass; the build prints no chunk-size warning that was not there before.

- [ ] **Step 9: Look at it**

Start the app with the `dev-setup` skill's commands (worker, API, Vite) and open a separated, analysed song. Check, in both Stems and Tabs:

1. The header, transport and switch do not move when switching; playback continues.
2. Loop bars `−`/`+` move the blue region in Stems and the highlighted cells in Tabs.
3. Saved loops: name and save the current bars, recall another, delete one; the menu opens over the content, not under it.
4. Rename: the title changes here and, after about a second, on the Library card.
5. At 1100 px window width nothing in the transport overlaps; it wraps.

- [ ] **Step 10: Listen (R-01)**

Reading faster than real time is new for the engine: the stem cursor now skips samples (`readRate` up to 1.5) before the time-stretcher. With the metronome on and a two-bar loop armed, listen at 150 %, 125 % and 100 %:

- the click stays on the beat and the loop wrap has no click or gap at every tempo (N-05);
- cymbals and vocals at 150 % have no new whistling or harshness compared with 100 %.

If the wrap clicks, stop and treat it as a bug in this task (superpowers:systematic-debugging). If 150 % sounds harsh but the wrap is clean, record it in Task 6's N-04 wording ("clean to about X %") rather than lowering the ceiling.

- [ ] **Step 11: Commit**

```bash
git add -A frontend
git commit -m "feat(song): one song screen with swappable Stems and Tabs content"
```

---

### Task 6: Specs, design pages, README, screenshots; push

**Files:**
- Modify: `design/tech-spec-stemcraft.md`, `design/domain-spec.md`, `design/ui-spec.md`
- Modify: `design/ui/src/pages/screens/song-view.html`, `design/ui/src/pages/screens/play-along.html`, `design/ui/src/pages/components/transport.html`
- Modify: `README.md`, `scripts/capture-screens.mjs` (only if the capture needs a new height), `docs/screenshots/song-view.png`, `docs/screenshots/play-along.png`

- [ ] **Step 1: Tech spec and domain spec**

`design/tech-spec-stemcraft.md`, N-04 — replace with:

```markdown
- **N-04** — Tempo range **50–150 %** without pitch change; subjectively clean from
  ~70 % up, usable below. Pitch shift clean within **±2–3 semitones**. (Amended
  2026-09-30: the ceiling was 100 %; playing faster than the record is practice too.)
```

(Adjust "clean from ~70 % up" only if Task 5 Step 10 found otherwise.) In the D-18 entry, add one sentence at the end of its first paragraph: `Since 2026-09-30 the two are one screen: SongScreen renders the header, the transport and a Stems/Tabs switch, and the two routes are only the content under it.`

`design/domain-spec.md`: change `- **Tempo** 50–100% without changing pitch` to `- **Tempo** 50–150% without changing pitch`; in the same list change the A–B loop line to `- **Loop** by bar numbers, snapped to bars`; add `- **Rename** title and artist in place` to the Song view list. If the domain spec's library section lists song actions, add rename there too.

- [ ] **Step 2: UI spec**

`design/ui-spec.md`:

- §5 component table: delete the "Right rail" row; change the Transport bar row's description to `bar number in display/48 mono; untouched tempo/pitch values render muted; loop set by bar steppers; saved loops menu; count-in. Identical over Stems and Tabs`; add a row `| View switch | setup (48 px) | Stems / Tabs, two links styled as a segmented control; the chosen view's own tools sit to its right |`.
- §6 item 3 — replace the whole item with:

```markdown
3. **Song screen** — the hard screen, and the only one a song is played on. Top to
   bottom: a header (back to library, title and artist with in-place **Rename**, Export);
   the transport, pinned (play, bar, chord → next, tempo 50–150 % with a tick at 100 %,
   pitch, loop, loop bars, saved loops, metronome, count-in); a **Stems / Tabs** switch
   with the chosen view's tools beside it; then the content. **Stems** is one
   horizontally scrolling time axis holding the seek ruler, the chord row aligned to
   bars, and four full-height stem lanes with beat and downbeat grid, loop region and
   playhead; the 200 px lane heads stay put while it scrolls; its tools are zoom and
   Follow playhead (U-12). **Tabs** is the play-along content: key and pattern pickers,
   the neck, the beat lane and the chord ribbon; its tool is the Scale & fretboard link.
   There is no right rail. Switching content never stops playback and never moves a
   control (D-18). Every value auto-saves to `song.json`; zoom and scroll are view state
   and never do. Mockup: `docs/superpowers/specs/2026-09-30-unified-song-screen-mockup.html`.
```

  If §6 has a separate "Play along" item, reduce it to one line pointing at item 3.
- §7: change `` `A`/`B` set loop points at the current bar `` to `` `A`/`B` set the loop's start / end to the current bar (the transport's loop-bar steppers do the same by number) `` and `` `↑`/`↓` tempo ±5 % `` stays. Add: `All of these work in both Stems and Tabs.`
- §8: delete the "Practice mode" bullet (the rail it proposed dropping is gone).

- [ ] **Step 3: Design-system pages**

The mockup is the source. In `design/ui/src/pages/screens/song-view.html` and `play-along.html`:

- Replace each page's `.topbar` block with the mockup's topbar in its display state (the `titlebtn` with the pencil, no edit form, the Export button).
- Replace each page's transport panel with the mockup's `.tpanel` block (both rows), followed by the mockup's `.viewbar` block — in `song-view.html` with "Stems" selected and the zoom tools; in `play-along.html` with "Tabs" selected and the chip.
- `song-view.html`: delete the `.rail` block, change `.body2` to a single column (`display:flex;flex-direction:column`), and drop the `border-right` on `.stage`.
- `play-along.html`: delete its old transport panel; add the ghost button `Scale &amp; fretboard &rarr;` after the key picker.
- Copy the mockup's "new in this design" CSS rules (`.tpanel`, `.barstep`, `.viewbar`, `.viewseg`, `.titlebtn`, `.loopmenu`, `.loopspop`, `.lx`) into each page's local `<style>`.
- Update both `@dsCard` first lines: `name="Song screen — Stems"` / `name="Song screen — Tabs"`, subtitle `One header, one pinned transport, swappable content`.
- `components/transport.html`: replace the Set A / Set B buttons with the loop-bar steppers and add the Saved loops button and count-in, matching the mockup's second transport row; tempo readout example `120%` with a centre tick.

Run: `python3 design/ui/build.py`
Expected: `built N pages -> …/design/ui/dist`, no error. Open `design/ui/dist/screens/song-view.html` and `play-along.html` and compare with the mockup.

- [ ] **Step 4: README**

In `README.md`'s feature list:

- Replace the "Song view time axis…" bullet's opening words with "Stems view time axis…".
- Replace "Tempo and pitch change without re-separating; stems are never modified" with "Tempo (50–150 %) and pitch change without re-separating; stems are never modified".
- Replace "Sample-accurate seamless loops on the beat grid, with optional count-in" with "Sample-accurate seamless loops set by bar number, saved by name, with optional count-in".
- Add: "One song screen: the transport stays put while you switch between Stems (waveforms and mixer) and Tabs (the play-along neck); the music never stops".
- Add: "Rename a song's title and artist in place".
- In the Play along bullet: "Play along screen for bass" → "Tabs view for bass"; "playback carries on when you switch back to the Song view" → delete (covered by the new bullet).

Then re-read the run instructions and the screenshot captions against what shipped; rename the captions to "Song screen — Stems" and "Song screen — Tabs".

- [ ] **Step 5: Screenshots**

With the app running and a separated, analysed song's id:

```bash
node scripts/capture-screens.mjs song-view=/songs/<id> play-along=/songs/<id>/play
```

Look at both PNGs in `docs/screenshots/`. If the Tabs capture cuts off the ribbon or shows empty space below the banner, adjust `HEIGHTS['play-along']` in `scripts/capture-screens.mjs` and re-run. If the README's documented capture command lists the song routes, leave it as it is — the routes did not change.

- [ ] **Step 6: Full verification**

```bash
uv run pytest -q && uv run ruff check packages ops && npm --prefix frontend test -- --run && npm --prefix frontend run typecheck && npm --prefix frontend run build
```

Expected: everything passes.

- [ ] **Step 7: Commit and push**

```bash
git add -A
git commit -m "docs: unified song screen in specs, design pages, README and screenshots"
git push origin main
```

---

## Self-review notes

- **Requirement coverage:** rename → Task 2 (and reachable in both views, Task 5); same playback control with bar looping → Tasks 4–5; tempo beyond 100 % → Task 1; unified screen with swappable content and a fixed transport → Task 5; rail removal (agreed after the first mockup) → Task 4; A/B keys kept, 150 % ceiling → Tasks 1 and 4.
- **Known risk:** reading the stems faster than real time has never been exercised (R-01). Task 5 Step 10 is the gate; the loop wrap code itself is untouched.
- **Not in scope:** validating `playback.tempo` on `PUT /api/songs/{id}` (it is only validated at export today, and that is unchanged); a beat number in the transport; a fill-from-centre tempo slider.
