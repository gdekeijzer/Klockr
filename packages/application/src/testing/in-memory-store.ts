import {
  ok,
  type AccessGrant,
  type Board,
  type BoardId,
  type EpochMs,
  type GrantId,
  queueView,
  type QueueAggregate,
  type QueueId,
  type QueueState,
  type ShowAggregate,
  type QueueItemId,
  type QuickTimerShow,
  type Result,
  type Show,
  type ShowId,
  type TimerState,
} from '@klockr/domain';
import { appError, type AppError } from '../errors';
import type {
  AuditRecord,
  AuditRepository,
  GrantRepository,
  IdGenerator,
  NewGrantRecord,
  ShowRepository,
  ShowStateRepository,
  TimerRepository,
  TokenKind,
  TokenService,
} from '../ports';
import { changedTimers } from '../queue';

/**
 * In-memory implementation of every persistence port, sharing one store so Shows, Queues,
 * timers and grants stay consistent. For tests and for running the server without PostgreSQL.
 * Like the PostgreSQL adapter it keeps only pending suggestions and uncleared messages.
 */
export class InMemoryStore
  implements ShowRepository, ShowStateRepository, TimerRepository, GrantRepository, AuditRepository
{
  readonly shows = new Map<string, Show>();
  readonly aggregates = new Map<string, ShowAggregate>();
  readonly grants = new Map<string, { grant: AccessGrant; tokenHash: string }>();
  readonly audit: AuditRecord[] = [];

  /** All Queues of all Shows (compatibility view for tests). */
  get queues(): Map<string, QueueState> {
    return new Map(
      [...this.aggregates.values()].flatMap((a) => a.queues.map((q) => [q.queue.id, q] as const)),
    );
  }

  /** All Boards of all Shows (compatibility view for tests). */
  get boards(): Map<string, Board> {
    return new Map(
      [...this.aggregates.values()].flatMap((a) => a.boards.map((b) => [b.id, b] as const)),
    );
  }

  listAudit(showId: ShowId, limit: number): Promise<readonly AuditRecord[]> {
    return Promise.resolve(
      this.audit
        .filter((a) => a.showId === showId)
        .slice()
        .reverse()
        .slice(0, limit),
    );
  }

  createQuickTimerShow(bundle: QuickTimerShow, grants: readonly NewGrantRecord[]): Promise<void> {
    const { show, queue, item, board } = bundle;
    this.shows.set(show.id, show);
    this.aggregates.set(show.id, {
      showId: show.id,
      title: show.title,
      revision: 0,
      primaryQueueId: show.primaryQueueId,
      showWarning: show.warning,
      showSchedule: show.schedule,
      queues: [{ queue, groups: [], items: [item] }],
      locks: [],
      unlockRequests: [],
      relations: [],
      suggestions: [],
      boards: [board],
      messages: [],
    });
    for (const record of grants) this.grants.set(record.grant.id, record);
    return Promise.resolve();
  }

  getShow(showId: ShowId): Promise<Show | null> {
    return Promise.resolve(this.shows.get(showId) ?? null);
  }

  touch(showId: ShowId, at: EpochMs): Promise<void> {
    const show = this.shows.get(showId);
    if (show) this.shows.set(showId, { ...show, lastActiveAt: at });
    return Promise.resolve();
  }

  // --- Show aggregate -------------------------------------------------------------------------

  loadShowAggregate(showId: ShowId): Promise<ShowAggregate | null> {
    return Promise.resolve(this.aggregates.get(showId) ?? null);
  }

  /** Convenience for tests: the single-Queue view of any Queue. */
  loadQueue(queueId: QueueId | string): Promise<QueueAggregate | null> {
    for (const show of this.aggregates.values()) {
      const view = queueView(show, queueId);
      if (view) return Promise.resolve(view);
    }
    return Promise.resolve(null);
  }

  saveShowAggregate(
    prev: ShowAggregate,
    next: ShowAggregate,
    audit: readonly AuditRecord[] = [],
  ): Promise<Result<void, AppError>> {
    const stored = this.aggregates.get(prev.showId);
    if (stored?.revision !== prev.revision) {
      return Promise.resolve(appError('revision_conflict', 'Show was modified concurrently'));
    }
    const storedTimers = new Map(
      stored.queues.flatMap((q) => q.items.map((i) => [i.id, i.timer] as const)),
    );
    const changes = changedTimers(prev, next);
    for (const change of changes) {
      const current = storedTimers.get(change.id) ?? null;
      if ((current?.revision ?? null) !== (change.before?.revision ?? null)) {
        return Promise.resolve(appError('revision_conflict', 'Timer was modified concurrently'));
      }
    }
    this.aggregates.set(next.showId, {
      ...next,
      suggestions: next.suggestions.filter((x) => x.status === 'pending'),
      messages: next.messages.filter((m) => m.clearedAt === null),
    });
    this.audit.push(...audit);
    const show = this.shows.get(next.showId);
    if (show) {
      this.shows.set(show.id, {
        ...show,
        warning: next.showWarning,
        schedule: next.showSchedule,
        primaryQueueId: next.primaryQueueId,
      });
    }
    return Promise.resolve(ok(undefined));
  }

  // --- Locator / timers (M0 timer kernel port) ------------------------------------------------

  #find(queueItemId: string) {
    for (const show of this.aggregates.values()) {
      for (const q of show.queues) {
        const item = q.items.find((i) => i.id === queueItemId);
        if (item) return { show, item };
      }
    }
    return null;
  }

  showIdOfItem(queueItemId: QueueItemId): Promise<ShowId | null> {
    return Promise.resolve(this.#find(queueItemId)?.show.showId ?? null);
  }

  showIdOfBoard(boardId: BoardId): Promise<ShowId | null> {
    for (const show of this.aggregates.values()) {
      if (show.boards.some((b) => b.id === boardId)) return Promise.resolve(show.showId);
    }
    return Promise.resolve(null);
  }

  get(queueItemId: QueueItemId): Promise<TimerState | null> {
    return Promise.resolve(this.#find(queueItemId)?.item.timer ?? null);
  }

  save(
    queueItemId: QueueItemId,
    next: TimerState,
    previousRevision: number,
  ): Promise<Result<void, AppError>> {
    const found = this.#find(queueItemId);
    if (found?.item.timer?.revision !== previousRevision) {
      return Promise.resolve(appError('revision_conflict', 'Timer was modified concurrently'));
    }
    const { show } = found;
    this.aggregates.set(show.showId, {
      ...show,
      revision: show.revision + 1,
      queues: show.queues.map((q) => ({
        ...q,
        items: q.items.map((i) => (i.id === queueItemId ? { ...i, timer: next } : i)),
      })),
    });
    return Promise.resolve(ok(undefined));
  }

  // --- Grants ---------------------------------------------------------------------------------

  create(record: NewGrantRecord): Promise<void> {
    this.grants.set(record.grant.id, record);
    return Promise.resolve();
  }

  findById(id: GrantId): Promise<AccessGrant | null> {
    return Promise.resolve(this.grants.get(id)?.grant ?? null);
  }

  findByTokenHash(tokenHash: string): Promise<AccessGrant | null> {
    const found = [...this.grants.values()].find((g) => g.tokenHash === tokenHash);
    return Promise.resolve(found?.grant ?? null);
  }

  revoke(id: GrantId, at: EpochMs): void {
    const record = this.grants.get(id);
    if (record) this.grants.set(id, { ...record, grant: { ...record.grant, revokedAt: at } });
  }
}

/** Deterministic token service for tests. Production uses a CSPRNG + SHA-256 (apps/server). */
export class FakeTokenService implements TokenService {
  #n = 0;

  /** `run` makes tokens unique across test runs that share a persistent database. */
  constructor(private readonly run = 'test') {}

  issue(kind: TokenKind): { token: string; hash: string } {
    const token = `${kind === 'owner' ? 'klo' : 'klb'}_${this.run}${String(++this.#n)}`;
    return { token, hash: this.hash(token) };
  }

  hash(token: string): string {
    return `fakehash:${token.split('').reverse().join('')}`;
  }

  kindOf(token: string): TokenKind | null {
    if (token.startsWith('klo_')) return 'owner';
    if (token.startsWith('klb_')) return 'board';
    return null;
  }
}

export class SequentialIds implements IdGenerator {
  #n = 0;

  uuid(): string {
    const hex = (++this.#n).toString(16).padStart(12, '0');
    return `00000000-0000-4000-8000-${hex}`;
  }
}
