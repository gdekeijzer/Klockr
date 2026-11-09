import {
  ok,
  type AccessGrant,
  type Board,
  type BoardId,
  type EpochMs,
  type GrantId,
  type Queue,
  type QueueItem,
  type QueueItemId,
  type QuickTimerShow,
  type Result,
  type Show,
  type ShowId,
  type TimerState,
} from '@klockr/domain';
import { appError, type AppError } from '../errors';
import type {
  GrantRepository,
  IdGenerator,
  NewGrantRecord,
  ShowRepository,
  TimerRepository,
  TokenKind,
  TokenService,
} from '../ports';

/**
 * In-memory implementation of every persistence port, sharing one store so timers, items and
 * grants stay consistent. For tests and for running the server without PostgreSQL.
 */
export class InMemoryStore implements ShowRepository, TimerRepository, GrantRepository {
  readonly shows = new Map<string, Show>();
  readonly queues = new Map<string, Queue>();
  readonly items = new Map<string, QueueItem>();
  readonly boards = new Map<string, Board>();
  readonly grants = new Map<string, { grant: AccessGrant; tokenHash: string }>();

  createQuickTimerShow(bundle: QuickTimerShow, grants: readonly NewGrantRecord[]): Promise<void> {
    this.shows.set(bundle.show.id, bundle.show);
    this.queues.set(bundle.queue.id, bundle.queue);
    this.items.set(bundle.item.id, bundle.item);
    this.boards.set(bundle.board.id, bundle.board);
    for (const record of grants) this.grants.set(record.grant.id, record);
    return Promise.resolve();
  }

  getShow(showId: ShowId): Promise<Show | null> {
    return Promise.resolve(this.shows.get(showId) ?? null);
  }

  getPrimaryItem(showId: ShowId): Promise<QueueItem | null> {
    const show = this.shows.get(showId);
    if (!show) return Promise.resolve(null);
    const items = [...this.items.values()]
      .filter((i) => i.queueId === show.primaryQueueId)
      .sort((a, b) => a.position - b.position);
    return Promise.resolve(items[0] ?? null);
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

  showIdOfItem(queueItemId: QueueItemId): Promise<ShowId | null> {
    const item = this.items.get(queueItemId);
    const queue = item ? this.queues.get(item.queueId) : undefined;
    return Promise.resolve(queue?.showId ?? null);
  }

  showIdOfBoard(boardId: BoardId): Promise<ShowId | null> {
    return Promise.resolve(this.boards.get(boardId)?.showId ?? null);
  }

  get(queueItemId: QueueItemId): Promise<TimerState | null> {
    return Promise.resolve(this.items.get(queueItemId)?.timer ?? null);
  }

  save(
    queueItemId: QueueItemId,
    next: TimerState,
    previousRevision: number,
  ): Promise<Result<void, AppError>> {
    const item = this.items.get(queueItemId);
    if (item?.timer?.revision !== previousRevision) {
      return Promise.resolve(appError('revision_conflict', 'Timer was modified concurrently'));
    }
    this.items.set(queueItemId, { ...item, timer: next });
    return Promise.resolve(ok(undefined));
  }

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
