import { describe, expect, it } from 'vitest';
import { timerCommandSchema, timerSnapshotSchema, timerStatusSchema } from './timer';

const commandId = '0b9f8a6e-4d3a-4a52-9f0b-1a2b3c4d5e6f';
const queueItemId = '7c1e2d3f-5a6b-4c7d-8e9f-0a1b2c3d4e5f';

describe('timer command contracts', () => {
  it('accepts a valid start command', () => {
    const parsed = timerCommandSchema.parse({
      commandId,
      type: 'timer.start',
      payload: { queueItemId },
    });
    expect(parsed.type).toBe('timer.start');
  });

  it('accepts idempotency key and expected revision', () => {
    const result = timerCommandSchema.safeParse({
      commandId,
      type: 'timer.adjust',
      idempotencyKey: 'companion-btn-17',
      expectedRevision: 4,
      payload: { queueItemId, deltaMs: 30_000 },
    });
    expect(result.success).toBe(true);
  });

  it.each([
    { commandId: 'nope', type: 'timer.start', payload: { queueItemId } },
    { commandId, type: 'timer.explode', payload: { queueItemId } },
    { commandId, type: 'timer.adjust', payload: { queueItemId, deltaMs: 0 } },
    { commandId, type: 'timer.adjust', payload: { queueItemId, deltaMs: 1.5 } },
    { commandId, type: 'timer.stop', payload: { queueItemId }, expectedRevision: -1 },
  ])('rejects invalid command %#', (input) => {
    expect(timerCommandSchema.safeParse(input).success).toBe(false);
  });

  it('has no timer END command: END belongs to the Queue Item', () => {
    for (const type of ['timer.end', 'item.end']) {
      expect(
        timerCommandSchema.safeParse({ commandId, type, payload: { queueItemId } }).success,
      ).toBe(false);
    }
  });

  it('rejects the removed ended status in snapshots', () => {
    expect(timerStatusSchema.safeParse('ended').success).toBe(false);
  });
});

describe('timer snapshot contract', () => {
  it('requires serverTime and revision', () => {
    const base = {
      queueItemId,
      mode: 'countdown',
      status: 'running',
      durationMs: 60_000,
      adjustmentMs: 0,
      startedAt: 1_767_258_000_000,
      pausedAt: null,
      pausedTotalMs: 0,
      stoppedAt: null,
      revision: 1,
    };
    expect(timerSnapshotSchema.safeParse(base).success).toBe(false);
    expect(timerSnapshotSchema.safeParse({ ...base, serverTime: 1_767_258_001_000 }).success).toBe(
      true,
    );
  });
});
