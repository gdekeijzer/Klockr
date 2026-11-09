import { describe, expect, it } from 'vitest';
import { parseDurationInput } from './duration-input';

describe('parseDurationInput', () => {
  it.each([
    ['5', 300_000],
    ['05:30', 330_000],
    ['1:00:00', 3_600_000],
    ['0:45', 45_000],
  ])('%s -> %i ms', (input, ms) => {
    expect(parseDurationInput(input)).toBe(ms);
  });

  it.each(['', 'abc', '0', '00:00', '5:75', '1:75:00', '1:2:3:4'])('rejects %s', (input) => {
    expect(parseDurationInput(input)).toBeNull();
  });
});
