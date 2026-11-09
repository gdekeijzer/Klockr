import type { BoardId, GrantId, ShowId } from '../ids';
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
  | 'board.share'
  | 'board.read';

/** Grant families present in M1. Accounts, role links, devices and API tokens come later. */
export type GrantKind = 'anonymous_owner' | 'board_share';

export interface AccessGrant {
  readonly id: GrantId;
  readonly kind: GrantKind;
  readonly showId: ShowId;
  /** Set for Board-scoped grants. */
  readonly boardId: BoardId | null;
  readonly createdAt: EpochMs;
  readonly expiresAt: EpochMs | null;
  readonly revokedAt: EpochMs | null;
}

const BUNDLES: Readonly<Record<GrantKind, readonly Permission[]>> = {
  // Temporary Owner/Master-level management of exactly one anonymous Show.
  // show.manage: Show-level settings; queue.manage: structure/content/overrides;
  // item.control: live Queue operation (current, END / NEXT); timer.control: timer transport.
  anonymous_owner: [
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
    'board.share',
  ],
  // Read-only access to one Board projection. Never mutating.
  board_share: ['board.read'],
};

export function permissionsOf(kind: GrantKind): readonly Permission[] {
  return BUNDLES[kind];
}

export type GrantResource =
  | { readonly kind: 'show'; readonly showId: ShowId }
  | { readonly kind: 'board'; readonly showId: ShowId; readonly boardId: BoardId };

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
  if (resource.showId !== grant.showId) return false;
  if (grant.boardId !== null) {
    return resource.kind === 'board' && resource.boardId === grant.boardId;
  }
  return true;
}
