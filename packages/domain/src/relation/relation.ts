import { orderedItems } from '../queue/order';
import { ok } from '../result';
import type { ShowAggregate, ShowResult } from '../show/aggregate';
import {
  commitShow,
  itemById,
  queueOfItem,
  queueView,
  showBadInput,
  showInvalid,
  showNotFound,
} from '../show/aggregate';
import type { DurationMs, EpochMs } from '../time';

/**
 * Cross-Queue relation between two Queue Items of the SAME Show in DIFFERENT Queues
 * (FUNCTIONAL_DESIGN, "Queue Item relationship"). Synchronization metadata, never ownership:
 * both items stay members of their own Queue and are operated independently.
 *
 * - `preserveOffset`: the target's projected start follows `source projected start + offsetMs`
 *   (see `calculateShowSchedule`). Planned is never rewritten.
 * - Direction source -> target also drives suggested follow (a Current change of the source
 *   Queue onto the source item suggests the target item to the target Queue).
 * - Determinism: a target has at most ONE incoming active timing relation (preserveOffset).
 * - No cycles: a relation is refused when the target can already reach the source through
 *   relations plus each Queue's sequential order.
 */
export interface Relation {
  readonly id: string;
  readonly sourceItemId: string;
  readonly targetItemId: string;
  readonly offsetMs: DurationMs;
  readonly preserveOffset: boolean;
  readonly active: boolean;
  readonly createdAt: EpochMs;
  readonly updatedAt: EpochMs;
  readonly revision: number;
}

const MAX_OFFSET_MS = 24 * 3_600_000;

/** Dependency edges: active relations and "next in the same Queue". */
function dependencyEdges(
  show: ShowAggregate,
  relations: readonly Relation[],
): Map<string, string[]> {
  const edges = new Map<string, string[]>();
  const add = (from: string, to: string) => {
    const list = edges.get(from);
    if (list) list.push(to);
    else edges.set(from, [to]);
  };
  for (const q of show.queues) {
    const view = queueView(show, q.queue.id);
    if (!view) continue;
    const ordered = orderedItems(view);
    for (let i = 0; i + 1 < ordered.length; i++) {
      const a = ordered[i];
      const b = ordered[i + 1];
      if (a && b) add(a.id, b.id);
    }
  }
  for (const r of relations) if (r.active) add(r.sourceItemId, r.targetItemId);
  return edges;
}

/** True when `to` is reachable from `from`. */
function reaches(edges: Map<string, string[]>, from: string, to: string): boolean {
  const seen = new Set<string>([from]);
  const stack = [from];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === undefined) break;
    if (node === to) return true;
    for (const next of edges.get(node) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        stack.push(next);
      }
    }
  }
  return false;
}

function validate(
  show: ShowAggregate,
  relation: Relation,
  others: readonly Relation[],
): ShowResult<Relation> {
  const source = itemById(show, relation.sourceItemId);
  const target = itemById(show, relation.targetItemId);
  if (!source || !target) return showNotFound('item not found');
  if (queueOfItem(show, source.id)?.queue.id === queueOfItem(show, target.id)?.queue.id) {
    return showBadInput('a relation links items of two different Queues');
  }
  if (!Number.isInteger(relation.offsetMs) || Math.abs(relation.offsetMs) > MAX_OFFSET_MS) {
    return showBadInput('offset out of range');
  }
  if (
    others.some(
      (r) => r.sourceItemId === relation.sourceItemId && r.targetItemId === relation.targetItemId,
    )
  ) {
    return showInvalid('these items are already related');
  }
  if (
    relation.active &&
    relation.preserveOffset &&
    others.some((r) => r.active && r.preserveOffset && r.targetItemId === relation.targetItemId)
  ) {
    return showInvalid('the target already follows another item (one timing relation per target)');
  }
  if (relation.active) {
    const edges = dependencyEdges(show, others);
    if (reaches(edges, relation.targetItemId, relation.sourceItemId)) {
      return showInvalid('this relation would create a timing cycle');
    }
  }
  return ok(relation);
}

export function createRelation(
  show: ShowAggregate,
  input: {
    readonly sourceItemId: string;
    readonly targetItemId: string;
    readonly offsetMs: DurationMs;
    readonly preserveOffset: boolean;
  },
  ctx: { readonly now: EpochMs; readonly newId: () => string },
): ShowResult<{ show: ShowAggregate; relationId: string }> {
  const relation: Relation = {
    id: ctx.newId(),
    sourceItemId: input.sourceItemId,
    targetItemId: input.targetItemId,
    offsetMs: input.offsetMs,
    preserveOffset: input.preserveOffset,
    active: true,
    createdAt: ctx.now,
    updatedAt: ctx.now,
    revision: 0,
  };
  const valid = validate(show, relation, show.relations);
  if (!valid.ok) return valid;
  return ok({
    show: commitShow({ ...show, relations: [...show.relations, valid.value] }),
    relationId: relation.id,
  });
}

export function updateRelation(
  show: ShowAggregate,
  input: {
    readonly relationId: string;
    readonly offsetMs?: DurationMs | undefined;
    readonly preserveOffset?: boolean | undefined;
    readonly active?: boolean | undefined;
  },
  ctx: { readonly now: EpochMs },
): ShowResult {
  const existing = show.relations.find((r) => r.id === input.relationId);
  if (!existing) return showNotFound('relation not found');
  const next: Relation = {
    ...existing,
    offsetMs: input.offsetMs ?? existing.offsetMs,
    preserveOffset: input.preserveOffset ?? existing.preserveOffset,
    active: input.active ?? existing.active,
  };
  if (
    next.offsetMs === existing.offsetMs &&
    next.preserveOffset === existing.preserveOffset &&
    next.active === existing.active
  ) {
    return ok(show);
  }
  const valid = validate(
    show,
    next,
    show.relations.filter((r) => r.id !== existing.id),
  );
  if (!valid.ok) return valid;
  const updated = { ...valid.value, updatedAt: ctx.now, revision: existing.revision + 1 };
  return ok(
    commitShow({
      ...show,
      relations: show.relations.map((r) => (r.id === existing.id ? updated : r)),
    }),
  );
}

/** Break a relation. Pending suggestions created by it are withdrawn (stale). */
export function deleteRelation(show: ShowAggregate, relationId: string): ShowResult {
  if (!show.relations.some((r) => r.id === relationId)) return showNotFound('relation not found');
  return ok(
    commitShow({
      ...show,
      relations: show.relations.filter((r) => r.id !== relationId),
      suggestions: show.suggestions.map((s) =>
        s.relationId === relationId && s.status === 'pending'
          ? { ...s, status: 'stale' as const }
          : s,
      ),
    }),
  );
}
