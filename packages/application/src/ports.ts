import type {
  AccessGrant,
  ActorRef,
  BoardId,
  EpochMs,
  GrantId,
  Permission,
  ShowAggregate,
  QueueItemId,
  QuickTimerShow,
  Result,
  Show,
  ShowId,
  TimerState,
} from '@klockr/domain';
import type { Actor } from './command';
import type { AppError, CommandResult } from './errors';

export type { Permission } from '@klockr/domain';

export type ResourceRef =
  | { readonly kind: 'queueItem'; readonly id: string }
  | { readonly kind: 'show'; readonly id: string }
  | { readonly kind: 'board'; readonly id: string };

/** Capabilities are checked, never role names. Roles/grant kinds are bundles of these. */
export interface Authorizer {
  can(actor: Actor, permission: Permission, resource: ResourceRef): Promise<boolean>;
}

export interface TimerRepository {
  get(queueItemId: QueueItemId): Promise<TimerState | null>;
  /**
   * Persist `next` only if the stored revision still equals `previousRevision` (compare-and-set).
   * Returns `revision_conflict` otherwise, so concurrent writers can never overwrite newer state.
   */
  save(
    queueItemId: QueueItemId,
    next: TimerState,
    previousRevision: number,
  ): Promise<Result<void, AppError>>;
}

/** Resolves which Show owns an item/board. Used for scoping and event routing. */
export interface ShowLocator {
  showIdOfItem(queueItemId: QueueItemId): Promise<ShowId | null>;
  showIdOfBoard(boardId: BoardId): Promise<ShowId | null>;
}

/** Durable record of a newly issued credential. Only the hash of the secret is stored. */
export interface NewGrantRecord {
  readonly grant: AccessGrant;
  readonly tokenHash: string;
}

export interface ShowRepository extends ShowLocator {
  /** Persist all parts of a new Quick Timer Show and its grants atomically. */
  createQuickTimerShow(bundle: QuickTimerShow, grants: readonly NewGrantRecord[]): Promise<void>;
  getShow(showId: ShowId): Promise<Show | null>;
  /** Record management activity (feeds anonymous lifecycle/cleanup protection). */
  touch(showId: ShowId, at: EpochMs): Promise<void>;
}

/**
 * Show persistence (M4 consistency boundary): all peer Queues with Groups, Items and timers,
 * locks, relations, pending suggestions, Boards and active Messages.
 */
export interface ShowStateRepository {
  loadShowAggregate(showId: ShowId): Promise<ShowAggregate | null>;
  /**
   * Atomically persist `next` in one transaction: only if the stored Show revision still equals
   * `prev.revision` and every timer that differs still has its `prev` revision (compare-and-set).
   * Writes only what differs, plus the given audit records. Otherwise `revision_conflict`.
   */
  saveShowAggregate(
    prev: ShowAggregate,
    next: ShowAggregate,
    audit?: readonly AuditRecord[],
  ): Promise<Result<void, AppError>>;
}

/**
 * Persistent audit record of an operationally important change (locks, Emergency Override,
 * planning, anchors, timing mode). Written in the SAME transaction as the change it describes.
 */
export interface AuditRecord {
  readonly id: string;
  readonly showId: ShowId;
  readonly at: EpochMs;
  readonly actor: ActorRef;
  readonly action: string;
  readonly resource: { readonly kind: string; readonly id: string };
  readonly details: Readonly<Record<string, unknown>>;
}

export interface AuditRepository {
  /** Newest first. */
  listAudit(showId: ShowId, limit: number): Promise<readonly AuditRecord[]>;
}

export interface GrantRepository {
  create(record: NewGrantRecord): Promise<void>;
  findById(id: GrantId): Promise<AccessGrant | null>;
  findByTokenHash(tokenHash: string): Promise<AccessGrant | null>;
}

export type TokenKind = 'owner' | 'board';

/**
 * Issues and hashes opaque high-entropy credentials. Implementations must use a CSPRNG and a
 * one-way hash; secrets are never persisted or logged.
 */
export interface TokenService {
  issue(kind: TokenKind): { readonly token: string; readonly hash: string };
  hash(token: string): string;
  /** Kind encoded in the token's prefix, or null when malformed. */
  kindOf(token: string): TokenKind | null;
}

export interface IdGenerator {
  uuid(): string;
}

export interface StoredOutcome {
  /** Fingerprint of the command intent (type + payload) the key was first used with. */
  readonly fingerprint: string;
  readonly result: CommandResult<unknown>;
}

export interface IdempotencyStore {
  find(scope: string, key: string): Promise<StoredOutcome | null>;
  remember(scope: string, key: string, outcome: StoredOutcome): Promise<void>;
}

export interface TimerTransitionedEvent {
  readonly type: 'timer.transitioned';
  readonly commandId: string;
  readonly commandType: string;
  readonly showId: ShowId;
  readonly queueItemId: QueueItemId;
  readonly state: TimerState;
  readonly occurredAt: EpochMs;
}

/** A committed change of the Show aggregate (any Queue, relations, suggestions, Boards, Messages). */
export interface ShowChangedEvent {
  readonly type: 'show.changed';
  readonly commandId: string;
  readonly commandType: string;
  readonly showId: ShowId;
  readonly show: ShowAggregate;
  readonly occurredAt: EpochMs;
}

export type ApplicationEvent = TimerTransitionedEvent | ShowChangedEvent;

/**
 * Receives committed transitions (realtime hub, future Actions). Delivery failures must never
 * roll back or block the core timer engine or Queue operation.
 */
export interface EventPublisher {
  publish(event: ApplicationEvent): Promise<void>;
}
