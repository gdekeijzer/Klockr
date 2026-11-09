import {
  changedTimers,
  type AppError,
  type AuditRecord,
  type AuditRepository,
  type GrantRepository,
  type IdempotencyStore,
  type NewGrantRecord,
  type ShowRepository,
  type ShowStateRepository,
  type StoredOutcome,
  type TimerRepository,
} from '@klockr/application';
import {
  BoardId,
  err,
  GrantId,
  GroupId,
  ok,
  QueueId,
  QueueItemId,
  ShowId,
  type AccessGrant,
  type Board,
  type EpochMs,
  type GrantKind,
  type Group,
  type Lock,
  type LockTargetKind,
  type ShowSchedule,
  type TimingMode,
  type UnlockRequest,
  presetDefaults,
  queueView,
  type Audience,
  type BoardComponentKind,
  type BoardPreset,
  type Message,
  type Queue,
  type QueueAggregate,
  type QueueItem,
  type Relation,
  type ShowAggregate,
  type Suggestion,
  type QuickTimerShow,
  type Result,
  type Show,
  type StartMode,
  type TimerMode,
  type TimerState,
  type TimerStatus,
  type TimerThresholds,
} from '@klockr/domain';
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { Database } from './client';
import {
  accessGrants,
  auditEvents,
  boardSources,
  boards,
  itemRelations,
  messages,
  queueSuggestions,
  locks,
  unlockRequests,
  idempotencyRecords,
  itemTimers,
  queueGroups,
  queueItems,
  queues,
  shows,
  type ThresholdRuleJson,
} from './schema';

const toDate = (ms: EpochMs): Date => new Date(ms);
const toDateOrNull = (ms: EpochMs | null): Date | null => (ms === null ? null : new Date(ms));
const toMs = (d: Date): EpochMs => d.getTime();
const toMsOrNull = (d: Date | null): EpochMs | null => (d === null ? null : d.getTime());

type TimerRow = typeof itemTimers.$inferSelect;
type GrantRow = typeof accessGrants.$inferSelect;
type ShowRow = typeof shows.$inferSelect;
type ItemRow = typeof queueItems.$inferSelect;
type GroupRow = typeof queueGroups.$inferSelect;

function ruleFromJson(json: ThresholdRuleJson): TimerThresholds {
  return json.kind === 'absolute'
    ? { kind: 'absolute', warningMs: json.warningMs ?? 0, criticalMs: json.criticalMs ?? 0 }
    : {
        kind: 'percent',
        warningPercent: json.warningPercent ?? 0,
        criticalPercent: json.criticalPercent ?? 0,
      };
}
const ruleOrNull = (json: ThresholdRuleJson | null): TimerThresholds | null =>
  json === null ? null : ruleFromJson(json);
const ruleToJson = (rule: TimerThresholds): ThresholdRuleJson => ({ ...rule });
const ruleToJsonOrNull = (rule: TimerThresholds | null): ThresholdRuleJson | null =>
  rule === null ? null : ruleToJson(rule);

function itemFromRow(row: ItemRow, timer: TimerRow | null): QueueItem {
  return {
    id: QueueItemId(row.id),
    queueId: QueueId(row.queueId),
    groupId: row.groupId === null ? null : GroupId(row.groupId),
    title: row.title,
    subtitle: row.subtitle,
    notes: row.notes,
    tags: row.tags,
    position: row.position,
    active: row.active,
    completedAt: toMsOrNull(row.completedAt),
    startMode: row.startMode as StartMode,
    warning: ruleOrNull(row.warningRule),
    timer: timer ? timerFromRow(timer) : null,
    plannedStartAt: toMsOrNull(row.plannedStartAt),
    plannedDurationMs: row.plannedDurationMs,
    fixedAnchor: row.fixedAnchor,
    actualStartAt: toMsOrNull(row.actualStartAt),
    actualEndAt: toMsOrNull(row.actualEndAt),
    visibility: row.visibility === null ? null : (row.visibility as Audience[]),
    notesAudiences: row.notesAudiences as Audience[],
    createdAt: toMs(row.createdAt),
    updatedAt: toMs(row.updatedAt),
    revision: row.revision,
  };
}

function itemColumns(item: QueueItem) {
  return {
    id: item.id,
    queueId: item.queueId,
    groupId: item.groupId,
    title: item.title,
    subtitle: item.subtitle,
    notes: item.notes,
    tags: [...item.tags],
    position: item.position,
    active: item.active,
    completedAt: toDateOrNull(item.completedAt),
    startMode: item.startMode,
    warningRule: ruleToJsonOrNull(item.warning),
    plannedStartAt: toDateOrNull(item.plannedStartAt),
    plannedDurationMs: item.plannedDurationMs,
    fixedAnchor: item.fixedAnchor,
    actualStartAt: toDateOrNull(item.actualStartAt),
    actualEndAt: toDateOrNull(item.actualEndAt),
    visibility: item.visibility === null ? null : [...item.visibility],
    notesAudiences: [...item.notesAudiences],
    createdAt: toDate(item.createdAt),
    updatedAt: toDate(item.updatedAt),
    revision: item.revision,
  };
}

function groupFromRow(row: GroupRow): Group {
  return {
    id: GroupId(row.id),
    queueId: QueueId(row.queueId),
    title: row.title,
    position: row.position,
    createdAt: toMs(row.createdAt),
    updatedAt: toMs(row.updatedAt),
  };
}

function groupColumns(group: Group) {
  return {
    id: group.id,
    queueId: group.queueId,
    title: group.title,
    position: group.position,
    createdAt: toDate(group.createdAt),
    updatedAt: toDate(group.updatedAt),
  };
}

/** Thrown inside a transaction to roll it back on a lost compare-and-set. */
class RevisionConflict extends Error {}

function timerFromRow(row: TimerRow): TimerState {
  return {
    mode: row.mode as TimerMode,
    status: row.status as TimerStatus,
    durationMs: row.durationMs,
    adjustmentMs: row.adjustmentMs,
    startedAt: toMsOrNull(row.startedAt),
    pausedAt: toMsOrNull(row.pausedAt),
    pausedTotalMs: row.pausedTotalMs,
    stoppedAt: toMsOrNull(row.stoppedAt),
    revision: row.revision,
  };
}

function timerColumns(state: TimerState) {
  return {
    mode: state.mode,
    status: state.status,
    durationMs: state.durationMs,
    adjustmentMs: state.adjustmentMs,
    startedAt: toDateOrNull(state.startedAt),
    pausedAt: toDateOrNull(state.pausedAt),
    pausedTotalMs: state.pausedTotalMs,
    stoppedAt: toDateOrNull(state.stoppedAt),
    revision: state.revision,
  };
}

function grantFromRow(row: GrantRow): AccessGrant {
  return {
    id: GrantId(row.id),
    kind: row.kind as GrantKind,
    showId: ShowId(row.showId),
    boardId: row.boardId === null ? null : BoardId(row.boardId),
    createdAt: toMs(row.createdAt),
    expiresAt: toMsOrNull(row.expiresAt),
    revokedAt: toMsOrNull(row.revokedAt),
  };
}

function grantColumns(record: NewGrantRecord) {
  const { grant } = record;
  return {
    id: grant.id,
    kind: grant.kind,
    showId: grant.showId,
    boardId: grant.boardId,
    tokenHash: record.tokenHash,
    createdAt: toDate(grant.createdAt),
    expiresAt: toDateOrNull(grant.expiresAt),
    revokedAt: toDateOrNull(grant.revokedAt),
  };
}

function showFromRow(row: ShowRow): Show {
  return {
    id: ShowId(row.id),
    title: row.title,
    ownership: 'anonymous',
    primaryQueueId: QueueId(row.primaryQueueId),
    createdAt: toMs(row.createdAt),
    lastActiveAt: toMs(row.lastActiveAt),
    expiresAt: toMs(row.expiresAt),
    warning: ruleFromJson(row.warningRule),
    schedule: scheduleFromRow(row),
  };
}

function scheduleFromRow(row: ShowRow): ShowSchedule {
  return {
    timingMode: row.timingMode as TimingMode,
    timeZone: row.timeZone,
    scheduleDate: row.scheduleDate,
    toleranceMs: row.toleranceMs,
    severeBehindMs: row.severeBehindMs,
  };
}

function scheduleColumns(schedule: ShowSchedule) {
  return {
    timingMode: schedule.timingMode,
    timeZone: schedule.timeZone,
    scheduleDate: schedule.scheduleDate,
    toleranceMs: schedule.toleranceMs,
    severeBehindMs: schedule.severeBehindMs,
  };
}

function lockFromRow(row: typeof locks.$inferSelect): Lock {
  return {
    id: row.id,
    target: { kind: row.targetKind as LockTargetKind, id: row.targetId },
    lockedAt: toMs(row.lockedAt),
    lockedBy: { kind: row.lockedByKind, id: row.lockedById },
  };
}

function requestFromRow(row: typeof unlockRequests.$inferSelect): UnlockRequest {
  return {
    id: row.id,
    lockId: row.lockId,
    target: { kind: row.targetKind as LockTargetKind, id: row.targetId },
    requestedAt: toMs(row.requestedAt),
    requestedBy: { kind: row.requestedByKind, id: row.requestedById },
    reason: row.reason,
  };
}

/** PostgreSQL adapter for the Show/Queue/Timer/Grant persistence ports. */

function queueFromRow(row: typeof queues.$inferSelect): Queue {
  return {
    id: QueueId(row.id),
    showId: ShowId(row.showId),
    name: row.name,
    discipline: row.discipline,
    position: row.position,
    currentItemId: row.currentItemId === null ? null : QueueItemId(row.currentItemId),
    warning: ruleOrNull(row.warningRule),
    timingMode: row.timingMode as TimingMode | null,
    revision: row.revision,
  };
}

function queueColumns(queue: Queue) {
  return {
    id: queue.id,
    showId: queue.showId,
    name: queue.name,
    purpose: 'program',
    discipline: queue.discipline,
    position: queue.position,
    currentItemId: queue.currentItemId,
    warningRule: ruleToJsonOrNull(queue.warning),
    timingMode: queue.timingMode,
    revision: queue.revision,
  };
}

function relationFromRow(row: typeof itemRelations.$inferSelect): Relation {
  return {
    id: row.id,
    sourceItemId: row.sourceItemId,
    targetItemId: row.targetItemId,
    offsetMs: row.offsetMs,
    preserveOffset: row.preserveOffset,
    active: row.active,
    createdAt: toMs(row.createdAt),
    updatedAt: toMs(row.updatedAt),
    revision: row.revision,
  };
}

function relationColumns(showId: string, r: Relation) {
  return {
    id: r.id,
    showId,
    sourceItemId: r.sourceItemId,
    targetItemId: r.targetItemId,
    offsetMs: r.offsetMs,
    preserveOffset: r.preserveOffset,
    active: r.active,
    createdAt: toDate(r.createdAt),
    updatedAt: toDate(r.updatedAt),
    revision: r.revision,
  };
}

function suggestionFromRow(row: typeof queueSuggestions.$inferSelect): Suggestion {
  return {
    id: row.id,
    relationId: row.relationId,
    sourceQueueId: row.sourceQueueId,
    sourceItemId: row.sourceItemId,
    targetQueueId: row.targetQueueId,
    targetItemId: row.targetItemId,
    targetCurrentAtCreation: row.targetCurrentAtCreation,
    createdAt: toMs(row.createdAt),
    status: row.status as Suggestion['status'],
    resolvedAt: toMsOrNull(row.resolvedAt),
  };
}

function suggestionColumns(showId: string, x: Suggestion) {
  return {
    id: x.id,
    showId,
    relationId: x.relationId,
    sourceQueueId: x.sourceQueueId,
    sourceItemId: x.sourceItemId,
    targetQueueId: x.targetQueueId,
    targetItemId: x.targetItemId,
    targetCurrentAtCreation: x.targetCurrentAtCreation,
    createdAt: toDate(x.createdAt),
    status: x.status,
    resolvedAt: toDateOrNull(x.resolvedAt),
  };
}

function boardFromRow(
  row: typeof boards.$inferSelect,
  sources: readonly { queueId: string; position: number }[],
): Board {
  const preset = row.preset as BoardPreset;
  const defaults = presetDefaults(preset);
  return {
    id: BoardId(row.id),
    showId: ShowId(row.showId),
    name: row.name,
    preset,
    audience: row.audience as Audience,
    sources: row.followPrimary
      ? { kind: 'primary' }
      : {
          kind: 'queues',
          queueIds: [...sources]
            .sort((a, b) => a.position - b.position)
            .map((s) => QueueId(s.queueId)),
        },
    // An empty list (M1 boards before M4) means: the preset's default components.
    components:
      row.components.length > 0
        ? row.components.map((c) => ({ ...c, kind: c.kind as BoardComponentKind }))
        : defaults.components,
    presentation: { ...defaults.presentation, ...row.presentation },
    createdAt: toMs(row.createdAt),
    updatedAt: toMs(row.updatedAt),
    revision: row.revision,
  };
}

function boardColumns(b: Board) {
  return {
    id: b.id,
    showId: b.showId,
    preset: b.preset,
    name: b.name,
    audience: b.audience,
    followPrimary: b.sources.kind === 'primary',
    components: b.components.map((c) => ({ ...c })),
    presentation: { ...b.presentation },
    createdAt: toDate(b.createdAt),
    updatedAt: toDate(b.updatedAt),
    revision: b.revision,
  };
}

function messageFromRow(row: typeof messages.$inferSelect): Message {
  return {
    id: row.id,
    text: row.text,
    audiences: row.audiences as Audience[],
    boardIds: row.boardIds.map(BoardId),
    priority: row.priority as Message['priority'],
    createdAt: toMs(row.createdAt),
    expiresAt: toMsOrNull(row.expiresAt),
    clearedAt: toMsOrNull(row.clearedAt),
  };
}

function messageColumns(showId: string, m: Message) {
  return {
    id: m.id,
    showId,
    text: m.text,
    audiences: [...m.audiences],
    boardIds: [...m.boardIds],
    priority: m.priority,
    createdAt: toDate(m.createdAt),
    expiresAt: toDateOrNull(m.expiresAt),
    clearedAt: toDateOrNull(m.clearedAt),
  };
}

export class PgShowStore
  implements ShowRepository, ShowStateRepository, TimerRepository, GrantRepository, AuditRepository
{
  constructor(private readonly db: Database) {}

  async createQuickTimerShow(
    bundle: QuickTimerShow,
    grants: readonly NewGrantRecord[],
  ): Promise<void> {
    const { show, queue, item, board } = bundle;
    await this.db.transaction(async (tx) => {
      await tx.insert(shows).values({
        id: show.id,
        title: show.title,
        ownership: show.ownership,
        primaryQueueId: show.primaryQueueId,
        createdAt: toDate(show.createdAt),
        lastActiveAt: toDate(show.lastActiveAt),
        expiresAt: toDate(show.expiresAt),
        warningRule: ruleToJson(show.warning),
        ...scheduleColumns(show.schedule),
        revision: 0,
      });
      await tx.insert(queues).values({ ...queueColumns(queue), currentItemId: null });
      await tx.insert(queueItems).values(itemColumns(item));
      // The current pointer references the item, so it is set once the item exists.
      await tx
        .update(queues)
        .set({ currentItemId: queue.currentItemId })
        .where(eq(queues.id, queue.id));
      await tx.insert(itemTimers).values({
        queueItemId: item.id,
        ...timerColumns(item.timer),
        updatedAt: toDate(show.createdAt),
      });
      await tx.insert(boards).values(boardColumns(board));
      if (grants.length > 0) await tx.insert(accessGrants).values(grants.map(grantColumns));
    });
  }

  async getShow(showId: ShowId): Promise<Show | null> {
    const [row] = await this.db.select().from(shows).where(eq(shows.id, showId)).limit(1);
    return row ? showFromRow(row) : null;
  }

  /** Load the complete Show aggregate (all Queues, locks, relations, suggestions, Boards, Messages). */
  async loadShowAggregate(showId: ShowId): Promise<ShowAggregate | null> {
    const [show] = await this.db.select().from(shows).where(eq(shows.id, showId)).limit(1);
    if (!show) return null;
    const queueRows = await this.db
      .select()
      .from(queues)
      .where(eq(queues.showId, showId))
      .orderBy(asc(queues.position));
    const queueIds = queueRows.map((q) => q.id);
    const none = queueIds.length === 0;
    const [
      groupRows,
      itemRows,
      lockRows,
      requestRows,
      relationRows,
      suggestionRows,
      boardRows,
      sourceRows,
      messageRows,
    ] = await Promise.all([
      none ? [] : this.db.select().from(queueGroups).where(inArray(queueGroups.queueId, queueIds)),
      none
        ? []
        : this.db
            .select({ item: queueItems, timer: itemTimers })
            .from(queueItems)
            .leftJoin(itemTimers, eq(itemTimers.queueItemId, queueItems.id))
            .where(inArray(queueItems.queueId, queueIds)),
      this.db.select().from(locks).where(eq(locks.showId, showId)),
      this.db
        .select()
        .from(unlockRequests)
        .where(and(eq(unlockRequests.showId, showId), isNull(unlockRequests.resolvedAt))),
      this.db.select().from(itemRelations).where(eq(itemRelations.showId, showId)),
      this.db
        .select()
        .from(queueSuggestions)
        .where(and(eq(queueSuggestions.showId, showId), eq(queueSuggestions.status, 'pending'))),
      this.db.select().from(boards).where(eq(boards.showId, showId)).orderBy(asc(boards.createdAt)),
      this.db
        .select({ source: boardSources })
        .from(boardSources)
        .innerJoin(boards, eq(boards.id, boardSources.boardId))
        .where(eq(boards.showId, showId)),
      this.db
        .select()
        .from(messages)
        .where(and(eq(messages.showId, showId), isNull(messages.clearedAt))),
    ]);
    const sourcesByBoard = new Map<string, { queueId: string; position: number }[]>();
    for (const { source } of sourceRows) {
      const list = sourcesByBoard.get(source.boardId) ?? [];
      list.push({ queueId: source.queueId, position: source.position });
      sourcesByBoard.set(source.boardId, list);
    }
    return {
      showId: ShowId(show.id),
      title: show.title,
      revision: show.revision,
      primaryQueueId: QueueId(show.primaryQueueId),
      showWarning: ruleFromJson(show.warningRule),
      showSchedule: scheduleFromRow(show),
      queues: queueRows.map((q) => ({
        queue: queueFromRow(q),
        groups: groupRows.filter((g) => g.queueId === q.id).map(groupFromRow),
        items: itemRows
          .filter((r) => r.item.queueId === q.id)
          .map((r) => itemFromRow(r.item, r.timer)),
      })),
      locks: lockRows.map(lockFromRow),
      unlockRequests: requestRows
        .sort((a, b) => +a.requestedAt - +b.requestedAt)
        .map(requestFromRow),
      relations: relationRows.sort((a, b) => +a.createdAt - +b.createdAt).map(relationFromRow),
      suggestions: suggestionRows
        .sort((a, b) => +a.createdAt - +b.createdAt)
        .map(suggestionFromRow),
      boards: boardRows.map((b) => boardFromRow(b, sourcesByBoard.get(b.id) ?? [])),
      messages: messageRows.sort((a, b) => +a.createdAt - +b.createdAt).map(messageFromRow),
    };
  }

  /** Convenience: the single-Queue view of a Queue (tests, M2/M3 callers). */
  async loadQueue(queueId: QueueId | string): Promise<QueueAggregate | null> {
    const [row] = await this.db
      .select({ showId: queues.showId })
      .from(queues)
      .where(eq(queues.id, queueId))
      .limit(1);
    const show = row ? await this.loadShowAggregate(ShowId(row.showId)) : null;
    return show ? queueView(show, queueId) : null;
  }

  /**
   * One transaction: compare-and-set on the Show revision (also serializes concurrent writers
   * via the row lock), then write only what differs — Queues, Groups, Items, timers (each timer
   * compare-and-set on its own revision), locks, relations, suggestions, Boards, Messages — plus
   * the audit records. Any lost race rolls everything back.
   */
  async saveShowAggregate(
    prev: ShowAggregate,
    next: ShowAggregate,
    audit: readonly AuditRecord[] = [],
  ): Promise<Result<void, AppError>> {
    try {
      await this.db.transaction(async (tx) => {
        const claimed = await tx
          .update(shows)
          .set({ revision: next.revision })
          .where(and(eq(shows.id, prev.showId), eq(shows.revision, prev.revision)))
          .returning({ id: shows.id });
        if (claimed.length === 0) throw new RevisionConflict();

        // Queues: new ones first (items reference them); field changes later (current pointer).
        const prevQueues = new Map(prev.queues.map((q) => [q.queue.id, q.queue]));
        for (const q of next.queues) {
          if (!prevQueues.has(q.queue.id)) {
            await tx.insert(queues).values({ ...queueColumns(q.queue), currentItemId: null });
          }
        }

        const prevGroups = new Map(
          prev.queues.flatMap((q) => q.groups.map((g) => [g.id, g] as const)),
        );
        for (const group of next.queues.flatMap((q) => q.groups)) {
          const before = prevGroups.get(group.id);
          if (!before) await tx.insert(queueGroups).values(groupColumns(group));
          else if (before !== group) {
            await tx
              .update(queueGroups)
              .set(groupColumns(group))
              .where(eq(queueGroups.id, group.id));
          }
        }

        const prevItems = new Map(
          prev.queues.flatMap((q) => q.items.map((i) => [i.id, i] as const)),
        );
        const nextItems = next.queues.flatMap((q) => q.items);
        for (const item of nextItems) {
          const before = prevItems.get(item.id);
          if (!before) await tx.insert(queueItems).values(itemColumns(item));
          else if (before.revision !== item.revision || before.queueId !== item.queueId) {
            await tx.update(queueItems).set(itemColumns(item)).where(eq(queueItems.id, item.id));
          }
        }

        for (const change of changedTimers(prev, next)) {
          if (change.before === null && change.after !== null) {
            await tx.insert(itemTimers).values({
              queueItemId: change.id,
              ...timerColumns(change.after),
              updatedAt: new Date(),
            });
            continue;
          }
          if (change.before === null) continue;
          const guard = and(
            eq(itemTimers.queueItemId, change.id),
            eq(itemTimers.revision, change.before.revision),
          );
          const written =
            change.after === null
              ? await tx.delete(itemTimers).where(guard).returning({ id: itemTimers.queueItemId })
              : await tx
                  .update(itemTimers)
                  .set({ ...timerColumns(change.after), updatedAt: new Date() })
                  .where(guard)
                  .returning({ id: itemTimers.queueItemId });
          if (written.length === 0) throw new RevisionConflict();
        }

        // Relations (before removing items: their FKs cascade anyway).
        const prevRelations = new Map(prev.relations.map((r) => [r.id, r]));
        const nextRelationIds = new Set(next.relations.map((r) => r.id));
        for (const r of next.relations) {
          const before = prevRelations.get(r.id);
          if (!before) await tx.insert(itemRelations).values(relationColumns(next.showId, r));
          else if (before !== r) {
            await tx
              .update(itemRelations)
              .set(relationColumns(next.showId, r))
              .where(eq(itemRelations.id, r.id));
          }
        }
        const removedRelations = prev.relations
          .filter((r) => !nextRelationIds.has(r.id))
          .map((r) => r.id);
        if (removedRelations.length > 0) {
          await tx.delete(itemRelations).where(inArray(itemRelations.id, removedRelations));
        }

        const nextItemIds = new Set(nextItems.map((i) => i.id));
        const removedItems = [...prevItems.keys()].filter((id) => !nextItemIds.has(id));
        if (removedItems.length > 0)
          await tx.delete(queueItems).where(inArray(queueItems.id, removedItems));
        const nextGroupIds = new Set(next.queues.flatMap((q) => q.groups.map((g) => g.id)));
        const removedGroups = [...prevGroups.keys()].filter((id) => !nextGroupIds.has(id));
        if (removedGroups.length > 0)
          await tx.delete(queueGroups).where(inArray(queueGroups.id, removedGroups));

        for (const q of next.queues) {
          const before = prevQueues.get(q.queue.id);
          if (!before || before !== q.queue) {
            await tx.update(queues).set(queueColumns(q.queue)).where(eq(queues.id, q.queue.id));
          }
        }

        if (
          next.primaryQueueId !== prev.primaryQueueId ||
          next.showWarning !== prev.showWarning ||
          next.showSchedule !== prev.showSchedule
        ) {
          await tx
            .update(shows)
            .set({
              primaryQueueId: next.primaryQueueId,
              warningRule: ruleToJson(next.showWarning),
              ...scheduleColumns(next.showSchedule),
            })
            .where(eq(shows.id, next.showId));
        }

        const nextQueueIds = new Set(next.queues.map((q) => q.queue.id));
        const removedQueues = [...prevQueues.keys()].filter((id) => !nextQueueIds.has(id));

        // Locks and unlock requests.
        const queueOfTarget = (kind: string, id: string): string => {
          if (kind === 'queue') return id;
          if (kind === 'group')
            return (
              next.queues.find((q) => q.groups.some((g) => g.id === id))?.queue.id ??
              next.primaryQueueId
            );
          if (kind === 'item')
            return (
              next.queues.find((q) => q.items.some((i) => i.id === id))?.queue.id ??
              next.primaryQueueId
            );
          return next.primaryQueueId;
        };
        const prevLocks = new Set(prev.locks.map((l) => l.id));
        const nextLocks = new Set(next.locks.map((l) => l.id));
        const addedLocks = next.locks.filter((l) => !prevLocks.has(l.id));
        if (addedLocks.length > 0) {
          await tx.insert(locks).values(
            addedLocks.map((l) => ({
              id: l.id,
              showId: next.showId,
              queueId: queueOfTarget(l.target.kind, l.target.id),
              targetKind: l.target.kind,
              targetId: l.target.id,
              lockedAt: toDate(l.lockedAt),
              lockedByKind: l.lockedBy.kind,
              lockedById: l.lockedBy.id,
            })),
          );
        }
        const removedLocks = prev.locks.filter((l) => !nextLocks.has(l.id)).map((l) => l.id);
        if (removedLocks.length > 0) await tx.delete(locks).where(inArray(locks.id, removedLocks));
        const prevRequests = new Set(prev.unlockRequests.map((r) => r.id));
        const nextRequests = new Set(next.unlockRequests.map((r) => r.id));
        const addedRequests = next.unlockRequests.filter((r) => !prevRequests.has(r.id));
        if (addedRequests.length > 0) {
          await tx.insert(unlockRequests).values(
            addedRequests.map((r) => ({
              id: r.id,
              showId: next.showId,
              queueId: queueOfTarget(r.target.kind, r.target.id),
              lockId: r.lockId,
              targetKind: r.target.kind,
              targetId: r.target.id,
              requestedAt: toDate(r.requestedAt),
              requestedByKind: r.requestedBy.kind,
              requestedById: r.requestedBy.id,
              reason: r.reason,
            })),
          );
        }
        const resolved = prev.unlockRequests
          .filter((r) => !nextRequests.has(r.id))
          .map((r) => r.id);
        if (resolved.length > 0) {
          await tx
            .update(unlockRequests)
            .set({ resolvedAt: new Date() })
            .where(inArray(unlockRequests.id, resolved));
        }

        // Suggestions: new rows inserted; status changes recorded (resolved rows are kept).
        const prevSuggestions = new Map(prev.suggestions.map((x) => [x.id, x]));
        for (const x of next.suggestions) {
          const before = prevSuggestions.get(x.id);
          if (!before) await tx.insert(queueSuggestions).values(suggestionColumns(next.showId, x));
          else if (before.status !== x.status) {
            await tx
              .update(queueSuggestions)
              .set({ status: x.status, resolvedAt: toDateOrNull(x.resolvedAt) })
              .where(eq(queueSuggestions.id, x.id));
          }
        }
        const nextSuggestionIds = new Set(next.suggestions.map((x) => x.id));
        const droppedSuggestions = prev.suggestions
          .filter((x) => !nextSuggestionIds.has(x.id))
          .map((x) => x.id);
        if (droppedSuggestions.length > 0) {
          await tx
            .update(queueSuggestions)
            .set({ status: 'stale', resolvedAt: new Date() })
            .where(
              and(
                inArray(queueSuggestions.id, droppedSuggestions),
                eq(queueSuggestions.status, 'pending'),
              ),
            );
        }

        // Boards and their source bindings.
        const prevBoards = new Map(prev.boards.map((b) => [b.id, b]));
        for (const b of next.boards) {
          const before = prevBoards.get(b.id);
          if (!before) await tx.insert(boards).values(boardColumns(b));
          else if (before !== b)
            await tx.update(boards).set(boardColumns(b)).where(eq(boards.id, b.id));
          if (!before || before.sources !== b.sources) {
            await tx.delete(boardSources).where(eq(boardSources.boardId, b.id));
            if (b.sources.kind === 'queues' && b.sources.queueIds.length > 0) {
              await tx.insert(boardSources).values(
                b.sources.queueIds.map((queueId, position) => ({
                  boardId: b.id,
                  queueId,
                  position,
                })),
              );
            }
          }
        }
        const nextBoardIds = new Set(next.boards.map((b) => b.id));
        const removedBoards = prev.boards.filter((b) => !nextBoardIds.has(b.id)).map((b) => b.id);
        if (removedBoards.length > 0)
          await tx.delete(boards).where(inArray(boards.id, removedBoards));

        // Queues last: deleting one cascades its leftovers (sources, locks) after the moves above.
        if (removedQueues.length > 0)
          await tx.delete(queues).where(inArray(queues.id, removedQueues));

        // Messages.
        const prevMessages = new Map(prev.messages.map((m) => [m.id, m]));
        for (const m of next.messages) {
          const before = prevMessages.get(m.id);
          if (!before) await tx.insert(messages).values(messageColumns(next.showId, m));
          else if (before.clearedAt !== m.clearedAt) {
            await tx
              .update(messages)
              .set({ clearedAt: toDateOrNull(m.clearedAt) })
              .where(eq(messages.id, m.id));
          }
        }

        if (audit.length > 0) {
          await tx.insert(auditEvents).values(
            audit.map((a) => ({
              id: a.id,
              showId: a.showId,
              at: toDate(a.at),
              actorKind: a.actor.kind,
              actorId: a.actor.id,
              action: a.action,
              resourceKind: a.resource.kind,
              resourceId: a.resource.id,
              details: { ...a.details },
            })),
          );
        }
      });
      return ok(undefined);
    } catch (error) {
      if (error instanceof RevisionConflict) {
        return err({ code: 'revision_conflict', message: 'Show was modified concurrently' });
      }
      throw error;
    }
  }

  async listAudit(showId: ShowId, limit: number): Promise<readonly AuditRecord[]> {
    const rows = await this.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.showId, showId))
      .orderBy(desc(auditEvents.at), desc(auditEvents.seq))
      .limit(limit);
    return rows.map((r) => ({
      id: r.id,
      showId: ShowId(r.showId),
      at: toMs(r.at),
      actor: { kind: r.actorKind, id: r.actorId },
      action: r.action,
      resource: { kind: r.resourceKind, id: r.resourceId },
      details: r.details,
    }));
  }

  async touch(showId: ShowId, at: EpochMs): Promise<void> {
    await this.db
      .update(shows)
      .set({ lastActiveAt: toDate(at) })
      .where(eq(shows.id, showId));
  }

  async showIdOfItem(queueItemId: QueueItemId): Promise<ShowId | null> {
    const [row] = await this.db
      .select({ showId: queues.showId })
      .from(queueItems)
      .innerJoin(queues, eq(queues.id, queueItems.queueId))
      .where(eq(queueItems.id, queueItemId))
      .limit(1);
    return row ? ShowId(row.showId) : null;
  }

  async showIdOfBoard(boardId: BoardId): Promise<ShowId | null> {
    const [row] = await this.db
      .select({ showId: boards.showId })
      .from(boards)
      .where(eq(boards.id, boardId))
      .limit(1);
    return row ? ShowId(row.showId) : null;
  }

  async get(queueItemId: QueueItemId): Promise<TimerState | null> {
    const [row] = await this.db
      .select()
      .from(itemTimers)
      .where(eq(itemTimers.queueItemId, queueItemId))
      .limit(1);
    return row ? timerFromRow(row) : null;
  }

  async save(
    queueItemId: QueueItemId,
    next: TimerState,
    previousRevision: number,
  ): Promise<Result<void, AppError>> {
    const updated = await this.db
      .update(itemTimers)
      .set({ ...timerColumns(next), updatedAt: new Date() })
      .where(
        and(eq(itemTimers.queueItemId, queueItemId), eq(itemTimers.revision, previousRevision)),
      )
      .returning({ revision: itemTimers.revision });
    if (updated.length === 0) {
      return err({ code: 'revision_conflict', message: 'Timer was modified concurrently' });
    }
    return ok(undefined);
  }

  async create(record: NewGrantRecord): Promise<void> {
    await this.db.insert(accessGrants).values(grantColumns(record));
  }

  async findById(id: GrantId): Promise<AccessGrant | null> {
    const [row] = await this.db.select().from(accessGrants).where(eq(accessGrants.id, id)).limit(1);
    return row ? grantFromRow(row) : null;
  }

  async findByTokenHash(tokenHash: string): Promise<AccessGrant | null> {
    const [row] = await this.db
      .select()
      .from(accessGrants)
      .where(eq(accessGrants.tokenHash, tokenHash))
      .limit(1);
    return row ? grantFromRow(row) : null;
  }
}

/** Durable idempotency records (survive server restarts). */
export class PgIdempotencyStore implements IdempotencyStore {
  constructor(private readonly db: Database) {}

  async find(scope: string, key: string): Promise<StoredOutcome | null> {
    const [row] = await this.db
      .select()
      .from(idempotencyRecords)
      .where(and(eq(idempotencyRecords.scope, scope), eq(idempotencyRecords.key, key)))
      .limit(1);
    return row
      ? { fingerprint: row.fingerprint, result: row.result as StoredOutcome['result'] }
      : null;
  }

  async remember(scope: string, key: string, outcome: StoredOutcome): Promise<void> {
    await this.db
      .insert(idempotencyRecords)
      .values({ scope, key, fingerprint: outcome.fingerprint, result: outcome.result })
      .onConflictDoNothing();
  }
}
