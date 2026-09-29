import { describe, expect, it } from 'vitest';

import { formatTimestamp, parseTimestamp } from './time';

describe('formatTimestamp', () => {
  it('formats to the millisecond', () => {
    expect(formatTimestamp(0)).toBe('0:00.000');
    // 12:04.357 = 724.357 s = 34_769_136 samples
    expect(formatTimestamp(34_769_136)).toBe('12:04.357');
  });
  it('switches to hours from one hour up', () => {
    expect(formatTimestamp(48000 * 3725)).toBe('1:02:05.000');
  });
  it('rounds to the nearest millisecond rather than truncating', () => {
    expect(formatTimestamp(47)).toBe('0:00.001'); // 0.979 ms
    expect(formatTimestamp(23)).toBe('0:00.000'); // 0.479 ms
  });
});

describe('parseTimestamp', () => {
  it('round-trips every millisecond value', () => {
    for (const sample of [0, 48, 34_769_136, 48000 * 4865 + 48 * 959]) {
      expect(parseTimestamp(formatTimestamp(sample))).toBe(sample);
    }
  });
  it('accepts m:ss, bare seconds and h:mm:ss.mmm', () => {
    expect(parseTimestamp('1:05')).toBe(65 * 48000);
    expect(parseTimestamp('83.5')).toBe(83.5 * 48000);
    expect(parseTimestamp('1:02:05.250')).toBe((3725 + 0.25) * 48000);
  });
  it('reads a short fraction as milliseconds, not as a raw count', () => {
    expect(parseTimestamp('0:01.5')).toBe(1.5 * 48000);
    expect(parseTimestamp('0:01.05')).toBe(1.05 * 48000);
  });
  it('rejects text that is not a time, and out-of-range fields', () => {
    for (const text of ['', 'abc', '1:75', '1:99:00', '-1:00', '1:00.1234', '1::2']) {
      expect(parseTimestamp(text)).toBeNull();
    }
  });
  it('tolerates surrounding whitespace and a decimal comma', () => {
    expect(parseTimestamp(' 0:02,500 ')).toBe(2.5 * 48000);
  });
});
