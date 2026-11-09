import { z } from 'zod';

/**
 * Shared primitives for external boundaries (HTTP, realtime, worker inputs).
 * Contracts describe what crosses a boundary; they are not database models.
 */
export const idSchema = z.uuid();

/** Client-generated identifier of one command attempt (UUID). */
export const commandIdSchema = z.uuid();

/** Optional caller-supplied key; retrying with the same key never applies a command twice. */
export const idempotencyKeySchema = z.string().min(8).max(128);

export const revisionSchema = z.int().nonnegative();

/** Epoch milliseconds (UTC). */
export const epochMsSchema = z.int().nonnegative();

export const durationMsSchema = z.int();

/**
 * Common envelope for every state-changing command.
 * `expectedRevision` enables optimistic concurrency; a mismatch yields `revision_conflict`.
 */
export function commandSchema<TType extends string, TPayload extends z.ZodType>(
  type: TType,
  payload: TPayload,
) {
  return z.object({
    commandId: commandIdSchema,
    type: z.literal(type),
    idempotencyKey: idempotencyKeySchema.optional(),
    expectedRevision: revisionSchema.optional(),
    payload,
  });
}

export const errorCodeSchema = z.enum([
  'validation_failed',
  'not_found',
  'forbidden',
  'revision_conflict',
  'invalid_transition',
  'idempotency_conflict',
  'internal',
]);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

export const errorResponseSchema = z.object({
  error: z.object({
    code: errorCodeSchema,
    message: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});
export type ErrorResponse = z.infer<typeof errorResponseSchema>;
