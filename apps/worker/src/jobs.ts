import type { Clock, EpochMs } from '@klockr/domain';

/**
 * Background job boundary (ADR-0010). Jobs are non-live work: expiry cleanup, lifecycle
 * warnings, email, housekeeping. They must be idempotent/retry-safe and must never own
 * authoritative live timer state. State changes go through @klockr/application commands.
 */
export interface JobContext {
  readonly now: EpochMs;
  readonly signal: AbortSignal;
}

export interface Job {
  readonly name: string;
  run(context: JobContext): Promise<void>;
}

export interface JobLogger {
  info(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

export interface JobRunReport {
  readonly name: string;
  readonly ok: boolean;
  readonly durationMs: number;
}

/** Runs each job once, isolating failures so one broken job never blocks the others. */
export async function runJobsOnce(
  jobs: readonly Job[],
  clock: Clock,
  logger: JobLogger,
  signal: AbortSignal,
): Promise<JobRunReport[]> {
  const reports: JobRunReport[] = [];
  for (const job of jobs) {
    if (signal.aborted) break;
    const started = clock.now();
    try {
      await job.run({ now: started, signal });
      reports.push({ name: job.name, ok: true, durationMs: clock.now() - started });
    } catch (error) {
      logger.error({ job: job.name, err: error }, 'job failed');
      reports.push({ name: job.name, ok: false, durationMs: clock.now() - started });
    }
  }
  return reports;
}

/**
 * Registered jobs. Intentionally empty in M0: anonymous cleanup/email jobs arrive with the
 * milestones that define their behavior (M1 lifecycle metadata, M7 cleanup hardening).
 */
export const jobs: readonly Job[] = [];
