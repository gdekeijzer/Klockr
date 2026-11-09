import type { QueueItem } from '../queue/model';

/**
 * Fixed audience categories (docs/BOARDS_AUDIENCES.md). A Board has exactly one primary
 * Audience; Queue Items and Messages target Audiences instead of device names.
 */
export const AUDIENCES = ['stage', 'production', 'backstage', 'public', 'broadcast'] as const;
export type Audience = (typeof AUDIENCES)[number];

export function isAudience(value: string): value is Audience {
  return (AUDIENCES as readonly string[]).includes(value);
}

/**
 * Visibility is projection authorization, not lifecycle: a hidden item still exists, is planned,
 * runs and can be Current. `visibility === null` means visible to every audience (the
 * backward-compatible default for all items created before M4).
 */
export function isItemVisibleTo(item: QueueItem, audience: Audience): boolean {
  return item.visibility === null || item.visibility.includes(audience);
}

/**
 * The `notes` PROPERTY is internal operator information. It reaches a Board only when the
 * item explicitly publishes its notes to that Board's audience (default: none) AND the Board
 * enables a Notes component. (A standalone Note item is a normal item; its title follows
 * `visibility`.)
 */
export function areNotesVisibleTo(item: QueueItem, audience: Audience): boolean {
  return item.notes !== null && item.notesAudiences.includes(audience);
}

export function normalizeAudiences(list: readonly string[]): Audience[] {
  return AUDIENCES.filter((a) => list.includes(a));
}

// --- Visibility operation (a Queue view operation, like the other item edits) ----------------

import { QueueItemId } from '../ids';
import { findItem } from '../queue/order';
import {
  commit,
  notFound,
  replaceItem,
  touchItem,
  type OperationContext,
  type QueueResult,
} from '../queue/operations';
import type { QueueAggregate } from '../queue/model';
import { ok } from '../result';

/**
 * Set who may see an item on Boards (`null` = everyone) and to which audiences its `notes`
 * property is published (default none).
 */
export function setItemVisibility(
  agg: QueueAggregate,
  input: {
    readonly id: string;
    readonly visibility: readonly string[] | null;
    readonly notesAudiences?: readonly string[] | undefined;
  },
  ctx: OperationContext,
): QueueResult {
  const item = findItem(agg, QueueItemId(input.id));
  if (!item) return notFound('item not found');
  const visibility = input.visibility === null ? null : normalizeAudiences(input.visibility);
  const notesAudiences =
    input.notesAudiences === undefined
      ? item.notesAudiences
      : normalizeAudiences(input.notesAudiences);
  if (
    JSON.stringify(visibility) === JSON.stringify(item.visibility) &&
    JSON.stringify(notesAudiences) === JSON.stringify(item.notesAudiences)
  ) {
    return ok(agg);
  }
  return ok(commit(replaceItem(agg, touchItem(item, { visibility, notesAudiences }, ctx.now))));
}
