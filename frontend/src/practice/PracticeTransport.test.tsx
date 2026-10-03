import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';

import { DEFAULT_INSTRUMENT_SETTINGS, type InstrumentSettings } from '../api/client';
import { sampleIndex } from '../engine/types';
import { generate } from '../music/practice/generate';
import { renderPractice } from './audio/render';
import { nowAndNext, PracticeTransport } from './PracticeTransport';
import type { PracticeSession } from './usePracticeSession';

function loop(settings: InstrumentSettings = DEFAULT_INSTRUMENT_SETTINGS) {
  const r = generate('bass', settings);
  if (!r.ok) throw new Error(r.error);
  return r.loop;
}

function session(overrides: Partial<PracticeSession> = {}): PracticeSession {
  const l = loop();
  return {
    rendered: renderPractice(l, 100),
    playing: false,
    togglePlay: vi.fn(),
    getPosition: () => sampleIndex(0),
    seekNonce: 0,
    loopsDone: 0,
    error: null,
    ...overrides,
  };
}

test('nowAndNext: the chord for grooves, the note for scales, the string for drills', () => {
  expect(nowAndNext(loop(), 5)).toEqual({ cap: 'chord', now: 'D', next: 'Em' });
  const scale = loop({ ...DEFAULT_INSTRUMENT_SETTINGS, exercise: 'scale', key: 9 });
  expect(nowAndNext(scale, 0)).toEqual({ cap: 'note', now: 'A', next: 'C' });
  const drill = loop({ ...DEFAULT_INSTRUMENT_SETTINGS, exercise: 'drill' });
  expect(nowAndNext(drill, 2)).toEqual({ cap: 'string', now: 'A string', next: 'A' });
});

test('play, bpm, count-in and regenerate', async () => {
  const s = session();
  const onSettings = vi.fn();
  const onRegenerate = vi.fn();
  render(
    <PracticeTransport session={s} settings={DEFAULT_INSTRUMENT_SETTINGS} loop={loop()} canRegenerate onSettings={onSettings} onRegenerate={onRegenerate} />,
  );
  await userEvent.click(screen.getByRole('button', { name: 'Play' }));
  expect(s.togglePlay).toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Faster' }));
  expect(onSettings).toHaveBeenLastCalledWith(expect.objectContaining({ bpm: 101 }));
  await userEvent.click(screen.getByRole('button', { name: '2' }));
  expect(onSettings).toHaveBeenLastCalledWith(expect.objectContaining({ count_in_bars: 2 }));
  await userEvent.click(screen.getByRole('button', { name: /Regenerate/ }));
  expect(onRegenerate).toHaveBeenCalled();
});

test('the ramp editor cannot pass the engine’s range, and says why', async () => {
  const onSettings = vi.fn();
  const settings = { ...DEFAULT_INSTRUMENT_SETTINGS, ramp: { ...DEFAULT_INSTRUMENT_SETTINGS.ramp, on: true } };
  render(<PracticeTransport session={session()} settings={settings} loop={loop()} canRegenerate={false} onSettings={onSettings} onRegenerate={vi.fn()} />);
  expect(screen.queryByRole('button', { name: /Regenerate/ })).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Edit ramp' }));
  expect(screen.getByRole('button', { name: 'Ramp target up' })).toBeDisabled(); // 120 = 80 × 1.5
  expect(screen.getByText('The engine stretches 0.5–1.5× of the start, so 40–120 bpm from 80.')).toBeInTheDocument();
});
