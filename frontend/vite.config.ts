import { readFileSync } from 'node:fs';

import react from '@vitejs/plugin-react';
// vitest/config, not vite: the `test` key below is not part of Vite's own config type.
import { defineConfig } from 'vitest/config';

// Serves `foo.css?source` as the file's text. Vite's own `?raw` returns '' for CSS under
// Vitest (and the class map for a .module.css), so the static guards in
// src/styles/*.test.ts -- which assert on which tokens the CSS names -- read through this
// instead. Test-only in practice: nothing in the app imports a `?source` URL.
const PREFIX = '\0css-source:';
const SUFFIX = '.source.js';
const cssSource = () => ({
  name: 'css-source',
  enforce: 'pre' as const,
  // A virtual id that does not end in .css: Vite's (and Vitest's) CSS transforms claim
  // every id that does and blank the module back to ''.
  async resolveId(this: { resolve: (id: string, importer?: string, options?: object) => Promise<{ id: string } | null> }, id: string, importer?: string) {
    if (!id.endsWith('.css?source')) return null;
    const resolved = await this.resolve(id.slice(0, -'?source'.length), importer, { skipSelf: true });
    return resolved ? PREFIX + resolved.id.split('?')[0] + SUFFIX : null;
  },
  load(id: string) {
    if (!id.startsWith(PREFIX)) return null;
    const text = readFileSync(id.slice(PREFIX.length, -SUFFIX.length), 'utf8');
    return `export default ${JSON.stringify(text)};`;
  },
});

// D-15: the dev server proxies /api so development is one origin, exactly like
// production. Without `ws: true` the proxy drops the upgrade and job progress
// fails in dev only — a class of bug that never reaches production.
export default defineConfig({
  plugins: [react(), cssSource()],
  server: {
    host: '0.0.0.0', // C-05: reachable from other machines on the LAN
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:8000', changeOrigin: true, ws: true },
    },
  },
  build: { outDir: 'dist', sourcemap: true },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/setupTests.ts'],
    // Vitest hashes CSS-module class names by default (`styles.primary` comes back as
    // '_primary_2b6b9a'), so the src/ui/*.test.tsx assertions -- written against the
    // literal names the design system uses -- cannot match. 'non-scoped' resolves
    // `.primary` to 'primary'. Verified against this Vitest version.
    css: { modules: { classNameStrategy: 'non-scoped' } },
  },
});
