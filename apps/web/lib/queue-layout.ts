import type { GroupSnapshot, QueueItemSnapshot, QueueSnapshot } from '@klockr/contracts';

/** Client view of the Queue order: top-level items and groups, groups with their children. */
export type Row =
  | { readonly kind: 'item'; readonly item: QueueItemSnapshot }
  | {
      readonly kind: 'group';
      readonly group: GroupSnapshot;
      readonly items: readonly QueueItemSnapshot[];
    };

export function rowsOf(queue: QueueSnapshot): Row[] {
  const top: (Row & { position: number })[] = [
    ...queue.items
      .filter((i) => i.groupId === null)
      .map((item) => ({ kind: 'item' as const, item, position: item.position })),
    ...queue.groups.map((group) => ({
      kind: 'group' as const,
      group,
      position: group.position,
      items: queue.items
        .filter((i) => i.groupId === group.id)
        .sort((a, b) => a.position - b.position),
    })),
  ];
  return top.sort((a, b) => a.position - b.position);
}

export type Dragged = { readonly kind: 'item' | 'group'; readonly id: string };

/** Where a drop lands, relative to the row it is dropped on. */
export type DropTarget =
  | { readonly kind: 'item'; readonly id: string }
  | { readonly kind: 'group'; readonly id: string }
  | { readonly kind: 'end' };

export type MoveCommand =
  | {
      readonly type: 'item.move';
      readonly payload: { queueItemId: string; groupId: string | null; index: number };
    }
  | { readonly type: 'group.move'; readonly payload: { groupId: string; index: number } };

/**
 * Translate a drag & drop gesture into a move command (or null for a no-op). Dropping on a row
 * inserts before it; dropping an item on a group header appends it to that group; dropping on the
 * end zone appends at the top level. Groups never nest: a group dropped on a child row is placed
 * before that child's group. Indices are positions after removing the dragged element, which is
 * how the domain `move` operations interpret them. Moving is structure only: it never triggers
 * an operational action (current/next/timers).
 */
export function moveFor(
  queue: QueueSnapshot,
  dragged: Dragged,
  target: DropTarget,
): MoveCommand | null {
  const rows = rowsOf(queue);
  if (dragged.kind === 'group') {
    const rest = rows.filter((r) => !(r.kind === 'group' && r.group.id === dragged.id));
    let index = rest.length;
    if (target.kind === 'group') {
      if (target.id === dragged.id) return null;
      index = rest.findIndex((r) => r.kind === 'group' && r.group.id === target.id);
    } else if (target.kind === 'item') {
      index = rest.findIndex(
        (r) =>
          (r.kind === 'item' && r.item.id === target.id) ||
          (r.kind === 'group' && r.items.some((i) => i.id === target.id)),
      );
      if (index < 0) return null; // dropped on one of its own children
    }
    const from = rows.findIndex((r) => r.kind === 'group' && r.group.id === dragged.id);
    return from === index ? null : { type: 'group.move', payload: { groupId: dragged.id, index } };
  }

  if (target.kind === 'item' && target.id === dragged.id) return null;
  const without = rows
    .filter((r) => !(r.kind === 'item' && r.item.id === dragged.id))
    .map((r) =>
      r.kind === 'group' ? { ...r, items: r.items.filter((i) => i.id !== dragged.id) } : r,
    );
  let groupId: string | null = null;
  let index = without.length;
  if (target.kind === 'group') {
    groupId = target.id;
    const group = without.find((r) => r.kind === 'group' && r.group.id === target.id);
    index = group?.kind === 'group' ? group.items.length : 0;
  } else if (target.kind === 'item') {
    const top = without.findIndex((r) => r.kind === 'item' && r.item.id === target.id);
    if (top >= 0) index = top;
    else {
      const parent = without.find(
        (r) => r.kind === 'group' && r.items.some((i) => i.id === target.id),
      );
      if (parent?.kind !== 'group') return null;
      groupId = parent.group.id;
      index = parent.items.findIndex((i) => i.id === target.id);
    }
  }
  const item = queue.items.find((i) => i.id === dragged.id);
  if (!item) return null;
  const siblings = queue.items
    .filter((i) => i.groupId === item.groupId)
    .sort((a, b) => a.position - b.position);
  const currentIndex =
    item.groupId === null
      ? rows.findIndex((r) => r.kind === 'item' && r.item.id === item.id)
      : siblings.findIndex((i) => i.id === item.id);
  if (groupId === item.groupId && index === currentIndex) return null;
  return { type: 'item.move', payload: { queueItemId: dragged.id, groupId, index } };
}

/** Up/down keyboard-friendly alternative to drag & drop, within the item's container. */
export function stepMove(queue: QueueSnapshot, itemId: string, delta: -1 | 1): MoveCommand | null {
  const item = queue.items.find((i) => i.id === itemId);
  if (!item) return null;
  const rows = rowsOf(queue);
  const count =
    item.groupId === null
      ? rows.length
      : queue.items.filter((i) => i.groupId === item.groupId).length;
  const index =
    item.groupId === null
      ? rows.findIndex((r) => r.kind === 'item' && r.item.id === itemId)
      : item.position;
  const next = index + delta;
  if (next < 0 || next >= count) return null;
  return {
    type: 'item.move',
    payload: { queueItemId: itemId, groupId: item.groupId, index: next },
  };
}

export function stepMoveGroup(
  queue: QueueSnapshot,
  groupId: string,
  delta: -1 | 1,
): MoveCommand | null {
  const rows = rowsOf(queue);
  const index = rows.findIndex((r) => r.kind === 'group' && r.group.id === groupId);
  const next = index + delta;
  if (index < 0 || next < 0 || next >= rows.length) return null;
  return { type: 'group.move', payload: { groupId, index: next } };
}
