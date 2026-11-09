import { z } from 'zod';

const envSchema = z.object({
  SERVER_HOST: z.string().default('127.0.0.1'),
  SERVER_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.url().optional(),
  KLOCKR_VERSION: z.string().default('0.0.0-dev'),
  /** Secure attribute on credential cookies; enable whenever served over HTTPS. */
  COOKIE_SECURE: z.stringbool().default(false),
  /** Apply pending migrations at startup (local dev/test convenience; ACC/PRD migrate explicitly). */
  MIGRATE_ON_START: z.stringbool().default(false),
  /**
   * Public origin of this environment (ACC `https://acc.klockr.live`, PRD `https://klockr.live`)
   * for absolute links built without a request (e.g. future e-mails). Never hardcoded; browser
   * traffic stays same-origin and does not depend on it.
   */
  KLOCKR_PUBLIC_URL: z.url().optional(),
});

export type ServerConfig = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  return envSchema.parse(env);
}
