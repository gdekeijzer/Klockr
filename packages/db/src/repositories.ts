import type {
  AppError,
  GrantRepository,
  IdempotencyStore,
  NewGrantRecord,
  ShowRepository,
  StoredOutcome,
  TimerRepository,
} from '@klockr/application';
import {
  BoardId,
  err,
  GrantId,
  ok,
  QueueId,
  QueueItemId,
  ShowId,
  type AccessGrant,
  type Board,
  type EpochMs,
  type GrantKind,
  type QueueItem,
  type QuickTimerShow,
  type Result,
  type Show,
  type TimerMode,
  type TimerState,
  type TimerStatus,
} from '@klockr/domain';
import { and, asc, eq } from 'drizzle-orm';
import type { Database } from './client';
import {
  accessGrants,
  boards,
  idempotencyRecords,
  itemTimers,
  queueItems,
  queues,
  shows,
} from './schema';

const toDate = (ms: EpochMs): Date => new Date(ms);
const toDateOrNull = (ms: EpochMs | null): Date | null => (ms === null ? null : new Date(ms));
const toMs = (d: Date): EpochMs => d.getTime();
const toMsOrNull = (d: Date | null): EpochMs | null => (d === null ? null : d.getTime());

type TimerRow = typeof itemTimers.$inferSelect;
type GrantRow = typeof accessGrants.$inferSelect;
type ShowRow = typeof shows.$inferSelect;

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
  };
}

/** PostgreSQL adapter for the Show/Timer/Grant persistence ports. */
export class PgShowStore implements ShowRepository, TimerRepository, GrantRepository {
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
      });
      await tx.insert(queues).values({
        id: queue.id,
        showId: queue.showId,
        name: queue.name,
        purpose: queue.purpose,
        position: queue.position,
      });
      await tx.insert(queueItems).values({
        id: item.id,
        queueId: item.queueId,
        title: item.title,
        position: item.position,
      });
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

  async getPrimaryItem(showId: ShowId): Promise<QueueItem | null> {
    const [row] = await this.db
      .select({ item: queueItems, timer: itemTimers })
      .from(shows)
      .innerJoin(queueItems, eq(queueItems.queueId, shows.primaryQueueId))
      .leftJoin(itemTimers, eq(itemTimers.queueItemId, queueItems.id))
      .where(eq(shows.id, showId))
      .orderBy(asc(queueItems.position))
      .limit(1);
    if (!row) return null;
    return {
      id: QueueItemId(row.item.id),
      queueId: QueueId(row.item.queueId),
      title: row.item.title,
      position: row.item.position,
      timer: row.timer ? timerFromRow(row.timer) : null,
    };
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
