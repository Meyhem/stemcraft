# End-of-song replay fix, clickable play-along bars, album tracks to library: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clear three backlog items: pressing play after a Song has ended restarts it cleanly, clicking a bar in the Play along chord ribbon moves the playhead there, and split album tracks can be added to the library as Songs.

**Architecture:** All three are frontend-only. The replay bug is fixed inside `EngineController` (the engine remembers it reached the end and rewinds on the next play). Bar seek adds one session handler and re-maps the ribbon's click. Tracks reach the library through the existing `POST /api/songs/upload` route, which is the seam Phase 8 recorded when it closed Q-04, so no API, worker or schema change is needed.

**Tech Stack:** React 19, TypeScript, TanStack Query, Vitest + Testing Library, the custom Web Audio engine in `frontend/src/engine/`.

**Spec:** [design/domain-spec.md](../../../design/domain-spec.md) (Backlog, "Play along", "Album splitter"), [design/tech-spec-stemcraft.md](../../../design/tech-spec-stemcraft.md) (D-06, D-18, Q-04, U-05, U-06, N-08), [2026-09-29-play-along-design.md](../specs/2026-09-29-play-along-design.md), [2026-09-28-phase-8-album-splitter.md](2026-09-28-phase-8-album-splitter.md) (Q-04 seam).

## Global Constraints

- The API never imports torch; this plan does not touch the API or the worker at all.
- One writer per file: the API owns `song.json` and an upload's `original.*`. Tracks become Songs only through `POST /api/songs/upload`.
- Never seek the time-stretcher (D-06). Every seek in this plan moves the worklet's read cursor only, as `EngineController.seek` already does.
- The playhead is painted from the engine clock via `usePlayhead`, never React state (U-05).
- Fail loudly (N-08): errors reach the UI with the server's real message.
- Match the surrounding code's comment density and idiom.
- Work on `main`. After each task: tests and typecheck pass, README upkeep done, commit, `git push origin main`.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Commands run from the repo root. Frontend tests: `npm --prefix frontend test -- <file>`. Typecheck: `npm --prefix frontend run typecheck`.

## Decisions this plan makes

- **Play at the end restarts from the top.** Root cause of the spasm: when the cursor reaches the end the worklet posts `ended` once and keeps `endedReported` true. A second `play()` leaves the cursor parked at the end, so no new `ended` arrives and the engine stays "playing". The clock then extrapolates forward and every ~107 ms position report snaps it back to the end.
- **Ribbon click re-map.** Plain click seeks to the bar. Shift-click still sets the loop end. Ctrl/Cmd-click sets the loop start (what plain click did before). The Loop bars steppers are unchanged.
- **Seeking to a bar inside an armed loop keeps the loop armed.** A seek outside it releases the loop first, exactly as `onScrub` does (U-06). The engine's wrap logic is only unsafe for a cursor outside the region.
- **Q-04 stays closed on the server.** The browser downloads the rendered MP3 and posts it to the song upload route; the ID3 tags the split wrote supply title and artist. Accepted costs: one extra lossy generation (320 kbps MP3 rather than a cut of `audio.wav`), and "already added" is remembered only for the page session, so adding twice after a reload makes a duplicate Song, the same as uploading a file twice.

---

### Task 1: Play after the end restarts from the top

**Files:**
- Modify: `frontend/src/engine/EngineController.ts`
- Test: `frontend/src/engine/EngineController.test.ts`
- Modify: `design/domain-spec.md` (Backlog)

**Interfaces:**
- Consumes: nothing new.
- Produces: no signature changes. `play()` and `countInAndPlay()` start from sample 0 when the stems have ended; `getPositionSamples()` never exceeds `durationSamples`.

- [ ] **Step 1: Expose `endedBox` from the test factory**

In `frontend/src/engine/EngineController.test.ts`, change the last line of `makeController` from

```ts
  return { controller, context, cursorNode, clock };
```

to

```ts
  return { controller, context, cursorNode, clock, endedBox };
```

- [ ] **Step 2: Write the failing tests**

Append to `frontend/src/engine/EngineController.test.ts`:

```ts
describe('EngineController at the end of the stems', () => {
  it('parks the clock exactly on the end when the stems end', async () => {
    const { controller, context, cursorNode, endedBox } = makeController(0);
    await controller.play();
    context.currentTime = 1;
    endedBox.fire();
    expect(controller.getPositionSamples()).toBe(controller.durationSamples);
    context.currentTime = 5;
    expect(controller.getPositionSamples()).toBe(controller.durationSamples);
    expect(cursorNode.parameters.get('playing')!.value).toBe(0);
  });

  it('play after the end starts from the top instead of sitting on the end', async () => {
    const { controller, context, cursorNode, endedBox } = makeController(0);
    await controller.play();
    endedBox.fire();
    cursorNode.port.postMessage.mockClear();

    context.currentTime = 10;
    await controller.play();
    expect(cursorNode.port.postMessage).toHaveBeenCalledWith({ type: 'seek', position: 0 });
    expect(controller.getPositionSamples()).toBe(0);
    context.currentTime = 11;
    expect(controller.getPositionSamples()).toBe(SAMPLE_RATE);
  });

  it('a seek after the end is respected by the next play', async () => {
    const { controller, endedBox } = makeController(0);
    await controller.play();
    endedBox.fire();
    controller.seek(sampleIndex(1234));
    await controller.play();
    expect(controller.getPositionSamples()).toBe(1234);
  });

  it('a count-in after the end counts into the top, not into the end', async () => {
    const { controller, cursorNode, endedBox } = makeController(0);
    await controller.play();
    endedBox.fire();
    cursorNode.port.postMessage.mockClear();

    const restore = vi.fn();
    const done = controller.countInAndPlay(controller.durationSamples, 1, BAR_STARTS, restore);
    await waitForRaf();
    flushOneFrame();
    await done;
    expect(restore).toHaveBeenCalledTimes(1);
    expect(cursorNode.port.postMessage).toHaveBeenCalledWith({ type: 'seek', position: 0 });
    expect(cursorNode.port.postMessage).not.toHaveBeenCalledWith({ type: 'seek', position: 10_000_000 });
  });

  it('never reports a position past the end', async () => {
    const { controller, context } = makeController(0);
    controller.seek(sampleIndex(9_990_000));
    await controller.play();
    context.currentTime = 10;
    expect(controller.getPositionSamples()).toBe(10_000_000);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm --prefix frontend test -- src/engine/EngineController.test.ts`
Expected: the five new tests FAIL (the first with a position of 48000 rather than 10000000); the existing ones pass.

- [ ] **Step 4: Implement**

In `frontend/src/engine/EngineController.ts`:

Add a field under `pendingCountIn`:

```ts
  // Set when the worklet reports the stems ended, cleared by any seek. The
  // worklet reports `ended` once per arrival, so a play() that left the cursor
  // parked there would run forever without a second report: the clock would
  // extrapolate past the end and every position report would snap it back.
  private atEnd = false;
```

Replace the constructor body:

```ts
    this.endedBox.fire = () => {
      this.pause();
      this.atEnd = true;
      // pause() froze the clock wherever its extrapolation had reached, which is
      // a few ms either side of the true end. The cursor is exactly on the end.
      this.clock.resync({
        contextTime: this.context.currentTime,
        position: this.durationSamples,
        samplesPerSecond: 0,
      });
      this.endedListeners.forEach((cb) => cb());
    };
```

Replace `seek`:

```ts
  seek(position: SampleIndex): void {
    this.cancelCountIn();
    this.atEnd = false;
    this.cursorNode.port.postMessage({ type: 'seek', position: toDeviceDomain(position, this.context.sampleRate) });
    this.clock.resync({ contextTime: this.context.currentTime, position, samplesPerSecond: this.clockRate });
  }
```

Replace `getPositionSamples`:

```ts
  getPositionSamples(): SampleIndex {
    // Clamped: between two worklet reports the clock extrapolates, and in the
    // last ~100 ms of a song that would run the playhead past the end.
    const position = this.clock.positionAt(this.context.currentTime);
    const end = this.durationSamples;
    return position > end ? end : position;
  }
```

In `play()`, add one line after the `context.resume()` line:

```ts
    if (this.context.state === 'suspended') await this.context.resume();
    // Play at the end means "again from the top", like every other player.
    if (this.atEnd) this.seek(sampleIndex(0));
```

In `countInAndPlay()`, add after the first `this.cancelCountIn();`:

```ts
    // Same rule as play(): at the end, `from` is the top. Without this the
    // cursor would be sent back to the end and play() would then rewind it,
    // leaving the stems silenced until the cursor reached `from` again.
    if (this.atEnd) from = sampleIndex(0);
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm --prefix frontend test -- src/engine`
Expected: PASS, all engine test files.

Run: `npm --prefix frontend run typecheck`
Expected: no errors.

- [ ] **Step 6: Verify in the browser**

Use the `dev-setup` skill to start the app. Open an analysed Song, scrub to a few seconds before the end, press play and let it finish. Press play again.
Expected: playback restarts from 0:00 with the playhead moving smoothly. Repeat on the Play along screen with count-in set to 1 bar.

- [ ] **Step 7: Remove the backlog line, commit, push**

Delete this line from the Backlog in `design/domain-spec.md`:

```
- Bug: after a Song ends, pressing play again makes the playhead spasm at the end of the Song
```

```bash
git add frontend/src/engine/EngineController.ts frontend/src/engine/EngineController.test.ts design/domain-spec.md
git commit -m "fix(engine): play after the end restarts from the top

The worklet reports ended once, so a second play left the cursor parked on the
end while the clock kept extrapolating and snapping back.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin main
```

---

### Task 2: Clicking a bar in the chord ribbon moves the playhead

**Files:**
- Modify: `frontend/src/session/SongSession.tsx`
- Modify: `frontend/src/playalong/ChordRibbon.tsx`
- Modify: `frontend/src/screens/PlayAlong.tsx`
- Test: `frontend/src/playalong/ChordRibbon.test.tsx`, `frontend/src/screens/PlayAlong.test.tsx`
- Modify: `README.md`, `design/domain-spec.md`, `docs/superpowers/specs/2026-09-29-play-along-design.md`

**Interfaces:**
- Consumes: `SongSession.onScrub(position: SampleIndex)`, `barStart(grid: Grid, bar: number): SampleIndex` from `frontend/src/music/grid.ts`.
- Produces: `SongSession.onSeekBar(bar: number): void` (0-based bar) and the `ChordRibbon` prop `onSeekBar(bar: number): void`.

- [ ] **Step 1: Rewrite the ribbon's click test**

In `frontend/src/playalong/ChordRibbon.test.tsx`, replace `renderRibbon` with:

```tsx
function renderRibbon(loop = { name: '', start_bar: 1, end_bar: 3 }) {
  const onLoopBars = vi.fn();
  const onSeekBar = vi.fn();
  const result = patternSource.barsFor({ song, analysis, grid, loop: null });
  if (!result.ok) throw new Error(result.error);
  render(
    <ChordRibbon
      bars={result.bars}
      songKey={result.key}
      loop={loop}
      grid={grid}
      getPosition={() => sampleIndex(96_000 + 10)}
      playing={false}
      seekNonce={0}
      onLoopBars={onLoopBars}
      onSeekBar={onSeekBar}
    />,
  );
  return { onLoopBars, onSeekBar };
}
```

and replace the test `'click sets the loop start, shift-click the end'` with:

```tsx
  it('click moves the playhead to the bar and leaves the loop alone', () => {
    const { onLoopBars, onSeekBar } = renderRibbon();
    fireEvent.click(screen.getByRole('button', { name: /Bar 4/ }));
    expect(onSeekBar).toHaveBeenCalledWith(3);
    expect(onLoopBars).not.toHaveBeenCalled();
  });

  it('ctrl-click sets the loop start, shift-click the end, and neither seeks', () => {
    const { onLoopBars, onSeekBar } = renderRibbon();
    fireEvent.click(screen.getByRole('button', { name: /Bar 4/ }), { ctrlKey: true });
    // A start past the current end pushes the end along: at least one bar.
    expect(onLoopBars).toHaveBeenLastCalledWith(3, 4);
    fireEvent.click(screen.getByRole('button', { name: /Bar 4/ }), { shiftKey: true });
    expect(onLoopBars).toHaveBeenLastCalledWith(1, 4);
    // Shift-click before the start is not an end of anything.
    onLoopBars.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /Bar 1/ }), { shiftKey: true });
    expect(onLoopBars).not.toHaveBeenCalled();
    expect(onSeekBar).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Add the screen tests**

In `frontend/src/screens/PlayAlong.test.tsx`, add `fireEvent` to the `@testing-library/react` import and append inside `describe('PlayAlong', ...)`:

```tsx
  it('moves the playhead to a bar clicked in the chord ribbon', async () => {
    renderAt('/songs/abc123/play');
    await userEvent.click(await screen.findByRole('button', { name: /^Bar 3,/ }));
    expect(engine.seek).toHaveBeenCalledWith(192_000);
  });

  it('keeps an armed loop for a click inside it and releases it for a click outside', async () => {
    renderAt('/songs/abc123/play');
    // Bars 2-3 (0-based 1..3), armed.
    fireEvent.click(await screen.findByRole('button', { name: /^Bar 2,/ }), { ctrlKey: true });
    fireEvent.click(screen.getByRole('button', { name: /^Bar 3,/ }), { shiftKey: true });
    const arm = screen.getByRole('button', { name: 'Arm loop' });
    await userEvent.click(arm);
    expect(arm).toHaveAttribute('aria-pressed', 'true');

    await userEvent.click(screen.getByRole('button', { name: /^Bar 3,/ }));
    expect(engine.seek).toHaveBeenLastCalledWith(192_000);
    expect(arm).toHaveAttribute('aria-pressed', 'true');

    await userEvent.click(screen.getByRole('button', { name: /^Bar 4,/ }));
    expect(engine.seek).toHaveBeenLastCalledWith(288_000);
    expect(arm).toHaveAttribute('aria-pressed', 'false');
  });
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm --prefix frontend test -- src/playalong/ChordRibbon.test.tsx src/screens/PlayAlong.test.tsx`
Expected: the new tests FAIL (`onSeekBar` never called; `engine.seek` never called).

- [ ] **Step 4: Add `onSeekBar` to the session**

In `frontend/src/session/SongSession.tsx`:

Add to the `SongSession` interface, after `onNudgeBars`:

```ts
  /** Moves the cursor to the start of a 0-based bar. An armed loop survives only if the bar is inside it. */
  onSeekBar(bar: number): void;
```

Add after `handleNudgeBars`:

```ts
  // Play along's ribbon seeks by bar. Inside an armed loop the cursor stays in
  // the region the wrap logic expects, so the loop can stay armed -- restarting
  // a looped phrase from one of its bars should not end the loop. Anywhere else
  // it is a cursor move like any other and goes through handleScrub (U-06).
  const handleSeekBar = useCallback(
    (bar: number) => {
      const { engine: current, grid: currentGrid, song: currentSong, loopArmed: armed } = latest.current;
      if (!current || !currentGrid || bar < 0) return;
      const position = barStart(currentGrid, bar);
      const loop = currentSong?.active_loop;
      if (armed && loop && bar >= loop.start_bar && bar < loop.end_bar) {
        current.seek(position);
        setSeekNonce((n) => n + 1);
        return;
      }
      handleScrub(position);
    },
    [handleScrub],
  );
```

In the returned `useMemo` object add `onSeekBar: handleSeekBar,` after `onNudgeBars: handleNudgeBars,`, and add `handleSeekBar,` to its dependency array after `handleNudgeBars,`.

- [ ] **Step 5: Re-map the ribbon's click**

In `frontend/src/playalong/ChordRibbon.tsx`:

Replace the header comment's first three lines with:

```tsx
// The whole chord chart as one cell per bar (D-18): where you are, where the
// loop is, and a quick way to move. Click moves the playhead to the bar.
// Ctrl/Cmd-click sets the loop start and shift-click the end, with the same
// one-bar minimum and no inversion as Set A / Set B.
```

Add to `ChordRibbonProps` after `onLoopBars`:

```tsx
  onSeekBar(bar: number): void;
```

Add `onSeekBar` to the destructured props of `ChordRibbon`, and replace `select` with:

```tsx
  const select = (bar: number, event: MouseEvent) => {
    if (event.shiftKey) {
      const start = loop?.start_bar ?? 0;
      if (bar < start) return;
      onLoopBars(start, bar + 1);
      return;
    }
    if (event.ctrlKey || event.metaKey) {
      onLoopBars(bar, Math.max(loop?.end_bar ?? 0, bar + 1));
      return;
    }
    onSeekBar(bar);
  };
```

Replace the group's `aria-label` with:

```tsx
aria-label="Chord chart by bar. Click moves the playhead, Ctrl-click sets the loop start, shift-click the end."
```

- [ ] **Step 6: Wire it in the screen**

In `frontend/src/screens/PlayAlong.tsx`, add to the `<ChordRibbon ... />` props after `onLoopBars={session.onLoopBars}`:

```tsx
              onSeekBar={session.onSeekBar}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm --prefix frontend test -- src/playalong src/screens/PlayAlong.test.tsx src/session`
Expected: PASS.

Run: `npm --prefix frontend run typecheck`
Expected: no errors.

- [ ] **Step 8: Verify in the browser**

On the Play along screen of an analysed Song: click a bar while paused (the current-bar outline, neck and beat lane jump there); click a bar while playing (playback continues from it); arm a loop and click a bar inside it (loop stays armed) then one outside it (Loop button unlights).

- [ ] **Step 9: Docs, commit, push**

`design/domain-spec.md`: delete the Backlog line

```
- Play along: make the bottom bar/chord list clickable, so clicking a bar moves the playhead there
```

and replace the "Looping by bar numbers" bullet with:

```
- **Chord ribbon:** click a bar to move the playhead there
- **Looping by bar numbers:** start and end bar steppers, or Ctrl-click (start) and shift-click (end) the chord ribbon. It is the same loop as Song view's.
```

`docs/superpowers/specs/2026-09-29-play-along-design.md`: in item 7 "Chord ribbon" replace "Click sets the loop start and shift-click sets the end." with "Click moves the playhead to the bar. Ctrl/Cmd-click sets the loop start and shift-click sets the end (changed 2026-09-30; click used to set the start)."

`README.md`, Play along bullet: replace "Loop by bar numbers or from the chord ribbon;" with "Click a bar in the chord ribbon to jump there; loop by bar numbers or by Ctrl- and Shift-clicking the ribbon;".

```bash
git add frontend/src/session/SongSession.tsx frontend/src/playalong/ChordRibbon.tsx frontend/src/playalong/ChordRibbon.test.tsx frontend/src/screens/PlayAlong.tsx frontend/src/screens/PlayAlong.test.tsx README.md design/domain-spec.md docs/superpowers/specs/2026-09-29-play-along-design.md
git commit -m "feat(play-along): clicking a bar in the chord ribbon moves the playhead

Ctrl/Cmd-click now sets the loop start; shift-click still sets the end.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin main
```

---

### Task 3: Add split album tracks to the library as Songs

**Files:**
- Create: `frontend/src/splitter/toLibrary.ts`
- Test: `frontend/src/splitter/toLibrary.test.ts`
- Modify: `frontend/src/api/queries.ts`
- Modify: `frontend/src/screens/AlbumSplitter.tsx`, `frontend/src/screens/AlbumSplitter.module.css`
- Test: `frontend/src/screens/AlbumSplitter.test.tsx`
- Modify: `README.md`, `design/domain-spec.md`, `design/tech-spec-stemcraft.md`, `docs/screenshots/album-splitter.png`

**Interfaces:**
- Consumes: `albumTrackUrl(albumId, filename)`, `api.upload<T>(path, form)`, `CreatedSong`, `AlbumTrackFile` from `frontend/src/api/client.ts`; `queryKeys.songs` in `frontend/src/api/queries.ts`; server route `POST /api/songs/upload` (multipart `file`, optional `title`, `artist`; blank fields are filled from the file's tags).
- Produces: `sendTrackToLibrary(albumId: string, filename: string): Promise<CreatedSong>` and `useSendTrackToLibrary(albumId: string)` (a mutation whose variable is the filename).

- [ ] **Step 1: Write the failing unit test**

Create `frontend/src/splitter/toLibrary.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';

import { sendTrackToLibrary } from './toLibrary';

afterEach(() => vi.unstubAllGlobals());

describe('sendTrackToLibrary', () => {
  it('downloads the rendered track and uploads it as a Song, leaving title and artist to the tags', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return new Response(JSON.stringify({ song: { id: 's1' }, job_id: 7 }), { status: 201 });
      }
      return new Response(new Uint8Array([1, 2, 3]));
    });
    vi.stubGlobal('fetch', fetchMock);

    const created = await sendTrackToLibrary('01J0', '01-so-what.mp3');

    expect(created.job_id).toBe(7);
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/albums/01J0/tracks/01-so-what.mp3');
    const [url, init] = fetchMock.mock.calls[1]!;
    expect(url).toBe('/api/songs/upload');
    const form = init!.body as FormData;
    const file = form.get('file') as File;
    expect(file.name).toBe('01-so-what.mp3');
    expect(file.size).toBe(3);
    // Blank on purpose: the upload route fills them from the ID3 tags the split wrote.
    expect(form.has('title')).toBe(false);
    expect(form.has('artist')).toBe(false);
  });

  it('fails with the server message and uploads nothing when the track is gone (N-08)', async () => {
    const fetchMock = vi.fn(async () => new Response('album 01J0 has no track', { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(sendTrackToLibrary('01J0', '01-so-what.mp3')).rejects.toThrow(
      'GET /api/albums/01J0/tracks/01-so-what.mp3 → 404: album 01J0 has no track',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm --prefix frontend test -- src/splitter/toLibrary.test.ts`
Expected: FAIL, cannot resolve `./toLibrary`.

- [ ] **Step 3: Implement the helper**

Create `frontend/src/splitter/toLibrary.ts`:

```ts
// A split track becomes a Song the same way any file does: through the song
// upload route. Q-04 keeps the splitter standalone on the server, so the
// browser carries the rendered MP3 across -- nothing under albums/ and nothing
// in the Song write path knows about the other. Title and artist are left
// blank so the upload route reads them from the ID3 tags the split wrote,
// which are the truth about this file even if album.json was edited since.
import { albumTrackUrl, api, type CreatedSong } from '../api/client';

export async function sendTrackToLibrary(albumId: string, filename: string): Promise<CreatedSong> {
  const url = albumTrackUrl(albumId, filename);
  const response = await fetch(url);
  if (!response.ok) {
    // N-08: the server's own message, in the shape client.ts uses.
    throw new Error(`GET ${url} → ${response.status}: ${await response.text()}`);
  }
  const form = new FormData();
  form.append('file', new File([await response.arrayBuffer()], filename, { type: 'audio/mpeg' }));
  return api.upload<CreatedSong>('/api/songs/upload', form);
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm --prefix frontend test -- src/splitter/toLibrary.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the mutation hook**

In `frontend/src/api/queries.ts`, add the import

```ts
import { sendTrackToLibrary } from '../splitter/toLibrary';
```

and add after `useAlbumTracks`:

```ts
/** One track per call, so each row can show its own progress and its own error. */
export function useSendTrackToLibrary(albumId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (filename: string) => sendTrackToLibrary(albumId, filename),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: queryKeys.songs });
      client.invalidateQueries({ queryKey: ['jobs'] });
    },
  });
}
```

- [ ] **Step 6: Write the failing screen tests**

Append inside `describe('AlbumSplitter', ...)` in `frontend/src/screens/AlbumSplitter.test.tsx`:

```tsx
  const splitAlbum = {
    ...readyAlbum,
    state: 'split',
    files: { ...readyAlbum.files, has_tracks: true, has_zip: true },
  };
  const trackFiles = [
    { name: '01-one.mp3', file: 'tracks/01-one.mp3', bytes: 10 },
    { name: '02-two.mp3', file: 'tracks/02-two.mp3', bytes: 10 },
  ];
  const uploads = (fetchMock: ReturnType<typeof renderWith>) =>
    fetchMock.mock.calls.filter(([url]) => url === '/api/songs/upload');

  it('adds one track to the library and marks it', async () => {
    const fetchMock = renderWith(splitAlbum, { tracks: trackFiles });
    fireEvent.click(await screen.findByRole('button', { name: 'Add 01-one.mp3 to library' }));
    expect(await screen.findByRole('button', { name: '01-one.mp3 is in the library' })).toBeDisabled();
    expect(uploads(fetchMock)).toHaveLength(1);
    expect(((uploads(fetchMock)[0]![1]!.body as FormData).get('file') as File).name).toBe('01-one.mp3');
    expect(screen.getByRole('link', { name: 'Open library' })).toHaveAttribute('href', '/');
  });

  it('adds every track not yet added, in order', async () => {
    const fetchMock = renderWith(splitAlbum, { tracks: trackFiles });
    fireEvent.click(await screen.findByRole('button', { name: 'Add all 2 tracks to library' }));
    await waitFor(() => expect(uploads(fetchMock)).toHaveLength(2));
    const names = uploads(fetchMock).map(([, init]) => ((init!.body as FormData).get('file') as File).name);
    expect(names).toEqual(['01-one.mp3', '02-two.mp3']);
    await waitFor(() => expect(screen.getByRole('button', { name: /All 2 tracks are in the library/ })).toBeDisabled());
  });

  it('does not offer the library before a split has produced tracks', async () => {
    renderWith(readyAlbum);
    await screen.findByRole('button', { name: /Split into/ });
    expect(screen.queryByRole('button', { name: /to library/ })).toBeNull();
  });
```

Note: `renderWith`'s fetch mock already answers the track `GET` (its default branch) and any `POST` with a 201, which is all these tests need.

- [ ] **Step 7: Run them to verify they fail**

Run: `npm --prefix frontend test -- src/screens/AlbumSplitter.test.tsx`
Expected: the first two new tests FAIL (no such button); the third passes already.

- [ ] **Step 8: Implement the UI**

In `frontend/src/screens/AlbumSplitter.tsx`:

Add `useSendTrackToLibrary` to the `'../api/queries'` import list.

In `AlbumEditor`, after `const queueSplit = useQueueSplit();`:

```tsx
  const sendToLibrary = useSendTrackToLibrary(albumId);
  // Which files this page has sent. Session-only on purpose: a Song does not
  // record which album it came from (Q-04), so after a reload adding a track
  // again makes a second Song, exactly as uploading the same file twice would.
  const [inLibrary, setInLibrary] = useState<ReadonlySet<string>>(new Set());
```

Add next to the other handlers (before `handleSplit`):

```tsx
  // One at a time and in track order: the queue is serial anyway, and a failure
  // stops the run with the tracks before it already marked. The error itself is
  // rendered from the mutation (N-08), so the catch only ends the loop.
  async function addToLibrary(names: string[]) {
    for (const name of names) {
      try {
        await sendToLibrary.mutateAsync(name);
      } catch {
        return;
      }
      setInLibrary((previous) => new Set(previous).add(name));
    }
  }
```

Replace the final block

```tsx
      {files?.has_tracks && (tracksQuery.data?.length ?? 0) > 0 && (
        <ul className={styles.files}>
          {(tracksQuery.data ?? []).map((track) => (
            <li key={track.name}>
              <a className={styles.download} href={albumTrackUrl(albumId, track.name)}>
                {track.name}
              </a>
            </li>
          ))}
        </ul>
      )}
```

with

```tsx
      {files?.has_tracks && trackFiles.length > 0 && (
        <>
          <div className={styles.libraryRow}>
            <Button
              disabled={sendToLibrary.isPending || remaining.length === 0}
              onClick={() => addToLibrary(remaining)}
            >
              {remaining.length === 0
                ? `All ${trackFiles.length} tracks are in the library`
                : remaining.length === trackFiles.length
                  ? `Add all ${trackFiles.length} tracks to library`
                  : `Add the other ${remaining.length} to library`}
            </Button>
            {inLibrary.size > 0 && <TextLink to="/">Open library</TextLink>}
          </div>
          {/* N-08: the API's own message, verbatim. */}
          {sendToLibrary.isError && (
            <Banner
              tone="error"
              title={`${sendToLibrary.variables} could not be added to the library`}
              trace={String(sendToLibrary.error)}
            />
          )}
          <ul className={styles.files}>
            {trackFiles.map((track) => {
              const added = inLibrary.has(track.name);
              const sending = sendToLibrary.isPending && sendToLibrary.variables === track.name;
              return (
                <li key={track.name} className={styles.fileRow}>
                  <a className={styles.download} href={albumTrackUrl(albumId, track.name)}>
                    {track.name}
                  </a>
                  <Button
                    variant="ghost"
                    disabled={added || sendToLibrary.isPending}
                    aria-label={added ? `${track.name} is in the library` : `Add ${track.name} to library`}
                    onClick={() => addToLibrary([track.name])}
                  >
                    {added ? 'In library' : sending ? 'Adding…' : 'Add to library'}
                  </Button>
                </li>
              );
            })}
          </ul>
        </>
      )}
```

and define the two derived values just above the component's final `return (` that renders this section (next to where `spans`, `job` and `reason` are computed):

```tsx
  const trackFiles = tracksQuery.data ?? [];
  const remaining = trackFiles.filter((track) => !inLibrary.has(track.name)).map((track) => track.name);
```

In `frontend/src/screens/AlbumSplitter.module.css`, add after the `.files` rule:

```css
.fileRow,
.libraryRow {
  display: flex;
  align-items: center;
  gap: var(--ds-3);
}

.fileRow {
  justify-content: space-between;
}
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `npm --prefix frontend test -- src/screens/AlbumSplitter.test.tsx src/splitter src/api`
Expected: PASS.

Run: `npm --prefix frontend run typecheck`
Expected: no errors.

- [ ] **Step 10: Verify end to end in the browser**

With the app running (`dev-setup` skill), open a split album and press "Add to library" on one track. Expected: the row shows "In library", the Library shows a new Song whose title and artist match the track's ID3 tags, and the Job queue shows its `import` job followed by `separate`. Then press "Add the other N to library" and confirm one Song per remaining track.

- [ ] **Step 11: Full suite**

Run: `npm --prefix frontend test`
Expected: PASS.

Run: `npm --prefix frontend run build`
Expected: build succeeds.

- [ ] **Step 12: Docs, screenshot, commit, push**

`design/domain-spec.md`: delete the Backlog line

```
- Send album-splitter tracks straight into the library as Songs
```

and add a step 7 to the "Album splitter" list:

```
7. Any split track, or all of them, can be added to the library as Songs; title and artist come from the track's tags
```

`design/tech-spec-stemcraft.md`, §14: replace the Q-04 entry with:

```
- **Q-04** — Should album-splitter output land directly in the library as Songs
  rather than only as a zip? *Closed (Phase 8, extended 2026-09-30):* the splitter
  stays a standalone tool on the server and shares no write path with Songs. Tracks
  reach the library from the browser, which posts a rendered MP3 to the ordinary
  song upload route; the cost is one extra lossy generation (320 kbps).
```

`README.md`, Album splitter bullet: replace "then download a zip" with "then download a zip or add the tracks to the library as Songs".

Screenshot: recapture only the splitter, on an album that has been split, using the command in the README's screenshots section with the single argument `album-splitter=/splitter/<id>`. Check the image shows the track list with the library buttons.

```bash
git add frontend/src/splitter/toLibrary.ts frontend/src/splitter/toLibrary.test.ts frontend/src/api/queries.ts frontend/src/screens/AlbumSplitter.tsx frontend/src/screens/AlbumSplitter.module.css frontend/src/screens/AlbumSplitter.test.tsx README.md design/domain-spec.md design/tech-spec-stemcraft.md docs/screenshots/album-splitter.png
git commit -m "feat(splitter): add split tracks to the library as Songs

Goes through the existing song upload route, so Q-04 stays closed on the server.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin main
```
