import { describe, expect, it } from 'vitest';
import { timerCommandSchema, timerSnapshotSchema } from './timer';

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

  it('keeps STOP and END as distinct command types', () => {
    const stop = timerCommandSchema.parse({
      commandId,
      type: 'timer.stop',
      payload: { queueItemId },
    });
    const end = timerCommandSchema.parse({ commandId, type: 'item.end', payload: { queueItemId } });
    expect(stop.type).not.toBe(end.type);
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
      endedAt: null,
      revision: 1,
    };
    expect(timerSnapshotSchema.safeParse(base).success).toBe(false);
    expect(timerSnapshotSchema.safeParse({ ...base, serverTime: 1_767_258_001_000 }).success).toBe(
      true,
    );
  });
});
