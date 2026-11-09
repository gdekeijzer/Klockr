import type { BoardShareListResponse } from '@klockr/contracts';
import { EventId, GrantId, ok, ShowId, type BoardId } from '@klockr/domain';
import type { CommandContext } from '../command';
import { appError, type CommandResult } from '../errors';
import type { OwnerScope, ResourceRef } from '../ports';
import { actorRef } from '../queue/mutate';
import { newGrant } from '../show/quick-timer';
import type { PlatformDeps } from '../event/event-service';
import { boardsInScope } from './device-service';

/**
 * Board share links (ad-hoc, read-only URL credentials) — separate from persistent Devices.
 * Shares of a Show's Boards live in the Show scope; shares of Event/Room Boards in the Event
 * scope. Revocation is immediate: new requests fail and open connections are closed.
 */
const scopeResource = (scope: OwnerScope): ResourceRef =>
  scope.showId !== null
    ? { kind: 'show', id: scope.showId }
    : { kind: 'event', id: scope.eventId ?? '' };

/** Boards that are shared FROM this scope (own Boards only, not those of placed Shows). */
async function ownBoards(scope: OwnerScope, deps: PlatformDeps) {
  const all = await boardsInScope(scope, deps);
  return all.filter(({ board }) =>
    scope.showId !== null ? board.showId === scope.showId : board.eventId === scope.eventId,
  );
}

export async function listBoardShares(
  scope: OwnerScope,
  context: CommandContext,
  deps: PlatformDeps,
): Promise<CommandResult<BoardShareListResponse>> {
  if (!(await deps.authorizer.can(context.actor, 'board.share.manage', scopeResource(scope)))) {
    return appError('forbidden', 'Not permitted to manage share links here');
  }
  const [grants, boards] = await Promise.all([
    deps.grants.listBoardShares(scope),
    ownBoards(scope, deps),
  ]);
  const names = new Map(boards.map(({ board }) => [board.id, board.name]));
  return ok({
    shares: grants.flatMap((g) =>
      g.boardId
        ? [
            {
              id: g.id,
              boardId: g.boardId,
              boardName: names.get(g.boardId) ?? 'Removed Board',
              label: g.label,
              createdAt: g.createdAt,
              revokedAt: g.revokedAt,
            },
          ]
        : [],
    ),
  });
}

export async function createScopedBoardShare(
  scope: OwnerScope,
  input: { readonly boardId?: string | undefined; readonly label?: string | undefined },
  context: CommandContext,
  deps: PlatformDeps,
): Promise<CommandResult<{ shareId: string; boardId: BoardId; boardShareToken: string }>> {
  if (!(await deps.authorizer.can(context.actor, 'board.share', scopeResource(scope)))) {
    return appError('forbidden', 'Not permitted to share Boards here');
  }
  const boards = await ownBoards(scope, deps);
  const board = input.boardId
    ? boards.find(({ board: b }) => b.id === input.boardId)?.board
    : boards[0]?.board;
  if (!board) return appError('not_found', 'Board not found');
  const label = input.label?.trim() ? input.label.trim().slice(0, 80) : null;
  const share = newGrant(
    deps,
    'board_share',
    {
      showId: scope.showId ? ShowId(scope.showId) : null,
      eventId: scope.showId ? null : scope.eventId ? EventId(scope.eventId) : null,
    },
    board.id,
    label,
  );
  const now = deps.clock.now();
  await deps.grants.createWithAudit(share.record, [
    {
      id: deps.ids.uuid(),
      showId: scope.showId ? ShowId(scope.showId) : null,
      eventId: scope.showId ? null : scope.eventId ? EventId(scope.eventId) : null,
      at: now,
      actor: actorRef(context.actor),
      action: 'board.share.create',
      resource: { kind: 'board', id: board.id },
      details: { shareId: share.record.grant.id, label },
    },
  ]);
  return ok({ shareId: share.record.grant.id, boardId: board.id, boardShareToken: share.token });
}

export async function revokeBoardShare(
  scope: OwnerScope,
  shareId: string,
  context: CommandContext,
  deps: PlatformDeps,
): Promise<CommandResult<null>> {
  if (!(await deps.authorizer.can(context.actor, 'board.share.manage', scopeResource(scope)))) {
    return appError('forbidden', 'Not permitted to manage share links here');
  }
  const grant = await deps.grants.findById(GrantId(shareId));
  const inScope =
    grant?.kind === 'board_share' &&
    (scope.showId !== null ? grant.showId === scope.showId : grant.eventId === scope.eventId);
  if (!grant || !inScope) return appError('not_found', 'Share link not found');
  if (grant.revokedAt !== null) return ok(null);
  const now = deps.clock.now();
  await deps.grants.revokeGrant(grant.id, now, [
    {
      id: deps.ids.uuid(),
      showId: grant.showId,
      eventId: grant.eventId,
      at: now,
      actor: actorRef(context.actor),
      action: 'board.share.revoke',
      resource: { kind: 'board', id: grant.boardId ?? '' },
      details: { shareId: grant.id, label: grant.label },
    },
  ]);
  try {
    await deps.events.publish({ type: 'access.revoked', grantId: grant.id, occurredAt: now });
  } catch (error) {
    deps.onPublishError?.(error);
  }
  return ok(null);
}
