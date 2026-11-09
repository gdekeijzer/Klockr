'use client';

import type {
  AuditEventDto,
  LockTargetDto,
  QueueItemSnapshot,
  QueueSnapshot,
} from '@klockr/contracts';
import { effectiveLock, type ItemSchedule, type QueueAggregate } from '@klockr/domain';
import { epochToZoned, formatClock, formatDuration, formatOffset, zonedToEpoch } from '@klockr/ui';
import { useEffect, useState } from 'react';
import { LockIcon } from '../../../../components/LockIcon';
import { fetchAudit, type QueueCommandBody } from '../../../../lib/api';
import { parseDurationInput } from '../../../../lib/duration-input';
import styles from '../show.module.css';
import editor from './editor.module.css';

type Run = (body: QueueCommandBody) => void;

/** Show date used for HH:MM entry: the configured Show date, else today in the Show timezone. */
export function showDate(queue: QueueSnapshot, now: number): string {
  return queue.showSchedule.scheduleDate ?? epochToZoned(now, queue.showSchedule.timeZone).date;
}

// ---------------------------------------------------------------------------------------------
// Item planning (Planned / Projected / Actual)
// ---------------------------------------------------------------------------------------------

export function ScheduleSection(props: {
  item: QueueItemSnapshot;
  queue: QueueSnapshot;
  schedule: ItemSchedule | undefined;
  now: number;
  disabled: boolean;
  onCommand: Run;
}) {
  const { item, queue, schedule, disabled, onCommand } = props;
  const tz = queue.showSchedule.timeZone;
  const [time, setTime] = useState(
    item.plannedStartAt === null ? '' : epochToZoned(item.plannedStartAt, tz).time,
  );
  const [anchor, setAnchor] = useState(item.fixedAnchor);
  const [plannedDuration, setPlannedDuration] = useState(
    item.plannedDurationMs === null ? '' : formatDuration(item.plannedDurationMs),
  );
  const date = showDate(queue, props.now);
  const plannedStartAt = time.trim() === '' ? null : zonedToEpoch(date, time, tz);
  const timeValid = time.trim() === '' || plannedStartAt !== null;
  const durationMs =
    item.timer !== null || plannedDuration.trim() === ''
      ? null
      : plannedDuration.trim() === '0' || plannedDuration.trim() === '00:00'
        ? 0
        : parseDurationInput(plannedDuration);
  const durationValid = item.timer !== null || plannedDuration.trim() === '' || durationMs !== null;
  const anchorValid = !anchor || plannedStartAt !== null;
  const dirty =
    plannedStartAt !== item.plannedStartAt ||
    anchor !== item.fixedAnchor ||
    (item.timer === null && durationMs !== item.plannedDurationMs);

  const row = (label: string, start: number | null, end: number | null, testId: string) => (
    <tr data-testid={testId} data-start={start ?? ''} data-end={end ?? ''}>
      <th scope="row" className="label">
        {label}
      </th>
      <td className="mono">{formatClock(start, tz)}</td>
      <td className="mono">{formatClock(end, tz)}</td>
    </tr>
  );

  return (
    <div className={editor.section} data-testid="schedule-section">
      <span className="label">Schedule</span>
      <table className={editor.ppa}>
        <thead>
          <tr>
            <th />
            <th className="label">Start</th>
            <th className="label">End</th>
          </tr>
        </thead>
        <tbody>
          {row(
            'Planned',
            schedule?.plannedStart ?? null,
            schedule?.plannedEnd ?? null,
            'ppa-planned',
          )}
          {row(
            'Projected',
            schedule?.projectedStart ?? null,
            schedule?.projectedEnd ?? null,
            'ppa-projected',
          )}
          {row('Actual', item.actualStartAt, item.actualEndAt, 'ppa-actual')}
        </tbody>
      </table>
      {schedule?.startShiftMs !== null && schedule?.startShiftMs !== undefined && (
        <p className={styles.muted}>
          Projected start {formatOffset(schedule.startShiftMs)} vs planned
          {schedule.explicitStart ? '' : ' (chained after the previous item)'}.
        </p>
      )}
      <form
        className={editor.form}
        onSubmit={(e) => {
          e.preventDefault();
          if (!dirty || !timeValid || !durationValid || !anchorValid) return;
          onCommand({
            type: 'item.setSchedule',
            payload: {
              queueItemId: item.id,
              plannedStartAt,
              fixedAnchor: anchor,
              ...(item.timer === null ? { plannedDurationMs: durationMs } : {}),
            },
          });
        }}
      >
        <label className={editor.field}>
          <span className="label">
            Planned start ({tz}, {date}) — empty = after previous item
          </span>
          <input
            type="time"
            className={`${styles.input} mono`}
            value={time}
            aria-invalid={!timeValid}
            aria-label="Planned start"
            onChange={(e) => {
              setTime(e.target.value);
            }}
          />
        </label>
        {item.timer === null && (
          <label className={editor.field}>
            <span className="label">Planned duration (no timer)</span>
            <input
              className={`${styles.input} mono`}
              value={plannedDuration}
              placeholder="mm:ss"
              aria-invalid={!durationValid}
              onChange={(e) => {
                setPlannedDuration(e.target.value);
              }}
            />
          </label>
        )}
        <label className={editor.checkbox}>
          <input
            type="checkbox"
            checked={anchor}
            onChange={(e) => {
              setAnchor(e.target.checked);
            }}
          />
          Fixed anchor (holds its planned time; never started automatically)
        </label>
        {!anchorValid && <p className={styles.muted}>A fixed anchor needs a planned start time.</p>}
        <button
          type="submit"
          className={styles.button}
          disabled={disabled || !dirty || !timeValid || !durationValid || !anchorValid}
        >
          Save schedule
        </button>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Show / Queue schedule settings
// ---------------------------------------------------------------------------------------------

export function ShowSchedulePanel(props: {
  queue: QueueSnapshot;
  disabled: boolean;
  onCommand: Run;
}) {
  const { queue, disabled, onCommand } = props;
  const s = queue.showSchedule;
  const [timeZone, setTimeZone] = useState(s.timeZone);
  const [date, setDate] = useState(s.scheduleDate ?? '');
  const [tolerance, setTolerance] = useState(String(s.toleranceMs / 1000));
  const [severe, setSevere] = useState(formatDuration(s.severeBehindMs));
  const toleranceMs = Number(tolerance) * 1000;
  const severeMs = parseDurationInput(severe);
  const valid =
    Number.isInteger(toleranceMs) &&
    toleranceMs >= 0 &&
    severeMs !== null &&
    severeMs >= toleranceMs;

  return (
    <section
      className={styles.panel}
      aria-label="Schedule settings"
      data-testid="schedule-settings"
    >
      <span className="label">Timing</span>
      <label className={editor.field}>
        <span className="label">Show default timing mode</span>
        <select
          className={styles.input}
          value={s.timingMode}
          disabled={disabled}
          aria-label="Show timing mode"
          onChange={(e) => {
            onCommand({
              type: 'show.setSchedule',
              payload: { timingMode: e.target.value as 'strict' | 'sliding' },
            });
          }}
        >
          <option value="strict">Strict / Operator controlled</option>
          <option value="sliding">Sliding / Free</option>
        </select>
      </label>
      <label className={editor.field}>
        <span className="label">
          Program queue timing —{' '}
          <span className={styles.source} data-override={queue.timingMode !== null}>
            {queue.timingMode === null ? 'Show default' : 'Queue override'}
          </span>
        </span>
        <select
          className={styles.input}
          value={queue.timingMode ?? ''}
          disabled={disabled}
          aria-label="Queue timing mode"
          onChange={(e) => {
            const mode = e.target.value === '' ? null : (e.target.value as 'strict' | 'sliding');
            onCommand({ type: 'queue.setTimingMode', payload: { mode } });
          }}
        >
          <option value="">Inherit Show default ({s.timingMode})</option>
          <option value="strict">Strict (override)</option>
          <option value="sliding">Sliding (override)</option>
        </select>
      </label>
      <form
        className={editor.form}
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid) return;
          onCommand({
            type: 'show.setSchedule',
            payload: {
              timeZone: timeZone.trim(),
              scheduleDate: date === '' ? null : date,
              toleranceMs,
              severeBehindMs: severeMs,
            },
          });
        }}
      >
        <label className={editor.field}>
          <span className="label">Time zone (IANA)</span>
          <input
            className={styles.input}
            value={timeZone}
            onChange={(e) => {
              setTimeZone(e.target.value);
            }}
          />
        </label>
        <label className={editor.field}>
          <span className="label">Show date</span>
          <input
            type="date"
            className={styles.input}
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
            }}
          />
        </label>
        <label className={editor.field}>
          <span className="label">On-time tolerance (± seconds)</span>
          <input
            className={`${styles.input} mono`}
            inputMode="numeric"
            value={tolerance}
            onChange={(e) => {
              setTolerance(e.target.value);
            }}
          />
        </label>
        <label className={editor.field}>
          <span className="label">Severe BEHIND from (mm:ss)</span>
          <input
            className={`${styles.input} mono`}
            value={severe}
            onChange={(e) => {
              setSevere(e.target.value);
            }}
          />
        </label>
        <button type="submit" className={styles.button} disabled={disabled || !valid}>
          Save schedule settings
        </button>
      </form>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Locks
// ---------------------------------------------------------------------------------------------

const KIND_LABEL: Readonly<Record<LockTargetDto['kind'], string>> = {
  show: 'Show',
  queue: 'Queue',
  group: 'Group',
  item: 'item',
};

/** Effective lock state of a target with Lock / Unlock / Request Unlock actions. */
export function LockSection(props: {
  target: LockTargetDto;
  aggregate: QueueAggregate;
  queue: QueueSnapshot;
  disabled: boolean;
  onCommand: Run;
}) {
  const { target, aggregate, queue, disabled, onCommand } = props;
  const effective = effectiveLock(aggregate, target);
  const own = effective !== null && effective.inheritedFrom === null;
  const requests = queue.unlockRequests.filter((r) => r.lockId === effective?.lock.id);
  return (
    <div className={editor.section} data-testid="lock-section" data-locked={effective !== null}>
      <span className="label">Lock</span>
      {effective ? (
        <p className={editor.lockState} data-testid="lock-state">
          <LockIcon /> LOCKED
          {effective.inheritedFrom && (
            <span className={styles.muted}>
              {' '}
              · inherited from {KIND_LABEL[effective.inheritedFrom.kind]}
            </span>
          )}
        </p>
      ) : (
        <p className={styles.muted} data-testid="lock-state">
          <LockIcon open /> Unlocked
        </p>
      )}
      <p className={styles.muted}>
        A lock blocks structure, planning and timing edits. Live transport (start, pause, stop, END
        / NEXT) is never blocked.
      </p>
      <div className={styles.buttons}>
        {!effective && (
          <button
            type="button"
            className={styles.button}
            disabled={disabled}
            onClick={() => {
              onCommand({ type: 'lock.set', payload: { target } });
            }}
          >
            Lock {KIND_LABEL[target.kind]}
          </button>
        )}
        {own && (
          <button
            type="button"
            className={styles.button}
            disabled={disabled}
            onClick={() => {
              onCommand({ type: 'lock.release', payload: { target } });
            }}
          >
            Unlock
          </button>
        )}
        {effective && (
          <button
            type="button"
            className={styles.button}
            disabled={disabled}
            onClick={() => {
              onCommand({ type: 'lock.requestUnlock', payload: { target, reason: null } });
            }}
          >
            Request Unlock
          </button>
        )}
      </div>
      {requests.length > 0 && (
        <p className={styles.muted} data-testid="unlock-requests">
          {requests.length} open unlock {requests.length === 1 ? 'request' : 'requests'}
          {requests[0]?.reason ? ` — “${requests[0].reason}”` : ''}
        </p>
      )}
      {effective && queue.locks.length > 0 && (
        <span className={styles.muted}>
          Locked {formatClock(effective.lock.lockedAt, queue.showSchedule.timeZone)}
        </span>
      )}
    </div>
  );
}

/**
 * Shown when an edit was refused because of a lock: LOCKED, with Request Unlock and an explicit,
 * confirmed and audited Emergency Override (needs `lock.override`). Never a silent bypass.
 */
export function LockedNotice(props: {
  message: string;
  target: LockTargetDto | null;
  disabled: boolean;
  onRequestUnlock: (target: LockTargetDto) => void;
  onOverride: (reason: string) => void;
  onDismiss: () => void;
}) {
  const [reason, setReason] = useState('');
  const [confirming, setConfirming] = useState(false);
  return (
    <div role="alert" className={editor.lockedNotice} data-testid="locked-notice">
      <strong>
        <LockIcon /> LOCKED
      </strong>
      <span>{props.message}. The change was not applied.</span>
      <div className={styles.buttons}>
        {props.target && (
          <button
            type="button"
            className={styles.button}
            disabled={props.disabled}
            onClick={() => {
              if (props.target) props.onRequestUnlock(props.target);
            }}
          >
            Request Unlock
          </button>
        )}
        {!confirming ? (
          <button
            type="button"
            className={`${styles.button} ${editor.destructiveOutline}`}
            disabled={props.disabled}
            onClick={() => {
              setConfirming(true);
            }}
          >
            Emergency Override…
          </button>
        ) : (
          <form
            className={editor.overrideForm}
            onSubmit={(e) => {
              e.preventDefault();
              if (reason.trim()) props.onOverride(reason.trim());
            }}
          >
            <label className={editor.field}>
              <span className="label">Reason (audited)</span>
              <input
                className={styles.input}
                value={reason}
                maxLength={500}
                aria-label="Override reason"
                onChange={(e) => {
                  setReason(e.target.value);
                }}
              />
            </label>
            <button
              type="submit"
              className={`${styles.button} ${editor.destructive}`}
              disabled={props.disabled || !reason.trim()}
            >
              Confirm Emergency Override
            </button>
          </form>
        )}
        <button type="button" className={styles.button} onClick={props.onDismiss}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Audit trail
// ---------------------------------------------------------------------------------------------

const ACTION_LABEL: Readonly<Record<string, string>> = {
  'lock.set': 'Locked',
  'lock.release': 'Unlocked',
  'lock.request_unlock': 'Unlock requested',
  'lock.override': 'EMERGENCY OVERRIDE',
  'schedule.update': 'Planning changed',
  'anchor.update': 'Fixed anchor changed',
  'timing_mode.update': 'Timing mode changed',
  'schedule.settings': 'Schedule settings changed',
};

export function AuditPanel(props: { showId: string; revision: number; timeZone: string }) {
  const [events, setEvents] = useState<readonly AuditEventDto[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchAudit(props.showId).then(
      (r) => {
        if (!cancelled) setEvents(r.events);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [props.showId, props.revision]);

  return (
    <section className={styles.panel} aria-label="Audit trail" data-testid="audit-panel">
      <span className="label">Audit trail</span>
      {events === null ? (
        <p className={styles.muted}>Loading…</p>
      ) : events.length === 0 ? (
        <p className={styles.muted}>No audited changes yet.</p>
      ) : (
        <ol className={editor.audit}>
          {events.slice(0, 20).map((e) => (
            <li key={e.id} data-testid="audit-event" data-action={e.action}>
              <span className="mono">{formatClock(e.at, props.timeZone, true)}</span>{' '}
              <strong data-override={e.action === 'lock.override'}>
                {ACTION_LABEL[e.action] ?? e.action}
              </strong>{' '}
              <span className={styles.muted}>
                {e.resource.kind}
                {typeof e.details.reason === 'string' ? ` — “${e.details.reason}”` : ''}
                {typeof e.details.command === 'string' ? ` · ${e.details.command}` : ''}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
