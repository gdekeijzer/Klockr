import type { BoardStateSnapshot, QueueSnapshot, TimerSnapshot } from '@klockr/contracts';
import { acceptTimer } from './timer-sync';

/**
 * Client-side revision gating. The server is authoritative; clients only decide which of the
 * authoritative messages they have received is newest. Two independent orderings exist:
 * - the Queue revision (structure, current/next, lifecycle) for Queue/Board projections;
 * - each timer's own revision for timer transitions.
 * A stale or out-of-order message is dropped, never merged.
 */
export interface ManagementState {
  readonly queue: QueueSnapshot | null;
  /** Newest known timer per item. Only items that have a timer in `queue` are kept. */
  readonly timers: Readonly<Record<string, TimerSnapshot>>;
}

export const emptyManagementState: ManagementState = { queue: null, timers: {} };

export function applyQueueSnapshot(state: ManagementState, queue: QueueSnapshot): ManagementState {
  if (state.queue && queue.revision < state.queue.revision) return state;
  const timers: Record<string, TimerSnapshot> = {};
  for (const item of queue.items) {
    if (item.timer) timers[item.id] = acceptTimer(state.timers[item.id] ?? null, item.timer);
  }
  return { queue, timers };
}

export function applyTimerUpdate(state: ManagementState, timer: TimerSnapshot): ManagementState {
  // A timer of an item that has no timer in the newest Queue projection is ignored.
  if (!state.queue?.items.some((i) => i.id === timer.queueItemId && i.timer !== null)) {
    return state;
  }
  const current = state.timers[timer.queueItemId] ?? null;
  const next = acceptTimer(current, timer);
  return next === current
    ? state
    : { ...state, timers: { ...state.timers, [timer.queueItemId]: next } };
}

export interface BoardState {
  readonly board: BoardStateSnapshot | null;
  readonly timer: TimerSnapshot | null;
}

export const emptyBoardState: BoardState = { board: null, timer: null };

export function applyBoardSnapshot(state: BoardState, board: BoardStateSnapshot): BoardState {
  if (state.board && board.queueRevision < state.board.queueRevision) return state;
  const sameItem =
    state.timer && board.timer && state.timer.queueItemId === board.timer.queueItemId;
  const timer = board.timer
    ? sameItem
      ? acceptTimer(state.timer, board.timer)
      : board.timer
    : null;
  return { board, timer };
}

export function applyBoardTimer(state: BoardState, timer: TimerSnapshot): BoardState {
  // Boards show the current item only; transitions of other items are irrelevant.
  if (state.board?.current?.id !== timer.queueItemId) return state;
  const next = acceptTimer(state.timer, timer);
  return next === state.timer ? state : { ...state, timer: next };
}
