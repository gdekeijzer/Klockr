import { z } from 'zod';

export const healthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  service: z.enum(['web', 'server', 'worker']),
  version: z.string(),
  time: z.iso.datetime(),
  checks: z.record(z.string(), z.enum(['ok', 'fail', 'skipped'])).optional(),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;
