import { cleanup, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

import { renderTool } from './testing';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const guitar = { instrument: { kind: 'guitar' as const, strings: 6, tuning: ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'], left_handed: false } };

test('chord finder on guitar shows voicing cards with tab', async () => {
  renderTool('/theory/chord-finder?root=A&q=m7', { theory: guitar });
  expect(await screen.findByText('x02010')).toBeInTheDocument();
  expect(screen.getByText('575555')).toBeInTheDocument();
  expect(screen.getByText('Open')).toBeInTheDocument();
  expect(screen.getAllByText('Root on 6th string · fret 5').length).toBeGreaterThan(0);
});

test('chord finder on bass shows arpeggio shapes in play order', async () => {
  const { container } = renderTool('/theory/chord-finder?root=A&q=m7');
  expect(await screen.findByText('From the root on the E string')).toBeInTheDocument();
  const card = screen.getByText('From the root on the E string').closest('div')!.parentElement!;
  expect([...card.querySelectorAll('[data-cell]')].map((d) => d.textContent)).toEqual(['1', '2', '3', '4', '5']);
  expect(container.querySelector('[data-cell="s3f5"][data-marker="root"]')).not.toBeNull();
});

test('a bass arpeggio that spans five frets is drawn whole, every note inside the card', async () => {
  // C dim7 from the E string sits on frets 7-11, the widest a bass shape gets.
  renderTool('/theory/chord-finder?root=C&q=dim7');
  const title = await screen.findByText('From the root on the E string');
  const card = title.closest('div')!.parentElement!;
  const dots = [...card.querySelectorAll('[data-cell]')];
  expect(dots.map((d) => d.textContent)).toEqual(['1', '2', '3', '4', '5']);
  expect(dots.map((d) => d.getAttribute('data-cell')!.replace(/^s\d+f/, ''))).toContain('11');
  const width = Number(card.querySelector('svg')!.getAttribute('viewBox')!.split(' ')[2]);
  for (const circle of card.querySelectorAll('[data-cell] circle')) {
    const cx = Number(circle.getAttribute('cx'));
    expect(cx).toBeGreaterThan(0);
    expect(cx).toBeLessThan(width - 18);
  }
});
