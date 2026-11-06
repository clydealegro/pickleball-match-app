import { describe, expect, it } from 'vitest';
import { formatElapsed } from './time';

describe('formatElapsed', () => {
  it('formats minutes and seconds', () => {
    expect(formatElapsed(0)).toBe('0:00');
    expect(formatElapsed(9_000)).toBe('0:09');
    expect(formatElapsed(65_000)).toBe('1:05');
    expect(formatElapsed(14 * 60_000 + 59_999)).toBe('14:59');
  });

  it('adds hours past 60 minutes', () => {
    expect(formatElapsed(3_600_000)).toBe('1:00:00');
    expect(formatElapsed(3_725_000)).toBe('1:02:05');
  });

  it('never shows negative time', () => {
    expect(formatElapsed(-5_000)).toBe('0:00');
  });
});
