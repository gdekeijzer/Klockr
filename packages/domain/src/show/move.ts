import type { GroupId, QueueItemId } from '../ids';
import { applyLayout, layoutOf } from '../queue/order';
import { ok } from '../result';
import type { EpochMs } from '../time';
import {
  commitShow,
  findQueue,
  normalizeShow,
  queueOfItem,
  queueView,
  showBadInput,
  showInvalid,
  showNotFound,
  withQueueView,
  type ShowAggregate,
  type ShowResult,
} from './aggregate';

/**
 * Move a NOT-live Queue Item to another Queue (atomic, one Show revision). Refused for the
 * Current item and for an item with a running/paused timer. Its own planning travels with it;
 * the projection is simply recalculated. Relations that would end up linking two items of the
 * same Queue are refused (break them first). Never changes Current, never starts or stops a
 * timer. Lock checks happen in the application layer (source item + target container).
 */
export function moveItemToQueue(
  show: ShowAggregate,
  input: {
    readonly itemId: string;
    readonly queueId: string;
    readonly groupId: GroupId | null;
    readonly index: number;
  },
  ctx: { readonly now: EpochMs },
): ShowResult {
  const source = queueOfItem(show, input.itemId);
  const target = findQueue(show, input.queueId);
  if (!source || !target) return showNotFound('item or queue not found');
  if (source.queue.id === target.queue.id)
    return showBadInput('use a reorder within the same Queue');
  const item = source.items.find((i) => i.id === input.itemId);
  if (!item) return showNotFound('item not found');
  if (source.queue.currentItemId === item.id)
    return showInvalid('the Current item cannot be moved to another Queue');
  if (item.timer?.status === 'running' || item.timer?.status === 'paused') {
    return showInvalid('an item with a running timer cannot be moved');
  }
  if (input.groupId !== null && !target.groups.some((g) => g.id === input.groupId)) {
    return showNotFound('group not found');
  }
  const targetItems = new Set(target.items.map((i) => i.id as string));
  const sameQueueLink = show.relations.some(
    (r) =>
      (r.sourceItemId === item.id && targetItems.has(r.targetItemId)) ||
      (r.targetItemId === item.id && targetItems.has(r.sourceItemId)),
  );
  if (sameQueueLink)
    return showInvalid(
      'the item is related to an item in the target Queue; break that relation first',
    );

  const sourceView = queueView(show, source.queue.id);
  const targetView = queueView(show, target.queue.id);
  if (!sourceView || !targetView) return showNotFound('queue not found');

  // Remove from the source Queue.
  const sourceLayout = layoutOf(sourceView)
    .filter((e) => !(e.kind === 'item' && e.id === item.id))
    .map((e) => (e.kind === 'group' ? { ...e, items: e.items.filter((id) => id !== item.id) } : e));
  const sourceAfter = applyLayout(
    { ...sourceView, items: sourceView.items.filter((i) => i.id !== item.id) },
    sourceLayout,
    ctx.now,
  );
  // Insert into the target Queue.
  const moved = {
    ...item,
    queueId: target.queue.id,
    groupId: input.groupId,
    updatedAt: ctx.now,
    revision: item.revision + 1,
  };
  const targetLayout = [...layoutOf(targetView)];
  const id = item.id as QueueItemId;
  if (input.groupId === null) {
    targetLayout.splice(Math.max(0, Math.min(targetLayout.length, input.index)), 0, {
      kind: 'item',
      id,
    });
  } else {
    const at = targetLayout.findIndex((e) => e.kind === 'group' && e.id === input.groupId);
    const group = targetLayout[at];
    if (group?.kind === 'group') {
      const items = [...group.items];
      items.splice(Math.max(0, Math.min(items.length, input.index)), 0, id);
      targetLayout[at] = { ...group, items };
    }
  }
  const targetAfter = applyLayout(
    { ...targetView, items: [...targetView.items, moved] },
    targetLayout,
    ctx.now,
  );

  const bump = <T extends { queue: { revision: number } }>(v: T): T => ({
    ...v,
    queue: { ...v.queue, revision: v.queue.revision + 1 },
  });
  let next = withQueueView(show, bump(sourceAfter));
  next = withQueueView(next, bump(targetAfter));
  return ok(commitShow(normalizeShow({ ...next, revision: show.revision }, ctx.now)));
}
