import type { BoardId, DeviceId, EventId, ShowId } from '../ids';
import { err, ok, type Result } from '../result';
import type { EpochMs } from '../time';

/**
 * A Device is a managed physical/logical display client (Speaker Monitor, FOH screen, hallway
 * signage). It is NOT a Board: it only has identity, pairing, connectivity and ONE assigned
 * Board. The Board alone decides audience, sources, components and messages. A Device can never
 * mutate a Show; its credential is read-only presentation access, separate from user/owner
 * credentials and from Board share links.
 */
export interface DeviceScope {
  /** Exactly one of both: an Event (all its Shows/Boards) or one standalone Show. */
  readonly eventId: EventId | null;
  readonly showId: ShowId | null;
}

export interface Device {
  readonly id: DeviceId;
  readonly scope: DeviceScope;
  readonly name: string;
  readonly assignedBoardId: BoardId | null;
  readonly createdAt: EpochMs;
  /** Updated on connect/disconnect and at most every LAST_SEEN_WRITE_INTERVAL_MS while online. */
  readonly lastSeenAt: EpochMs | null;
  readonly revokedAt: EpochMs | null;
  readonly revision: number;
}

export type DeviceStatus = 'online' | 'recently_seen' | 'offline' | 'never_connected' | 'revoked';

/** A device seen within this window (but not connected now) is "recently seen". */
export const RECENTLY_SEEN_MS = 15 * 60_000;
/** While a device stays connected, `lastSeenAt` is persisted at most this often. */
export const LAST_SEEN_WRITE_INTERVAL_MS = 5 * 60_000;

/** Derived, never stored: live presence comes from the realtime server, history from lastSeen. */
export function deviceStatus(device: Device, connected: boolean, now: EpochMs): DeviceStatus {
  if (device.revokedAt !== null) return 'revoked';
  if (connected) return 'online';
  if (device.lastSeenAt === null) return 'never_connected';
  return now - device.lastSeenAt <= RECENTLY_SEEN_MS ? 'recently_seen' : 'offline';
}

export type DeviceError =
  | { readonly code: 'invalid'; readonly reason: string }
  | { readonly code: 'revoked'; readonly reason: string };

const invalid = (reason: string) => err<DeviceError>({ code: 'invalid', reason });

function validName(name: string): Result<string, DeviceError> {
  const v = name.trim();
  return v.length === 0 || v.length > 80 ? invalid('device name must be 1-80 characters') : ok(v);
}

export function createDevice(input: {
  readonly id: DeviceId;
  readonly scope: DeviceScope;
  readonly name: string;
  readonly assignedBoardId: BoardId | null;
  readonly now: EpochMs;
}): Result<Device, DeviceError> {
  if ((input.scope.eventId === null) === (input.scope.showId === null)) {
    return invalid('a Device belongs to exactly one Event or one Show');
  }
  const name = validName(input.name);
  if (!name.ok) return name;
  return ok({
    id: input.id,
    scope: input.scope,
    name: name.value,
    assignedBoardId: input.assignedBoardId,
    createdAt: input.now,
    lastSeenAt: null,
    revokedAt: null,
    revision: 0,
  });
}

function active(device: Device): Result<Device, DeviceError> {
  return device.revokedAt === null
    ? ok(device)
    : err({ code: 'revoked', reason: 'the device has been revoked' });
}

export function renameDevice(device: Device, name: string): Result<Device, DeviceError> {
  const a = active(device);
  if (!a.ok) return a;
  const v = validName(name);
  if (!v.ok) return v;
  return ok({ ...device, name: v.value, revision: device.revision + 1 });
}

/** Assign or reassign (null = unassigned). The Board must be within the Device scope (app layer). */
export function assignBoard(device: Device, boardId: BoardId | null): Result<Device, DeviceError> {
  const a = active(device);
  if (!a.ok) return a;
  return ok({ ...device, assignedBoardId: boardId, revision: device.revision + 1 });
}

/** Revocation is final: the credential stops working; pairing again creates a new Device. */
export function revokeDevice(device: Device, now: EpochMs): Result<Device, DeviceError> {
  const a = active(device);
  if (!a.ok) return a;
  return ok({ ...device, revokedAt: now, revision: device.revision + 1 });
}

/** Persist presence sparsely: on connect/disconnect (`force`) or after the write interval. */
export function shouldWriteLastSeen(device: Device, now: EpochMs, force: boolean): boolean {
  if (device.revokedAt !== null) return false;
  if (force || device.lastSeenAt === null) return true;
  return now - device.lastSeenAt >= LAST_SEEN_WRITE_INTERVAL_MS;
}

// --- Pairing -----------------------------------------------------------------------------

/**
 * Low-friction pairing: the display shows a short code ("7K4M-P2"); an operator enters it in
 * Device Management. The code is short-lived, one-time and stored only as a hash. The display
 * proves it is the same client with a separate high-entropy pairing secret (also hashed) and
 * claims its permanent credential exactly once.
 */
export interface PairingSession {
  readonly id: string;
  readonly codeHash: string;
  readonly secretHash: string;
  readonly status: 'pending' | 'paired' | 'claimed';
  readonly deviceId: DeviceId | null;
  readonly createdAt: EpochMs;
  readonly expiresAt: EpochMs;
  readonly pairedAt: EpochMs | null;
  readonly claimedAt: EpochMs | null;
}

export const PAIRING_TTL_MS = 10 * 60_000;
/** After pairing, the display has this long to claim its credential. */
export const PAIRING_CLAIM_GRACE_MS = 10 * 60_000;
/** No 0/O, 1/I/L: unambiguous on screens and when typed. 31 symbols, 6 chars ≈ 29.7 bits. */
export const PAIRING_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const PAIRING_CODE_LENGTH = 6;

/** `randomIndex(n)` must be a CSPRNG integer in [0, n). */
export function generatePairingCode(randomIndex: (n: number) => number): string {
  let code = '';
  for (let i = 0; i < PAIRING_CODE_LENGTH; i++) {
    code += PAIRING_ALPHABET[randomIndex(PAIRING_ALPHABET.length)] ?? '';
  }
  return code;
}

/** Display form: "7K4M-P2". */
export function formatPairingCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

const CODE_PATTERN = new RegExp(`^[${PAIRING_ALPHABET}]{${String(PAIRING_CODE_LENGTH)}}$`);

/** Accepts "7k4m p2", "7K4M-P2", …; null when it cannot be a code. */
export function normalizePairingCode(input: string): string | null {
  const code = input.toUpperCase().replace(/[\s-]/g, '');
  if (code.length !== PAIRING_CODE_LENGTH) return null;
  return CODE_PATTERN.test(code) ? code : null;
}

export type PairingError =
  | { readonly code: 'expired'; readonly reason: string }
  | { readonly code: 'used'; readonly reason: string }
  | { readonly code: 'pending'; readonly reason: string };

export function startPairing(input: {
  readonly id: string;
  readonly codeHash: string;
  readonly secretHash: string;
  readonly now: EpochMs;
}): PairingSession {
  return {
    id: input.id,
    codeHash: input.codeHash,
    secretHash: input.secretHash,
    status: 'pending',
    deviceId: null,
    createdAt: input.now,
    expiresAt: input.now + PAIRING_TTL_MS,
    pairedAt: null,
    claimedAt: null,
  };
}

/** Operator confirms the code: one-time, only while pending and not expired. */
export function pairSession(
  session: PairingSession,
  deviceId: DeviceId,
  now: EpochMs,
): Result<PairingSession, PairingError> {
  if (session.status !== 'pending') return err({ code: 'used', reason: 'code already used' });
  if (now >= session.expiresAt) return err({ code: 'expired', reason: 'pairing code expired' });
  return ok({ ...session, status: 'paired', deviceId, pairedAt: now });
}

/** The display collects its permanent credential: exactly once, after pairing. */
export function claimSession(
  session: PairingSession,
  now: EpochMs,
): Result<PairingSession & { readonly deviceId: DeviceId }, PairingError> {
  if (session.status === 'claimed') return err({ code: 'used', reason: 'already claimed' });
  if (session.status === 'pending') {
    return now >= session.expiresAt
      ? err({ code: 'expired', reason: 'pairing code expired' })
      : err({ code: 'pending', reason: 'waiting for pairing' });
  }
  const deviceId = session.deviceId;
  if (deviceId === null || session.pairedAt === null) {
    return err({ code: 'used', reason: 'invalid pairing state' });
  }
  if (now >= session.pairedAt + PAIRING_CLAIM_GRACE_MS) {
    return err({ code: 'expired', reason: 'pairing claim expired' });
  }
  return ok({ ...session, status: 'claimed', claimedAt: now, deviceId });
}
