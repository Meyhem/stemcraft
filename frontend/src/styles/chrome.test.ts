import { expect, test } from 'vitest';

// Static guards over every CSS module. jsdom applies no cascade, so no rendering test
// can say what colour a control is painted -- but the invariants below are about which
// tokens the CSS *names*, and that is readable as text. cssSource in
// vite.config.ts serves `?source` as the file's text.
const modules = import.meta.glob('../**/*.module.css', {
  query: '?source',
  import: 'default',
  eager: true,
}) as Record<string, string>;

// Comments explain the rules (and legitimately name the tokens they forbid).
const code = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

test('the glob found real stylesheets, so the guards below cannot pass by reading nothing', () => {
  const entries = Object.entries(modules);
  expect(entries.length).toBeGreaterThan(20);
  for (const [path, css] of entries) {
    expect(css.length, `${path} came back empty`).toBeGreaterThan(0);
  }
});

test('stem hues appear only where a stem is named (U-01)', () => {
  // A lit/pressed/selected control is chrome and takes --ds-accent. The muted stem hues
  // identify a stem, so the only stylesheet allowed to paint with one is the
  // fretboard's, whose root-note dots are the instrument being named. (StemLane sets its
  // --lane-hue from the stem's own token in TSX, which is the stem being named too.)
  const ALLOWED = ['Fretboard.module.css'];
  const stemHue = /--ds-(vocals|drums|bass|other)\b/;
  const offenders = Object.entries(modules)
    .filter(([path]) => !ALLOWED.some((name) => path.endsWith(name)))
    .filter(([, css]) => stemHue.test(code(css)))
    .map(([path]) => path);
  expect(offenders).toEqual([]);
});

test('no raw hex colour outside tokens.css', () => {
  const offenders = Object.entries(modules)
    .filter(([, css]) => /#[0-9a-fA-F]{3,8}\b/.test(code(css)))
    .map(([path]) => path);
  expect(offenders).toEqual([]);
});

test('nothing on the playhead path is animated by CSS (U-05)', () => {
  // D-07 makes the engine the only clock. A CSS transition on the playhead, the chord
  // highlight or the splitter's playhead is a second clock that interpolates through
  // moments the engine did not have -- including the loop wrap, where it would hide the
  // seam R-01 exists to catch. Comments are stripped: these files explain the rule.
  const PLAYHEAD_PATH = ['Timeline.module.css', 'ChordStrip.module.css', 'WaveformMarkers.module.css'];
  const found = Object.entries(modules).filter(([path]) =>
    PLAYHEAD_PATH.some((name) => path.endsWith(name)),
  );
  // If a file is renamed the guard would silently cover nothing.
  expect(found.map(([path]) => path.split('/').pop()).sort()).toEqual([...PLAYHEAD_PATH].sort());
  const offenders = found
    .filter(([, css]) => /\b(transition|animation)\b/.test(code(css)))
    .map(([path]) => path);
  expect(offenders).toEqual([]);
});
