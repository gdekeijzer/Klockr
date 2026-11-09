import { z } from 'zod';
import { epochMsSchema, idSchema, revisionSchema } from './common';
import { queueSnapshotSchema, thresholdRuleSchema } from './queue';
import { MAX_DURATION_MS, timerSnapshotSchema } from './timer';

/** POST /api/v1/shows — Anonymous New Show with a Quick Timer. */
export const createQuickTimerRequestSchema = z.object({
  durationMs: z.int().positive().max(MAX_DURATION_MS),
  /** Creating browser's IANA timezone, used for human schedule times (default UTC). */
  timeZone: z.string().min(1).max(64).optional(),
  /** Show day YYYY-MM-DD in that timezone. */
  scheduleDate: z.iso.date().optional(),
});
export type CreateQuickTimerRequest = z.infer<typeof createQuickTimerRequestSchema>;

/**
 * Response of Show creation. The owner credential is NOT in the body: it is set as an HttpOnly
 * cookie. The board share token is returned exactly once so the creator can share it.
 */
export const createQuickTimerResponseSchema = z.object({
  showId: idSchema,
  boardShareToken: z.string(),
});
export type CreateQuickTimerResponse = z.infer<typeof createQuickTimerResponseSchema>;

/** POST /api/v1/shows/:showId/board-shares — new read-only Speaker Board link credential. */
export const boardShareResponseSchema = z.object({
  boardId: idSchema,
  boardShareToken: z.string(),
});
export type BoardShareResponse = z.infer<typeof boardShareResponseSchema>;

/** Management (Operator / Queue Editor) projection of Show State. */
export const showStateSnapshotSchema = z.object({
  show: z.object({
    id: idSchema,
    title: z.string(),
    ownership: z.enum(['anonymous']),
    createdAt: epochMsSchema,
    expiresAt: epochMsSchema,
  }),
  board: z.object({ id: idSchema }),
  /** The Program Queue (M2: the only Queue). */
  queue: queueSnapshotSchema,
});
export type ShowStateSnapshot = z.infer<typeof showStateSnapshotSchema>;

/**
 * Read-only Speaker Board projection: only the CURRENT item's display data, its effective
 * thresholds and timer. No queue, notes, tags, management data, credentials or expiry.
 * Ordered by `queueRevision`; timers additionally by their own revision.
 */
export const boardStateSnapshotSchema = z.object({
  board: z.object({ id: idSchema, preset: z.enum(['speaker']) }),
  queueRevision: revisionSchema,
  current: z
    .object({ id: idSchema, title: z.string(), subtitle: z.string().nullable() })
    .nullable(),
  warning: thresholdRuleSchema,
  timer: timerSnapshotSchema.nullable(),
  serverTime: epochMsSchema,
});
export type BoardStateSnapshot = z.infer<typeof boardStateSnapshotSchema>;
