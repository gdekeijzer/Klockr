import type { GroupId, QueueItemId } from '../ids';
import type { EpochMs } from '../time';
import type { Group, ItemLifecycle, QueueAggregate, QueueItem } from './model';

/**
 * Layout: the Queue's order as a value. Top-level entries are items and groups interleaved;
 * a group entry lists its child item ids. Operations edit the layout, then {@link applyLayout}
 * writes positions/group membership back. Positions are always dense (0..n-1).
 */
export type LayoutEntry =
  | { readonly kind: 'item'; readonly id: QueueItemId }
  | { readonly kind: 'group'; readonly id: GroupId; readonly items: readonly QueueItemId[] };

export type Layout = readonly LayoutEntry[];

const byPosition = (a: { position: number; id: string }, b: { position: number; id: string }) =>
  a.position - b.position || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function layoutOf(agg: QueueAggregate): Layout {
  const top: ({ kind: 'item'; item: QueueItem } | { kind: 'group'; group: Group })[] = [
    ...agg.items.filter((i) => i.groupId === null).map((item) => ({ kind: 'item' as const, item })),
    ...agg.groups.map((group) => ({ kind: 'group' as const, group })),
  ];
  top.sort((a, b) =>
    byPosition(a.kind === 'item' ? a.item : a.group, b.kind === 'item' ? b.item : b.group),
  );
  return top.map((entry) => {
    if (entry.kind === 'item') return { kind: 'item', id: entry.item.id };
    const children = agg.items
      .filter((i) => i.groupId === entry.group.id)
      .sort(byPosition)
      .map((i) => i.id);
    return { kind: 'group', id: entry.group.id, items: children };
  });
}

/** Items in operational order (groups expanded in place). */
export function orderedItems(agg: QueueAggregate): QueueItem[] {
  const byId = new Map(agg.items.map((i) => [i.id, i]));
  const ids = layoutOf(agg).flatMap((e) => (e.kind === 'item' ? [e.id] : e.items));
  return ids.map((id) => byId.get(id)).filter((i): i is QueueItem => i !== undefined);
}

/**
 * Write a layout back: dense positions, group membership. Items whose position or group
 * changed get a new revision/updatedAt; unchanged items are returned as the same objects.
 */
export function applyLayout(agg: QueueAggregate, layout: Layout, now: EpochMs): QueueAggregate {
  const itemPlacement = new Map<QueueItemId, { groupId: GroupId | null; position: number }>();
  const groupPosition = new Map<GroupId, number>();
  layout.forEach((entry, position) => {
    if (entry.kind === 'item') {
      itemPlacement.set(entry.id, { groupId: null, position });
    } else {
      groupPosition.set(entry.id, position);
      entry.items.forEach((id, childPosition) => {
        itemPlacement.set(id, { groupId: entry.id, position: childPosition });
      });
    }
  });
  const items = agg.items
    .filter((i) => itemPlacement.has(i.id))
    .map((item) => {
      const placement = itemPlacement.get(item.id);
      if (!placement) return item;
      if (placement.groupId === item.groupId && placement.position === item.position) return item;
      return {
        ...item,
        groupId: placement.groupId,
        position: placement.position,
        updatedAt: now,
        revision: item.revision + 1,
      };
    });
  const groups = agg.groups
    .filter((g) => groupPosition.has(g.id))
    .map((group) => {
      const position = groupPosition.get(group.id) ?? group.position;
      return position === group.position ? group : { ...group, position, updatedAt: now };
    });
  return { ...agg, items, groups };
}

export function findItem(agg: QueueAggregate, id: QueueItemId): QueueItem | undefined {
  return agg.items.find((i) => i.id === id);
}

export function findGroup(agg: QueueAggregate, id: GroupId): Group | undefined {
  return agg.groups.find((g) => g.id === id);
}

export function currentItem(agg: QueueAggregate): QueueItem | null {
  const id = agg.queue.currentItemId;
  return id === null ? null : (findItem(agg, id) ?? null);
}

/** Eligible for NEXT: active and not yet completed. */
export function isEligible(item: QueueItem): boolean {
  return item.active && item.completedAt === null;
}

/**
 * Derived `next`: the first eligible item after Current in Queue order (inactive and completed
 * items are skipped). With no Current, the first eligible item in the Queue. Never persisted, so
 * it can never disagree with the order, the active flags or the current position.
 */
export function nextItem(agg: QueueAggregate): QueueItem | null {
  const ordered = orderedItems(agg);
  const currentId = agg.queue.currentItemId;
  const from = currentId === null ? 0 : ordered.findIndex((i) => i.id === currentId) + 1;
  return ordered.slice(from).find(isEligible) ?? null;
}

export function lifecycleOf(agg: QueueAggregate, item: QueueItem): ItemLifecycle {
  if (agg.queue.currentItemId === item.id) return 'current';
  if (item.completedAt !== null) return 'completed';
  if (!item.active) return 'inactive';
  return 'upcoming';
}
