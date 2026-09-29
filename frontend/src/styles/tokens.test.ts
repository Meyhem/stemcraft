import { expect, test } from 'vitest';

// ?source (see cssSource in vite.config.ts), not node:fs: the frontend has no @types/node
// and `npm run build` typechecks test files too. Vite's own ?raw returns '' for CSS here.
import authority from '../../../design/ui/src/tokens.css?source';
import mirror from './tokens.css?source';

// U-02: design/ui/src/tokens.css is the authority; frontend/src/styles/tokens.css is a
// mirror of it. They are byte-identical today and this test exists to keep them that
// way -- a token added to one and not the other is a divergence that shows up as a
// wrong colour weeks later, in one place, and looks like a screen bug.
//
// Load-bearing: this asserts on the *bytes*, not on a parsed set of names. A
// reformatted mirror is still a divergence, because design/ui/build.py inlines the
// authority verbatim into the reference pages a human compares the app against.
test('the frontend token mirror is byte-identical to the design system authority', () => {
  expect(mirror).toBe(authority);
});

test('the on-filled-control text tokens exist', () => {
  // Buttons paint filled controls with var(--ds-on-accent). If the token is missing the
  // text inherits --ds-text: near-white on a bright accent fill.
  expect(mirror).toContain('--ds-on-accent:#04121F');
  expect(mirror).toContain('--ds-on-error:#180000');
  expect(mirror).toContain('--ds-on-warn:#1A1200');
});
