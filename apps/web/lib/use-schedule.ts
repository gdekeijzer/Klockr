'use client';

import type { ShowStateSnapshot, TimerSnapshot } from '@klockr/contracts';
import {
  classifyOffset,
  type OffsetStatus,
  type ScheduleProjection,
  type ShowScheduleProjection,
} from '@klockr/domain';
import { useState } from 'react';
import { projectShowSchedule } from './schedule-view';

export interface ScheduleState {
  readonly projection: ScheduleProjection;
  /** Show offset status of this Queue with hysteresis (no flicker around the tolerance edges). */
  readonly status: OffsetStatus | null;
  /** Items whose projected start moved by more than the tolerance at a recent commit. */
  readonly updated: ReadonlyMap<string, { readonly deltaMs: number; readonly at: number }>;
}

export interface ShowSchedule {
  readonly show: ShowScheduleProjection;
  readonly forQueue: (queueId: string) => ScheduleState | null;
}

const UPDATED_VISIBLE_MS = 8_000;

/**
 * Projected schedule of the whole Show for rendering: recomputed at render time from the
 * authoritative snapshot (like a timer display), plus calm presentation state per Queue — a
 * hysteresis-stable status and a short "UPDATED ±mm:ss" marker on items whose projection moved
 * at the last commit. Rows are never reordered by the schedule.
 */
export function useShowSchedule(
  state: ShowStateSnapshot | null,
  timers: Readonly<Record<string, TimerSnapshot>>,
  now: number,
): ShowSchedule | null {
  const [statuses, setStatuses] = useState<Readonly<Record<string, OffsetStatus | null>>>({});
  const [seenRevision, setSeenRevision] = useState<number | null>(null);
  const [lastStarts, setLastStarts] = useState<ReadonlyMap<string, number | null>>(new Map());
  const [updated, setUpdated] = useState<ScheduleState['updated']>(new Map());

  if (!state) return null;
  const show = projectShowSchedule(state, timers, now);

  const nextStatuses: Record<string, OffsetStatus | null> = {};
  let statusChanged = false;
  for (const [queueId, projection] of show.queues) {
    const before = statuses[queueId] ?? null;
    const status =
      projection.showOffsetMs === null
        ? null
        : classifyOffset(
            projection.showOffsetMs,
            projection.toleranceMs,
            projection.severeBehindMs,
            before,
          );
    nextStatuses[queueId] = status;
    if (status !== before) statusChanged = true;
  }
  if (statusChanged) setStatuses(nextStatuses);

  if (state.show.revision !== seenRevision) {
    const starts = new Map(
      [...show.queues.values()].flatMap((p) =>
        p.items.map((i) => [i.id, i.projectedStart] as const),
      ),
    );
    const changed = new Map([...updated].filter(([, v]) => now - v.at < UPDATED_VISIBLE_MS));
    if (seenRevision !== null) {
      const tolerance = state.queues[0]?.showSchedule.toleranceMs ?? 30_000;
      for (const [id, start] of starts) {
        const before = lastStarts.get(id);
        if (
          before !== undefined &&
          before !== null &&
          start !== null &&
          Math.abs(start - before) > tolerance
        ) {
          changed.set(id, { deltaMs: start - before, at: now });
        }
      }
    }
    setSeenRevision(state.show.revision);
    setLastStarts(starts);
    setUpdated(changed);
  }

  const visible = new Map([...updated].filter(([, v]) => now - v.at < UPDATED_VISIBLE_MS));
  return {
    show,
    forQueue: (queueId) => {
      const projection = show.queues.get(queueId);
      return projection
        ? { projection, status: nextStatuses[queueId] ?? null, updated: visible }
        : null;
    },
  };
}
