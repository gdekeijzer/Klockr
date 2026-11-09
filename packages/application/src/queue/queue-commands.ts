import type { QueueCommandDto, QueueCommandType } from '@klockr/contracts';
import {
  addGroup,
  addItem,
  deleteGroup,
  deleteItem,
  duplicateGroup,
  duplicateItem,
  endItem,
  GroupId,
  moveGroup,
  moveItem,
  ok,
  QueueItemId,
  renameGroup,
  setCurrent,
  setItemActive,
  setItemWarning,
  setQueueWarning,
  setShowWarning,
  updateItem,
  type Clock,
  type OperationContext,
  type Permission,
  type QueueAggregate,
  type QueueError,
  type QueueResult,
  type ShowId,
} from '@klockr/domain';
import type { CommandContext } from '../command';
import { appError, type CommandResult } from '../errors';
import { stableStringify } from '../idempotency';
import type {
  Authorizer,
  EventPublisher,
  IdempotencyStore,
  IdGenerator,
  QueueRepository,
  ShowRepository,
} from '../ports';

/** Queue commands are exactly the validated boundary DTOs (one shape for UI and API). */
export type QueueCommand = QueueCommandDto;

export interface QueueCommandOutcome {
  readonly aggregate: QueueAggregate;
  /** Id of the item/group created by add/duplicate commands. */
  readonly createdId: string | null;
}

export interface QueueCommandDeps {
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly shows: ShowRepository;
  readonly queues: QueueRepository;
  readonly idempotency: IdempotencyStore;
  readonly authorizer: Authorizer;
  readonly events: EventPublisher;
  readonly onPublishError?: (error: unknown) => void;
}

/**
 * Capability per command (never role names). Structure/content/overrides need `queue.manage`;
 * live operation (current, END / NEXT) needs `item.control`; Show defaults need `show.manage`.
 */
export function permissionFor(type: QueueCommandType): Permission {
  switch (type) {
    case 'queue.setCurrent':
    case 'item.end':
      return 'item.control';
    case 'show.setWarning':
      return 'show.manage';
    case 'item.add':
    case 'item.update':
    case 'item.delete':
    case 'item.duplicate':
    case 'item.move':
    case 'item.setActive':
    case 'item.setWarning':
    case 'group.add':
    case 'group.rename':
    case 'group.delete':
    case 'group.duplicate':
    case 'group.move':
    case 'queue.setWarning':
      return 'queue.manage';
  }
}

type Applied = QueueResult<{ aggregate: QueueAggregate; createdId: string | null }>;

const plain = (r: QueueResult): Applied => (r.ok ? ok({ aggregate: r.value, createdId: null }) : r);

/** Pure mapping from a command to its domain operation. */
export function applyQueueCommand(
  agg: QueueAggregate,
  command: QueueCommand,
  ctx: OperationContext,
): Applied {
  switch (command.type) {
    case 'item.add': {
      const { groupId, ...rest } = command.payload;
      const r = addItem(
        agg,
        { ...rest, groupId: groupId === undefined || groupId === null ? null : GroupId(groupId) },
        ctx,
      );
      return r.ok ? ok({ aggregate: r.value.aggregate, createdId: r.value.itemId }) : r;
    }
    case 'item.update':
      return plain(
        updateItem(
          agg,
          { id: QueueItemId(command.payload.queueItemId), patch: command.payload.patch },
          ctx,
        ),
      );
    case 'item.delete':
      return plain(deleteItem(agg, { id: QueueItemId(command.payload.queueItemId) }, ctx));
    case 'item.duplicate': {
      const r = duplicateItem(agg, { id: QueueItemId(command.payload.queueItemId) }, ctx);
      return r.ok ? ok({ aggregate: r.value.aggregate, createdId: r.value.itemId }) : r;
    }
    case 'item.move': {
      const { queueItemId, groupId, index } = command.payload;
      return plain(
        moveItem(
          agg,
          {
            id: QueueItemId(queueItemId),
            groupId: groupId === null ? null : GroupId(groupId),
            index,
          },
          ctx,
        ),
      );
    }
    case 'item.setActive':
      return plain(
        setItemActive(
          agg,
          { id: QueueItemId(command.payload.queueItemId), active: command.payload.active },
          ctx,
        ),
      );
    case 'item.setWarning':
      return plain(
        setItemWarning(
          agg,
          { id: QueueItemId(command.payload.queueItemId), warning: command.payload.warning },
          ctx,
        ),
      );
    case 'queue.setCurrent':
      return plain(setCurrent(agg, { id: QueueItemId(command.payload.queueItemId) }, ctx));
    case 'item.end': {
      const r = endItem(
        agg,
        { id: QueueItemId(command.payload.queueItemId), advance: command.payload.next },
        ctx,
      );
      return r.ok ? ok({ aggregate: r.value.aggregate, createdId: null }) : r;
    }
    case 'group.add': {
      const r = addGroup(agg, command.payload, ctx);
      return r.ok ? ok({ aggregate: r.value.aggregate, createdId: r.value.groupId }) : r;
    }
    case 'group.rename':
      return plain(
        renameGroup(
          agg,
          { id: GroupId(command.payload.groupId), title: command.payload.title },
          ctx,
        ),
      );
    case 'group.delete':
      return plain(deleteGroup(agg, { id: GroupId(command.payload.groupId) }, ctx));
    case 'group.duplicate': {
      const r = duplicateGroup(agg, { id: GroupId(command.payload.groupId) }, ctx);
      return r.ok ? ok({ aggregate: r.value.aggregate, createdId: r.value.groupId }) : r;
    }
    case 'group.move':
      return plain(
        moveGroup(agg, { id: GroupId(command.payload.groupId), index: command.payload.index }, ctx),
      );
    case 'queue.setWarning':
      return plain(setQueueWarning(agg, { warning: command.payload.warning }));
    case 'show.setWarning':
      return plain(setShowWarning(agg, { warning: command.payload.warning }));
  }
}

function fromQueueError(error: QueueError): CommandResult<never> {
  return appError(error.code, error.reason);
}

/** Without an explicit expectedRevision, a lost compare-and-set race is re-evaluated this often. */
const MAX_ATTEMPTS = 3;

/**
 * The single entry point for Queue state changes, for UI and external API alike. Order:
 * permission -> idempotent replay -> load -> expected revision -> pure domain operation ->
 * atomic compare-and-set save -> remember outcome -> publish -> record activity.
 *
 * When the caller did not pin `expectedRevision`, a concurrent write (e.g. a timer transition
 * racing an END) makes the command re-evaluate against the fresh state, exactly as if it had
 * arrived a moment later; domain guards (e.g. "END only the current item") still apply.
 */
export async function executeQueueCommand(
  showId: ShowId,
  command: QueueCommand,
  context: CommandContext,
  deps: QueueCommandDeps,
): Promise<CommandResult<QueueCommandOutcome>> {
  const allowed = await deps.authorizer.can(context.actor, permissionFor(command.type), {
    kind: 'show',
    id: showId,
  });
  if (!allowed) return appError('forbidden', 'Not permitted to change this Queue');

  const scope = `${context.actor.kind}:${context.actor.id}`;
  const fingerprint = stableStringify({ showId, type: command.type, payload: command.payload });
  if (command.idempotencyKey !== undefined) {
    const stored = await deps.idempotency.find(scope, command.idempotencyKey);
    if (stored) {
      if (stored.fingerprint !== fingerprint) {
        return appError('idempotency_conflict', 'Idempotency key was used for a different command');
      }
      return stored.result as CommandResult<QueueCommandOutcome>;
    }
  }

  const show = await deps.shows.getShow(showId);
  if (!show) return appError('not_found', 'Show not found');

  for (let attempt = 1; ; attempt++) {
    const prev = await deps.queues.loadQueue(show.primaryQueueId);
    if (!prev) return appError('not_found', 'Queue not found');
    if (
      command.expectedRevision !== undefined &&
      command.expectedRevision !== prev.queue.revision
    ) {
      return appError('revision_conflict', 'Queue has changed since it was read', {
        expectedRevision: command.expectedRevision,
        actualRevision: prev.queue.revision,
      });
    }

    const now = deps.clock.now();
    const applied = applyQueueCommand(prev, command, { now, newId: () => deps.ids.uuid() });
    if (!applied.ok) return fromQueueError(applied.error);
    const { aggregate, createdId } = applied.value;

    // A no-op (nothing changed) is a success without a write or event.
    if (aggregate === prev) return ok({ aggregate, createdId });

    const saved = await deps.queues.saveQueue(prev, aggregate);
    if (!saved.ok) {
      if (
        saved.error.code === 'revision_conflict' &&
        command.expectedRevision === undefined &&
        attempt < MAX_ATTEMPTS
      ) {
        continue;
      }
      return saved;
    }

    const result = ok({ aggregate, createdId });
    if (command.idempotencyKey !== undefined) {
      await deps.idempotency.remember(scope, command.idempotencyKey, { fingerprint, result });
    }
    try {
      await deps.events.publish({
        type: 'queue.changed',
        commandId: command.commandId,
        commandType: command.type,
        showId,
        aggregate,
        occurredAt: now,
      });
    } catch (error) {
      deps.onPublishError?.(error);
    }
    await deps.shows.touch(showId, now);
    return result;
  }
}
