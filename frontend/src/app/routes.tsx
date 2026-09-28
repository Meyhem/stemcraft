// D-14: one route per screen, song id in the path.
import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';

import { AlbumSplitter } from '../screens/AlbumSplitter';
import { Export } from '../screens/Export';
import { Import } from '../screens/Import';
import { JobQueue } from '../screens/JobQueue';
import { Library } from '../screens/Library';
import { ScaleSheet } from '../screens/ScaleSheet';
import { SongView } from '../screens/SongView';
import { AppShell } from './AppShell';

// Task 8: dev-only manual verification page for the playback engine (R-01).
// The `import.meta.env.DEV` check must gate the dynamic import() itself, not
// just the JSX that renders it — Vite/Rollup constant-fold `DEV` to `false` in
// a production build and then drop the whole `import()` expression as dead
// code, taking EngineHarness, EngineController and every fixture asset it
// pulls in with it. A static import guarded only by a JSX conditional would
// still end up in the production bundle. Rendered chrome-free (no AppShell):
// this page is meant to be listened to in isolation against a click track,
// and AppShell's nav/health-check/job-stream chrome is irrelevant noise here.
const EngineHarness = import.meta.env.DEV ? lazy(() => import('../dev/EngineHarness')) : null;

export function AppRoutes() {
  return (
    <Routes>
      {import.meta.env.DEV && EngineHarness && (
        <Route
          path="dev/engine-harness"
          element={
            <Suspense fallback={null}>
              <EngineHarness />
            </Suspense>
          }
        />
      )}
      <Route element={<AppShell />}>
        <Route index element={<Library />} />
        <Route path="import" element={<Import />} />
        <Route path="splitter" element={<AlbumSplitter />} />
        <Route path="jobs" element={<JobQueue />} />
        <Route path="songs/:songId" element={<SongView />} />
        <Route path="songs/:songId/scale" element={<ScaleSheet />} />
        <Route path="songs/:songId/export" element={<Export />} />
        <Route path="*" element={<p>Not found</p>} />
      </Route>
    </Routes>
  );
}
