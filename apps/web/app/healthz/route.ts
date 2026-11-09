import type { HealthResponse } from '@klockr/contracts';

export const dynamic = 'force-dynamic';

export function GET(): Response {
  const body: HealthResponse = {
    status: 'ok',
    service: 'web',
    version: process.env.KLOCKR_VERSION ?? '0.0.0-dev',
    time: new Date().toISOString(),
  };
  return Response.json(body);
}
