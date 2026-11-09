import { queueView, type ShowAggregate } from '../show/aggregate';
import type { EpochMs } from '../time';
import { calculateSchedule, type ScheduleProjection } from './engine';

export interface RelationProjection {
  readonly relationId: string;
  /** Source projected start + offset, when the source has a projected start. */
  readonly desiredStart: EpochMs | null;
  /** The target could not honour the relation (sequence, Strict plan, anchor, or cycle). */
  readonly conflict: boolean;
}

export interface ShowScheduleProjection {
  readonly queues: ReadonlyMap<string, ScheduleProjection>;
  readonly relations: readonly RelationProjection[];
  /** False only if relation timing did not settle (a cycle formed after reordering). */
  readonly converged: boolean;
}

/**
 * Multi-Queue projection: every Queue is projected with the M3 engine; active relations with
 * `preserveOffset` add a desired start for their target (`source projected start + offset`).
 * Iterated to a fixpoint (relations form a DAG; at most one timing relation per target), so the
 * result is deterministic. Pure; `now` is passed in.
 */
export function calculateShowSchedule(show: ShowAggregate, now: EpochMs): ShowScheduleProjection {
  const timing = show.relations.filter((r) => r.active && r.preserveOffset);
  let links = new Map<string, EpochMs>();
  let queues = new Map<string, ScheduleProjection>();
  let converged = false;
  const maxIterations = timing.length + 2;

  for (let i = 0; i < maxIterations; i++) {
    queues = new Map();
    for (const q of show.queues) {
      const view = queueView(show, q.queue.id);
      if (view) queues.set(q.queue.id, calculateSchedule(view, now, links));
    }
    const next = new Map<string, EpochMs>();
    for (const r of timing) {
      const source = findItemSchedule(queues, r.sourceItemId);
      if (source?.projectedStart !== null && source?.projectedStart !== undefined) {
        next.set(r.targetItemId, source.projectedStart + r.offsetMs);
      }
    }
    if (sameLinks(links, next)) {
      converged = true;
      break;
    }
    links = next;
  }

  const relations = show.relations.map((r) => {
    if (!r.active || !r.preserveOffset)
      return { relationId: r.id, desiredStart: null, conflict: false };
    const target = findItemSchedule(queues, r.targetItemId);
    return {
      relationId: r.id,
      desiredStart: links.get(r.targetItemId) ?? null,
      conflict: !converged || (target?.link?.conflict ?? false),
    };
  });
  return { queues, relations, converged };
}

function findItemSchedule(queues: ReadonlyMap<string, ScheduleProjection>, itemId: string) {
  for (const projection of queues.values()) {
    const found = projection.items.find((i) => i.id === itemId);
    if (found) return found;
  }
  return undefined;
}

function sameLinks(a: ReadonlyMap<string, EpochMs>, b: ReadonlyMap<string, EpochMs>): boolean {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) if (b.get(k) !== v) return false;
  return true;
}
