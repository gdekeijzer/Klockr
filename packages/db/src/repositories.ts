import {
  changedTimers,
  type AppError,
  type GrantRepository,
  type IdempotencyStore,
  type NewGrantRecord,
  type QueueRepository,
  type ShowRepository,
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
  type QueueAggregate,
  type QueueItem,
  type QuickTimerShow,
  type Result,
  type Show,
  type StartMode,
  type TimerMode,
  type TimerState,
  type TimerStatus,
  type TimerThresholds,
} from '@klockr/domain';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { Database } from './client';
import {
  accessGrants,
  boards,
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
  };
}

/** PostgreSQL adapter for the Show/Queue/Timer/Grant persistence ports. */
export class PgShowStore
  implements ShowRepository, QueueRepository, TimerRepository, GrantRepository
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
      });
      await tx.insert(queues).values({
        id: queue.id,
        showId: queue.showId,
        name: queue.name,
        purpose: queue.purpose,
        position: queue.position,
        warningRule: ruleToJsonOrNull(queue.warning),
        revision: queue.revision,
      });
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
      await tx.insert(boards).values({
        id: board.id,
        showId: board.showId,
        preset: board.preset,
        createdAt: toDate(board.createdAt),
      });
      if (grants.length > 0) await tx.insert(accessGrants).values(grants.map(grantColumns));
    });
  }

  async getShow(showId: ShowId): Promise<Show | null> {
    const [row] = await this.db.select().from(shows).where(eq(shows.id, showId)).limit(1);
    return row ? showFromRow(row) : null;
  }

  async loadQueue(queueId: QueueId): Promise<QueueAggregate | null> {
    const [head] = await this.db
      .select({ queue: queues, showWarning: shows.warningRule })
      .from(queues)
      .innerJoin(shows, eq(shows.id, queues.showId))
      .where(eq(queues.id, queueId))
      .limit(1);
    if (!head) return null;
    const [groupRows, itemRows] = await Promise.all([
      this.db.select().from(queueGroups).where(eq(queueGroups.queueId, queueId)),
      this.db
        .select({ item: queueItems, timer: itemTimers })
        .from(queueItems)
        .leftJoin(itemTimers, eq(itemTimers.queueItemId, queueItems.id))
        .where(eq(queueItems.queueId, queueId)),
    ]);
    const q = head.queue;
    return {
      showId: ShowId(q.showId),
      showWarning: ruleFromJson(head.showWarning),
      queue: {
        id: QueueId(q.id),
        showId: ShowId(q.showId),
        name: q.name,
        purpose: 'program',
        position: q.position,
        currentItemId: q.currentItemId === null ? null : QueueItemId(q.currentItemId),
        warning: ruleOrNull(q.warningRule),
        revision: q.revision,
      },
      groups: groupRows.map(groupFromRow),
      items: itemRows.map((r) => itemFromRow(r.item, r.timer)),
    };
  }

  /**
   * One transaction: compare-and-set on the Queue revision (also serializes concurrent Queue
   * writers via the row lock), then write only what differs — groups, items, timers (each timer
   * compare-and-set on its own revision) — and finally the current pointer. Any lost race rolls
   * everything back, so END + NEXT is all-or-nothing.
   */
  async saveQueue(prev: QueueAggregate, next: QueueAggregate): Promise<Result<void, AppError>> {
    try {
      await this.db.transaction(async (tx) => {
        const claimed = await tx
          .update(queues)
          .set({ revision: next.queue.revision })
          .where(and(eq(queues.id, prev.queue.id), eq(queues.revision, prev.queue.revision)))
          .returning({ id: queues.id });
        if (claimed.length === 0) throw new RevisionConflict();

        if (next.showWarning !== prev.showWarning) {
          await tx
            .update(shows)
            .set({ warningRule: ruleToJson(next.showWarning) })
            .where(eq(shows.id, next.showId));
        }

        const prevGroups = new Map(prev.groups.map((g) => [g.id, g]));
        for (const group of next.groups) {
          const before = prevGroups.get(group.id);
          if (!before) await tx.insert(queueGroups).values(groupColumns(group));
          else if (before !== group) {
            await tx
              .update(queueGroups)
              .set(groupColumns(group))
              .where(eq(queueGroups.id, group.id));
          }
        }

        const prevItems = new Map(prev.items.map((i) => [i.id, i]));
        for (const item of next.items) {
          const before = prevItems.get(item.id);
          if (!before) await tx.insert(queueItems).values(itemColumns(item));
          else if (before.revision !== item.revision) {
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

        const nextItemIds = new Set(next.items.map((i) => i.id));
        const removedItems = prev.items.filter((i) => !nextItemIds.has(i.id)).map((i) => i.id);
        if (removedItems.length > 0) {
          await tx.delete(queueItems).where(inArray(queueItems.id, removedItems));
        }
        const nextGroupIds = new Set(next.groups.map((g) => g.id));
        const removedGroups = prev.groups.filter((g) => !nextGroupIds.has(g.id)).map((g) => g.id);
        if (removedGroups.length > 0) {
          await tx.delete(queueGroups).where(inArray(queueGroups.id, removedGroups));
        }

        if (
          next.queue.currentItemId !== prev.queue.currentItemId ||
          next.queue.warning !== prev.queue.warning
        ) {
          await tx
            .update(queues)
            .set({
              currentItemId: next.queue.currentItemId,
              warningRule: ruleToJsonOrNull(next.queue.warning),
            })
            .where(eq(queues.id, next.queue.id));
        }
      });
      return ok(undefined);
    } catch (error) {
      if (error instanceof RevisionConflict) {
        return err({ code: 'revision_conflict', message: 'Queue was modified concurrently' });
      }
      throw error;
    }
  }

  async getBoard(boardId: BoardId): Promise<Board | null> {
    const [row] = await this.db.select().from(boards).where(eq(boards.id, boardId)).limit(1);
    return row
      ? {
          id: BoardId(row.id),
          showId: ShowId(row.showId),
          preset: 'speaker',
          createdAt: toMs(row.createdAt),
        }
      : null;
  }

  async getBoardOfShow(showId: ShowId): Promise<Board | null> {
    const [row] = await this.db
      .select()
      .from(boards)
      .where(eq(boards.showId, showId))
      .orderBy(asc(boards.createdAt))
      .limit(1);
    return row
      ? {
          id: BoardId(row.id),
          showId: ShowId(row.showId),
          preset: 'speaker',
          createdAt: toMs(row.createdAt),
        }
      : null;
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
    const board = await this.getBoard(boardId);
    return board?.showId ?? null;
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
