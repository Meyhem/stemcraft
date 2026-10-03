import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi, type MockInstance } from 'vitest';

import { DEFAULT_THEORY, type TheoryDoc } from '../../api/client';
import { positionAt, type Cell } from '../../music/positions';
import { DEFAULT_INSTRUMENT } from '../../music/tuning';
import * as render from '../audio/guessRender';
import { forgetUnsavedTheory } from '../TheoryDoc';
import { guessEngine } from '../useGuessSound';
import { seeds } from '../useQuizHistory';
import { fakeEngine, renderTool } from './testing';

afterEach(() => {
  cleanup();
  forgetUnsavedTheory();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

let engine: ReturnType<typeof fakeEngine>;
let create: MockInstance<typeof guessEngine.create>;
let rendered: MockInstance<typeof render.renderGuess>;
beforeEach(() => {
  vi.spyOn(seeds, 'next').mockReturnValue(20261003);
  engine = fakeEngine();
  create = vi.spyOn(guessEngine, 'create').mockResolvedValue(engine);
  rendered = vi.spyOn(render, 'renderGuess');
});

const KEYS = ['C', 'C♯/D♭', 'D', 'E♭', 'E', 'F', 'F♯/G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
const STRING = ['G', 'D', 'A', 'E'];
const ear = (settings: Partial<TheoryDoc['quiz']['settings']['ear']> = {}): Partial<TheoryDoc> => ({
  last_tool: 'guess-note',
  quiz: { ...DEFAULT_THEORY.quiz, settings: { ...DEFAULT_THEORY.quiz.settings, ear: { ...DEFAULT_THEORY.quiz.settings.ear, ...settings } } },
});

const target = () => rendered.mock.calls.at(-1)![1] as number;
const reference = () => rendered.mock.calls.at(-1)![2] as number | null;
const play = async () => {
  fireEvent.click(await screen.findByRole('button', { name: '▶ Play' }));
  await act(async () => {});
};
const answers = () => within(screen.getByRole('group', { name: 'Answer' }));
const tap = (c: Cell) => fireEvent.click(screen.getByRole('button', { name: `${STRING[c.string]} string, ${c.fret === 0 ? 'open' : `fret ${c.fret}`}` }));
const cellsOf = (midi: number): Cell[] =>
  [0, 1, 2, 3].flatMap((string) => Array.from({ length: 13 }, (_, fret) => ({ string, fret }))).filter((c) => positionAt(DEFAULT_INSTRUMENT, c).midi === midi);

test('nothing sounds until Play; then the question plays with an A first, and the next ones play by themselves', async () => {
  renderTool('/theory/guess-note', { theory: ear() });
  expect(await screen.findByText('A, then which note?')).toBeInTheDocument();
  expect(create).not.toHaveBeenCalled();
  await play();
  expect(create).toHaveBeenCalledTimes(1);
  expect(reference()).not.toBeNull();
  fireEvent.click(answers().getByRole('button', { name: KEYS[target() % 12]! }));
  await act(async () => {});
  expect(engine.replaceStems).toHaveBeenCalledTimes(1);
  expect(screen.getByText(/^That was /)).toBeInTheDocument();
});

test('a wrong name is explained and the question stays; only the first try is recorded', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const { puts } = renderTool('/theory/guess-note', { theory: ear() });
  await play();
  const t = target();
  fireEvent.click(answers().getByRole('button', { name: KEYS[(t + 1) % 12]! }));
  expect(screen.getByRole('status')).toHaveTextContent('✕ not');
  expect(target()).toBe(t);
  fireEvent.click(answers().getByRole('button', { name: KEYS[t % 12]! }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(600);
  });
  expect(puts.at(-1)!.quiz.history.at(-1)).toMatchObject({ quiz: 'ear', mode: 'name/a', item: `m${t}`, correct: false });
});

test('on the neck, every cell with the exact pitch is right, and an octave off is said', async () => {
  renderTool('/theory/guess-note', { theory: ear({ answer: 'neck', reference: 'none' }) });
  expect(await screen.findByText('Which note?')).toBeInTheDocument();
  await play();
  expect(reference()).toBeNull();
  const t = target();
  const octave = cellsOf(t + 12)[0] ?? cellsOf(t - 12)[0];
  if (octave) {
    tap(octave);
    expect(screen.getByRole('status')).toHaveTextContent('✕ right note, an octave too');
  }
  const right = cellsOf(t);
  tap(right[right.length - 1]!);
  await act(async () => {});
  expect(screen.getByText(/^That was /)).toBeInTheDocument();
});

test('Space plays the question again without answering it', async () => {
  renderTool('/theory/guess-note', { theory: ear() });
  await play();
  const t = target();
  fireEvent.keyDown(window, { key: ' ' });
  await act(async () => {});
  expect(engine.play).toHaveBeenCalledTimes(2);
  expect(target()).toBe(t);
});

test('the digit keys answer in name mode', async () => {
  renderTool('/theory/guess-note', { theory: ear() });
  await play();
  const t = target();
  fireEvent.keyDown(window, { key: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '='][t % 12]! });
  await act(async () => {});
  expect(screen.getByText(/^That was /)).toBeInTheDocument();
});

test('an engine that cannot start is shown as it is, and no answer is offered', async () => {
  create.mockRejectedValue(new Error("The browser's audio runs at 44100 Hz and would not switch to 48000 Hz"));
  renderTool('/theory/guess-note', { theory: ear() });
  await play();
  expect(screen.getByRole('alert')).toHaveTextContent("Can't play the note: The browser's audio runs at 44100 Hz");
  expect(screen.queryByRole('group', { name: 'Answer' })).toBeNull();
});

test('the answer and reference settings are saved', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const { puts } = renderTool('/theory/guess-note', { theory: ear() });
  await screen.findByText('A, then which note?');
  fireEvent.click(screen.getByRole('button', { name: 'On the neck' }));
  fireEvent.click(screen.getByRole('button', { name: 'No reference' }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(600);
  });
  expect(puts.at(-1)!.quiz.settings.ear).toMatchObject({ answer: 'neck', reference: 'none' });
});

test('a focus with nothing in it says so and offers to widen it', async () => {
  renderTool('/theory/guess-note', { theory: ear({ strings: [9] }) });
  expect(await screen.findByRole('alert')).toHaveTextContent('No notes to ask about.');
  expect(screen.getByRole('button', { name: 'Widen the focus' })).toBeInTheDocument();
});

test('the ear focus follows a change of instrument', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const { puts } = renderTool('/theory/guess-note', { theory: ear({ strings: [3, 2] }) });
  await screen.findByText('A, then which note?');
  fireEvent.change(screen.getByRole('combobox', { name: 'Instrument' }), { target: { value: 'guitar6' } });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(600);
  });
  expect(puts.at(-1)!.quiz.settings.ear.strings).toEqual([5, 4]);
});
