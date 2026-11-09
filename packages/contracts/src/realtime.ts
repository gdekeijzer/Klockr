import { z } from 'zod';
import { epochMsSchema } from './common';
import type { BoardStateSnapshot, ShowStateSnapshot } from './show';
import type { TimerSnapshot } from './timer';

/**
 * Realtime wire contract (Socket.IO, path `/realtime`). Read-only channel: commands go through
 * HTTP. The server never streams ticks; it sends a full snapshot on every (re)connect and a
 * timer snapshot on every committed transition. Clients drop anything with an older revision.
 */
export const REALTIME_PATH = '/realtime';

export const realtimeEvents = {
  /** server -> client: full authoritative snapshot (on connect and reconnect). */
  showSnapshot: 'show.snapshot',
  boardSnapshot: 'board.snapshot',
  /** server -> client: authoritative timer state after a transition. */
  timer: 'timer.state',
  /** client -> server with ack: clock offset probe. */
  clock: 'clock.ping',
} as const;

/** Handshake `auth` payload. Operators authenticate by cookie and name the Show; Boards by token. */
export const realtimeAuthSchema = z.union([
  z.object({ role: z.literal('operator'), showId: z.uuid() }),
  z.object({ role: z.literal('board'), boardShareToken: z.string().min(1).max(200) }),
]);
export type RealtimeAuth = z.infer<typeof realtimeAuthSchema>;

export const clockAckSchema = z.object({ serverTime: epochMsSchema });
export type ClockAck = z.infer<typeof clockAckSchema>;

/** Typed Socket.IO event maps shared by server and clients. */
export interface ServerToClientEvents {
  'show.snapshot': (snapshot: ShowStateSnapshot) => void;
  'board.snapshot': (snapshot: BoardStateSnapshot) => void;
  'timer.state': (timer: TimerSnapshot) => void;
}

export interface ClientToServerEvents {
  'clock.ping': (ack: (payload: ClockAck) => void) => void;
}
