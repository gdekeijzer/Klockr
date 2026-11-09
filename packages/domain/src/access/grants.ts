import type { BoardId, EventId, GrantId, ShowId } from '../ids';
import type { EpochMs } from '../time';

/**
 * Capabilities. Authorization always checks these, never grant or role names.
 * Grant kinds are bundles of capabilities with a scope (docs/IDENTITY_AUTH_LIFECYCLE.md).
 */
export type Permission =
  | 'show.read'
  | 'show.manage'
  | 'queue.read'
  | 'queue.manage'
  | 'item.control'
  | 'timer.control'
  | 'schedule.read'
  | 'schedule.manage'
  | 'lock.manage'
  | 'lock.request'
  | 'lock.override'
  | 'audit.read'
  | 'queue.create'
  | 'queue.delete'
  | 'relation.manage'
  | 'board.manage'
  | 'message.send'
  | 'board.share'
  | 'board.read'
  // M5: Events, Rooms, Show placement/duplication, Devices and Board share management.
  | 'event.read'
  | 'event.manage'
  | 'room.manage'
  | 'show.create'
  | 'show.move'
  | 'show.duplicate'
  | 'device.read'
  | 'device.manage'
  | 'device.pair'
  | 'board.share.manage';

/**
 * Grant families. Accounts, role links and API tokens come later; Devices have their own
 * credential (not a grant).
 */
export type GrantKind = 'anonymous_owner' | 'anonymous_event_owner' | 'board_share';

export interface AccessGrant {
  readonly id: GrantId;
  readonly kind: GrantKind;
  /** Scope: exactly one of `showId` / `eventId`. */
  readonly showId: ShowId | null;
  /** Event scope (M5): covers the Event, its Rooms, Event Boards and every Show placed in it. */
  readonly eventId: EventId | null;
  /** Set for Board-scoped grants. */
  readonly boardId: BoardId | null;
  /** Optional human label (Board share management). */
  readonly label: string | null;
  readonly createdAt: EpochMs;
  readonly expiresAt: EpochMs | null;
  readonly revokedAt: EpochMs | null;
}

const SHOW_OWNER: readonly Permission[] = [
  // Temporary Owner/Master-level management of exactly one anonymous Show.
  // show.manage: Show-level settings; queue.manage: structure/content/overrides;
  // item.control: live Queue operation (current, END / NEXT); timer.control: timer transport.
  'show.read',
  'show.manage',
  'queue.read',
  'queue.manage',
  'item.control',
  'timer.control',
  // M3: planning, locks (incl. Emergency Override) and the audit trail of its own Show.
  'schedule.read',
  'schedule.manage',
  'lock.manage',
  'lock.request',
  'lock.override',
  'audit.read',
  // M4: peer Queues, cross-Queue relations, Boards and ad-hoc messages of its own Show.
  'queue.create',
  'queue.delete',
  'relation.manage',
  'board.manage',
  'message.send',
  'board.share',
  // M5: within its own Show only — move it into an Event (together with event.manage on
  // that Event), duplicate it, manage Devices bound to it and its Board share links.
  'show.move',
  'show.duplicate',
  'device.read',
  'device.manage',
  'device.pair',
  'board.share.manage',
];

const BUNDLES: Readonly<Record<GrantKind, readonly Permission[]>> = {
  anonymous_owner: SHOW_OWNER,
  // M5: temporary owner of one anonymous Event. Covers the Event structure and, through
  // placement, every Show inside the Event (same Show capabilities as its owner).
  anonymous_event_owner: [
    ...SHOW_OWNER,
    'event.read',
    'event.manage',
    'room.manage',
    'show.create',
  ],
  // Read-only access to one Board projection. Never mutating.
  board_share: ['board.read'],
};

export function permissionsOf(kind: GrantKind): readonly Permission[] {
  return BUNDLES[kind];
}

/** A resource resolved to its scope (Show and/or the Event the Show/Board belongs to). */
export type GrantResource =
  | { readonly kind: 'show'; readonly showId: ShowId; readonly eventId?: EventId | null }
  | {
      readonly kind: 'board';
      readonly showId: ShowId | null;
      readonly boardId: BoardId;
      readonly eventId?: EventId | null;
    }
  | { readonly kind: 'event'; readonly eventId: EventId };

export function isGrantActive(grant: AccessGrant, now: EpochMs): boolean {
  if (grant.revokedAt !== null) return false;
  return grant.expiresAt === null || now < grant.expiresAt;
}

/** Pure authorization rule: capability present, grant active, resource within the grant scope. */
export function grantPermits(
  grant: AccessGrant,
  permission: Permission,
  resource: GrantResource,
  now: EpochMs,
): boolean {
  if (!isGrantActive(grant, now)) return false;
  if (!permissionsOf(grant.kind).includes(permission)) return false;
  if (grant.boardId !== null) {
    return resource.kind === 'board' && resource.boardId === grant.boardId;
  }
  if (grant.showId !== null) {
    return resource.kind !== 'event' && resource.showId === grant.showId;
  }
  if (grant.eventId !== null) {
    return (resource.eventId ?? null) === grant.eventId;
  }
  return false;
}
