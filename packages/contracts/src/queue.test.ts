import { describe, expect, it } from 'vitest';
import { showCommandSchema } from './commands';
import { queueCommandSchema, thresholdRuleSchema } from './queue';

const commandId = '0b9f8a6e-4d3a-4a52-9f0b-1a2b3c4d5e6f';
const queueItemId = '7c1e2d3f-5a6b-4c7d-8e9f-0a1b2c3d4e5f';

describe('queue command contracts', () => {
  it('accepts presets as plain item.add commands (note without timer)', () => {
    const note = queueCommandSchema.parse({
      commandId,
      type: 'item.add',
      payload: { title: 'CEO arrives stage left', durationMs: null },
    });
    expect(note.type).toBe('item.add');
  });

  it('END and END + NEXT are one item command with a next flag', () => {
    for (const next of [false, true]) {
      expect(
        queueCommandSchema.safeParse({
          commandId,
          type: 'item.end',
          payload: { queueItemId, next },
        }).success,
      ).toBe(true);
    }
  });

  it('the commands endpoint accepts both timer and queue commands', () => {
    expect(
      showCommandSchema.parse({ commandId, type: 'timer.stop', payload: { queueItemId } }).type,
    ).toBe('timer.stop');
    expect(
      showCommandSchema.parse({ commandId, type: 'queue.setCurrent', payload: { queueItemId } })
        .type,
    ).toBe('queue.setCurrent');
  });

  it.each([
    { commandId, type: 'item.add', payload: { title: '' } },
    { commandId, type: 'item.add', payload: { title: 'x', durationMs: 0 } },
    { commandId, type: 'item.move', payload: { queueItemId, groupId: null, index: -1 } },
    { commandId, type: 'item.end', payload: { queueItemId } },
    { commandId, type: 'show.setWarning', payload: { warning: null } },
  ])('rejects invalid command %#', (input) => {
    expect(showCommandSchema.safeParse(input).success).toBe(false);
  });

  it('threshold rules are percent or absolute', () => {
    expect(
      thresholdRuleSchema.safeParse({ kind: 'percent', warningPercent: 20, criticalPercent: 5 })
        .success,
    ).toBe(true);
    expect(
      thresholdRuleSchema.safeParse({ kind: 'absolute', warningMs: 300_000, criticalMs: 60_000 })
        .success,
    ).toBe(true);
    expect(
      thresholdRuleSchema.safeParse({ kind: 'percent', warningPercent: 101, criticalPercent: 5 })
        .success,
    ).toBe(false);
    expect(thresholdRuleSchema.safeParse({ kind: 'relative', warningPercent: 20 }).success).toBe(
      false,
    );
  });
});
