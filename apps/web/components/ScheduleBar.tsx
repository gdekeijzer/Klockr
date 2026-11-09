import type { QueueSnapshot } from '@klockr/contracts';
import { anchorChip, formatClock, offsetChip } from '@klockr/ui';
import type { ScheduleState } from '../lib/use-schedule';
import { Chip } from './Chip';

/**
 * Compact schedule status: timing mode (with its source), the ONE dominant Show offset and the
 * next fixed anchor with the recovery required before it. Show offset and recovery-to-anchor are
 * shown as two separate values on purpose: they mean different things.
 */
export function ScheduleBar({
  queue,
  schedule,
  testPrefix = '',
}: {
  queue: QueueSnapshot;
  schedule: ScheduleState;
  testPrefix?: string;
}) {
  const { projection, status } = schedule;
  const tz = queue.showSchedule.timeZone;
  const anchor = projection.nextAnchor;
  const anchorItem = anchor ? queue.items.find((i) => i.id === anchor.itemId) : undefined;
  const mode = projection.timingMode;
  return (
    <div
      role="status"
      aria-label="Schedule status"
      data-testid={`${testPrefix}schedule-bar`}
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 'var(--k-spacing-3)',
        padding: 'var(--k-spacing-2) var(--k-spacing-6)',
        background: 'var(--k-background-chrome)',
        borderBottom: '1px solid var(--k-border-subtle)',
        fontSize: 13,
      }}
    >
      <span
        className="label"
        data-testid={`${testPrefix}timing-mode`}
        data-mode={mode.mode}
        title={mode.source === 'queue' ? 'Queue override' : 'Show default'}
      >
        {mode.mode === 'strict' ? 'Strict' : 'Sliding'}
        <span style={{ color: 'var(--k-text-muted)' }}>
          {' '}
          · {mode.source === 'queue' ? 'Queue override' : 'Show default'}
        </span>
      </span>
      {status !== null && projection.showOffsetMs !== null ? (
        <span
          data-testid={`${testPrefix}show-offset`}
          data-status={status}
          data-offset={projection.showOffsetMs}
        >
          <Chip spec={offsetChip(status, projection.showOffsetMs)} />
        </span>
      ) : (
        <span className="label" data-testid={`${testPrefix}show-offset`} data-status="unplanned">
          No schedule
        </span>
      )}
      {anchor && anchorItem && (
        <span
          data-testid={`${testPrefix}next-anchor`}
          data-status={anchor.status}
          data-recovery={anchor.recoveryMs}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--k-spacing-2)' }}
        >
          <span className="label">
            Next fixed:{' '}
            <strong style={{ color: 'var(--k-text-primary)' }}>{anchorItem.title}</strong>{' '}
            <span className="mono">{formatClock(anchor.plannedStart, tz)}</span>
          </span>
          {anchor.status !== 'on_track' && (
            <Chip spec={anchorChip(anchor.status, anchor.recoveryMs)} />
          )}
        </span>
      )}
    </div>
  );
}
