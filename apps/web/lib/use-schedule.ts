'use client';

import type { QueueSnapshot, TimerSnapshot } from '@klockr/contracts';
import { classifyOffset, type OffsetStatus, type ScheduleProjection } from '@klockr/domain';
import { useState } from 'react';
import { projectSchedule } from './schedule-view';

export interface ScheduleState {
  readonly projection: ScheduleProjection;
  /** Show offset status with hysteresis (no flicker around the tolerance edges). */
  readonly status: OffsetStatus | null;
  /** Items whose projected start moved by more than the tolerance at a recent Queue change. */
  readonly updated: ReadonlyMap<string, { readonly deltaMs: number; readonly at: number }>;
}

const UPDATED_VISIBLE_MS = 8_000;

/**
 * Projected schedule for rendering: recomputed from the authoritative snapshot at render time
 * (like a timer display), plus calm presentation state — a hysteresis-stable status and a short
 * "UPDATED ±mm:ss" marker on rows whose projection moved at the last Queue change. Rows are never
 * reordered by the schedule; only structure changes order.
 */
export function useSchedule(
  queue: QueueSnapshot | null,
  timers: Readonly<Record<string, TimerSnapshot>>,
  now: number,
): ScheduleState | null {
  const [status, setStatus] = useState<OffsetStatus | null>(null);
  const [seenRevision, setSeenRevision] = useState<number | null>(null);
  const [lastStarts, setLastStarts] = useState<ReadonlyMap<string, number | null>>(new Map());
  const [updated, setUpdated] = useState<ScheduleState['updated']>(new Map());

  if (!queue) return null;
  const projection = projectSchedule(queue, timers, now);

  // Derived-state updates during render (React's "storing information from previous renders").
  const nextStatus =
    projection.showOffsetMs === null
      ? null
      : classifyOffset(
          projection.showOffsetMs,
          projection.toleranceMs,
          projection.severeBehindMs,
          status,
        );
  if (nextStatus !== status) setStatus(nextStatus);

  if (queue.revision !== seenRevision) {
    const starts = new Map(projection.items.map((i) => [i.id, i.projectedStart]));
    const changed = new Map([...updated].filter(([, v]) => now - v.at < UPDATED_VISIBLE_MS));
    if (seenRevision !== null) {
      for (const [id, start] of starts) {
        const before = lastStarts.get(id);
        if (before !== undefined && before !== null && start !== null) {
          const deltaMs = start - before;
          if (Math.abs(deltaMs) > projection.toleranceMs) changed.set(id, { deltaMs, at: now });
        }
      }
    }
    setSeenRevision(queue.revision);
    setLastStarts(starts);
    setUpdated(changed);
  }

  const visible = new Map([...updated].filter(([, v]) => now - v.at < UPDATED_VISIBLE_MS));
  return { projection, status: nextStatus, updated: visible };
}
