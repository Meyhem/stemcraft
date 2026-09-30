import { formatJobTime, formatJobTimeFull } from './jobTime';

// An ISO timestamp from song.json / album.json; missing or unparsable shows a dash.
export function When({ iso }: { iso: string | null | undefined }) {
  const ms = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(ms)) return <span className="dim3">—</span>;
  return (
    <time dateTime={new Date(ms).toISOString()} title={formatJobTimeFull(ms / 1000)}>
      {formatJobTime(ms / 1000)}
    </time>
  );
}
