import type {
  AccessGrant,
  ActorRef,
  BoardId,
  Device,
  DeviceId,
  EpochMs,
  EventAggregate,
  EventId,
  GrantId,
  PairingSession,
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
  | { readonly kind: 'board'; readonly id: string }
  | { readonly kind: 'event'; readonly id: string }
  | { readonly kind: 'device'; readonly id: string };

/** Owner scope of a Board or Device: a Show (and the Event it sits in) or an Event. */
export interface OwnerScope {
  readonly showId: ShowId | null;
  readonly eventId: EventId | null;
}

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
  /** M5: the Event a Show is placed in (null = standalone). */
  eventIdOfShow(showId: ShowId): Promise<EventId | null>;
  /** M5: owner of a Board (Show Board: its Show + that Show's Event; Event Board: the Event). */
  scopeOfBoard(boardId: BoardId): Promise<OwnerScope | null>;
  /** M5: scope of a Device (for a Show-scoped Device also the Event of that Show). */
  scopeOfDevice(deviceId: DeviceId): Promise<OwnerScope | null>;
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
  /** M5: persist a complete new Show (Show in Event, duplicate) and its grants atomically. */
  createShow(
    show: Show,
    aggregate: ShowAggregate,
    grants: readonly NewGrantRecord[],
    audit?: readonly AuditRecord[],
  ): Promise<void>;
}

/**
 * M5: Event persistence. The Event aggregate (Event, Rooms, Show placement, Event Boards,
 * Event/Room locks) is saved atomically with compare-and-set on the Event revision; placement
 * is written to the Shows (event/room/order) in the same transaction.
 */
export interface EventRepository {
  createEvent(agg: EventAggregate, grants: readonly NewGrantRecord[]): Promise<void>;
  loadEvent(eventId: EventId): Promise<EventAggregate | null>;
  saveEvent(
    prev: EventAggregate,
    next: EventAggregate,
    audit?: readonly AuditRecord[],
  ): Promise<Result<void, AppError>>;
}

/** M5: Devices and pairing sessions. Only hashes of codes, secrets and credentials are stored. */
export interface DeviceRepository {
  createPairing(session: PairingSession): Promise<void>;
  /** The newest PENDING session with this code (used/claimed codes are ignored). */
  findPairingByCodeHash(codeHash: string): Promise<PairingSession | null>;
  findPairingBySecretHash(secretHash: string): Promise<PairingSession | null>;
  /** Compare-and-set on the previous status (one-time pair / claim). */
  savePairing(prev: PairingSession, next: PairingSession): Promise<Result<void, AppError>>;
  createDevice(device: Device, audit?: readonly AuditRecord[]): Promise<void>;
  /** Pairing in ONE transaction: create the Device and mark the session paired (CAS on status). */
  pairDevice(
    prev: PairingSession,
    next: PairingSession,
    device: Device,
    audit?: readonly AuditRecord[],
  ): Promise<Result<void, AppError>>;
  findDevice(deviceId: DeviceId): Promise<Device | null>;
  findDeviceByCredentialHash(hash: string): Promise<Device | null>;
  listDevices(scope: OwnerScope): Promise<readonly Device[]>;
  /** Compare-and-set on the Device revision, with audit in the same transaction. */
  saveDevice(
    prev: Device,
    next: Device,
    audit?: readonly AuditRecord[],
  ): Promise<Result<void, AppError>>;
  setDeviceCredential(deviceId: DeviceId, credentialHash: string): Promise<void>;
  removeDevice(deviceId: DeviceId, audit?: readonly AuditRecord[]): Promise<void>;
  /** Presence history only (no revision bump). */
  touchDevice(deviceId: DeviceId, at: EpochMs): Promise<void>;
}

/** Live presence of Devices (the realtime server knows who is connected). */
export interface DevicePresence {
  isConnected(deviceId: string): boolean;
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
  /** Scope of the record: a Show and/or (M5) an Event. */
  readonly showId: ShowId | null;
  readonly eventId?: EventId | null;
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
  /** M5: Board share grants of a Show or an Event (including revoked ones). */
  listBoardShares(scope: OwnerScope): Promise<readonly AccessGrant[]>;
  /** M5: revoke a grant (sets revokedAt); audited in the same transaction. */
  revokeGrant(id: GrantId, at: EpochMs, audit?: readonly AuditRecord[]): Promise<void>;
  /** M5: persist a new grant together with its audit record. */
  createWithAudit(record: NewGrantRecord, audit: readonly AuditRecord[]): Promise<void>;
}

/**
 * Credential families: `owner` (anonymous Show owner), `event` (anonymous Event owner),
 * `board` (Board share), `device` (paired Device), `pairing` (display-side pairing secret).
 */
export type TokenKind = 'owner' | 'event' | 'board' | 'device' | 'pairing';

/**
 * Issues and hashes opaque high-entropy credentials. Implementations must use a CSPRNG and a
 * one-way hash; secrets are never persisted or logged.
 */
export interface TokenService {
  issue(kind: TokenKind): { readonly token: string; readonly hash: string };
  hash(token: string): string;
  /** Kind encoded in the token's prefix, or null when malformed. */
  kindOf(token: string): TokenKind | null;
  /** CSPRNG integer in [0, n) (pairing codes). */
  randomIndex(n: number): number;
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

/** M5: a committed change of an Event aggregate (structure, placement, Event Boards, locks). */
export interface EventChangedEvent {
  readonly type: 'event.changed';
  readonly eventId: EventId;
  /** Shows whose placement changed (their context/breadcrumb changed). */
  readonly showIds: readonly ShowId[];
  readonly occurredAt: EpochMs;
}

/** M5: Devices of a scope changed (paired, renamed, (re)assigned, revoked, removed, presence). */
export interface DevicesChangedEvent {
  readonly type: 'devices.changed';
  readonly scope: OwnerScope;
  /** Devices whose display must be refreshed (assignment) or cut off (revocation). */
  readonly deviceIds: readonly DeviceId[];
  readonly revoked: boolean;
  readonly occurredAt: EpochMs;
}

/** M5: a Board share credential was revoked; open connections must be closed. */
export interface AccessRevokedEvent {
  readonly type: 'access.revoked';
  readonly grantId: GrantId;
  readonly occurredAt: EpochMs;
}

export type ApplicationEvent =
  | TimerTransitionedEvent
  | ShowChangedEvent
  | EventChangedEvent
  | DevicesChangedEvent
  | AccessRevokedEvent;

/**
 * Receives committed transitions (realtime hub, future Actions). Delivery failures must never
 * roll back or block the core timer engine or Queue operation.
 */
export interface EventPublisher {
  publish(event: ApplicationEvent): Promise<void>;
}
