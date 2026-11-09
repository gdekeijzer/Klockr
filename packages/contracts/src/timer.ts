import { z } from 'zod';
import { commandSchema, durationMsSchema, epochMsSchema, idSchema, revisionSchema } from './common';

export const timerModeSchema = z.enum(['countdown', 'countup']);
export const timerStatusSchema = z.enum(['idle', 'running', 'paused', 'stopped']);

const timerTarget = z.object({ queueItemId: idSchema });

export const startTimerCommandSchema = commandSchema('timer.start', timerTarget);
export const pauseTimerCommandSchema = commandSchema('timer.pause', timerTarget);
export const resumeTimerCommandSchema = commandSchema('timer.resume', timerTarget);
export const stopTimerCommandSchema = commandSchema('timer.stop', timerTarget);
export const adjustTimerCommandSchema = commandSchema(
  'timer.adjust',
  timerTarget.extend({
    deltaMs: durationMsSchema.refine((v) => v !== 0, 'deltaMs must be non-zero'),
  }),
);
/*
 * There is deliberately no timer END command. END / NEXT ends a Queue Item (also one without a
 * timer) and is introduced with Queue Items as a Queue Item / show-control command.
 * STOP is the only way to halt a timer and is never an alias for END.
 */

export const timerCommandSchema = z.discriminatedUnion('type', [
  startTimerCommandSchema,
  pauseTimerCommandSchema,
  resumeTimerCommandSchema,
  stopTimerCommandSchema,
  adjustTimerCommandSchema,
]);
export type TimerCommandDto = z.infer<typeof timerCommandSchema>;
export type TimerCommandType = TimerCommandDto['type'];

/**
 * Authoritative timer snapshot. Clients derive the visible value locally from these
 * timestamps plus `serverTime` (for clock-offset correction); the server never sends ticks.
 */
export const timerSnapshotSchema = z.object({
  queueItemId: idSchema,
  mode: timerModeSchema,
  status: timerStatusSchema,
  durationMs: z.int().nonnegative(),
  adjustmentMs: durationMsSchema,
  startedAt: epochMsSchema.nullable(),
  pausedAt: epochMsSchema.nullable(),
  pausedTotalMs: z.int().nonnegative(),
  stoppedAt: epochMsSchema.nullable(),
  revision: revisionSchema,
  serverTime: epochMsSchema,
});
export type TimerSnapshot = z.infer<typeof timerSnapshotSchema>;
