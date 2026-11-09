import { describe, expect, it } from 'vitest';
import {
  anchorChip,
  epochToZoned,
  formatClock,
  formatOffset,
  offsetChip,
  zonedToEpoch,
} from './schedule-format';

describe('zoned schedule times', () => {
  it('converts wall-clock time in a timezone to UTC and back (incl. DST)', () => {
    expect(zonedToEpoch('2026-11-10', '09:00', 'Europe/Amsterdam')).toBe(
      Date.UTC(2026, 10, 10, 8, 0),
    );
    expect(zonedToEpoch('2026-07-10', '09:00', 'Europe/Amsterdam')).toBe(
      Date.UTC(2026, 6, 10, 7, 0),
    );
    expect(zonedToEpoch('2026-11-10', '09:00', 'UTC')).toBe(Date.UTC(2026, 10, 10, 9, 0));
    expect(epochToZoned(Date.UTC(2026, 10, 10, 8, 0), 'Europe/Amsterdam')).toEqual({
      date: '2026-11-10',
      time: '09:00',
    });
    expect(formatClock(Date.UTC(2026, 10, 10, 8, 0, 5), 'Europe/Amsterdam', true)).toBe('09:00:05');
    expect(zonedToEpoch('2026-11-10', '25:00', 'UTC')).toBeNull();
  });

  it('formats offsets and status chips (ahead is informational, not green)', () => {
    expect(formatOffset(7 * 60_000)).toBe('+07:00');
    expect(formatOffset(-4 * 60_000)).toBe('-04:00');
    expect(offsetChip('behind', 7 * 60_000)).toEqual({
      label: '+07:00 BEHIND',
      variant: 'warning',
    });
    expect(offsetChip('ahead', -4 * 60_000)).toEqual({ label: '-04:00 AHEAD', variant: 'info' });
    expect(offsetChip('on_time', 10_000)).toEqual({ label: 'ON TIME', variant: 'success' });
    expect(offsetChip('severe', 9 * 60_000).variant).toBe('critical');
    expect(anchorChip('risk', 8 * 60_000)).toEqual({
      label: '08:00 TO RECOVER',
      variant: 'warning',
    });
    expect(anchorChip('missed', 60_000).variant).toBe('critical');
  });
});
