import type {
  AuditListResponse,
  BoardShareListResponse,
  CreatedShowResponse,
  DeviceCommandDto,
  DeviceCommandResponse,
  DeviceDisplaySnapshot,
  DeviceListResponse,
  EventCommandDto,
  EventCommandResponse,
  EventStateSnapshot,
  PairingClaimResponse,
  PairingStartResponse,
  BoardShareResponse,
  CreateQuickTimerResponse,
  ErrorResponse,
  QueueCommandDto,
  ShowCommandResponse,
  BoardCommandDto,
  BoardStateSnapshot,
  TimerCommandDto,
  TimerSnapshot,
} from '@klockr/contracts';

/** Same-origin API (reverse proxy in ACC/PRD, Next rewrites locally). */
const API = '/api/v1';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      ...init,
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
    });
  } catch {
    throw new ApiError(0, 'network', 'No connection to the KLOCKR server');
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ErrorResponse | null;
    throw new ApiError(
      res.status,
      body?.error.code ?? 'internal',
      body?.error.message ?? res.statusText,
      body?.error.details ?? {},
    );
  }
  return (await res.json()) as T;
}

/**
 * Anonymous New Show. The creating browser's timezone and today's date become the Show's
 * schedule timezone/date (human HH:MM planning), changeable later in Master.
 */
export function createQuickTimer(durationMs: number): Promise<CreateQuickTimerResponse> {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const scheduleDate = new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date());
  return request('/shows', {
    method: 'POST',
    body: JSON.stringify({ durationMs, timeZone, scheduleDate }),
  });
}

/** New read-only share credential for one Board (default: the Show's first Board). */
export function createBoardShare(
  showId: string,
  boardId?: string,
  label?: string,
): Promise<BoardShareResponse> {
  return request(`/shows/${showId}/board-shares`, {
    method: 'POST',
    body: JSON.stringify({ ...(boardId ? { boardId } : {}), ...(label ? { label } : {}) }),
  });
}

/** Scoped Board projection for the management preview (same data a Board token receives). */
export function fetchBoardPreview(showId: string, boardId: string): Promise<BoardStateSnapshot> {
  return request<BoardStateSnapshot>(`/shows/${showId}/boards/${boardId}/preview`);
}

type CommandBody = Omit<TimerCommandDto, 'commandId' | 'idempotencyKey'>;

/**
 * Send a timer command. The command id doubles as idempotency key, so a retried request can
 * never apply twice. The UI only reflects the result after the server confirms it.
 */
export async function sendTimerCommand(
  showId: string,
  command: CommandBody,
): Promise<TimerSnapshot> {
  const commandId = crypto.randomUUID();
  const body = { ...command, commandId, idempotencyKey: commandId };
  const result = await request<{ timer: TimerSnapshot }>(`/shows/${showId}/commands`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return result.timer;
}

/** Body of a Show command (Queue, relation, suggestion, Board, Message) without envelope ids. */
export type QueueCommandBody = DistributiveOmit<
  QueueCommandDto | BoardCommandDto,
  'commandId' | 'idempotencyKey'
>;
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/**
 * Send a Queue command (item.*, group.*, queue.*, show.*). Same idempotency rule as timers;
 * the returned Queue is authoritative and revision-gated by the caller.
 */
export async function sendQueueCommand(
  showId: string,
  command: QueueCommandBody,
): Promise<ShowCommandResponse> {
  const commandId = crypto.randomUUID();
  return request<ShowCommandResponse>(`/shows/${showId}/commands`, {
    method: 'POST',
    body: JSON.stringify({ ...command, commandId, idempotencyKey: commandId }),
  });
}

export function fetchAudit(showId: string): Promise<AuditListResponse> {
  return request<AuditListResponse>(`/shows/${showId}/audit?limit=50`);
}

// --- M5: Events, Rooms, Show placement --------------------------------------------------------

/** Management scope of Devices and share links: a standalone Show or an Event. */
export interface Scope {
  readonly kind: 'show' | 'event';
  readonly id: string;
}
const scopePath = (scope: Scope) => `/${scope.kind === 'show' ? 'shows' : 'events'}/${scope.id}`;

export function createEvent(input: {
  name: string;
  timeZone: string;
  startsAt: number | null;
  endsAt: number | null;
}): Promise<{ eventId: string }> {
  return request('/events', { method: 'POST', body: JSON.stringify(input) });
}

export function fetchEventState(eventId: string): Promise<EventStateSnapshot> {
  return request(`/events/${eventId}/state`);
}

export type EventCommandBody = DistributiveOmit<EventCommandDto, 'commandId' | 'idempotencyKey'>;

export function sendEventCommand(
  eventId: string,
  command: EventCommandBody,
): Promise<EventCommandResponse> {
  const commandId = crypto.randomUUID();
  return request(`/events/${eventId}/commands`, {
    method: 'POST',
    body: JSON.stringify({ ...command, commandId, idempotencyKey: commandId }),
  });
}

export function createShowInEvent(
  eventId: string,
  input: { title: string; roomId: string | null; durationMs?: number },
): Promise<CreatedShowResponse> {
  return request(`/events/${eventId}/shows`, { method: 'POST', body: JSON.stringify(input) });
}

export function attachShow(eventId: string, showId: string, roomId: string | null) {
  return request<{ ok: true }>(`/events/${eventId}/shows/attach`, {
    method: 'POST',
    body: JSON.stringify({ showId, roomId }),
  });
}

export function duplicateShow(
  showId: string,
  input: { title?: string; roomId?: string | null },
): Promise<CreatedShowResponse> {
  return request(`/shows/${showId}/duplicate`, { method: 'POST', body: JSON.stringify(input) });
}

export function fetchEventBoardPreview(
  eventId: string,
  boardId: string,
): Promise<BoardStateSnapshot> {
  return request(`/events/${eventId}/boards/${boardId}/preview`);
}

// --- M5: Devices -----------------------------------------------------------------------------

export function fetchDevices(scope: Scope): Promise<DeviceListResponse> {
  return request(`${scopePath(scope)}/devices`);
}

export type DeviceCommandBody = DistributiveOmit<DeviceCommandDto, 'commandId' | 'idempotencyKey'>;

export function sendDeviceCommand(
  scope: Scope,
  command: DeviceCommandBody,
): Promise<DeviceCommandResponse> {
  const commandId = crypto.randomUUID();
  return request(`${scopePath(scope)}/devices`, {
    method: 'POST',
    body: JSON.stringify({ ...command, commandId, idempotencyKey: commandId }),
  });
}

/** Display side: ask for a pairing code (no credential needed). */
export function startPairing(): Promise<PairingStartResponse> {
  return request('/devices/pairing', { method: 'POST', body: '{}' });
}

/** Display side: pending -> paired (credential, once) -> expired. */
export async function claimPairing(
  pairingSecret: string,
): Promise<PairingClaimResponse | { status: 'expired' }> {
  let res: Response;
  try {
    res = await fetch(`${API}/devices/pairing/claim`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pairingSecret }),
    });
  } catch {
    return { status: 'pending' }; // offline: keep waiting
  }
  if (res.status === 410) return { status: 'expired' };
  if (!res.ok && res.status !== 202) return { status: 'pending' };
  return (await res.json()) as PairingClaimResponse;
}

/** Paired display: its identity and assigned Board (401 once revoked). */
export async function fetchDeviceDisplay(
  token: string,
): Promise<DeviceDisplaySnapshot | 'revoked'> {
  const res = await fetch(`${API}/device/state`, { headers: { authorization: `Bearer ${token}` } });
  if (res.status === 401) return 'revoked';
  if (!res.ok) throw new ApiError(res.status, 'internal', res.statusText);
  return (await res.json()) as DeviceDisplaySnapshot;
}

// --- M5: Board share links -------------------------------------------------------------------

export function fetchBoardShares(scope: Scope): Promise<BoardShareListResponse> {
  return request(`${scopePath(scope)}/board-shares`);
}

export function createScopedShare(
  scope: Scope,
  boardId: string,
  label: string,
): Promise<BoardShareResponse> {
  return request(`${scopePath(scope)}/board-shares`, {
    method: 'POST',
    body: JSON.stringify({ boardId, ...(label.trim() ? { label: label.trim() } : {}) }),
  });
}

export function revokeShare(scope: Scope, shareId: string) {
  return request<{ ok: true }>(`${scopePath(scope)}/board-shares/${shareId}/revoke`, {
    method: 'POST',
    body: '{}',
  });
}
