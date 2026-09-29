// Chord chart arithmetic for the Song view: merging the analysis's per-bar
// segments into runs, spelling them for display, and finding the one under the
// playhead. Pure, so the chord row and the transport readout agree by
// construction -- both paint from the same merged list and the same lookup.
import type { ChordSegment } from '../api/client';
import type { SampleIndex } from '../engine/types';

/**
 * "G:maj" -> "G", "E:min" -> "Em", "C:maj7" -> "Cmaj7", "N" -> no chord,
 * "X" -> unclassifiable. The wire format is BTC's; this is the reading of it.
 * Both N and X are rendered as marks with labels rather than as blanks -- a gap
 * in the strip would read as a rendering bug instead of as "the model had
 * nothing to say here" (N-08's spirit applied to a display).
 */
export function formatChord(chord: string): { text: string; label: string } {
  if (chord === 'N') return { text: '–', label: 'no chord' };
  if (chord === 'X') return { text: '?', label: 'unclassified' };
  const [root, quality] = chord.split(':');
  if (!quality) return { text: chord, label: chord };
  if (quality === 'maj') return { text: root!, label: `${root} major` };
  if (quality === 'min') return { text: `${root}m`, label: `${root} minor` };
  return { text: `${root}${quality}`, label: `${root} ${quality}` };
}

// Only the root is a note name. BTC's qualities and slash-basses are scale
// degrees ("7(b9)", "maj/b7"), where "b" is a degree flat, not a note.
const ROOT_FLAT = /^([A-G])b/;

/** formatChord, with note flats spelled "♭" for display only ("Bb" -> "B♭"). */
export function displayChord(chord: string): { text: string; label: string } {
  const { text, label } = formatChord(chord);
  return { text: text.replace(ROOT_FLAT, '$1♭'), label: label.replace(ROOT_FLAT, '$1♭') };
}

/**
 * Adjacent segments with the same chord become one ("G G G G" -> one G across
 * four bars). The analysis emits one segment per bar; a chart that repeats the
 * name every bar is noise at a glance, and at narrow zooms the repeats are what
 * overlapped into an unreadable run of letters.
 */
export function mergeChords(segments: readonly ChordSegment[]): ChordSegment[] {
  const out: ChordSegment[] = [];
  for (const segment of segments) {
    const last = out[out.length - 1];
    if (last && last.chord === segment.chord) {
      last.end_sample = segment.end_sample;
    } else {
      out.push({ ...segment });
    }
  }
  return out;
}

/**
 * Whether `text` fits a segment `width` px wide at `fontPx`, with the row's
 * 8 px left padding, its 1 px border and a margin. 0.75 em per glyph is a
 * deliberately generous average for the 600-weight UI sans -- measured in the
 * browser, "A#m" at 24 px is 52 px, 0.72 em a glyph, so 0.66 let it overflow.
 * A label that does not fit is hidden, never squeezed into its neighbour.
 */
export function chordLabelFits(text: string, width: number, fontPx: number): boolean {
  return text.length * fontPx * 0.75 + 12 <= width;
}

/** Index of the segment under `position`, or -1 before the first. Binary search. */
export function chordIndexAt(segments: readonly ChordSegment[], position: SampleIndex): number {
  if (segments.length === 0 || position < segments[0]!.start_sample) return -1;
  let lo = 0;
  let hi = segments.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (segments[mid]!.start_sample <= position) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
