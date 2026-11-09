import type { BoardCommandDto, QueueCommandDto } from '@klockr/contracts';
import {
  addGroup,
  addItem,
  addQueue,
  acceptSuggestion,
  boardSourceQueues,
  commitShow,
  createMessage,
  createRelation,
  deleteGroup,
  deleteItem,
  deleteQueue,
  deleteRelation,
  duplicateGroup,
  duplicateItem,
  endItem,
  GroupId,
  ignoreSuggestion,
  moveGroup,
  moveItem,
  moveItemToQueue,
  moveQueue,
  ok,
  presetDefaults,
  queueOfItem,
  queueView,
  QueueItemId,
  releaseLock,
  renameGroup,
  requestUnlock,
  setCurrent,
  setItemActive,
  setItemSchedule,
  setItemVisibility,
  setItemWarning,
  setLock,
  setPrimaryQueue,
  setQueueTimingMode,
  setQueueWarning,
  setShowSchedule,
  setShowWarning,
  updateItem,
  updateQueue,
  updateRelation,
  validateBoard,
  withQueueView,
  BoardId,
  type ActorRef,
  type Board,
  type OperationContext,
  type Permission,
  type QueueAggregate,
  type QueueError,
  type QueueResult,
  type ShowAggregate,
  type ShowError,
  type ShowId,
  type ShowSchedule,
} from '@klockr/domain';
import type { CommandContext } from '../command';
import type { AppError, CommandResult } from '../errors';
import { lockTargetsFor } from './locks';
import {
  actorRef,
  mutateShow,
  queueRevisionCheck,
  type AuditDraft,
  type MutationDeps,
} from './mutate';
import { sourcesFromDto } from './projection';

/** Queue, relation, suggestion, Board and Message commands: exactly the boundary DTOs. */
export type QueueCommand = QueueCommandDto;
export type ShowCommand = QueueCommandDto | BoardCommandDto;
export type ShowCommandType = ShowCommand['type'];

export interface QueueCommandOutcome {
  readonly show: ShowAggregate;
  /** The affected Queue (or the Primary Queue for Show-level commands). */
  readonly aggregate: QueueAggregate;
  /** Id of the object created by add/create/duplicate commands. */
  readonly createdId: string | null;
}

export type QueueCommandDeps = MutationDeps;

/**
 * Capability per command (never role names). Structure/content/overrides need `queue.manage`;
 * live operation (current, END / NEXT, suggestions) needs `item.control`; Show defaults and the
 * Primary Queue need `show.manage`; M4 adds `queue.create`/`queue.delete`, `relation.manage`,
 * `board.manage` and `message.send`.
 */
export function permissionFor(type: ShowCommandType): Permission {
  switch (type) {
    case 'queue.setCurrent':
    case 'item.end':
    case 'suggestion.accept':
    case 'suggestion.ignore':
      return 'item.control';
    case 'show.setWarning':
    case 'queue.setPrimary':
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
    case 'queue.create':
      return 'queue.create';
    case 'queue.delete':
      return 'queue.delete';
    case 'relation.create':
    case 'relation.update':
    case 'relation.delete':
      return 'relation.manage';
    case 'board.create':
    case 'board.update':
    case 'board.delete':
      return 'board.manage';
    case 'message.send':
    case 'message.clear':
      return 'message.send';
    case 'item.add':
    case 'item.update':
    case 'item.delete':
    case 'item.duplicate':
    case 'item.move':
    case 'item.setActive':
    case 'item.setWarning':
    case 'item.setVisibility':
    case 'item.moveToQueue':
    case 'group.add':
    case 'group.rename':
    case 'group.delete':
    case 'group.duplicate':
    case 'group.move':
    case 'queue.setWarning':
    case 'queue.update':
    case 'queue.move':
      return 'queue.manage';
  }
}

/** Commands that operate on exactly one Queue (run on a `queueView`). */
const VIEW_COMMANDS = [
  'item.add',
  'item.update',
  'item.delete',
  'item.duplicate',
  'item.move',
  'item.setActive',
  'item.setWarning',
  'item.setVisibility',
  'item.setSchedule',
  'item.end',
  'queue.setCurrent',
  'queue.setWarning',
  'queue.setTimingMode',
  'group.add',
  'group.rename',
  'group.delete',
  'group.duplicate',
  'group.move',
  'show.setWarning',
  'show.setSchedule',
  'lock.set',
  'lock.release',
  'lock.requestUnlock',
] as const;
type ViewCommandType = (typeof VIEW_COMMANDS)[number];
export type ViewCommand = Extract<QueueCommandDto, { type: ViewCommandType }>;

export function isViewCommand(command: ShowCommand): command is ViewCommand {
  return (VIEW_COMMANDS as readonly string[]).includes(command.type);
}

/** The Queue a single-Queue command addresses (explicit, via its item/group, or Primary). */
export function queueIdFor(show: ShowAggregate, command: ViewCommand): string | undefined {
  const byItem = (id: string) => queueOfItem(show, id)?.queue.id;
  const byGroup = (id: string) =>
    show.queues.find((q) => q.groups.some((g) => g.id === id))?.queue.id;
  switch (command.type) {
    case 'item.add':
    case 'group.add':
    case 'queue.setWarning':
    case 'queue.setTimingMode':
      return command.payload.queueId ?? show.primaryQueueId;
    case 'group.rename':
    case 'group.delete':
    case 'group.duplicate':
    case 'group.move':
      return byGroup(command.payload.groupId);
    case 'show.setWarning':
    case 'show.setSchedule':
      return show.primaryQueueId;
    case 'lock.set':
    case 'lock.release':
    case 'lock.requestUnlock': {
      const t = command.payload.target;
      return t.kind === 'show'
        ? show.primaryQueueId
        : t.kind === 'queue'
          ? t.id
          : t.kind === 'group'
            ? byGroup(t.id)
            : byItem(t.id);
    }
    default:
      return byItem(command.payload.queueItemId);
  }
}

type Applied = QueueResult<{ aggregate: QueueAggregate; createdId: string | null }>;

const plain = (r: QueueResult): Applied => (r.ok ? ok({ aggregate: r.value, createdId: null }) : r);

/** Pure mapping from a command to its domain operation. */
export function applyQueueCommand(
  agg: QueueAggregate,
  command: ViewCommand,
  ctx: OperationContext & { readonly actor: ActorRef },
): Applied {
  switch (command.type) {
    case 'item.add': {
      const { groupId, queueId: _queueId, ...rest } = command.payload;
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
      const r = addGroup(agg, { title: command.payload.title, index: command.payload.index }, ctx);
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
    case 'item.setVisibility':
      return plain(
        setItemVisibility(
          agg,
          {
            id: command.payload.queueItemId,
            visibility: command.payload.visibility,
            notesAudiences: command.payload.notesAudiences,
          },
          ctx,
        ),
      );
    case 'lock.requestUnlock': {
      const r = requestUnlock(agg, command.payload.target, command.payload.reason ?? null, {
        ...ctx,
        actor: ctx.actor,
      });
      return r.ok ? ok({ aggregate: r.value.aggregate, createdId: r.value.request.id }) : r;
    }
  }
}

/**
 * Audit trail for operationally important changes: locks, unlock requests, planned schedule
 * edits (incl. planned durations), fixed anchors and timing modes. (Emergency Overrides are
 * audited by `mutateQueue` itself.)
 */
export function auditFor(
  command: ViewCommand,
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

function fromError(error: QueueError | ShowError): AppError {
  return { code: error.code, message: error.reason };
}

interface Applied2 {
  readonly show: ShowAggregate;
  readonly createdId: string | null;
  readonly audit: AuditDraft[];
}

/** Show-level commands (Queues, relations, suggestions, Boards, Messages, cross-Queue move). */
export function applyShowCommand(
  show: ShowAggregate,
  command: Exclude<ShowCommand, ViewCommand>,
  ctx: OperationContext & { readonly actor: ActorRef },
): CommandResult<Applied2> {
  const done = (next: ShowAggregate, createdId: string | null = null, audit: AuditDraft[] = []) =>
    ok({ show: next, createdId, audit });
  switch (command.type) {
    case 'queue.create': {
      const r = addQueue(show, command.payload, ctx);
      if (!r.ok) return { ok: false, error: fromError(r.error) };
      return done(r.value.show, r.value.queueId, [
        {
          action: 'queue.create',
          resource: { kind: 'queue', id: r.value.queueId },
          details: { name: command.payload.name },
        },
      ]);
    }
    case 'queue.update': {
      const r = updateQueue(show, command.payload);
      return r.ok ? done(r.value) : { ok: false, error: fromError(r.error) };
    }
    case 'queue.move': {
      const r = moveQueue(show, command.payload);
      return r.ok ? done(r.value) : { ok: false, error: fromError(r.error) };
    }
    case 'queue.setPrimary': {
      const r = setPrimaryQueue(show, command.payload.queueId);
      if (!r.ok) return { ok: false, error: fromError(r.error) };
      return done(
        r.value,
        null,
        r.value === show
          ? []
          : [
              {
                action: 'queue.set_primary',
                resource: { kind: 'queue', id: command.payload.queueId },
                details: { before: show.primaryQueueId },
              },
            ],
      );
    }
    case 'queue.delete': {
      const name =
        show.queues.find((q) => q.queue.id === command.payload.queueId)?.queue.name ?? null;
      const r = deleteQueue(show, command.payload.queueId, ctx.now);
      if (!r.ok) return { ok: false, error: fromError(r.error) };
      return done(r.value, null, [
        {
          action: 'queue.delete',
          resource: { kind: 'queue', id: command.payload.queueId },
          details: { name },
        },
      ]);
    }
    case 'item.moveToQueue': {
      const { queueItemId, queueId, groupId, index } = command.payload;
      const r = moveItemToQueue(
        show,
        {
          itemId: queueItemId,
          queueId,
          groupId: groupId === null ? null : GroupId(groupId),
          index,
        },
        ctx,
      );
      return r.ok ? done(r.value) : { ok: false, error: fromError(r.error) };
    }
    case 'relation.create': {
      const r = createRelation(show, command.payload, ctx);
      if (!r.ok) return { ok: false, error: fromError(r.error) };
      return done(r.value.show, r.value.relationId, [
        {
          action: 'relation.create',
          resource: { kind: 'relation', id: r.value.relationId },
          details: { ...command.payload },
        },
      ]);
    }
    case 'relation.update': {
      const r = updateRelation(show, command.payload, ctx);
      if (!r.ok) return { ok: false, error: fromError(r.error) };
      return done(
        r.value,
        null,
        r.value === show
          ? []
          : [
              {
                action: 'relation.update',
                resource: { kind: 'relation', id: command.payload.relationId },
                details: { ...command.payload },
              },
            ],
      );
    }
    case 'relation.delete': {
      const r = deleteRelation(show, command.payload.relationId);
      if (!r.ok) return { ok: false, error: fromError(r.error) };
      return done(r.value, null, [
        {
          action: 'relation.delete',
          resource: { kind: 'relation', id: command.payload.relationId },
          details: {},
        },
      ]);
    }
    case 'suggestion.accept': {
      const r = acceptSuggestion(show, command.payload.suggestionId, ctx);
      if (!r.ok) return { ok: false, error: fromError(r.error) };
      return done(r.value.show, r.value.accepted ? command.payload.suggestionId : null);
    }
    case 'suggestion.ignore': {
      const r = ignoreSuggestion(show, command.payload.suggestionId, ctx);
      return r.ok ? done(r.value) : { ok: false, error: fromError(r.error) };
    }
    case 'board.create': {
      const defaults = presetDefaults(command.payload.preset);
      const board: Board = {
        id: BoardId(ctx.newId()),
        showId: show.showId,
        eventId: null,
        name: command.payload.name ?? defaults.name,
        preset: command.payload.preset,
        audience: defaults.audience,
        sources: defaults.sources,
        components: defaults.components,
        presentation: defaults.presentation,
        createdAt: ctx.now,
        updatedAt: ctx.now,
        revision: 0,
      };
      if (show.boards.length >= 50)
        return { ok: false, error: { code: 'validation_failed', message: 'too many boards' } };
      return done(commitShow({ ...show, boards: [...show.boards, board] }), board.id);
    }
    case 'board.update': {
      const existing = show.boards.find((b) => b.id === command.payload.boardId);
      if (!existing) return { ok: false, error: { code: 'not_found', message: 'board not found' } };
      const { boardId: _id, sources, presentation, ...rest } = command.payload;
      const candidate: Board = {
        ...existing,
        ...Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)),
        ...(sources ? { sources: sourcesFromDto(sources) } : {}),
        presentation: {
          ...existing.presentation,
          ...Object.fromEntries(
            Object.entries(presentation ?? {}).filter(([, v]) => v !== undefined),
          ),
        },
      };
      const valid = validateBoard(
        candidate,
        show.queues.map((q) => q.queue.id),
      );
      if (!valid.ok)
        return { ok: false, error: { code: 'validation_failed', message: valid.error } };
      const updated = { ...valid.value, updatedAt: ctx.now, revision: existing.revision + 1 };
      return done(
        commitShow({
          ...show,
          boards: show.boards.map((b) => (b.id === existing.id ? updated : b)),
        }),
      );
    }
    case 'board.delete': {
      if (!show.boards.some((b) => b.id === command.payload.boardId)) {
        return { ok: false, error: { code: 'not_found', message: 'board not found' } };
      }
      return done(
        commitShow({
          ...show,
          boards: show.boards.filter((b) => b.id !== command.payload.boardId),
        }),
      );
    }
    case 'message.send': {
      const boardIds = (command.payload.boardIds ?? []).map(BoardId);
      if (boardIds.some((id) => !show.boards.some((b) => b.id === id))) {
        return { ok: false, error: { code: 'not_found', message: 'board not found' } };
      }
      const created = createMessage({
        id: ctx.newId(),
        text: command.payload.text,
        audiences: command.payload.audiences,
        boardIds,
        priority: command.payload.priority,
        ttlMs: command.payload.ttlMs ?? null,
        now: ctx.now,
      });
      if (!created.ok)
        return { ok: false, error: { code: 'validation_failed', message: created.error } };
      return done(
        commitShow({ ...show, messages: [...show.messages, created.value] }),
        created.value.id,
      );
    }
    case 'message.clear': {
      if (!show.messages.some((m) => m.id === command.payload.messageId)) {
        return { ok: false, error: { code: 'not_found', message: 'message not found' } };
      }
      return done(
        commitShow({
          ...show,
          messages: show.messages.map((m) =>
            m.id === command.payload.messageId ? { ...m, clearedAt: ctx.now } : m,
          ),
        }),
      );
    }
  }
}

/**
 * Entry point for every non-timer Show command (UI and external API alike): runs through
 * `mutateShow` (capability, idempotency, expected revision, lock gate / audited Emergency
 * Override, pure domain operation, suggested-follow reconciliation, atomic save + audit, publish).
 */
export async function executeShowCommand(
  showId: ShowId,
  command: ShowCommand,
  context: CommandContext,
  deps: QueueCommandDeps,
): Promise<CommandResult<QueueCommandOutcome>> {
  const actor = actorRef(context.actor);
  let affectedQueue: string | undefined;
  const result = await mutateShow<string | null>(
    showId,
    {
      commandId: command.commandId,
      commandType: command.type,
      intent: command.payload,
      idempotencyKey: command.idempotencyKey,
      expectedRevision: command.expectedRevision,
      checkRevision: queueRevisionCheck(command.expectedRevision, (show) =>
        isViewCommand(command) ? queueIdFor(show, command) : undefined,
      ),
      permission: permissionFor(command.type),
      lockTargets: (show) => lockTargetsFor(show, command),
      override: command.override,
      apply: (prev, now) => {
        const ctx = { now, newId: () => deps.ids.uuid(), actor };
        if (isViewCommand(command)) {
          const queueId = queueIdFor(prev, command);
          affectedQueue = queueId;
          const view = queueId ? queueView(prev, queueId) : null;
          if (!view)
            return { ok: false, error: { code: 'not_found', message: 'Queue or item not found' } };
          const applied = applyQueueCommand(view, command, ctx);
          if (!applied.ok) return { ok: false, error: fromError(applied.error) };
          const next = withQueueView(prev, applied.value.aggregate);
          return ok({
            show: next,
            value: applied.value.createdId,
            audit: next === prev ? [] : auditFor(command, view, applied.value.aggregate),
          });
        }
        const applied = applyShowCommand(prev, command, ctx);
        if (!applied.ok) return applied;
        if (command.type === 'item.moveToQueue') affectedQueue = command.payload.queueId;
        return ok({
          show: applied.value.show,
          value: applied.value.createdId,
          audit: applied.value.audit,
        });
      },
    },
    context,
    deps,
  );
  if (!result.ok) return result;
  const show = result.value.show;
  const view =
    queueView(show, affectedQueue ?? show.primaryQueueId) ?? queueView(show, show.primaryQueueId);
  if (!view) return { ok: false, error: { code: 'internal', message: 'Show without Queue' } };
  return ok({ show, aggregate: view, createdId: result.value.value });
}

/** M2/M3 name of the same entry point. */
export const executeQueueCommand = executeShowCommand;

export { boardSourceQueues };
