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
  type TimerState,
  transitionItemTimer,
} from '@klockr/domain';
import type { CommandContext } from '../command';
import { appError, type CommandResult } from '../errors';
import type {
  Authorizer,
  GrantRepository,
  IdGenerator,
  AuditRecord,
  AuditRepository,
  NewGrantRecord,
  ShowRepository,
  TokenService,
} from '../ports';
import { toBoardSnapshot, toQueueSnapshot, type QueueCommandDeps } from '../queue';
import { mutateQueue } from '../queue/mutate';
import {
  fromTimerError,
  transitionFor,
  type TimerCommand,
  type TimerCommandDeps,
  type TimerCommandOutcome,
} from '../timer';

export interface ShowServiceDeps extends TimerCommandDeps, QueueCommandDeps {
  readonly audit: AuditRepository;
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

function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Anonymous New Show -> Quick Timer. No account, Event or Room. The creating browser receives
 * the owner credential (temporary Owner/Master access to this Show only).
 */
export async function createQuickTimer(
  input: {
    readonly durationMs: number;
    readonly timeZone?: string | undefined;
    readonly scheduleDate?: string | undefined;
  },
  deps: ShowServiceDeps,
): Promise<CommandResult<CreatedQuickTimer>> {
  const now = deps.clock.now();
  const ids = {
    showId: ShowId(deps.ids.uuid()),
    queueId: QueueId(deps.ids.uuid()),
    queueItemId: QueueItemId(deps.ids.uuid()),
    boardId: BoardId(deps.ids.uuid()),
  };
  const timeZone = input.timeZone && isTimeZone(input.timeZone) ? input.timeZone : 'UTC';
  const bundle = createQuickTimerShow(ids, input.durationMs, now, {
    timeZone,
    scheduleDate: input.scheduleDate ?? null,
  });
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
 * Live timer command addressed within a Show. Runs through the Queue aggregate (`mutateQueue`)
 * so that a first START records `actualStartAt` atomically with the transition, the schedule
 * projection is recalculated for every client (one `queue.changed`), and `timer.configure`
 * (a timing-configuration edit) respects locks. Transport (start/pause/resume/stop/adjust) is
 * never blocked by a lock. `expectedRevision` refers to the TIMER revision.
 * Items of other Shows are not found (no cross-Show probing).
 */
export async function runShowTimerCommand(
  showId: ShowId,
  command: TimerCommand,
  context: CommandContext,
  deps: ShowServiceDeps,
): Promise<CommandResult<TimerCommandOutcome>> {
  const queueItemId = QueueItemId(command.payload.queueItemId);
  const result = await mutateQueue<TimerState>(
    showId,
    {
      commandId: command.commandId,
      commandType: command.type,
      intent: command.payload,
      idempotencyKey: command.idempotencyKey,
      expectedRevision: command.expectedRevision,
      checkRevision: (agg) => {
        const timer = agg.items.find((i) => i.id === queueItemId)?.timer;
        if (!timer || command.expectedRevision === undefined) return null;
        return command.expectedRevision === timer.revision
          ? null
          : {
              code: 'revision_conflict',
              message: 'Timer has changed since it was read',
              details: {
                expectedRevision: command.expectedRevision,
                actualRevision: timer.revision,
              },
            };
      },
      permission: 'timer.control',
      lockTargets: () =>
        command.type === 'timer.configure' ? [{ kind: 'item', id: queueItemId }] : [],
      override: command.override,
      apply: (prev, now) => {
        const before = prev.items.find((i) => i.id === queueItemId);
        const transitioned = transitionItemTimer(
          prev,
          { id: queueItemId, transition: (state) => transitionFor(command)(state, now) },
          { now },
        );
        if (!transitioned.ok) {
          const error = transitioned.error;
          return 'reason' in error
            ? appError('not_found', 'Timer not found in this Show', { queueItemId })
            : fromTimerError(error);
        }
        const { aggregate, state } = transitioned.value;
        const durationChanged =
          command.type === 'timer.configure' && before?.timer?.durationMs !== state.durationMs;
        return ok({
          aggregate,
          value: state,
          audit: durationChanged
            ? [
                {
                  action: 'schedule.update',
                  resource: { kind: 'item', id: queueItemId },
                  details: {
                    title: before?.title ?? null,
                    durationMs: {
                      before: before?.timer?.durationMs ?? null,
                      after: state.durationMs,
                    },
                  },
                },
              ]
            : [],
          events: [
            {
              type: 'timer.transitioned',
              commandId: command.commandId,
              commandType: command.type,
              showId,
              queueItemId,
              state,
              occurredAt: now,
            },
          ],
        });
      },
    },
    context,
    deps,
  );
  return result.ok ? ok({ queueItemId, state: result.value.value }) : result;
}

/** Persistent audit trail of the Show (newest first). Requires `audit.read`. */
export async function getAuditTrail(
  showId: ShowId,
  context: CommandContext,
  deps: ShowServiceDeps,
  limit = 100,
): Promise<CommandResult<readonly AuditRecord[]>> {
  if (!(await deps.authorizer.can(context.actor, 'audit.read', { kind: 'show', id: showId }))) {
    return appError('forbidden', 'Not permitted to read the audit trail of this Show');
  }
  return ok(await deps.audit.listAudit(showId, Math.max(1, Math.min(500, limit))));
}
