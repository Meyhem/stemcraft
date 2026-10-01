import { expect, test } from 'vitest';

import html from '../../index.html?raw';
import tokens from './tokens.css?source';

// The splash in index.html paints before tokens.css loads, so it carries the stem hues as
// literals (U-02 forbids copying a hex into TSX; this is the one place a token cannot
// resolve). This keeps them from drifting from the tokens.
test('the splash uses the stem hues from tokens.css', () => {
  for (const [name, cls] of [['vocals', 'lv'], ['drums', 'ld'], ['bass', 'lb'], ['other', 'lo']] as const) {
    const hue = new RegExp(`--ds-${name}:\\s*(#[0-9A-Fa-f]{6})`).exec(tokens)?.[1];
    expect(hue, `--ds-${name} in tokens.css`).toBeDefined();
    expect(html).toContain(`#splash .${cls} { --c: ${hue};`);
  }
});

test('the splash says what is happening and is announced', () => {
  expect(html).toContain('role="status"');
  expect(html).toContain('Starting Stemcraft…');
});
