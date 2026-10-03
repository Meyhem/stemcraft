// D-14: one route per screen, song id in the path.
import { lazy, Suspense } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';

import { AlbumSplitter } from '../screens/AlbumSplitter';
import { Export } from '../screens/Export';
import { JobQueue } from '../screens/JobQueue';
import { Library } from '../screens/Library';
import { PlayAlong } from '../screens/PlayAlong';
import { SongScreen } from '../screens/SongScreen';
import { SongView } from '../screens/SongView';
import { TabView } from '../screens/TabView';
import { ImportModal } from '../screens/import/ImportModal';
import type { ImportLinkState } from '../screens/import/importLink';
import { SongScope } from '../session/SongScope';
import { Loader } from '../ui';
import { AppShell } from './AppShell';

// D-19: the Theory tab and tonal load only when the tab is opened, keeping the
// main bundle under Vite's 500 kB warning.
const Theory = lazy(() => import('../screens/Theory').then((m) => ({ default: m.Theory })));
// D-22: Practice loads its music and audio code only when the tab is opened.
const Practice = lazy(() => import('../screens/Practice').then((m) => ({ default: m.Practice })));

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
  const location = useLocation();
  // D-14: /import is a route that renders as a modal over the page it was
  // opened from. A direct visit has no background, so the Library is drawn under it.
  const background = (location.state as ImportLinkState | null)?.background;

  return (
    <>
      <Routes location={background ?? location}>
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
          <Route path="import" element={<Library />} />
          <Route path="splitter" element={<AlbumSplitter />} />
          {/* D-14: the album id lives in the path, like every other document
              this app edits. /splitter is the picker; /splitter/:albumId is the
              editor. */}
          <Route path="splitter/:albumId" element={<AlbumSplitter />} />
          <Route path="jobs" element={<JobQueue />} />
          {/* D-19: the tool is in the path, the shared selection in the query string. */}
          <Route path="theory" element={<Suspense fallback={<Loader size="page" label="Loading theory…" />}><Theory /></Suspense>} />
          <Route path="theory/:tool" element={<Suspense fallback={<Loader size="page" label="Loading theory…" />}><Theory /></Suspense>} />
          <Route path="practice" element={<Suspense fallback={<Loader size="page" label="Loading practice…" />}><Practice /></Suspense>} />
          {/* D-18: one session per song, above the content that plays it. SongScreen is
              the shared header, transport and Stems / Tab / Play along switch; the child
              routes are only the content under it, so switching never stops playback and
              never moves a control. Tab is the transcription (D-21), Play along the
              generated patterns (D-18, D-20). */}
          <Route path="songs/:songId" element={<SongScope />}>
            <Route element={<SongScreen />}>
              <Route index element={<SongView />} />
              <Route path="tab" element={<TabView />} />
              <Route path="play" element={<PlayAlong />} />
            </Route>
          </Route>
          <Route path="songs/:songId/export" element={<Export />} />
          <Route path="*" element={<p>Not found</p>} />
        </Route>
      </Routes>
      <Routes>
        <Route path="/import" element={<ImportModal />} />
        <Route path="*" element={null} />
      </Routes>
    </>
  );
}
