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
  setItemSchedule,
  setQueueTimingMode,
  setShowSchedule,
  setLock,
  releaseLock,
  requestUnlock,
  type ActorRef,
  type ShowSchedule,
  type Clock,
  type OperationContext,
  type Permission,
  type QueueAggregate,
  type QueueError,
  type QueueResult,
  type ShowId,
} from '@klockr/domain';
import type { CommandContext } from '../command';
import type { AppError, CommandResult } from '../errors';
import type {
  Authorizer,
  EventPublisher,
  IdempotencyStore,
  IdGenerator,
  QueueRepository,
  ShowRepository,
} from '../ports';
import { lockTargetsFor } from './locks';
import { actorRef, mutateQueue, type MutationResult } from './mutate';

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
    case 'item.setSchedule':
    case 'queue.setTimingMode':
    case 'show.setSchedule':
      return 'schedule.manage';
    case 'lock.set':
    case 'lock.release':
      return 'lock.manage';
    case 'lock.requestUnlock':
      return 'lock.request';
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
  ctx: OperationContext & { readonly actor: ActorRef },
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
    case 'item.setSchedule': {
      const { queueItemId, ...patch } = command.payload;
      return plain(setItemSchedule(agg, { id: QueueItemId(queueItemId), patch }, ctx));
    }
    case 'queue.setTimingMode':
      return plain(setQueueTimingMode(agg, command.payload.mode));
    case 'show.setSchedule': {
      const patch = Object.fromEntries(
        Object.entries(command.payload).filter(([, v]) => v !== undefined),
      ) as Partial<ShowSchedule>;
      return plain(setShowSchedule(agg, patch));
    }
    case 'lock.set': {
      const r = setLock(agg, command.payload.target, { ...ctx, actor: ctx.actor });
      return r.ok ? ok({ aggregate: r.value.aggregate, createdId: r.value.lock.id }) : r;
    }
    case 'lock.release': {
      const r = releaseLock(agg, command.payload.target);
      return r.ok ? ok({ aggregate: r.value.aggregate, createdId: null }) : r;
    }
    case 'lock.requestUnlock': {
      const r = requestUnlock(agg, command.payload.target, command.payload.reason ?? null, {
        ...ctx,
        actor: ctx.actor,
      });
      return r.ok ? ok({ aggregate: r.value.aggregate, createdId: r.value.request.id }) : r;
    }
  }
}

type AuditDraft = NonNullable<MutationResult<unknown>['audit']>[number];

/**
 * Audit trail for operationally important changes: locks, unlock requests, planned schedule
 * edits (incl. planned durations), fixed anchors and timing modes. (Emergency Overrides are
 * audited by `mutateQueue` itself.)
 */
export function auditFor(
  command: QueueCommand,
  prev: QueueAggregate,
  next: QueueAggregate,
): AuditDraft[] {
  const itemOf = (agg: QueueAggregate, id: string) => agg.items.find((i) => i.id === id);
  switch (command.type) {
    case 'item.setSchedule': {
      const before = itemOf(prev, command.payload.queueItemId);
      const after = itemOf(next, command.payload.queueItemId);
      if (!before || !after) return [];
      const pick = (i: typeof before) => ({
        plannedStartAt: i.plannedStartAt,
        plannedDurationMs: i.plannedDurationMs,
        fixedAnchor: i.fixedAnchor,
      });
      const records: AuditDraft[] = [
        {
          action: 'schedule.update',
          resource: { kind: 'item', id: after.id },
          details: { title: after.title, before: pick(before), after: pick(after) },
        },
      ];
      if (before.fixedAnchor !== after.fixedAnchor) {
        records.push({
          action: 'anchor.update',
          resource: { kind: 'item', id: after.id },
          details: {
            title: after.title,
            fixedAnchor: after.fixedAnchor,
            plannedStartAt: after.plannedStartAt,
          },
        });
      }
      return records;
    }
    case 'item.update': {
      if (command.payload.patch.durationMs === undefined) return [];
      const before = itemOf(prev, command.payload.queueItemId);
      const after = itemOf(next, command.payload.queueItemId);
      const from = before?.timer?.durationMs ?? null;
      const to = after?.timer?.durationMs ?? null;
      if (!after || from === to) return [];
      return [
        {
          action: 'schedule.update',
          resource: { kind: 'item', id: after.id },
          details: { title: after.title, durationMs: { before: from, after: to } },
        },
      ];
    }
    case 'queue.setTimingMode':
      return [
        {
          action: 'timing_mode.update',
          resource: { kind: 'queue', id: next.queue.id },
          details: { before: prev.queue.timingMode, after: next.queue.timingMode },
        },
      ];
    case 'show.setSchedule': {
      const records: AuditDraft[] = [];
      if (prev.showSchedule.timingMode !== next.showSchedule.timingMode) {
        records.push({
          action: 'timing_mode.update',
          resource: { kind: 'show', id: next.showId },
          details: { before: prev.showSchedule.timingMode, after: next.showSchedule.timingMode },
        });
      }
      const { timingMode: _a, ...restBefore } = prev.showSchedule;
      const { timingMode: _b, ...restAfter } = next.showSchedule;
      if (JSON.stringify(restBefore) !== JSON.stringify(restAfter)) {
        records.push({
          action: 'schedule.settings',
          resource: { kind: 'show', id: next.showId },
          details: { before: restBefore, after: restAfter },
        });
      }
      return records;
    }
    case 'lock.set':
      return [{ action: 'lock.set', resource: command.payload.target, details: {} }];
    case 'lock.release': {
      const released = prev.locks.find(
        (l) =>
          l.target.kind === command.payload.target.kind &&
          l.target.id === command.payload.target.id,
      );
      const resolved = prev.unlockRequests
        .filter((r) => r.lockId === released?.id)
        .map((r) => r.id);
      return [
        {
          action: 'lock.release',
          resource: command.payload.target,
          details: { lockId: released?.id ?? null, resolvedUnlockRequests: resolved },
        },
      ];
    }
    case 'lock.requestUnlock': {
      const request = next.unlockRequests.at(-1);
      return [
        {
          action: 'lock.request_unlock',
          resource: command.payload.target,
          details: {
            reason: request?.reason ?? null,
            lockId: request?.lockId ?? null,
            requestId: request?.id ?? null,
          },
        },
      ];
    }
    default:
      return [];
  }
}

function fromQueueError(error: QueueError): AppError {
  return { code: error.code, message: error.reason };
}

/**
 * Entry point for Queue commands (UI and external API alike). Runs through `mutateQueue`:
 * capability check, idempotency, expected Queue revision, lock gate / audited Emergency Override,
 * pure domain operation, atomic save with audit records, publish.
 */
export async function executeQueueCommand(
  showId: ShowId,
  command: QueueCommand,
  context: CommandContext,
  deps: QueueCommandDeps,
): Promise<CommandResult<QueueCommandOutcome>> {
  const result = await mutateQueue<string | null>(
    showId,
    {
      commandId: command.commandId,
      commandType: command.type,
      intent: command.payload,
      idempotencyKey: command.idempotencyKey,
      expectedRevision: command.expectedRevision,
      permission: permissionFor(command.type),
      lockTargets: (agg) => lockTargetsFor(agg, command),
      override: command.override,
      apply: (prev, now) => {
        const applied = applyQueueCommand(prev, command, {
          now,
          newId: () => deps.ids.uuid(),
          actor: actorRef(context.actor),
        });
        if (!applied.ok) return { ok: false, error: fromQueueError(applied.error) };
        const { aggregate, createdId } = applied.value;
        return ok({
          aggregate,
          value: createdId,
          audit: aggregate === prev ? [] : auditFor(command, prev, aggregate),
        });
      },
    },
    context,
    deps,
  );
  return result.ok
    ? ok({ aggregate: result.value.aggregate, createdId: result.value.value })
    : result;
}
