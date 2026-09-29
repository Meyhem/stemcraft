// Sample <-> "m:ss.mmm" for the cut list. Cuts are stored as integer samples at 48 kHz
// (invariant 4); milliseconds are only ever a display and typing convenience, converted
// at this boundary and nowhere else.

// D-03: the one sample rate.
export const SAMPLE_RATE = 48000;
const SAMPLES_PER_MS = SAMPLE_RATE / 1000; // 48

/** `m:ss.mmm`, or `h:mm:ss.mmm` from one hour up. Rounded to the nearest millisecond. */
export function formatTimestamp(sample: number): string {
  const totalMs = Math.max(0, Math.round(sample / SAMPLES_PER_MS));
  const ms = totalMs % 1000;
  const totalSeconds = Math.floor(totalMs / 1000);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  const tail = `${String(seconds).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${tail}`
    : `${minutes}:${tail}`;
}

const TIMESTAMP = /^(?:(\d+):)?(?:(\d+):)?(\d+)(?:[.,](\d{1,3}))?$/;

/**
 * Inverse of formatTimestamp. Accepts `h:mm:ss.mmm`, `m:ss.mmm`, `m:ss` and bare seconds
 * (`83.5`); the fraction is 1-3 digits and means milliseconds ("0.5" is 500 ms). Returns
 * an integer sample index, or null when the text is not a time -- never NaN, never a
 * guess.
 */
export function parseTimestamp(text: string): number | null {
  const match = TIMESTAMP.exec(text.trim());
  if (!match) return null;
  const [, first, second, last, fraction] = match;
  const fields = [first, second, last].filter((part) => part !== undefined).map(Number);
  // h:mm:ss, m:ss or bare seconds, by how many fields the text had.
  let hours = 0;
  let minutes = 0;
  const seconds = fields[fields.length - 1]!;
  if (fields.length === 3) {
    [hours, minutes] = [fields[0]!, fields[1]!];
    if (minutes >= 60 || seconds >= 60) return null;
  } else if (fields.length === 2) {
    minutes = fields[0]!;
    if (seconds >= 60) return null;
  }
  const ms = fraction === undefined ? 0 : Number(fraction.padEnd(3, '0'));
  const totalMs = ((hours * 60 + minutes) * 60 + seconds) * 1000 + ms;
  return Math.round(totalMs * SAMPLES_PER_MS);
}
