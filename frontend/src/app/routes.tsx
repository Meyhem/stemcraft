// D-14: one route per screen, song id in the path.
import { Route, Routes } from 'react-router-dom';

import { AlbumSplitter } from '../screens/AlbumSplitter';
import { Export } from '../screens/Export';
import { Import } from '../screens/Import';
import { JobQueue } from '../screens/JobQueue';
import { Library } from '../screens/Library';
import { ScaleSheet } from '../screens/ScaleSheet';
import { SongView } from '../screens/SongView';
import { AppShell } from './AppShell';

export function AppRoutes() {
  return (
    <Routes>
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
