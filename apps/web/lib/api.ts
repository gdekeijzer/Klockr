import type {
  AuditListResponse,
  BoardShareResponse,
  CreateQuickTimerResponse,
  ErrorResponse,
  QueueCommandDto,
  QueueCommandResponse,
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

export function createBoardShare(showId: string): Promise<BoardShareResponse> {
  return request(`/shows/${showId}/board-shares`, { method: 'POST', body: '{}' });
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

/** Body of a Queue command without the envelope fields the client generates. */
export type QueueCommandBody = DistributiveOmit<QueueCommandDto, 'commandId' | 'idempotencyKey'>;
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/**
 * Send a Queue command (item.*, group.*, queue.*, show.*). Same idempotency rule as timers;
 * the returned Queue is authoritative and revision-gated by the caller.
 */
export async function sendQueueCommand(
  showId: string,
  command: QueueCommandBody,
): Promise<QueueCommandResponse> {
  const commandId = crypto.randomUUID();
  return request<QueueCommandResponse>(`/shows/${showId}/commands`, {
    method: 'POST',
    body: JSON.stringify({ ...command, commandId, idempotencyKey: commandId }),
  });
}

export function fetchAudit(showId: string): Promise<AuditListResponse> {
  return request<AuditListResponse>(`/shows/${showId}/audit?limit=50`);
}
