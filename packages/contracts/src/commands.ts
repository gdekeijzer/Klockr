import { z } from 'zod';
import { boardCommandSchema } from './board';
import { queueCommandSchema } from './queue';
import { timerCommandSchema } from './timer';

/**
 * Everything `POST /api/v1/shows/:showId/commands` accepts: timer commands (timer.*) and Queue
 * commands (item.*, group.*, queue.*, show.*). One endpoint, one envelope, one application layer.
 */
export const showCommandSchema = z.discriminatedUnion('type', [
  ...timerCommandSchema.options,
  ...queueCommandSchema.options,
  ...boardCommandSchema.options,
]);
export type ShowCommandDto = z.infer<typeof showCommandSchema>;
