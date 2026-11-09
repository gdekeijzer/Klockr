import type { BoardStateSnapshot, ShowStateSnapshot, TimerSnapshot } from '@klockr/contracts';
import { acceptTimer } from './timer-sync';

/**
 * Client-side revision gating. The server is authoritative; clients only decide which of the
 * authoritative messages they have received is newest:
 * - the Show revision orders management snapshots (all Queues, relations, suggestions, ...);
 * - the projection `version` orders Board snapshots;
 * - each timer's own revision orders timer transitions.
 * A stale or out-of-order message is dropped, never merged.
 */
export interface ManagementState {
  readonly state: ShowStateSnapshot | null;
  /** Newest known timer per item (only items that have a timer in `state`). */
  readonly timers: Readonly<Record<string, TimerSnapshot>>;
}

export const emptyManagementState: ManagementState = { state: null, timers: {} };

export function applyShowState(
  current: ManagementState,
  state: ShowStateSnapshot,
): ManagementState {
  if (current.state && state.show.revision < current.state.show.revision) return current;
  const timers: Record<string, TimerSnapshot> = {};
  for (const queue of state.queues) {
    for (const item of queue.items) {
      if (item.timer) timers[item.id] = acceptTimer(current.timers[item.id] ?? null, item.timer);
    }
  }
  return { state, timers };
}

export function applyTimerUpdate(current: ManagementState, timer: TimerSnapshot): ManagementState {
  const known = current.state?.queues.some((q) =>
    q.items.some((i) => i.id === timer.queueItemId && i.timer !== null),
  );
  if (!known) return current;
  const before = current.timers[timer.queueItemId] ?? null;
  const next = acceptTimer(before, timer);
  return next === before
    ? current
    : { ...current, timers: { ...current.timers, [timer.queueItemId]: next } };
}

export interface BoardState {
  readonly board: BoardStateSnapshot | null;
  /** Newest known timer per (visible) item of this Board's projection. */
  readonly timers: Readonly<Record<string, TimerSnapshot>>;
}

export const emptyBoardState: BoardState = { board: null, timers: {} };

export function applyBoardSnapshot(current: BoardState, board: BoardStateSnapshot): BoardState {
  if (current.board && board.version < current.board.version) return current;
  const timers: Record<string, TimerSnapshot> = {};
  for (const queue of board.queues) {
    for (const t of queue.timers)
      timers[t.queueItemId] = acceptTimer(current.timers[t.queueItemId] ?? null, t);
  }
  return { board, timers };
}

/** Boards only accept transitions of timers their scoped projection already contains. */
export function applyBoardTimer(current: BoardState, timer: TimerSnapshot): BoardState {
  const before = current.timers[timer.queueItemId];
  if (!before) return current;
  const next = acceptTimer(before, timer);
  return next === before
    ? current
    : { ...current, timers: { ...current.timers, [timer.queueItemId]: next } };
}
