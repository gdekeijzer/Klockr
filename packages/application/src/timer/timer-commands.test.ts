import { timerCommandSchema } from '@klockr/contracts';
import {
  createTimer,
  deriveTimer,
  ManualClock,
  MINUTE_MS,
  QueueItemId,
  SECOND_MS,
} from '@klockr/domain';
import { beforeEach, describe, expect, it } from 'vitest';
import type { CommandContext } from '../command';
import {
  allowAllAuthorizer,
  denyAllAuthorizer,
  InMemoryIdempotencyStore,
  InMemoryTimerRepository,
  RecordingEventPublisher,
} from '../testing';
import {
  executeTimerCommand,
  timerCommandFromDto,
  toTimerSnapshot,
  type TimerCommand,
  type TimerCommandDeps,
} from './timer-commands';

const itemId = '7c1e2d3f-5a6b-4c7d-8e9f-0a1b2c3d4e5f';
const ctx: CommandContext = { actor: { kind: 'management_grant', id: 'grant-1' } };
let seq = 0;

function cmd(
  type: TimerCommand['type'],
  extra: Partial<Omit<TimerCommand, 'type'>> & { deltaMs?: number } = {},
): TimerCommand {
  const { deltaMs, ...rest } = extra;
  const payload =
    deltaMs === undefined ? { queueItemId: itemId } : { queueItemId: itemId, deltaMs };
  return { commandId: `cmd-${++seq}`, type, payload, ...rest } as TimerCommand;
}

describe('executeTimerCommand', () => {
  let clock: ManualClock;
  let timers: InMemoryTimerRepository;
  let events: RecordingEventPublisher;
  let deps: TimerCommandDeps;

  beforeEach(() => {
    clock = new ManualClock();
    timers = new InMemoryTimerRepository();
    events = new RecordingEventPublisher();
    deps = {
      clock,
      timers,
      events,
      idempotency: new InMemoryIdempotencyStore(),
      authorizer: allowAllAuthorizer,
    };
    const created = createTimer({ mode: 'countdown', durationMs: 10 * MINUTE_MS });
    if (!created.ok) throw new Error('setup');
    timers.seed(QueueItemId(itemId), created.value);
  });

  it('runs start/pause/resume/adjust/stop through the application layer using the injected clock', async () => {
    const start = await executeTimerCommand(cmd('timer.start'), ctx, deps);
    expect(start.ok && start.value.state.startedAt).toBe(clock.now());

    clock.advance(MINUTE_MS);
    await executeTimerCommand(cmd('timer.pause'), ctx, deps);
    clock.advance(MINUTE_MS);
    await executeTimerCommand(cmd('timer.resume'), ctx, deps);
    const adjusted = await executeTimerCommand(
      cmd('timer.adjust', { deltaMs: 30 * SECOND_MS }),
      ctx,
      deps,
    );
    if (!adjusted.ok) throw new Error('adjust failed');
    expect(deriveTimer(adjusted.value.state, clock.now()).remainingMs).toBe(
      9 * MINUTE_MS + 30 * SECOND_MS,
    );

    const stopped = await executeTimerCommand(cmd('timer.stop'), ctx, deps);
    expect(stopped.ok && stopped.value.state.status).toBe('stopped');
    expect(events.events.map((e) => e.commandType)).toEqual([
      'timer.start',
      'timer.pause',
      'timer.resume',
      'timer.adjust',
      'timer.stop',
    ]);
  });

  it('STOP only stops the timer; START afterwards is a restart from the full duration', async () => {
    await executeTimerCommand(cmd('timer.start'), ctx, deps);
    clock.advance(MINUTE_MS);
    const stopped = await executeTimerCommand(cmd('timer.stop'), ctx, deps);
    expect(stopped.ok && stopped.value.state.status).toBe('stopped');
    expect(events.events.at(-1)?.commandType).toBe('timer.stop');

    const restarted = await executeTimerCommand(cmd('timer.start'), ctx, deps);
    if (!restarted.ok) throw new Error('restart failed');
    expect(deriveTimer(restarted.value.state, clock.now()).remainingMs).toBe(10 * MINUTE_MS);
  });

  it('a duplicate START with the same idempotency key is applied once', async () => {
    const first = await executeTimerCommand(
      cmd('timer.start', { idempotencyKey: 'ext-start-1' }),
      ctx,
      deps,
    );
    clock.advance(5 * SECOND_MS);
    const retry = await executeTimerCommand(
      cmd('timer.start', { idempotencyKey: 'ext-start-1' }),
      ctx,
      deps,
    );

    expect(retry).toEqual(first);
    expect(events.events).toHaveLength(1);
    const stored = await timers.get(QueueItemId(itemId));
    expect(stored?.revision).toBe(1);
  });

  it('a duplicate START without idempotency key is rejected by the domain, not applied twice', async () => {
    await executeTimerCommand(cmd('timer.start'), ctx, deps);
    const again = await executeTimerCommand(cmd('timer.start'), ctx, deps);
    expect(!again.ok && again.error.code).toBe('invalid_transition');
  });

  it('rejects reuse of an idempotency key for a different command', async () => {
    await executeTimerCommand(cmd('timer.start', { idempotencyKey: 'key-123456' }), ctx, deps);
    const misuse = await executeTimerCommand(
      cmd('timer.pause', { idempotencyKey: 'key-123456' }),
      ctx,
      deps,
    );
    expect(!misuse.ok && misuse.error.code).toBe('idempotency_conflict');
  });

  it('rejects a stale expected revision without changing state', async () => {
    await executeTimerCommand(cmd('timer.start'), ctx, deps);
    const stale = await executeTimerCommand(cmd('timer.pause', { expectedRevision: 0 }), ctx, deps);
    expect(stale).toMatchObject({
      ok: false,
      error: { code: 'revision_conflict', details: { expectedRevision: 0, actualRevision: 1 } },
    });
    expect((await timers.get(QueueItemId(itemId)))?.status).toBe('running');
  });

  it('accepts a matching expected revision', async () => {
    await executeTimerCommand(cmd('timer.start'), ctx, deps);
    const paused = await executeTimerCommand(
      cmd('timer.pause', { expectedRevision: 1 }),
      ctx,
      deps,
    );
    expect(paused.ok).toBe(true);
  });

  it('checks permissions before anything else', async () => {
    const denied = await executeTimerCommand(cmd('timer.start'), ctx, {
      ...deps,
      authorizer: denyAllAuthorizer,
    });
    expect(!denied.ok && denied.error.code).toBe('forbidden');
    expect((await timers.get(QueueItemId(itemId)))?.status).toBe('idle');
  });

  it('returns not_found for an unknown timer', async () => {
    const result = await executeTimerCommand(
      {
        commandId: 'x',
        type: 'timer.start',
        payload: { queueItemId: '00000000-0000-4000-8000-000000000000' },
      },
      ctx,
      deps,
    );
    expect(!result.ok && result.error.code).toBe('not_found');
  });

  it('maps an invalid adjustment to validation_failed', async () => {
    const result = await executeTimerCommand(cmd('timer.adjust', { deltaMs: 0 }), ctx, deps);
    expect(!result.ok && result.error.code).toBe('validation_failed');
  });

  it('keeps the timer running when event delivery fails', async () => {
    const failures: unknown[] = [];
    const result = await executeTimerCommand(cmd('timer.start'), ctx, {
      ...deps,
      events: { publish: () => Promise.reject(new Error('hub down')) },
      onPublishError: (e) => failures.push(e),
    });
    expect(result.ok).toBe(true);
    expect(failures).toHaveLength(1);
    expect((await timers.get(QueueItemId(itemId)))?.status).toBe('running');
  });

  it('accepts validated contract DTOs and produces a snapshot stamped with server time', async () => {
    const dto = timerCommandSchema.parse({
      commandId: '0b9f8a6e-4d3a-4a52-9f0b-1a2b3c4d5e6f',
      type: 'timer.start',
      payload: { queueItemId: itemId },
    });
    const result = await executeTimerCommand(timerCommandFromDto(dto), ctx, deps);
    if (!result.ok) throw new Error('start failed');
    clock.advance(SECOND_MS);
    const snapshot = toTimerSnapshot(result.value.queueItemId, result.value.state, clock.now());
    expect(snapshot).toMatchObject({ status: 'running', revision: 1, serverTime: clock.now() });
  });
});
