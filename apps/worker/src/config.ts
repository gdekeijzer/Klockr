import { z } from 'zod';

const envSchema = z.object({
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  WORKER_INTERVAL_MS: z.coerce.number().int().min(1_000).default(60_000),
  DATABASE_URL: z.url().optional(),
  KLOCKR_VERSION: z.string().default('0.0.0-dev'),
});

export type WorkerConfig = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  return envSchema.parse(env);
}
