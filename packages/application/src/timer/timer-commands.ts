import type { TimerCommandDto, TimerSnapshot } from '@klockr/contracts';
import {
  adjustTimer,
  ok,
  pauseTimer,
  QueueItemId,
  resumeTimer,
  startTimer,
  stopTimer,
  type Clock,
  type EpochMs,
  type TimerError,
  type TimerResult,
  type TimerState,
} from '@klockr/domain';
import type { Command, CommandContext } from '../command';
import { appError, type CommandResult } from '../errors';
import { stableStringify } from '../idempotency';
import type { Authorizer, EventPublisher, IdempotencyStore, TimerRepository } from '../ports';

export interface TimerTarget {
  readonly queueItemId: string;
}

export type StartTimerCommand = Command<'timer.start', TimerTarget>;
export type PauseTimerCommand = Command<'timer.pause', TimerTarget>;
export type ResumeTimerCommand = Command<'timer.resume', TimerTarget>;
export type StopTimerCommand = Command<'timer.stop', TimerTarget>;
export type AdjustTimerCommand = Command<
  'timer.adjust',
  TimerTarget & { readonly deltaMs: number }
>;
/*
 * No END command here: END / NEXT is a Queue Item / show-control command (it may end an item
 * without a timer or with a stopped timer, run end actions and move current/next). It is added
 * with Queue Items as `EndItem`. STOP only affects the timer.
 */

export type TimerCommand =
  | StartTimerCommand
  | PauseTimerCommand
  | ResumeTimerCommand
  | StopTimerCommand
  | AdjustTimerCommand;

export interface TimerCommandOutcome {
  readonly queueItemId: QueueItemId;
  readonly state: TimerState;
}

export interface TimerCommandDeps {
  readonly clock: Clock;
  readonly timers: TimerRepository;
  readonly idempotency: IdempotencyStore;
  readonly authorizer: Authorizer;
  readonly events: EventPublisher;
  /** Called when event delivery fails; the command result is unaffected. */
  readonly onPublishError?: (error: unknown) => void;
}

type Transition = (state: TimerState, now: EpochMs) => TimerResult;

function transitionFor(command: TimerCommand): Transition {
  switch (command.type) {
    case 'timer.start':
      return startTimer;
    case 'timer.pause':
      return pauseTimer;
    case 'timer.resume':
      return resumeTimer;
    case 'timer.stop':
      return stopTimer;
    case 'timer.adjust': {
      const { deltaMs } = command.payload;
      return (state, now) => adjustTimer(state, deltaMs, now);
    }
  }
}

function fromTimerError(error: TimerError): CommandResult<never> {
  switch (error.code) {
    case 'invalid_transition':
      return appError(
        'invalid_transition',
        `Cannot ${error.command} a timer that is ${error.status}`,
        { command: error.command, status: error.status },
      );
    case 'invalid_config':
    case 'invalid_adjustment':
      return appError('validation_failed', error.reason);
  }
}

/**
 * The single entry point for timer state changes. Order of checks:
 * permission -> idempotent replay -> load -> expected revision -> domain transition ->
 * compare-and-set save -> remember idempotent outcome -> publish event.
 */
export async function executeTimerCommand(
  command: TimerCommand,
  context: CommandContext,
  deps: TimerCommandDeps,
): Promise<CommandResult<TimerCommandOutcome>> {
  const queueItemId = QueueItemId(command.payload.queueItemId);

  const allowed = await deps.authorizer.can(context.actor, 'timer.control', {
    kind: 'queueItem',
    id: queueItemId,
  });
  if (!allowed) return appError('forbidden', 'Not permitted to control this timer');

  const scope = `${context.actor.kind}:${context.actor.id}`;
  const fingerprint = stableStringify({ type: command.type, payload: command.payload });
  if (command.idempotencyKey !== undefined) {
    const stored = await deps.idempotency.find(scope, command.idempotencyKey);
    if (stored) {
      if (stored.fingerprint !== fingerprint) {
        return appError('idempotency_conflict', 'Idempotency key was used for a different command');
      }
      return stored.result as CommandResult<TimerCommandOutcome>;
    }
  }

  const current = await deps.timers.get(queueItemId);
  if (!current) return appError('not_found', 'Timer not found', { queueItemId });

  if (command.expectedRevision !== undefined && command.expectedRevision !== current.revision) {
    return appError('revision_conflict', 'Timer has changed since it was read', {
      expectedRevision: command.expectedRevision,
      actualRevision: current.revision,
    });
  }

  const now = deps.clock.now();
  const transitioned = transitionFor(command)(current, now);
  if (!transitioned.ok) return fromTimerError(transitioned.error);

  const saved = await deps.timers.save(queueItemId, transitioned.value, current.revision);
  if (!saved.ok) return saved;

  const result = ok({ queueItemId, state: transitioned.value });
  if (command.idempotencyKey !== undefined) {
    await deps.idempotency.remember(scope, command.idempotencyKey, { fingerprint, result });
  }

  try {
    await deps.events.publish({
      type: 'timer.transitioned',
      commandId: command.commandId,
      commandType: command.type,
      queueItemId,
      state: transitioned.value,
      occurredAt: now,
    });
  } catch (error) {
    deps.onPublishError?.(error);
  }

  return result;
}

/** Adapter from a validated boundary DTO (HTTP/realtime) to the application command. */
export function timerCommandFromDto(dto: TimerCommandDto): TimerCommand {
  return dto;
}

/** Map authoritative state to the wire snapshot, stamped with the server time. */
export function toTimerSnapshot(
  queueItemId: QueueItemId,
  state: TimerState,
  serverTime: EpochMs,
): TimerSnapshot {
  return {
    queueItemId,
    mode: state.mode,
    status: state.status,
    durationMs: state.durationMs,
    adjustmentMs: state.adjustmentMs,
    startedAt: state.startedAt,
    pausedAt: state.pausedAt,
    pausedTotalMs: state.pausedTotalMs,
    stoppedAt: state.stoppedAt,
    revision: state.revision,
    serverTime,
  };
}
