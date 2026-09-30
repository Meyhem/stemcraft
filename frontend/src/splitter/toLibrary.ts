// A split track becomes a Song the same way any file does: through the song
// upload route. Q-04 keeps the splitter standalone on the server, so the
// browser carries the rendered MP3 across -- nothing under albums/ and nothing
// in the Song write path knows about the other. Title and artist are left
// blank so the upload route reads them from the ID3 tags the split wrote,
// which are the truth about this file even if album.json was edited since.
import { albumTrackUrl, api, type CreatedSong } from '../api/client';

export async function sendTrackToLibrary(albumId: string, filename: string): Promise<CreatedSong> {
  const url = albumTrackUrl(albumId, filename);
  const response = await fetch(url);
  if (!response.ok) {
    // N-08: the server's own message, in the shape client.ts uses.
    throw new Error(`GET ${url} → ${response.status}: ${await response.text()}`);
  }
  const form = new FormData();
  form.append('file', new File([await response.arrayBuffer()], filename, { type: 'audio/mpeg' }));
  return api.upload<CreatedSong>('/api/songs/upload', form);
}
