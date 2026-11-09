import {
  ok,
  type AccessGrant,
  type Board,
  type BoardId,
  type EpochMs,
  type GrantId,
  type QueueAggregate,
  type QueueId,
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
  QueueRepository,
  ShowRepository,
  TimerRepository,
  TokenKind,
  TokenService,
} from '../ports';
import { changedTimers } from '../queue';

type StoredQueue = Omit<QueueAggregate, 'showId' | 'showWarning' | 'showSchedule'>;

/**
 * In-memory implementation of every persistence port, sharing one store so Queues, timers and
 * grants stay consistent. For tests and for running the server without PostgreSQL.
 */
export class InMemoryStore
  implements ShowRepository, QueueRepository, TimerRepository, GrantRepository, AuditRepository
{
  readonly shows = new Map<string, Show>();
  readonly queues = new Map<string, StoredQueue>();
  readonly boards = new Map<string, Board>();
  readonly grants = new Map<string, { grant: AccessGrant; tokenHash: string }>();
  readonly audit: AuditRecord[] = [];

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
    this.shows.set(bundle.show.id, bundle.show);
    this.queues.set(bundle.queue.id, {
      queue: bundle.queue,
      groups: [],
      items: [bundle.item],
      locks: [],
      unlockRequests: [],
    });
    this.boards.set(bundle.board.id, bundle.board);
    for (const record of grants) this.grants.set(record.grant.id, record);
    return Promise.resolve();
  }

  getShow(showId: ShowId): Promise<Show | null> {
    return Promise.resolve(this.shows.get(showId) ?? null);
  }

  getBoard(boardId: BoardId): Promise<Board | null> {
    return Promise.resolve(this.boards.get(boardId) ?? null);
  }

  getBoardOfShow(showId: ShowId): Promise<Board | null> {
    return Promise.resolve([...this.boards.values()].find((b) => b.showId === showId) ?? null);
  }

  touch(showId: ShowId, at: EpochMs): Promise<void> {
    const show = this.shows.get(showId);
    if (show) this.shows.set(showId, { ...show, lastActiveAt: at });
    return Promise.resolve();
  }

  // --- Queue aggregate ------------------------------------------------------------------------

  loadQueue(queueId: QueueId): Promise<QueueAggregate | null> {
    const stored = this.queues.get(queueId);
    const show = stored ? this.shows.get(stored.queue.showId) : undefined;
    if (!stored || !show) return Promise.resolve(null);
    return Promise.resolve({
      showId: show.id,
      showWarning: show.warning,
      showSchedule: show.schedule,
      ...stored,
    });
  }

  saveQueue(
    prev: QueueAggregate,
    next: QueueAggregate,
    audit: readonly AuditRecord[] = [],
  ): Promise<Result<void, AppError>> {
    const stored = this.queues.get(prev.queue.id);
    if (stored?.queue.revision !== prev.queue.revision) {
      return Promise.resolve(appError('revision_conflict', 'Queue was modified concurrently'));
    }
    const storedTimers = new Map(stored.items.map((i) => [i.id, i.timer]));
    for (const change of changedTimers(prev, next)) {
      const current = storedTimers.get(change.id) ?? null;
      if ((current?.revision ?? null) !== (change.before?.revision ?? null)) {
        return Promise.resolve(appError('revision_conflict', 'Timer was modified concurrently'));
      }
    }
    // Timers unchanged by this command keep their stored (possibly newer) state.
    const touched = new Set(changedTimers(prev, next).map((c) => c.id));
    const items = next.items.map((item) =>
      touched.has(item.id) ? item : { ...item, timer: storedTimers.get(item.id) ?? item.timer },
    );
    this.queues.set(next.queue.id, {
      queue: next.queue,
      groups: next.groups,
      items,
      locks: next.locks,
      unlockRequests: next.unlockRequests,
    });
    this.audit.push(...audit);
    const show = this.shows.get(next.showId);
    if (show && (show.warning !== next.showWarning || show.schedule !== next.showSchedule)) {
      this.shows.set(show.id, { ...show, warning: next.showWarning, schedule: next.showSchedule });
    }
    return Promise.resolve(ok(undefined));
  }

  // --- Locator / timers -----------------------------------------------------------------------

  #findItem(queueItemId: QueueItemId) {
    for (const stored of this.queues.values()) {
      const item = stored.items.find((i) => i.id === queueItemId);
      if (item) return { stored, item };
    }
    return null;
  }

  showIdOfItem(queueItemId: QueueItemId): Promise<ShowId | null> {
    return Promise.resolve(this.#findItem(queueItemId)?.stored.queue.showId ?? null);
  }

  showIdOfBoard(boardId: BoardId): Promise<ShowId | null> {
    return Promise.resolve(this.boards.get(boardId)?.showId ?? null);
  }

  get(queueItemId: QueueItemId): Promise<TimerState | null> {
    return Promise.resolve(this.#findItem(queueItemId)?.item.timer ?? null);
  }

  save(
    queueItemId: QueueItemId,
    next: TimerState,
    previousRevision: number,
  ): Promise<Result<void, AppError>> {
    const found = this.#findItem(queueItemId);
    if (found?.item.timer?.revision !== previousRevision) {
      return Promise.resolve(appError('revision_conflict', 'Timer was modified concurrently'));
    }
    const { stored } = found;
    this.queues.set(stored.queue.id, {
      ...stored,
      items: stored.items.map((i) => (i.id === queueItemId ? { ...i, timer: next } : i)),
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
