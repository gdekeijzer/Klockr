import type {
  BoardStateSnapshot,
  DeviceCommandDto,
  DeviceDisplaySnapshot,
  DeviceListResponse,
  PairingClaimResponse,
  PairingStartResponse,
} from '@klockr/contracts';
import {
  assignBoard,
  BoardId,
  claimSession,
  createDevice,
  DeviceId,
  EventId,
  formatPairingCode,
  generatePairingCode,
  normalizePairingCode,
  ok,
  pairSession,
  renameDevice,
  revokeDevice,
  shouldWriteLastSeen,
  ShowId,
  startPairing as startPairingSession,
  type Board,
  type Device,
  type Permission,
} from '@klockr/domain';
import type { CommandContext } from '../command';
import { appError, type CommandResult } from '../errors';
import { stableStringify } from '../idempotency';
import type { AuditRecord, OwnerScope, ResourceRef } from '../ports';
import { toBoardSnapshot } from '../queue';
import { actorRef } from '../queue/mutate';
import { loadEventView, type PlatformDeps } from '../event/event-service';
import { deviceSnapshot, toEventBoardSnapshot } from '../event/projection';

const scopeResource = (scope: OwnerScope): ResourceRef =>
  scope.showId !== null
    ? { kind: 'show', id: scope.showId }
    : { kind: 'event', id: scope.eventId ?? '' };

const pairingCodeHash = (deps: PlatformDeps, code: string) =>
  deps.tokens.hash(`pairing-code:${code}`);

// --- Display side: pairing ------------------------------------------------------------------

/** A display asks for a pairing code. No credential is needed; codes are short-lived. */
export async function startPairing(deps: PlatformDeps): Promise<PairingStartResponse> {
  const now = deps.clock.now();
  let code = generatePairingCode((n) => deps.tokens.randomIndex(n));
  for (let i = 0; i < 5; i++) {
    const clash = await deps.deviceStore.findPairingByCodeHash(pairingCodeHash(deps, code));
    if (!clash || clash.status !== 'pending' || clash.expiresAt <= now) break;
    code = generatePairingCode((n) => deps.tokens.randomIndex(n));
  }
  const secret = deps.tokens.issue('pairing');
  const session = startPairingSession({
    id: deps.ids.uuid(),
    codeHash: pairingCodeHash(deps, code),
    secretHash: secret.hash,
    now,
  });
  await deps.deviceStore.createPairing(session);
  return {
    code: formatPairingCode(code),
    pairingSecret: secret.token,
    expiresAt: session.expiresAt,
  };
}

/**
 * The display collects its permanent credential after an operator paired it — exactly once.
 * `expired` covers expired, already claimed and unknown sessions (no detail for probing).
 */
export async function claimPairing(
  pairingSecret: string,
  deps: PlatformDeps,
): Promise<PairingClaimResponse | { readonly status: 'expired' }> {
  if (deps.tokens.kindOf(pairingSecret) !== 'pairing') return { status: 'expired' };
  const session = await deps.deviceStore.findPairingBySecretHash(deps.tokens.hash(pairingSecret));
  if (!session) return { status: 'expired' };
  const claimed = claimSession(session, deps.clock.now());
  if (!claimed.ok)
    return claimed.error.code === 'pending' ? { status: 'pending' } : { status: 'expired' };
  const saved = await deps.deviceStore.savePairing(session, claimed.value);
  if (!saved.ok) return { status: 'expired' };
  const credential = deps.tokens.issue('device');
  await deps.deviceStore.setDeviceCredential(claimed.value.deviceId, credential.hash);
  return { status: 'paired', deviceId: claimed.value.deviceId, deviceToken: credential.token };
}

/** Resolve a Device credential. Revoked or unknown -> null. Never a management actor. */
export async function authenticateDevice(
  token: string,
  deps: PlatformDeps,
): Promise<Device | null> {
  if (deps.tokens.kindOf(token) !== 'device') return null;
  const device = await deps.deviceStore.findDeviceByCredentialHash(deps.tokens.hash(token));
  return device && device.revokedAt === null ? device : null;
}

/** Presence history: written on connect/disconnect and sparsely while connected. */
export async function recordDevicePresence(
  device: Device,
  force: boolean,
  deps: PlatformDeps,
): Promise<void> {
  const now = deps.clock.now();
  if (shouldWriteLastSeen(device, now, force)) await deps.deviceStore.touchDevice(device.id, now);
}

// --- Board resolution shared by Board shares and Devices -------------------------------------

/** Boards a Device / share in this scope may show: the scope's own Boards and its Shows' Boards. */
export async function boardsInScope(
  scope: OwnerScope,
  deps: PlatformDeps,
): Promise<{ board: Board; owner: string }[]> {
  if (scope.showId !== null) {
    const show = await deps.state.loadShowAggregate(scope.showId);
    return show ? show.boards.map((board) => ({ board, owner: show.title })) : [];
  }
  const view = scope.eventId ? await loadEventView(scope.eventId, deps) : null;
  if (!view) return [];
  return [
    ...view.agg.boards.map((board) => ({ board, owner: view.agg.event.name })),
    ...[...view.shows.values()].flatMap((s) =>
      s.boards.map((board) => ({ board, owner: s.title })),
    ),
  ];
}

/** Server-side scoped projection of any Board (Show Board or Event/Room Board). */
export async function boardSnapshotOf(
  boardId: string,
  deps: PlatformDeps,
): Promise<BoardStateSnapshot | null> {
  const scope = await deps.locator.scopeOfBoard(BoardId(boardId));
  if (!scope) return null;
  const now = deps.clock.now();
  if (scope.showId !== null) {
    const show = await deps.state.loadShowAggregate(scope.showId);
    const board = show?.boards.find((b) => b.id === boardId);
    return show && board ? toBoardSnapshot(board, show, now) : null;
  }
  const view = scope.eventId ? await loadEventView(scope.eventId, deps) : null;
  const board = view?.agg.boards.find((b) => b.id === boardId);
  return view && board ? toEventBoardSnapshot(board, view.agg, view.shows, now) : null;
}

/** Management preview of a Board owned by this scope (Show Board or Event/Room Board). */
export async function previewScopedBoard(
  scope: OwnerScope,
  boardId: string,
  context: CommandContext,
  deps: PlatformDeps,
): Promise<CommandResult<BoardStateSnapshot>> {
  if (!(await deps.authorizer.can(context.actor, 'board.manage', scopeResource(scope)))) {
    return appError('forbidden', 'Not permitted to manage Boards here');
  }
  if (!(await boardWithinScope(boardId, scope, deps)))
    return appError('not_found', 'Board not found');
  const snapshot = await boardSnapshotOf(boardId, deps);
  return snapshot ? ok(snapshot) : appError('not_found', 'Board not found');
}

/** Board read for a Board share credential (Show Board or Event/Room Board). */
export async function readSharedBoard(
  boardId: string,
  context: CommandContext,
  deps: PlatformDeps,
): Promise<CommandResult<BoardStateSnapshot>> {
  if (!(await deps.authorizer.can(context.actor, 'board.read', { kind: 'board', id: boardId }))) {
    return appError('forbidden', 'Not permitted to read this Board');
  }
  const snapshot = await boardSnapshotOf(boardId, deps);
  return snapshot ? ok(snapshot) : appError('not_found', 'Board not found');
}

/** Is the Board (still) inside the Device's scope? Guards against stale assignments. */
async function boardWithinScope(boardId: string, scope: OwnerScope, deps: PlatformDeps) {
  const boardScope = await deps.locator.scopeOfBoard(BoardId(boardId));
  if (!boardScope) return false;
  if (scope.showId !== null) return boardScope.showId === scope.showId;
  return boardScope.eventId !== null && boardScope.eventId === scope.eventId;
}

/** What a paired Device shows: only its assigned Board's scoped projection. */
export async function getDeviceDisplay(
  device: Device,
  deps: PlatformDeps,
): Promise<DeviceDisplaySnapshot> {
  const scope = { showId: device.scope.showId, eventId: device.scope.eventId };
  const board =
    device.assignedBoardId && (await boardWithinScope(device.assignedBoardId, scope, deps))
      ? await boardSnapshotOf(device.assignedBoardId, deps)
      : null;
  return { device: { id: device.id, name: device.name }, board, serverTime: deps.clock.now() };
}

// --- Management side ------------------------------------------------------------------------

export async function listDevices(
  scope: OwnerScope,
  context: CommandContext,
  deps: PlatformDeps,
): Promise<CommandResult<DeviceListResponse>> {
  if (!(await deps.authorizer.can(context.actor, 'device.read', scopeResource(scope)))) {
    return appError('forbidden', 'Not permitted to read Devices here');
  }
  return ok(await deviceList(scope, deps));
}

/** Device list of a scope without an authorization check (realtime fan-out to managers). */
export async function deviceList(
  scope: OwnerScope,
  deps: PlatformDeps,
): Promise<DeviceListResponse> {
  const [devices, boards] = await Promise.all([
    deps.deviceStore.listDevices(scope),
    boardsInScope(scope, deps),
  ]);
  const names = new Map(boards.map(({ board, owner }) => [board.id, `${owner}: ${board.name}`]));
  const now = deps.clock.now();
  return {
    devices: devices.map((d) => deviceSnapshot(d, deps.presence, names, now)),
    assignableBoards: boards.map(({ board, owner }) => ({
      id: board.id,
      name: board.name,
      owner,
      preset: board.preset,
    })),
  };
}

const PERMISSION: Readonly<Record<DeviceCommandDto['type'], Permission>> = {
  'device.pair': 'device.pair',
  'device.rename': 'device.manage',
  'device.assign': 'device.manage',
  'device.revoke': 'device.manage',
  'device.remove': 'device.manage',
};

/**
 * Device management commands within one scope (an Event or a standalone Show). Pairing never
 * involves a password on the display; assignment only to Boards inside the scope; revocation
 * is final and cuts open connections (`devices.changed` with `revoked`).
 */
export async function executeDeviceCommand(
  scope: OwnerScope,
  command: DeviceCommandDto,
  context: CommandContext,
  deps: PlatformDeps,
): Promise<CommandResult<DeviceListResponse & { createdId: string | null }>> {
  if (!(await deps.authorizer.can(context.actor, PERMISSION[command.type], scopeResource(scope)))) {
    return appError('forbidden', 'Not permitted to manage Devices here');
  }
  const actorKey = `${context.actor.kind}:${context.actor.id}`;
  const fingerprint = stableStringify({ scope, type: command.type, intent: command.payload });
  if (command.idempotencyKey !== undefined) {
    const stored = await deps.idempotency.find(actorKey, command.idempotencyKey);
    if (stored) {
      if (stored.fingerprint !== fingerprint) {
        return appError('idempotency_conflict', 'Idempotency key was used for a different command');
      }
      return stored.result as CommandResult<DeviceListResponse & { createdId: string | null }>;
    }
  }
  const now = deps.clock.now();
  const audit = (
    action: string,
    deviceId: string,
    details: Record<string, unknown>,
  ): AuditRecord => ({
    id: deps.ids.uuid(),
    showId: scope.showId,
    eventId: scope.eventId,
    at: now,
    actor: actorRef(context.actor),
    action,
    resource: { kind: 'device', id: deviceId },
    details,
  });
  const inScope = (device: Device | null): device is Device =>
    device !== null &&
    (scope.showId !== null
      ? device.scope.showId === scope.showId
      : device.scope.eventId === scope.eventId);
  const checkBoard = async (boardId: string | null | undefined) =>
    !boardId || (await boardWithinScope(boardId, scope, deps));

  let createdId: string | null = null;
  let changed: { deviceIds: string[]; revoked: boolean } = { deviceIds: [], revoked: false };

  if (command.type === 'device.pair') {
    const code = normalizePairingCode(command.payload.code);
    const session = code
      ? await deps.deviceStore.findPairingByCodeHash(pairingCodeHash(deps, code))
      : null;
    if (!session || session.status !== 'pending' || session.expiresAt <= now) {
      return appError('validation_failed', 'Unknown or expired pairing code');
    }
    if (!(await checkBoard(command.payload.boardId))) {
      return appError('validation_failed', 'That Board is not available here');
    }
    const device = createDevice({
      id: DeviceId(deps.ids.uuid()),
      scope: {
        showId: scope.showId ? ShowId(scope.showId) : null,
        eventId: scope.showId ? null : scope.eventId ? EventId(scope.eventId) : null,
      },
      name: command.payload.name,
      assignedBoardId: command.payload.boardId ? BoardId(command.payload.boardId) : null,
      now,
    });
    if (!device.ok) return appError('validation_failed', device.error.reason);
    const paired = pairSession(session, device.value.id, now);
    if (!paired.ok) return appError('validation_failed', 'Unknown or expired pairing code');
    const saved = await deps.deviceStore.pairDevice(session, paired.value, device.value, [
      audit('device.pair', device.value.id, {
        name: device.value.name,
        boardId: device.value.assignedBoardId,
      }),
    ]);
    if (!saved.ok) return appError('validation_failed', 'Unknown or expired pairing code');
    createdId = device.value.id;
    changed = { deviceIds: [device.value.id], revoked: false };
  } else {
    const device = await deps.deviceStore.findDevice(DeviceId(command.payload.deviceId));
    if (!inScope(device)) return appError('not_found', 'Device not found');
    if (command.expectedRevision !== undefined && command.expectedRevision !== device.revision) {
      return appError('revision_conflict', 'Device has changed since it was read');
    }
    if (command.type === 'device.remove') {
      if (device.revokedAt === null) {
        return appError('validation_failed', 'Revoke the Device before removing it');
      }
      await deps.deviceStore.removeDevice(device.id, [
        audit('device.remove', device.id, { name: device.name }),
      ]);
    } else {
      let next;
      let record: AuditRecord;
      switch (command.type) {
        case 'device.rename':
          next = renameDevice(device, command.payload.name);
          record = audit('device.rename', device.id, {
            from: device.name,
            to: command.payload.name,
          });
          break;
        case 'device.assign':
          if (!(await checkBoard(command.payload.boardId))) {
            return appError('validation_failed', 'That Board is not available here');
          }
          next = assignBoard(
            device,
            command.payload.boardId ? BoardId(command.payload.boardId) : null,
          );
          record = audit(device.assignedBoardId ? 'device.reassign' : 'device.assign', device.id, {
            from: device.assignedBoardId,
            to: command.payload.boardId,
          });
          break;
        case 'device.revoke':
          next = revokeDevice(device, now);
          record = audit('device.revoke', device.id, { name: device.name });
          break;
      }
      if (!next.ok) return appError('validation_failed', next.error.reason);
      const saved = await deps.deviceStore.saveDevice(device, next.value, [record]);
      if (!saved.ok) return saved;
      changed = { deviceIds: [device.id], revoked: command.type === 'device.revoke' };
    }
  }

  const result = ok({ ...(await deviceList(scope, deps)), createdId });
  if (command.idempotencyKey !== undefined) {
    await deps.idempotency.remember(actorKey, command.idempotencyKey, { fingerprint, result });
  }
  try {
    await deps.events.publish({
      type: 'devices.changed',
      scope,
      deviceIds: changed.deviceIds.map(DeviceId),
      revoked: changed.revoked,
      occurredAt: now,
    });
  } catch (error) {
    deps.onPublishError?.(error);
  }
  return result;
}
