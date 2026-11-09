import { describe, expect, it } from 'vitest';
import { boardFixture, itemFixture, queueFixture, showFixture, timerFixture } from './fixtures';
import {
  applyBoardSnapshot,
  applyBoardTimer,
  applyShowState,
  applyTimerUpdate,
  emptyBoardState,
  emptyManagementState,
} from './live-state';

describe('management state gating (Show revision + timer revisions)', () => {
  it('drops an older Show snapshot and keeps newer timers from transitions', () => {
    let state = applyShowState(
      emptyManagementState,
      showFixture([queueFixture([itemFixture('a')])], 2),
    );
    state = applyTimerUpdate(state, timerFixture('a', 3, { status: 'running' }));
    state = applyShowState(state, showFixture([queueFixture([itemFixture('a')])], 3));
    expect(state.timers.a?.revision).toBe(3);
    expect(applyShowState(state, showFixture([], 1))).toBe(state);
  });

  it('collects timers of all Queues; a recreated timer is accepted', () => {
    let state = applyShowState(
      emptyManagementState,
      showFixture([
        queueFixture([itemFixture('a')]),
        queueFixture([itemFixture('m')], { id: 'audio' }),
      ]),
    );
    expect(Object.keys(state.timers).sort()).toEqual(['a', 'm']);
    state = applyTimerUpdate(state, timerFixture('a', 5));
    state = applyShowState(
      state,
      showFixture([queueFixture([itemFixture('a', { timer: null })])], 2),
    );
    expect(state.timers.a).toBeUndefined();
    state = applyShowState(
      state,
      showFixture([queueFixture([itemFixture('a', { timer: timerFixture('a', 0) })])], 3),
    );
    expect(state.timers.a?.revision).toBe(0);
  });

  it('ignores timer transitions of unknown or timer-less items', () => {
    const state = applyShowState(
      emptyManagementState,
      showFixture([queueFixture([itemFixture('note', { timer: null })])]),
    );
    expect(applyTimerUpdate(state, timerFixture('note', 1))).toBe(state);
    expect(applyTimerUpdate(state, timerFixture('ghost', 1))).toBe(state);
  });
});

describe('board state gating (projection version + timer revisions)', () => {
  it('follows current changes and drops stale projections', () => {
    let state = applyBoardSnapshot(emptyBoardState, boardFixture(1, 'a'));
    state = applyBoardSnapshot(state, boardFixture(2, 'b'));
    expect(state.board?.queues[0]?.current?.id).toBe('b');
    expect(applyBoardSnapshot(state, boardFixture(1, 'a'))).toBe(state);
  });

  it('accepts transitions only for timers in its scoped projection, revision-gated', () => {
    let state = applyBoardSnapshot(emptyBoardState, boardFixture(1, 'a'));
    expect(applyBoardTimer(state, timerFixture('other', 9))).toBe(state);
    state = applyBoardTimer(state, timerFixture('a', 2, { status: 'running' }));
    expect(state.timers.a?.status).toBe('running');
    state = applyBoardSnapshot(state, boardFixture(1, 'a', 1));
    expect(state.timers.a?.revision).toBe(2);
  });

  it('a current item without timer has no timer', () => {
    expect(applyBoardSnapshot(emptyBoardState, boardFixture(1, null)).timers).toEqual({});
  });
});
