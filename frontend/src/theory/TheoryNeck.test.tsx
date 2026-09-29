import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

import { DEFAULT_INSTRUMENT, instrumentFor } from '../music/tuning';
import { TheoryNeck, type NeckDot } from './TheoryNeck';

const dots: NeckDot[] = [
  { string: 3, fret: 5, label: 'A', marker: 'root' },
  { string: 2, fret: 0, label: 'A', marker: 'root' },
  { string: 1, fret: 7, label: 'A', marker: 'tone', dim: true },
];

test('draws one dot per note with its marker, label and dim state', () => {
  const { container } = render(<TheoryNeck instrument={DEFAULT_INSTRUMENT} frets={12} dots={dots} label="A on bass" />);
  const drawn = container.querySelectorAll('[data-cell]');
  expect([...drawn].map((d) => `${d.getAttribute('data-cell')}:${d.getAttribute('data-marker')}`)).toEqual([
    's3f5:root',
    's2f0:root',
    's1f7:tone',
  ]);
  expect(container.querySelector('[data-cell="s1f7"]')).toHaveAttribute('data-dim', 'true');
  expect(screen.getByRole('group', { name: 'A on bass' })).toBeInTheDocument();
});

test('names strings from the tuning, highest string on top', () => {
  const { container } = render(
    <TheoryNeck instrument={{ ...DEFAULT_INSTRUMENT, tuning: ['D1', 'A1', 'D2', 'G2'] }} frets={12} dots={[]} label="neck" />,
  );
  const names = [...container.querySelectorAll('text')].map((t) => t.textContent).filter((t) => /^[A-G]/.test(t ?? ''));
  expect(names).toEqual(['G', 'D', 'A', 'D']);
});

test('a zoomed window numbers its first fret and has no open column', () => {
  const { container } = render(
    <TheoryNeck instrument={instrumentFor('guitar6', false)} start={4} frets={5} size="card" dots={[]} label="card" />,
  );
  const numbers = [...container.querySelectorAll('text')].map((t) => t.textContent).filter((t) => /^\d+$/.test(t ?? ''));
  expect(numbers).toEqual(['4', '5', '7']);
});

test('wrong and question markers draw ✕ and ?', () => {
  const { container } = render(
    <TheoryNeck
      instrument={DEFAULT_INSTRUMENT}
      frets={12}
      label="quiz"
      dots={[
        { string: 3, fret: 4, label: 'G♯', marker: 'wrong' },
        { string: 2, fret: 10, label: 'G', marker: 'question' },
      ]}
    />,
  );
  expect(container.querySelector('[data-cell="s3f4"]')?.textContent).toBe('✕');
  expect(container.querySelector('[data-cell="s2f10"]')?.textContent).toBe('?');
});

test('click targets report the cell, by mouse and by keyboard', () => {
  const onPick = vi.fn();
  render(<TheoryNeck instrument={DEFAULT_INSTRUMENT} frets={12} dots={[]} label="pick" onPick={onPick} />);
  fireEvent.click(screen.getByRole('button', { name: 'A string, fret 7' }));
  expect(onPick).toHaveBeenLastCalledWith({ string: 2, fret: 7 });
  fireEvent.keyDown(screen.getByRole('button', { name: 'E string, open' }), { key: 'Enter' });
  expect(onPick).toHaveBeenLastCalledWith({ string: 3, fret: 0 });
});

test('left-handed mirrors the neck', () => {
  const { container } = render(
    <TheoryNeck instrument={{ ...DEFAULT_INSTRUMENT, left_handed: true }} frets={12} dots={dots} label="lefty" />,
  );
  expect(container.querySelector('svg > g')).toHaveAttribute('transform', 'translate(1000 0) scale(-1 1)');
});

test('heat cells are drawn weak or strong', () => {
  const { container } = render(
    <TheoryNeck
      instrument={DEFAULT_INSTRUMENT}
      frets={12}
      dots={[]}
      label="heat"
      heat={[
        { string: 2, fret: 7, weakness: 0.9 },
        { string: 3, fret: 3, weakness: 0.1 },
      ]}
    />,
  );
  expect(container.querySelector('[data-heat="s2f7"]')).toHaveClass('heatWeak');
  expect(container.querySelector('[data-heat="s3f3"]')).toHaveClass('heatStrong');
});
