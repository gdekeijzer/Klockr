import { QueueItemId } from '../ids';
import { isEligible } from '../queue/order';
import { setCurrent } from '../queue/operations';
import { ok } from '../result';
import {
  findQueue,
  itemById,
  queueView,
  showNotFound,
  withQueueView,
  type ShowAggregate,
  type ShowResult,
} from '../show/aggregate';
import type { EpochMs } from '../time';

/**
 * Suggested follow (M4 default; there is no automatic cross-Queue follow). When a Queue's
 * Current moves onto an item that is the source of a relation, the related target item is
 * SUGGESTED to the target Queue ("PROGRAM ADVANCED — Suggested: Keynote mic [GO] [IGNORE]").
 * Nothing in the target Queue changes until its operator accepts.
 *
 * Durable runtime state (survives reconnect/reload). Status: pending -> accepted | ignored |
 * stale. A suggestion is stale when the target Queue's Current changed by other means since it
 * was created, or the target item is no longer eligible; a stale suggestion is never executed.
 */
export type SuggestionStatus = 'pending' | 'accepted' | 'ignored' | 'stale';

export interface Suggestion {
  readonly id: string;
  readonly relationId: string;
  readonly sourceQueueId: string;
  readonly sourceItemId: string;
  readonly targetQueueId: string;
  readonly targetItemId: string;
  /** The target Queue's Current when the suggestion was made (staleness reference). */
  readonly targetCurrentAtCreation: string | null;
  readonly createdAt: EpochMs;
  readonly status: SuggestionStatus;
  readonly resolvedAt: EpochMs | null;
}

export function pendingSuggestions(show: ShowAggregate): Suggestion[] {
  return show.suggestions.filter((s) => s.status === 'pending');
}

/** Is a pending suggestion still valid against the current state? */
export function isSuggestionValid(show: ShowAggregate, s: Suggestion): boolean {
  const target = findQueue(show, s.targetQueueId);
  const item = itemById(show, s.targetItemId);
  if (!target || !item || !target.items.some((i) => i.id === item.id)) return false;
  if (!show.relations.some((r) => r.id === s.relationId && r.active)) return false;
  if (target.queue.currentItemId !== s.targetCurrentAtCreation) return false;
  return isEligible(item) && target.queue.currentItemId !== item.id;
}

/**
 * After any change: mark pending suggestions stale that no longer hold, then create
 * suggestions for every Queue whose Current moved onto a relation source. A newer suggestion
 * for the same target Queue supersedes (stales) an older pending one.
 */
export function reconcileSuggestions(
  prev: ShowAggregate,
  next: ShowAggregate,
  ctx: { readonly now: EpochMs; readonly newId: () => string },
): ShowAggregate {
  let suggestions = next.suggestions.map((s) =>
    s.status === 'pending' && !isSuggestionValid(next, s)
      ? { ...s, status: 'stale' as const, resolvedAt: ctx.now }
      : s,
  );

  for (const q of next.queues) {
    const before = findQueue(prev, q.queue.id)?.queue.currentItemId ?? null;
    const after = q.queue.currentItemId;
    if (after === null || after === before) continue;
    for (const relation of next.relations) {
      if (!relation.active || relation.sourceItemId !== after) continue;
      const targetQueue = next.queues.find((t) =>
        t.items.some((i) => i.id === relation.targetItemId),
      );
      const targetItem = itemById(next, relation.targetItemId);
      if (!targetQueue || !targetItem || targetQueue.queue.id === q.queue.id) continue;
      if (!isEligible(targetItem) || targetQueue.queue.currentItemId === targetItem.id) continue;
      suggestions = suggestions.map((s) =>
        s.status === 'pending' && s.targetQueueId === targetQueue.queue.id
          ? { ...s, status: 'stale' as const, resolvedAt: ctx.now }
          : s,
      );
      suggestions.push({
        id: ctx.newId(),
        relationId: relation.id,
        sourceQueueId: q.queue.id,
        sourceItemId: after,
        targetQueueId: targetQueue.queue.id,
        targetItemId: targetItem.id,
        targetCurrentAtCreation: targetQueue.queue.currentItemId,
        createdAt: ctx.now,
        status: 'pending',
        resolvedAt: null,
      });
    }
  }

  const changed =
    suggestions.length !== next.suggestions.length ||
    suggestions.some((s, i) => s !== next.suggestions[i]);
  return changed ? { ...next, suggestions } : next;
}

/**
 * GO: make the suggested item Current in its own Queue (no timer is started here; existing
 * explicit start rules apply). A stale suggestion is marked stale and NOT executed.
 */
export function acceptSuggestion(
  show: ShowAggregate,
  suggestionId: string,
  ctx: { readonly now: EpochMs; readonly newId: () => string },
): ShowResult<{ show: ShowAggregate; accepted: boolean }> {
  const s = show.suggestions.find((x) => x.id === suggestionId);
  if (s?.status !== 'pending') return showNotFound('no pending suggestion');
  const resolve = (status: 'accepted' | 'stale', base: ShowAggregate): ShowAggregate => ({
    ...base,
    revision: base.revision === show.revision ? show.revision + 1 : base.revision,
    suggestions: base.suggestions.map((x) =>
      x.id === s.id ? { ...x, status, resolvedAt: ctx.now } : x,
    ),
  });
  if (!isSuggestionValid(show, s)) return ok({ show: resolve('stale', show), accepted: false });
  const view = queueView(show, s.targetQueueId);
  if (!view) return ok({ show: resolve('stale', show), accepted: false });
  const moved = setCurrent(view, { id: QueueItemId(s.targetItemId) }, ctx);
  if (!moved.ok) return ok({ show: resolve('stale', show), accepted: false });
  return ok({ show: resolve('accepted', withQueueView(show, moved.value)), accepted: true });
}

/** IGNORE: the target Queue's Current stays; the suggestion is closed. */
export function ignoreSuggestion(
  show: ShowAggregate,
  suggestionId: string,
  ctx: { readonly now: EpochMs },
): ShowResult {
  const s = show.suggestions.find((x) => x.id === suggestionId);
  if (s?.status !== 'pending') return showNotFound('no pending suggestion');
  return ok({
    ...show,
    revision: show.revision + 1,
    suggestions: show.suggestions.map((x) =>
      x.id === s.id ? { ...x, status: 'ignored' as const, resolvedAt: ctx.now } : x,
    ),
  });
}
