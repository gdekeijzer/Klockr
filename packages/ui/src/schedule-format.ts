import type { AnchorStatus, OffsetStatus } from '@klockr/domain';
import type { ChipSpec } from './timer-presentation';

/**
 * Human schedule times. Instants are UTC epoch ms; humans enter and read wall-clock times in the
 * Show's IANA timezone on the Show date (docs/QUEUES_SCHEDULING.md). Pure helpers on top of Intl.
 */
function parts(epoch: number, timeZone: string) {
  const formatted = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(epoch));
  const get = (type: string) => Number(formatted.find((p) => p.type === type)?.value ?? '0');
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  };
}

/** Offset of `timeZone` from UTC at `epoch`, in ms. */
function zoneOffsetMs(epoch: number, timeZone: string): number {
  const p = parts(epoch, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - (epoch - (epoch % 1000));
}

const pad = (n: number) => String(n).padStart(2, '0');

/** `YYYY-MM-DD` + `HH:MM[:SS]` in `timeZone` -> epoch ms (DST-safe). Null when invalid. */
export function zonedToEpoch(date: string, time: string, timeZone: string): number | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(time.trim());
  if (!d || !t) return null;
  const [y, mo, da] = [Number(d[1]), Number(d[2]), Number(d[3])];
  const [h, mi, s] = [Number(t[1]), Number(t[2]), Number(t[3] ?? '0')];
  if (h > 23 || mi > 59 || s > 59) return null;
  const guess = Date.UTC(y, mo - 1, da, h, mi, s);
  const first = zoneOffsetMs(guess, timeZone);
  const epoch = guess - first;
  const second = zoneOffsetMs(epoch, timeZone);
  return second === first ? epoch : guess - second;
}

/** epoch -> `{ date: YYYY-MM-DD, time: HH:MM }` in `timeZone`. */
export function epochToZoned(epoch: number, timeZone: string): { date: string; time: string } {
  const p = parts(epoch, timeZone);
  return {
    date: `${String(p.year)}-${pad(p.month)}-${pad(p.day)}`,
    time: `${pad(p.hour)}:${pad(p.minute)}`,
  };
}

/** Wall-clock time in the Show timezone: `HH:MM` (or `HH:MM:SS`). */
export function formatClock(epoch: number | null, timeZone: string, seconds = false): string {
  if (epoch === null) return '—';
  const p = parts(epoch, timeZone);
  return seconds
    ? `${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`
    : `${pad(p.hour)}:${pad(p.minute)}`;
}

/** Signed offset `+07:00` / `-04:00` (mm:ss, or h:mm:ss above an hour). Truncated to seconds. */
export function formatOffset(ms: number): string {
  const sign = ms < 0 ? '-' : '+';
  const total = Math.floor(Math.abs(ms) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${sign}${String(h)}:${pad(m)}:${pad(s)}` : `${sign}${pad(m)}:${pad(s)}`;
}

/** Unsigned `mm:ss` / `h:mm:ss`. */
export function formatSpan(ms: number): string {
  return formatOffset(Math.abs(ms)).slice(1);
}

/** Show offset chip: ON TIME green, AHEAD blue (informational), BEHIND amber, severe red. */
export function offsetChip(status: OffsetStatus, offsetMs: number): ChipSpec {
  switch (status) {
    case 'on_time':
      return { label: 'ON TIME', variant: 'success' };
    case 'ahead':
      return { label: `${formatOffset(offsetMs)} AHEAD`, variant: 'info' };
    case 'behind':
      return { label: `${formatOffset(offsetMs)} BEHIND`, variant: 'warning' };
    case 'severe':
      return { label: `${formatOffset(offsetMs)} BEHIND`, variant: 'critical' };
  }
}

/** Anchor state: on track neutral, risk amber, missed/conflict red. */
export function anchorChip(status: AnchorStatus, recoveryMs: number): ChipSpec {
  switch (status) {
    case 'on_track':
      return { label: 'ON TRACK', variant: 'neutral' };
    case 'risk':
      return { label: `${formatSpan(recoveryMs)} TO RECOVER`, variant: 'warning' };
    case 'missed':
      return { label: `ANCHOR MISSED · ${formatSpan(recoveryMs)}`, variant: 'critical' };
  }
}
