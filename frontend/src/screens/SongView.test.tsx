import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SongScope } from '../session/SongScope';
import { SongScreen } from './SongScreen';
import { SongView } from './SongView';

let cursor = 0;

const engine = {
  play: vi.fn(async () => {}),
  pause: vi.fn(),
  seek: vi.fn((position: number) => {
    cursor = position;
  }),
  setLoop: vi.fn(),
  setTempo: vi.fn(),
  setPitchSemitones: vi.fn(),
  setStemGain: vi.fn(),
  setMetronome: vi.fn(),
  setGrid: vi.fn(),
  // Typed after the real signature: the fourth argument is the restore-gains
  // callback, and one test reads it back off the mock.
  countInAndPlay: vi.fn(
    async (_from: number, _bars: number, _barStarts: number[], _restoreGains: () => void) => {},
  ),
  onEnded: vi.fn(() => () => {}),
  // The cursor the fake engine actually holds. seek() moves it and nothing
  // else does -- which is the paused case the playhead has to repaint for.
  getPositionSamples: vi.fn(() => cursor),
  dispose: vi.fn(async () => {}),
  durationSamples: 48_000 * 32,
  durationSeconds: 32,
  stemSummaries: ['vocals', 'drums', 'bass', 'other'].map((name) => ({
    name,
    envelope: Float32Array.from([0.3, 0.5]),
    peak: 0.5,
    nearSilent: false,
  })),
};

vi.mock('../engine/EngineController', () => ({
  STEM_ORDER: ['vocals', 'drums', 'bass', 'other'],
  EngineController: { create: vi.fn(async () => engine) },
}));

const songEntry = {
  dir: 'abc123-test',
  state: 'analyzed',
  unreadable: null,
  files: { has_audio: true, has_peaks: true, has_stems: true, has_analysis: true, has_transcription: false },
  song: {
    schema_version: 2,
    id: 'abc123',
    title: 'Test Song',
    artist: 'Someone',
    source: { kind: 'upload', value: 'original.mp3' },
    created_at: '2026-09-28T00:00:00+00:00',
    last_played_at: null,
    mix: {
      vocals: { gain_db: 0, muted: false },
      drums: { gain_db: 0, muted: false },
      bass: { gain_db: 0, muted: true },
      other: { gain_db: 0, muted: false },
    },
    playback: { tempo: 0.8, pitch_semitones: -1 },
    loops: [],
    active_loop: null,
    metronome: false,
    count_in_bars: 0,
  },
};

const analysis = {
  schema_version: 1,
  key_candidates: [{ tonic: 'G', mode: 'major', confidence: 1 }],
  beat_grid: {
    bpm: 120,
    beats: Array.from({ length: 64 }, (_, i) => i * 24_000),
    downbeats: Array.from({ length: 16 }, (_, i) => i * 96_000),
  },
  chords: [{ bar: 0, start_sample: 0, end_sample: 96_000, chord: 'G:maj' }],
};

function mockFetch(overrides: Record<string, unknown> = {}, putStatus = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PUT' && putStatus !== 200) {
        return new Response('song.json belongs to a different song', { status: putStatus });
      }
      const body =
        overrides[url] ??
        (url.endsWith('/analysis') ? analysis : url.includes('/api/songs/abc123') ? songEntry : {});
      if (body === 404) return new Response('not found', { status: 404 });
      return new Response(JSON.stringify(body), { status: init?.method === 'PUT' ? 200 : 200 });
    }),
  );
}

function renderSongView() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/songs/abc123']}>
        <Routes>
          <Route path="/songs/:songId" element={<SongScope />}>
            <Route element={<SongScreen />}>
              <Route index element={<SongView />} />
            </Route>
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  cursor = 0;
  mockFetch();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('SongView', () => {
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

  it('has no right rail: count-in and saved loops are in the transport popovers', async () => {
    renderSongView();
    await screen.findByRole('group', { name: 'vocals stem' });
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
    expect(screen.queryByText(/key candidates/i)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Practice' }));
    expect(screen.getByRole('group', { name: 'Count-in' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Edit loop' }));
    expect(screen.getByRole('dialog', { name: 'Loop' })).toHaveTextContent('Saved loops');
  });

  it('shows the song title and four stem lanes once loaded', async () => {
    renderSongView();
    expect(await screen.findByRole('heading', { name: /Test Song/ })).toBeInTheDocument();
    for (const name of ['vocals', 'drums', 'bass', 'other']) {
      expect(await screen.findByRole('group', { name: `${name} stem` })).toBeInTheDocument();
    }
  });

  it('restores the saved recipe into the engine on load', async () => {
    renderSongView();
    await waitFor(() => expect(engine.setTempo).toHaveBeenCalledWith(0.8));
    expect(engine.setPitchSemitones).toHaveBeenCalledWith(-1);
    // bass was muted in song.json: it must come back muted, not at unity.
    expect(engine.setStemGain).toHaveBeenCalledWith('bass', 0);
  });

  it('autosaves a mix change back to song.json', async () => {
    renderSongView();
    const mute = await screen.findByRole('button', { name: /mute vocals/i });
    await userEvent.click(mute);
    await waitFor(() => {
      const put = (fetch as ReturnType<typeof vi.fn>).mock.calls.find(
        ([, init]) => init?.method === 'PUT',
      );
      expect(put).toBeDefined();
      expect(JSON.parse(put![1].body).mix.vocals.muted).toBe(true);
    });
  });

  it('disarms the loop when the user scrubs, visibly (U-06)', async () => {
    renderSongView();
    await screen.findByRole('heading', { name: /Test Song/ });
    // No loop yet: the editor's steppers start from bar 1, and stepping the end makes it 1-2.
    await userEvent.click(await screen.findByRole('button', { name: 'Edit loop' }));
    await userEvent.click(await screen.findByRole('button', { name: 'End bar later' }));
    await userEvent.click(await screen.findByRole('button', { name: /arm loop/i }));
    expect(screen.getByRole('button', { name: /arm loop/i })).toHaveAttribute('aria-pressed', 'true');

    const track = screen.getByTestId('timeline-track');
    // The ruler is the time axis content: 16 bars at 1x (56 px/bar) = 896 px.
    vi.spyOn(track, 'getBoundingClientRect').mockReturnValue({
      left: 0, width: 896, top: 0, height: 28, right: 896, bottom: 28, x: 0, y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    // Wrapped in act() only so React flushes the resulting state update inside
    // the test's own tick: a raw dispatchEvent is how the stubbed rect above is
    // made to matter, and what is asserted below is unchanged.
    act(() => {
      track.dispatchEvent(new MouseEvent('click', { clientX: 448, bubbles: true }));
    });

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /arm loop/i })).toHaveAttribute(
        'aria-pressed',
        'false',
      ),
    );
    // D-06: the loop is released at the engine *before* the cursor is moved.
    // Asserted as an ordering, not just as a final value: "setLoop was last
    // called with null and seek was called" also passes for an implementation
    // that seeks first and lets an effect release the loop afterwards, which
    // is the exact bug the constraint forbids. So: of the setLoop calls that
    // happened before the seek, the last one must be the release.
    expect(engine.seek).toHaveBeenCalled();
    const seekOrder = engine.seek.mock.invocationCallOrder[0]!;
    const beforeSeek = engine.setLoop.mock.calls.filter(
      (_, i) => engine.setLoop.mock.invocationCallOrder[i]! < seekOrder,
    );
    expect(beforeSeek.at(-1)).toEqual([null]);
    expect(engine.setLoop).toHaveBeenLastCalledWith(null);
  });

  it('turns the metronome back off after a count-in, on every play', async () => {
    // countInAndPlay turns the click on unconditionally and never turns it off
    // -- undoing that is the caller's job. A song with metronome: false would
    // otherwise click for its whole length with the button reading off, and
    // only from the second play on: the first play's last_played_at stamp
    // pushes the recipe and hides it.
    mockFetch({
      '/api/songs/abc123': {
        ...songEntry,
        song: { ...songEntry.song, count_in_bars: 2, metronome: false },
      },
    });
    renderSongView();
    await userEvent.click(await screen.findByRole('button', { name: /^play$/i }));
    await waitFor(() => expect(engine.countInAndPlay).toHaveBeenCalledTimes(1));
    await userEvent.click(await screen.findByRole('button', { name: /^pause$/i }));
    await userEvent.click(await screen.findByRole('button', { name: /^play$/i }));
    await waitFor(() => expect(engine.countInAndPlay).toHaveBeenCalledTimes(2));

    engine.setMetronome.mockClear();
    const restoreGains = engine.countInAndPlay.mock.calls[1]![3];
    act(() => restoreGains());
    expect(engine.setMetronome).toHaveBeenCalledWith(false);
  });

  it('refuses to build an engine for a song with no stems, and says why', async () => {
    mockFetch({
      '/api/songs/abc123': { ...songEntry, state: 'imported', files: { ...songEntry.files, has_stems: false } },
    });
    renderSongView();
    expect(await screen.findByText(/not been separated/i)).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: /bass stem/ })).not.toBeInTheDocument();
  });

  it('plays without a beat grid, but says bars are unavailable', async () => {
    mockFetch({ '/api/songs/abc123/analysis': 404 });
    renderSongView();
    expect(await screen.findByRole('button', { name: /^play$/i })).toBeInTheDocument();
    // The ruler row stays and says why it has no bars.
    expect(screen.getByText('Bars need analysis to have run')).toBeInTheDocument();
  });

  it('surfaces a failed autosave verbatim, rather than editing into the void (N-08)', async () => {
    mockFetch({}, 409);
    renderSongView();
    await userEvent.click(await screen.findByRole('button', { name: /mute vocals/i }));
    // The server's own words, carried by ApiError, not a paraphrase.
    const alert = await screen.findByRole('alert', {}, { timeout: 3000 });
    expect(alert).toHaveTextContent('belongs to a different song');
    expect(alert).toHaveTextContent('409');
  });

  it('repaints the readouts after a scrub made while paused', async () => {
    // The bug this covers: `getPosition` is stable per engine and the painters
    // are stable, so a seek changes nothing usePlayhead's effect depends on --
    // the cursor moves and every readout stays frozen until play is pressed.
    // It has to be asserted here rather than in Timeline.test: a component-level
    // test passing a fresh inline getPosition re-runs the effect on every
    // render and so passes against the bug.
    renderSongView();
    await screen.findByRole('heading', { name: /Test Song/ });
    // Bar 1 once the grid has arrived: the cursor is at 0.
    await waitFor(() => expect(screen.getByTestId('bar-readout')).toHaveTextContent('1'));

    const track = screen.getByTestId('timeline-track');
    // The ruler is the time axis content: 16 bars at 1x (56 px/bar) = 896 px.
    vi.spyOn(track, 'getBoundingClientRect').mockReturnValue({
      left: 0, width: 896, top: 0, height: 28, right: 896, bottom: 28, x: 0, y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    act(() => {
      // Halfway (448 of 896 px): 768 000 samples in, which is downbeat 8 -- bar 9 on screen.
      track.dispatchEvent(new MouseEvent('click', { clientX: 448, bubbles: true }));
    });

    expect(engine.seek).toHaveBeenCalledWith(768_000);
    // Still paused: no rAF loop is running, so this can only come from the
    // repaint the seek itself asked for.
    expect(screen.getByRole('button', { name: /^play$/i })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('bar-readout')).toHaveTextContent('9'));
    await waitFor(() =>
      expect(screen.getByTestId('playhead')).toHaveStyle({ left: '448px' }),
    );
  });

  it('surfaces an engine construction failure verbatim (N-08)', async () => {
    const { EngineController } = await import('../engine/EngineController');
    vi.mocked(EngineController.create).mockRejectedValueOnce(
      new Error('DOMException: Unable to decode audio data'),
    );
    renderSongView();
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to decode audio data');
  });

  it('puts the chord row directly under the bar ruler, above the lanes, and nowhere else', async () => {
    renderSongView();
    const vocals = await screen.findByRole('group', { name: 'vocals stem' });
    const other = screen.getByRole('group', { name: 'other stem' });
    const ruler = screen.getByTestId('ruler-row');
    const chordRows = screen.getAllByTestId('chord-row');
    expect(chordRows).toHaveLength(1);
    const chords = chordRows[0]!;
    const follows = (a: Node, b: Node) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(ruler, chords)).toBe(true);
    expect(follows(chords, vocals)).toBe(true);
    // The old strip at the bottom is gone: no chord label after the last lane.
    const afterLanes = Array.from(document.querySelectorAll('[aria-label="G major"]')).filter((el) =>
      follows(other, el),
    );
    expect(afterLanes).toEqual([]);
    // One scroll container holds the ruler, the chords and every lane.
    const scroller = screen.getByTestId('time-axis-scroller');
    for (const el of [ruler, chords, vocals, other]) expect(scroller).toContainElement(el);
  });

  it('puts the playback controls above the time axis, at the top of the page', async () => {
    renderSongView();
    await screen.findByRole('group', { name: 'vocals stem' });
    const play = screen.getByRole('button', { name: /^(play|pause)$/i });
    const scroller = screen.getByTestId('time-axis-scroller');
    // The transport comes before the ruler, chords and lanes in reading order...
    expect(Boolean(play.compareDocumentPosition(scroller) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    // ...and is not inside the horizontally scrolling canvas.
    expect(scroller).not.toContainElement(play);
  });

  it('zoom changes the time axis content width, and every waveform with it', async () => {
    renderSongView();
    await screen.findByRole('group', { name: 'vocals stem' });
    const axis = screen.getByTestId('time-axis');
    // Default: 16 bars at 56 px, plus the 200 px sticky head column.
    await waitFor(() => expect(axis.style.width).toBe(`${200 + 896}px`));
    expect(screen.getByTestId('vocals-wave').style.width).toBe('896px');

    await userEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(axis.style.width).toBe(`${200 + 1792}px`);
    expect(screen.getByTestId('timeline-track').style.width).toBe('1792px');
    expect(screen.getByTestId('bass-wave').style.width).toBe('1792px');
    expect(screen.getByLabelText('G major').style.width).toBe('112px');

    await userEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect(axis.style.width).toBe(`${200 + 896}px`);
  });

  it('the wheel over the lanes zooms, and does not scroll the page', async () => {
    renderSongView();
    await screen.findByRole('group', { name: 'vocals stem' });
    const axis = screen.getByTestId('time-axis');
    await waitFor(() => expect(axis.style.width).toBe(`${200 + 896}px`));
    const scroller = screen.getByTestId('time-axis-scroller');
    // clientX 500 is right of the 200 px heads (jsdom boxes sit at 0).
    const event = new WheelEvent('wheel', { deltaY: -100, clientX: 500, cancelable: true, bubbles: true });
    act(() => {
      scroller.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
    expect(parseFloat(axis.style.width)).toBeGreaterThan(200 + 896);
  });

  it('the wheel over the sticky heads is left alone, so it cannot zoom by accident', async () => {
    renderSongView();
    await screen.findByRole('group', { name: 'vocals stem' });
    const axis = screen.getByTestId('time-axis');
    await waitFor(() => expect(axis.style.width).toBe(`${200 + 896}px`));
    const event = new WheelEvent('wheel', { deltaY: -100, clientX: 100, cancelable: true, bubbles: true });
    act(() => {
      screen.getByTestId('time-axis-scroller').dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(false);
    expect(axis.style.width).toBe(`${200 + 896}px`);
  });

  it('a drag across a lane draws a selection and zooms to fit it', async () => {
    // jsdom has no layout: every element reports a 900 px client width, so the scroller's
    // measured content viewport is 700 px (minus the 200 px heads).
    // jsdom defines clientWidth on Element.prototype; shadow it and delete the shadow after.
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 900 });
    try {
      renderSongView();
      await screen.findByRole('group', { name: 'vocals stem' });
      const axis = screen.getByTestId('time-axis');
      await waitFor(() => expect(axis.style.width).toBe(`${200 + 896}px`));
      const lane = screen.getByTestId('bass-wave');
      const at = (type: string, clientX: number) =>
        fireEvent(lane, new MouseEvent(type, { bubbles: true, clientX, clientY: 300, button: 0 }));
      // Content x 56..168 is bars 2-3 at 56 px per bar: two bars selected.
      at('pointerdown', 200 + 56);
      at('pointermove', 200 + 168);
      expect(screen.getByTestId('zoom-selection').style.width).toBe('112px');
      at('pointerup', 200 + 168);
      expect(screen.queryByTestId('zoom-selection')).toBeNull();
      // Two bars fitted into 700 px is 350 px per bar: 16 bars are 5600 px.
      expect(axis.style.width).toBe(`${200 + 5600}px`);
    } finally {
      delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
    }
  });

  it('a press on a lane that does not travel is not a zoom', async () => {
    renderSongView();
    await screen.findByRole('group', { name: 'vocals stem' });
    const axis = screen.getByTestId('time-axis');
    await waitFor(() => expect(axis.style.width).toBe(`${200 + 896}px`));
    const lane = screen.getByTestId('bass-wave');
    for (const type of ['pointerdown', 'pointermove', 'pointerup']) {
      fireEvent(lane, new MouseEvent(type, { bubbles: true, clientX: 402, clientY: 300, button: 0 }));
    }
    expect(screen.queryByTestId('zoom-selection')).toBeNull();
    expect(axis.style.width).toBe(`${200 + 896}px`);
  });

  it('follows the playhead by default, and the toggle turns it off', async () => {
    renderSongView();
    const follow = await screen.findByRole('button', { name: 'Follow playhead' });
    expect(follow).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(follow);
    expect(follow).toHaveAttribute('aria-pressed', 'false');
  });
});
