// D-18: the layout route over /songs/:songId and /songs/:songId/play. It owns
// the session, so the engine lives exactly as long as the user is on this
// song: switching between Song view and Play along keeps it (and keeps
// playing), and leaving the song unmounts this and disposes it.
import { Outlet, useParams } from 'react-router-dom';

import { SongSessionContext, useSongSessionState } from './SongSession';

export function SongScope() {
  const { songId = '' } = useParams();
  const session = useSongSessionState(songId);
  return (
    <SongSessionContext.Provider value={session}>
      <Outlet />
    </SongSessionContext.Provider>
  );
}
