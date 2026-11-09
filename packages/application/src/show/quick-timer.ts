import type { BoardStateSnapshot, ShowStateSnapshot } from '@klockr/contracts';
import {
  BoardId,
  createQuickTimerShow,
  GrantId,
  ok,
  QueueId,
  QueueItemId,
  ShowId,
  type AccessGrant,
  type Clock,
  type GrantKind,
} from '@klockr/domain';
import type { CommandContext } from '../command';
import { appError, type CommandResult } from '../errors';
import type {
  Authorizer,
  GrantRepository,
  IdGenerator,
  NewGrantRecord,
  ShowRepository,
  TokenService,
} from '../ports';
import { toBoardSnapshot, toQueueSnapshot, type QueueCommandDeps } from '../queue';
import {
  executeTimerCommand,
  type TimerCommand,
  type TimerCommandDeps,
  type TimerCommandOutcome,
} from '../timer';

export interface ShowServiceDeps extends TimerCommandDeps, QueueCommandDeps {
  readonly shows: ShowRepository;
  readonly grants: GrantRepository;
  readonly tokens: TokenService;
  readonly ids: IdGenerator;
  readonly authorizer: Authorizer;
  readonly clock: Clock;
}

export interface CreatedQuickTimer {
  readonly showId: ShowId;
  /** Secret owner credential. Returned once; only its hash is persisted. */
  readonly ownerToken: string;
  /** Secret read-only Speaker Board credential. Returned once; only its hash is persisted. */
  readonly boardShareToken: string;
}

function newGrant(
  deps: ShowServiceDeps,
  kind: GrantKind,
  showId: ShowId,
  boardId: BoardId | null,
): { record: NewGrantRecord; token: string } {
  const issued = deps.tokens.issue(kind === 'anonymous_owner' ? 'owner' : 'board');
  const grant: AccessGrant = {
    id: GrantId(deps.ids.uuid()),
    kind,
    showId,
    boardId,
    createdAt: deps.clock.now(),
    // Grants live as long as the Show; anonymous cleanup (worker) removes them with it.
    expiresAt: null,
    revokedAt: null,
  };
  return { record: { grant, tokenHash: issued.hash }, token: issued.token };
}

/**
 * Anonymous New Show -> Quick Timer. No account, Event or Room. The creating browser receives
 * the owner credential (temporary Owner/Master access to this Show only).
 */
export async function createQuickTimer(
  input: { readonly durationMs: number },
  deps: ShowServiceDeps,
): Promise<CommandResult<CreatedQuickTimer>> {
  const now = deps.clock.now();
  const ids = {
    showId: ShowId(deps.ids.uuid()),
    queueId: QueueId(deps.ids.uuid()),
    queueItemId: QueueItemId(deps.ids.uuid()),
    boardId: BoardId(deps.ids.uuid()),
  };
  const bundle = createQuickTimerShow(ids, input.durationMs, now);
  if (!bundle.ok) {
    const reason =
      bundle.error.code === 'invalid_transition' ? bundle.error.code : bundle.error.reason;
    return appError('validation_failed', reason);
  }

  const owner = newGrant(deps, 'anonymous_owner', ids.showId, null);
  const board = newGrant(deps, 'board_share', ids.showId, ids.boardId);
  await deps.shows.createQuickTimerShow(bundle.value, [owner.record, board.record]);

  return ok({ showId: ids.showId, ownerToken: owner.token, boardShareToken: board.token });
}

/** Issue an additional read-only Speaker Board link for a Show. */
export async function createBoardShare(
  showId: ShowId,
  context: CommandContext,
  deps: ShowServiceDeps,
): Promise<CommandResult<{ boardId: BoardId; boardShareToken: string }>> {
  if (!(await deps.authorizer.can(context.actor, 'board.share', { kind: 'show', id: showId }))) {
    return appError('forbidden', 'Not permitted to share Boards of this Show');
  }
  const board = await deps.shows.getBoardOfShow(showId);
  if (!board) return appError('not_found', 'Board not found');
  const share = newGrant(deps, 'board_share', showId, board.id);
  await deps.grants.create(share.record);
  return ok({ boardId: board.id, boardShareToken: share.token });
}

/** Management projection of the Show State (Operator / Queue Editor). */
export async function getShowState(
  showId: ShowId,
  context: CommandContext,
  deps: ShowServiceDeps,
): Promise<CommandResult<ShowStateSnapshot>> {
  if (!(await deps.authorizer.can(context.actor, 'queue.read', { kind: 'show', id: showId }))) {
    return appError('forbidden', 'Not permitted to read this Show');
  }
  const [show, board] = await Promise.all([
    deps.shows.getShow(showId),
    deps.shows.getBoardOfShow(showId),
  ]);
  const queue = show ? await deps.queues.loadQueue(show.primaryQueueId) : null;
  if (!show || !board || !queue) return appError('not_found', 'Show not found');
  return ok({
    show: {
      id: show.id,
      title: show.title,
      ownership: show.ownership,
      createdAt: show.createdAt,
      expiresAt: show.expiresAt,
    },
    board: { id: board.id },
    queue: toQueueSnapshot(queue, deps.clock.now()),
  });
}

/** Read-only Board projection for a Board share grant: follows the Program Queue's current. */
export async function getBoardState(
  boardId: BoardId,
  context: CommandContext,
  deps: ShowServiceDeps,
): Promise<CommandResult<BoardStateSnapshot>> {
  if (!(await deps.authorizer.can(context.actor, 'board.read', { kind: 'board', id: boardId }))) {
    return appError('forbidden', 'Not permitted to read this Board');
  }
  const board = await deps.shows.getBoard(boardId);
  const show = board ? await deps.shows.getShow(board.showId) : null;
  const queue = show ? await deps.queues.loadQueue(show.primaryQueueId) : null;
  if (!board || !queue) return appError('not_found', 'Board not found');
  return ok(toBoardSnapshot(board, queue, deps.clock.now()));
}

/**
 * Timer command addressed within a Show. Rejects items of other Shows as not_found (no
 * cross-Show probing), executes through the shared timer command path and records activity.
 */
export async function runShowTimerCommand(
  showId: ShowId,
  command: TimerCommand,
  context: CommandContext,
  deps: ShowServiceDeps,
): Promise<CommandResult<TimerCommandOutcome>> {
  const owner = await deps.locator.showIdOfItem(QueueItemId(command.payload.queueItemId));
  if (owner !== showId) return appError('not_found', 'Timer not found in this Show');
  const result = await executeTimerCommand(command, context, deps);
  if (result.ok) await deps.shows.touch(showId, deps.clock.now());
  return result;
}
