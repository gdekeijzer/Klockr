import { z } from 'zod';
import { epochMsSchema, idSchema } from './common';
import { MAX_DURATION_MS, timerSnapshotSchema } from './timer';

/** POST /api/v1/shows — Anonymous New Show with a Quick Timer. */
export const createQuickTimerRequestSchema = z.object({
  durationMs: z.int().positive().max(MAX_DURATION_MS),
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

/** Management (Operator) projection of Show State. */
export const showStateSnapshotSchema = z.object({
  show: z.object({
    id: idSchema,
    title: z.string(),
    ownership: z.enum(['anonymous']),
    createdAt: epochMsSchema,
    expiresAt: epochMsSchema,
  }),
  item: z.object({ id: idSchema, title: z.string() }),
  board: z.object({ id: idSchema }),
  timer: timerSnapshotSchema,
});
export type ShowStateSnapshot = z.infer<typeof showStateSnapshotSchema>;

/**
 * Read-only Board projection. Contains only what the Board renders: no Show management data,
 * no credentials, no expiry warnings.
 */
export const boardStateSnapshotSchema = z.object({
  board: z.object({ id: idSchema, preset: z.enum(['speaker']) }),
  item: z.object({ title: z.string() }),
  timer: timerSnapshotSchema,
});
export type BoardStateSnapshot = z.infer<typeof boardStateSnapshotSchema>;
