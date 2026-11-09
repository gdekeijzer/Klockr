import { z } from 'zod';
import { boardConfigSchema, messageSnapshotSchema } from './board';
import { epochMsSchema, idSchema, revisionSchema } from './common';
import { queueSnapshotSchema, relationSnapshotSchema, suggestionSnapshotSchema } from './queue';
import { MAX_DURATION_MS } from './timer';

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

/** POST /api/v1/shows/:showId/board-shares — new read-only Board link credential. */
export const boardShareRequestSchema = z.object({ boardId: idSchema.optional() });
export const boardShareResponseSchema = z.object({
  /** M5: id of the share (for listing/revocation; never the secret). */
  shareId: idSchema,
  boardId: idSchema,
  boardShareToken: z.string(),
});
export type BoardShareResponse = z.infer<typeof boardShareResponseSchema>;

/**
 * Management projection of the whole Show (Operator / Master / Boards admin): all peer Queues
 * with their Current/Next, relations, pending suggestions, Board configurations and active
 * messages. Ordered by `show.revision`.
 */
export const showStateSnapshotSchema = z.object({
  show: z.object({
    id: idSchema,
    title: z.string(),
    ownership: z.enum(['anonymous']),
    createdAt: epochMsSchema,
    expiresAt: epochMsSchema,
    revision: revisionSchema,
    primaryQueueId: idSchema,
    /** M5: optional Event / Room context (breadcrumb); null for a standalone Show. */
    context: z
      .object({
        eventId: idSchema,
        eventName: z.string(),
        roomId: idSchema.nullable(),
        roomName: z.string().nullable(),
      })
      .nullable(),
  }),
  queues: z.array(queueSnapshotSchema),
  relations: z.array(relationSnapshotSchema),
  suggestions: z.array(suggestionSnapshotSchema),
  boards: z.array(boardConfigSchema),
  messages: z.array(messageSnapshotSchema),
  serverTime: epochMsSchema,
});
export type ShowStateSnapshot = z.infer<typeof showStateSnapshotSchema>;

/** Response of an accepted Show command: the authoritative Show after the change. */
export const showCommandResponseSchema = z.object({
  state: showStateSnapshotSchema,
  /** Id of the object created by add/create/duplicate commands, else null. */
  createdId: z.string().nullable(),
});
export type ShowCommandResponse = z.infer<typeof showCommandResponseSchema>;
