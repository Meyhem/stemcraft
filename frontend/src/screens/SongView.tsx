import { useParams } from 'react-router-dom';

export function SongView() {
  const { songId } = useParams();
  return <h1>Song {songId}</h1>;
}
