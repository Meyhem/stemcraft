#!/usr/bin/env node
// Capture README screenshots of the RUNNING app (docs/screenshots/*.png).
//
// Chrome's one-shot `--screenshot` flag cannot capture the Song view: it snaps before the
// audio engine has decoded the stems, and under --virtual-time-budget the decode never
// finishes at all. So this drives a headless Chrome over the DevTools protocol instead,
// waits until each screen's own "ready" selector exists, then captures.
//
// Needs the API (8000) and the Vite dev server (5173) running, and google-chrome on PATH.
//
//   node scripts/capture-screens.mjs library=/ song-view=/songs/<id> play-along=/songs/<id>/play album-splitter=/splitter/<id> job-queue=/jobs "theory=/theory/scale-finder?root=A&scale=minor-pentatonic" theory-quiz=/theory/fretboard-quiz
//
// Each argument is name=path; the PNG is written to docs/screenshots/<name>.png. Pages are
// loaded and looked at; the play-along capture also presses Space to play and pause, to get
// the neck onto a bar. No song or album is modified: Space only plays/pauses, and nothing
// here sets a pattern or a loop.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.env.STEMCRAFT_URL ?? 'http://localhost:5173';
const OUT = new URL('../docs/screenshots/', import.meta.url).pathname;
const PORT = 9333;
const [WIDTH, HEIGHT] = [1440, 900];

// What "rendered" means per screen: an element that exists only once the data is in.
const READY = {
  library: 'main li, [class*="card"]',
  'song-view': '[data-testid="bass-canvas"]',
  'play-along': '[data-testid="neck-canvas"]',
  theory: '[data-cell]', // the neck's dots (SVG); the tab is a lazy chunk, so 'body' is too early
  'theory-shapes': '[data-cell]',
  'theory-quiz': '[data-marker="question"]', // a question is on the neck: the document is read and the round has started
  'album-splitter': '[data-testid="album-canvas"]',
  'job-queue': '[aria-label="Jobs"] li', // a job row: the list is in
};

// Screens taller than the default viewport: the play-along neck sits below the pickers;
// the Theory rail's instrument footer (tuning, left-handed) sits below the fold at 900; the
// quiz's question, neck, note buttons and weak-spot heatmap need a tall page to be seen together.
const HEIGHTS = { 'play-along': 1420, theory: 960, 'theory-shapes': 960, 'theory-quiz': 1100 };

// Screens that only show their point once playing: press Space, let a few bars go by,
// press Space again so the frame is still. (The neck is empty before the first bar.)
const PLAY_MS = { 'play-along': 7000 };

const shots = process.argv.slice(2).map((arg) => {
  // Split on the FIRST '=' only: a path may carry a query string (theory=/theory/x?root=A).
  const eq = arg.indexOf('=');
  // No '=' (or nothing before it) is not a pair; slicing at -1 would make one up.
  if (eq < 1) throw new Error(`expected name=path, got ${arg}`);
  const name = arg.slice(0, eq);
  const path = arg.slice(eq + 1);
  if (!name || !path) throw new Error(`expected name=path, got ${arg}`);
  return { name, path };
});
if (shots.length === 0) throw new Error('nothing to capture: pass name=path arguments');

const profile = mkdtempSync(join(tmpdir(), 'stemcraft-capture-'));
const chrome = spawn(
  'google-chrome',
  [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--autoplay-policy=no-user-gesture-required',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    `--window-size=${WIDTH},${HEIGHT}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function pageSocket() {
  for (let i = 0; i < 50; i++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      const page = targets.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      // Chrome is still starting.
    }
    await sleep(200);
  }
  throw new Error('Chrome did not expose a page target');
}

function client(url) {
  const ws = new WebSocket(url);
  let id = 0;
  const pending = new Map();
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    }
  };
  const ready = new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const n = ++id;
      pending.set(n, { resolve, reject });
      ws.send(JSON.stringify({ id: n, method, params }));
    });
  return { ready, send, close: () => ws.close() };
}

async function waitFor(cdp, selector, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { result } = await cdp.send('Runtime.evaluate', {
      expression: `Boolean(document.querySelector(${JSON.stringify(selector)}))`,
      returnByValue: true,
    });
    if (result.value) return;
    await sleep(250);
  }
  throw new Error(`timed out waiting for ${selector}`);
}

try {
  const cdp = client(await pageSocket());
  await cdp.ready;
  await cdp.send('Page.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: WIDTH,
    height: HEIGHT,
    deviceScaleFactor: 1,
    mobile: false,
  });
  for (const { name, path } of shots) {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: WIDTH,
      height: HEIGHTS[name] ?? HEIGHT,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await cdp.send('Page.navigate', { url: `${BASE}${path}` });
    await waitFor(cdp, READY[name] ?? 'body');
    if (PLAY_MS[name]) {
      const space = (type) =>
        cdp.send('Input.dispatchKeyEvent', { type, key: ' ', code: 'Space', windowsVirtualKeyCode: 32, text: ' ' });
      await space('keyDown');
      await space('keyUp');
      await sleep(PLAY_MS[name]);
      await space('keyDown');
      await space('keyUp');
    }
    await sleep(1500); // let the canvases paint and fonts settle
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(OUT, `${name}.png`), Buffer.from(data, 'base64'));
    console.log(`wrote docs/screenshots/${name}.png`);
  }
  cdp.close();
} finally {
  chrome.kill();
  rmSync(profile, { recursive: true, force: true });
}
