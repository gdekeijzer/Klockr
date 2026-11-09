import { healthResponseSchema } from '@klockr/contracts';
import { ManualClock } from '@klockr/domain';
import { describe, expect, it } from 'vitest';
import { buildApp } from './app';

describe('server health', () => {
  it('GET /health returns a valid liveness response', async () => {
    const clock = new ManualClock(Date.UTC(2026, 10, 9, 12, 0, 0));
    const app = await buildApp({ version: 'test', logLevel: 'silent', clock });
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    const body = healthResponseSchema.parse(res.json());
    expect(body).toMatchObject({
      status: 'ok',
      service: 'server',
      time: '2026-11-09T12:00:00.000Z',
    });
    await app.close();
  });

  it('GET /health/ready skips the database check when none is configured', async () => {
    const app = await buildApp({ version: 'test', logLevel: 'silent' });
    const res = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ checks: { database: 'skipped' } });
    await app.close();
  });

  it('GET /health/ready reports 503 when the database is unreachable', async () => {
    const app = await buildApp({
      version: 'test',
      logLevel: 'silent',
      checkDatabase: () => Promise.resolve(false),
    });
    const res = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ status: 'degraded', checks: { database: 'fail' } });
    await app.close();
  });
});
