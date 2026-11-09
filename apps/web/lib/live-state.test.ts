import { describe, expect, it } from 'vitest';
import { itemFixture, queueFixture, timerFixture } from './fixtures';
import {
  applyBoardSnapshot,
  applyBoardTimer,
  applyQueueSnapshot,
  applyTimerUpdate,
  emptyBoardState,
  emptyManagementState,
} from './live-state';

describe('management state gating', () => {
  it('drops an older Queue snapshot and keeps newer timers from transitions', () => {
    let state = applyQueueSnapshot(
      emptyManagementState,
      queueFixture([itemFixture('a')], { revision: 2 }),
    );
    state = applyTimerUpdate(state, timerFixture('a', 3, { status: 'running' }));
    // A Queue snapshot with an older timer revision does not roll the timer back.
    state = applyQueueSnapshot(state, queueFixture([itemFixture('a')], { revision: 3 }));
    expect(state.timers.a?.revision).toBe(3);
    const stale = applyQueueSnapshot(state, queueFixture([], { revision: 1 }));
    expect(stale).toBe(state);
  });

  it('forgets timers of items that no longer have one, so a recreated timer is accepted', () => {
    let state = applyQueueSnapshot(emptyManagementState, queueFixture([itemFixture('a')]));
    state = applyTimerUpdate(state, timerFixture('a', 5));
    state = applyQueueSnapshot(
      state,
      queueFixture([itemFixture('a', { timer: null })], { revision: 2 }),
    );
    expect(state.timers.a).toBeUndefined();
    state = applyQueueSnapshot(
      state,
      queueFixture([itemFixture('a', { timer: timerFixture('a', 0) })], { revision: 3 }),
    );
    expect(state.timers.a?.revision).toBe(0);
  });

  it('ignores timer transitions of unknown or timer-less items', () => {
    const state = applyQueueSnapshot(
      emptyManagementState,
      queueFixture([itemFixture('note', { timer: null })]),
    );
    expect(applyTimerUpdate(state, timerFixture('note', 1))).toBe(state);
    expect(applyTimerUpdate(state, timerFixture('ghost', 1))).toBe(state);
  });
});

describe('board state gating', () => {
  const board = (queueRevision: number, currentId: string | null, timerRevision = 0) => ({
    board: { id: 'b', preset: 'speaker' as const },
    queueRevision,
    current: currentId ? { id: currentId, title: currentId, subtitle: null } : null,
    warning: { kind: 'percent' as const, warningPercent: 20, criticalPercent: 5 },
    timer: currentId ? timerFixture(currentId, timerRevision) : null,
    serverTime: 0,
  });

  it('follows current changes and drops stale projections', () => {
    let state = applyBoardSnapshot(emptyBoardState, board(1, 'a'));
    state = applyBoardSnapshot(state, board(2, 'b'));
    expect(state.board?.current?.id).toBe('b');
    expect(applyBoardSnapshot(state, board(1, 'a'))).toBe(state);
  });

  it('applies timer transitions of the current item only, revision-gated', () => {
    let state = applyBoardSnapshot(emptyBoardState, board(1, 'a'));
    expect(applyBoardTimer(state, timerFixture('other', 9))).toBe(state);
    state = applyBoardTimer(state, timerFixture('a', 2, { status: 'running' }));
    expect(state.timer?.status).toBe('running');
    // A reconnect snapshot carrying an older timer revision of the same item keeps the newer one.
    state = applyBoardSnapshot(state, board(1, 'a', 1));
    expect(state.timer?.revision).toBe(2);
  });

  it('a current item without timer has no timer', () => {
    expect(applyBoardSnapshot(emptyBoardState, board(1, null)).timer).toBeNull();
  });
});
