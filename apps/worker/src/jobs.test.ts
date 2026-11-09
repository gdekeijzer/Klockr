import { ManualClock, SECOND_MS } from '@klockr/domain';
import { describe, expect, it } from 'vitest';
import { runJobsOnce, type Job } from './jobs';

const silent = { info: () => undefined, error: () => undefined };

describe('runJobsOnce', () => {
  it('isolates a failing job from the others', async () => {
    const clock = new ManualClock();
    const ran: string[] = [];
    const jobs: Job[] = [
      { name: 'a', run: () => Promise.reject(new Error('boom')) },
      {
        name: 'b',
        run: () => {
          ran.push('b');
          clock.advance(SECOND_MS);
          return Promise.resolve();
        },
      },
    ];
    const reports = await runJobsOnce(jobs, clock, silent, new AbortController().signal);
    expect(reports).toEqual([
      { name: 'a', ok: false, durationMs: 0 },
      { name: 'b', ok: true, durationMs: SECOND_MS },
    ]);
    expect(ran).toEqual(['b']);
  });

  it('stops scheduling jobs after abort', async () => {
    const controller = new AbortController();
    controller.abort();
    const reports = await runJobsOnce(
      [{ name: 'never', run: () => Promise.resolve() }],
      new ManualClock(),
      silent,
      controller.signal,
    );
    expect(reports).toEqual([]);
  });
});
