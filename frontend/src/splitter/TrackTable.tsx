// The track list beside the waveform. Everything except the title is derived:
// the number, the duration and the filename all come from trackSpans(), which
// mirrors what the server will compute from the same album.json -- so the
// filename shown here is the filename the split will actually write.
//
// There is no per-track album/artist column: those are fields on the Album, so
// every track inherits them by construction (D8-05). "Typed once and filled
// down" is the data model, not a button.
import type { ClientSpan } from './spans';
import { Table } from '../ui';
import styles from './TrackTable.module.css';

export interface TrackTableProps {
  spans: ClientSpan[];
  onTitleChange(index: number, title: string): void;
}

function formatDuration(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

export function TrackTable({ spans, onTitleChange }: TrackTableProps) {
  return (
    <Table>
      <thead>
        <tr>
          <th scope="col" className={styles.numberHead}>
            #
          </th>
          <th scope="col">Title</th>
          <th scope="col">Length</th>
          <th scope="col">File</th>
        </tr>
      </thead>
      <tbody>
        {spans.map((span, index) => (
          <tr key={span.number}>
            <td className={`num ${styles.number}`}>{span.number}</td>
            <td>
              <input
                className={styles.title}
                aria-label={`Track title ${span.number}`}
                placeholder="Untitled"
                value={span.title}
                onChange={(event) => onTitleChange(index, event.target.value)}
              />
            </td>
            <td className={`num ${styles.meta}`}>{formatDuration(span.durationSeconds)}</td>
            {/* Shown before the split runs, on purpose: the user should be
                able to see what they are about to get. */}
            <td className={`num ${styles.meta}`}>{span.filename}</td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
