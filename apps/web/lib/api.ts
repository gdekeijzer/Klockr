import type {
  BoardShareResponse,
  CreateQuickTimerResponse,
  ErrorResponse,
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
    );
  }
  return (await res.json()) as T;
}

export function createQuickTimer(durationMs: number): Promise<CreateQuickTimerResponse> {
  return request('/shows', { method: 'POST', body: JSON.stringify({ durationMs }) });
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
