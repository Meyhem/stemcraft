import react from '@vitejs/plugin-react';
// vitest/config, not vite: the `test` key below is not part of Vite's own config type.
import { defineConfig } from 'vitest/config';

// D-15: the dev server proxies /api so development is one origin, exactly like
// production. Without `ws: true` the proxy drops the upgrade and job progress
// fails in dev only — a class of bug that never reaches production.
export default defineConfig({
  plugins: [react()],
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
  },
});
