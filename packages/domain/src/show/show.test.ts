import { describe, expect, it } from 'vitest';
import { ManualClock } from '../clock';
import { BoardId, QueueId, QueueItemId, ShowId } from '../ids';
import { MINUTE_MS } from '../time';
import { ANONYMOUS_SHOW_TTL_MS, createQuickTimerShow } from './show';

const ids = {
  showId: ShowId('s1'),
  queueId: QueueId('q1'),
  queueItemId: QueueItemId('i1'),
  boardId: BoardId('b1'),
};

describe('createQuickTimerShow', () => {
  it('creates an anonymous Show with one Program Queue, one timed item and a Speaker Board', () => {
    const clock = new ManualClock();
    const result = createQuickTimerShow(ids, 10 * MINUTE_MS, clock.now());
    if (!result.ok) throw new Error('expected ok');
    const { show, queue, item, board } = result.value;

    expect(show).toMatchObject({
      id: 's1',
      ownership: 'anonymous',
      primaryQueueId: 'q1',
      createdAt: clock.now(),
      lastActiveAt: clock.now(),
      expiresAt: clock.now() + ANONYMOUS_SHOW_TTL_MS,
    });
    expect(ANONYMOUS_SHOW_TTL_MS).toBe(7 * 24 * 60 * MINUTE_MS);
    expect(queue).toMatchObject({ showId: 's1', purpose: 'program' });
    expect(item).toMatchObject({ queueId: 'q1' });
    expect(item.timer).toMatchObject({
      mode: 'countdown',
      status: 'idle',
      durationMs: 10 * MINUTE_MS,
    });
    expect(board).toMatchObject({ showId: 's1', preset: 'speaker' });
  });

  it('rejects an invalid duration', () => {
    expect(createQuickTimerShow(ids, 0, 0).ok).toBe(false);
  });
});
