// The cut list beside the waveform. Everything except the title and the two times is
// derived: the number, the duration and the filename all come from trackSpans(), which
// mirrors what the server will compute from the same album.json -- so the filename shown
// here is the filename the split will actually write.
//
// Start and End are editable, and they are the SAME cuts the waveform draws: track k's
// End and track k+1's Start are one split point, so editing either moves it and the
// neighbouring row follows. Track 1's Start (0) and the last track's End (the album
// length) are not cuts and are read-only.
//
// There is no per-track album/artist column: those are fields on the Album, so
// every track inherits them by construction (D8-05). "Typed once and filled
// down" is the data model, not a button.
import { useState } from 'react';

import type { ClientSpan } from './spans';
import { PlayIcon } from './icons';
import { formatTimestamp, parseTimestamp, SAMPLE_RATE } from './time';
import { Button, Table } from '../ui';
import styles from './TrackTable.module.css';

export interface TrackTableProps {
  spans: ClientSpan[];
  onTitleChange(index: number, title: string): void;
  /** Move the cut between track `leftIndex` and the one after it, to `sample`. */
  onCutChange(leftIndex: number, sample: number): void;
  /** Play from the start of track `index`. */
  onPlay(index: number): void;
  /** Delete the cut after track `index`, merging it with the next track. */
  onRemoveCut(index: number): void;
}

function formatDuration(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

interface TimeFieldProps {
  label: string;
  sample: number;
  /** Inclusive range this cut may take without crossing a neighbour. */
  low: number;
  high: number;
  onCommit(sample: number): void;
}

/**
 * A time the user can type. Keeps its own text while focused so a half-typed value is not
 * reformatted under the cursor; commits on blur or Enter. An invalid or out-of-range
 * value is shown as an error and the cut does NOT move -- it is never clamped silently
 * (N-08), because a cut that lands somewhere other than what was typed is worse than one
 * that visibly did not move.
 */
function TimeField({ label, sample, low, high, onCommit }: TimeFieldProps) {
  const shown = formatTimestamp(sample);
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function commit() {
    if (draft === null) return;
    // Unchanged text is not an edit: the display is rounded to the millisecond, and
    // re-committing it would nudge a cut placed with sample precision.
    if (draft.trim() === shown) {
      setDraft(null);
      setError(null);
      return;
    }
    const parsed = parseTimestamp(draft);
    if (parsed === null) {
      setError('Not a time. Use m:ss.mmm, for example 3:07.250');
      return;
    }
    if (parsed < low || parsed > high) {
      // Quote the bounds in whole milliseconds, the unit the field speaks: the raw
      // sample bounds (1 and total-1) would both display as a bound the user is then
      // told is out of range.
      const ms = SAMPLE_RATE / 1000;
      setError(
        `Must be between ${formatTimestamp(Math.ceil(low / ms) * ms)} and ${formatTimestamp(Math.floor(high / ms) * ms)}`,
      );
      return;
    }
    onCommit(parsed);
    setDraft(null);
    setError(null);
  }

  return (
    <div className={styles.timeCell}>
      <input
        className={`${styles.title} ${styles.time}`}
        aria-label={label}
        aria-invalid={error !== null}
        value={draft ?? shown}
        onChange={(event) => {
          setDraft(event.target.value);
          setError(null);
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit();
          if (event.key === 'Escape') {
            setDraft(null);
            setError(null);
          }
        }}
      />
      {error && (
        <span className={styles.error} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

export function TrackTable({ spans, onTitleChange, onCutChange, onPlay, onRemoveCut }: TrackTableProps) {
  // The cut between span `left` and span `left + 1` may sit anywhere strictly inside
  // the two tracks it separates -- Album's validator rejects a zero-length track.
  const cutBounds = (left: number): [number, number] => [
    spans[left]!.startSample + 1,
    spans[left + 1]!.endSample - 1,
  ];

  return (
    <Table>
      <thead>
        <tr>
          <th scope="col" className={styles.numberHead}>
            #
          </th>
          <th scope="col" className={styles.playHead}>
            <span className={styles.srOnly}>Play</span>
          </th>
          <th scope="col">Title</th>
          <th scope="col">Start</th>
          <th scope="col">End</th>
          <th scope="col">Length</th>
          <th scope="col">File</th>
          <th scope="col" className={styles.playHead}>
            <span className={styles.srOnly}>Remove cut</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {spans.map((span, index) => {
          const isFirst = index === 0;
          const isLast = index === spans.length - 1;
          return (
            <tr key={span.number}>
              <td className={`num ${styles.number}`}>{span.number}</td>
              <td>
                <Button
                  aria-label={`Play track ${span.number} from its start`}
                  onClick={() => onPlay(index)}
                >
                  <PlayIcon />
                </Button>
              </td>
              <td>
                <input
                  className={styles.title}
                  aria-label={`Track title ${span.number}`}
                  placeholder="Untitled"
                  value={span.title}
                  onChange={(event) => onTitleChange(index, event.target.value)}
                />
              </td>
              <td>
                {isFirst ? (
                  <span className={`num ${styles.meta}`}>{formatTimestamp(span.startSample)}</span>
                ) : (
                  <TimeField
                    label={`Track ${span.number} start`}
                    sample={span.startSample}
                    low={cutBounds(index - 1)[0]}
                    high={cutBounds(index - 1)[1]}
                    onCommit={(sample) => onCutChange(index - 1, sample)}
                  />
                )}
              </td>
              <td>
                {isLast ? (
                  <span className={`num ${styles.meta}`}>{formatTimestamp(span.endSample)}</span>
                ) : (
                  <TimeField
                    label={`Track ${span.number} end`}
                    sample={span.endSample}
                    low={cutBounds(index)[0]}
                    high={cutBounds(index)[1]}
                    onCommit={(sample) => onCutChange(index, sample)}
                  />
                )}
              </td>
              <td className={`num ${styles.meta}`}>{formatDuration(span.durationSeconds)}</td>
              {/* Shown before the split runs, on purpose: the user should be
                  able to see what they are about to get. */}
              <td className={`num ${styles.meta}`}>{span.filename}</td>
              <td>
                {!isLast && (
                  <Button
                      aria-label={`Remove the cut after track ${span.number}`}
                    onClick={() => onRemoveCut(index)}
                  >
                    ×
                  </Button>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}
