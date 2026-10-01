import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

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

// N-08: the splash must say why the app did not start. The inline script is run here in
// jsdom against the page's own markup.
function bootSplash() {
  document.body.innerHTML = html.slice(html.indexOf('<div id="root">'), html.indexOf('<noscript>'))
    + '<script type="module" src="/src/main.tsx"></script>';
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)![1]!;
  new Function(script)();
}

describe('splash failure', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  test('a bundle that fails to load is named, in an alert', () => {
    bootSplash();
    const tag = document.querySelector('script')!;
    tag.dispatchEvent(new Event('error')); // does not bubble; the script listens in capture
    const splash = document.getElementById('splash')!;
    expect(splash).toHaveAttribute('role', 'alert');
    expect(splash).toHaveTextContent('Stemcraft could not load');
    expect(splash).toHaveTextContent('/src/main.tsx');
  });

  test('an error thrown before mount shows its real message', () => {
    bootSplash();
    window.dispatchEvent(new ErrorEvent('error', { message: 'x', error: new Error('boom at startup') }));
    expect(document.getElementById('splash')).toHaveTextContent('boom at startup');
  });

  test('a bundle that never arrives times out and reports what the server said', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 502, statusText: 'Bad Gateway' }));
    bootSplash();
    await vi.advanceTimersByTimeAsync(14_999);
    expect(document.getElementById('splash')).toHaveAttribute('role', 'status');
    await vi.advanceTimersByTimeAsync(2);
    expect(document.getElementById('splash')).toHaveTextContent('taking too long');
    expect(document.getElementById('splash')).toHaveTextContent('HTTP 502 Bad Gateway');
  });

  test('a network failure is reported with the browser own message', async () => {
    vi.stubGlobal('fetch', async () => { throw new TypeError('Failed to fetch'); });
    bootSplash();
    await vi.advanceTimersByTimeAsync(15_001);
    expect(document.getElementById('splash')).toHaveTextContent('Failed to fetch');
  });

  test('once the app has replaced the splash, the timer does nothing', async () => {
    const fetched = vi.fn();
    vi.stubGlobal('fetch', fetched);
    bootSplash();
    document.getElementById('root')!.innerHTML = '<nav>app</nav>'; // what React's first render does
    await vi.advanceTimersByTimeAsync(20_000);
    expect(fetched).not.toHaveBeenCalled();
    expect(document.body).not.toHaveTextContent('taking too long');
  });
});
