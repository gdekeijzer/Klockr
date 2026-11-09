import { MINUTE_MS } from '@klockr/domain';
import { afterEach, describe, expect, it } from 'vitest';
import { cookieFrom, nextEvent, startTestServer } from '../testing/harness';

type Server = Awaited<ReturnType<typeof startTestServer>>;
let server: Server | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

async function createShow(s: Server) {
  const res = await fetch(`${s.baseUrl}/api/v1/shows`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      durationMs: 10 * MINUTE_MS,
      timeZone: 'Europe/Amsterdam',
      scheduleDate: '2026-11-10',
    }),
  });
  const body = (await res.json()) as { showId: string; boardShareToken: string };
  return { ...body, cookie: cookieFrom(res.headers.getSetCookie()) };
}

function post(
  s: Server,
  show: { showId: string; cookie: string },
  body: object,
  headers: Record<string, string> = {},
) {
  return fetch(`${s.baseUrl}/api/v1/shows/${show.showId}/commands`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: show.cookie, ...headers },
    body: JSON.stringify({ commandId: crypto.randomUUID(), ...body }),
  });
}

describe('M3 over HTTP: scheduling, locks, Emergency Override, audit', () => {
  it('a locked edit is 423 LOCKED; an explicit override applies it and shows up in the audit trail', async () => {
    server = await startTestServer();
    const show = await createShow(server);
    const state = (await (
      await fetch(`${server.baseUrl}/api/v1/shows/${show.showId}/state`, {
        headers: { cookie: show.cookie },
      })
    ).json()) as {
      queues: { items: { id: string }[]; showSchedule: { timeZone: string } }[];
    };
    expect(state.queues[0]?.showSchedule.timeZone).toBe('Europe/Amsterdam');
    const itemId = state.queues[0]?.items[0]?.id ?? '';

    expect(
      (
        await post(server, show, {
          type: 'lock.set',
          payload: { target: { kind: 'item', id: itemId } },
        })
      ).status,
    ).toBe(200);
    const blocked = await post(server, show, {
      type: 'item.update',
      payload: { queueItemId: itemId, patch: { title: 'X' } },
    });
    expect(blocked.status).toBe(423);
    expect(((await blocked.json()) as { error: { code: string } }).error.code).toBe('locked');

    // Live transport is not blocked by the lock.
    expect(
      (await post(server, show, { type: 'timer.start', payload: { queueItemId: itemId } })).status,
    ).toBe(200);

    const forced = await post(server, show, {
      type: 'item.update',
      override: { reason: 'live correction' },
      payload: { queueItemId: itemId, patch: { title: 'Opening' } },
    });
    expect(forced.status).toBe(200);

    const audit = await fetch(`${server.baseUrl}/api/v1/shows/${show.showId}/audit`, {
      headers: { cookie: show.cookie },
    });
    expect(audit.status).toBe(200);
    const events = (
      (await audit.json()) as { events: { action: string; details: Record<string, unknown> }[] }
    ).events;
    expect(events.map((e) => e.action)).toEqual(['lock.override', 'lock.set']);
    expect(events[0]?.details).toMatchObject({ reason: 'live correction', command: 'item.update' });

    const asBoard = await fetch(`${server.baseUrl}/api/v1/shows/${show.showId}/audit`, {
      headers: { authorization: `Bearer ${show.boardShareToken}` },
    });
    expect(asBoard.status).toBe(401);
  });

  it('planning edits publish a Queue snapshot with the planning inputs; no per-second events', async () => {
    server = await startTestServer();
    const show = await createShow(server);
    const operator = server.connect({ role: 'operator', showId: show.showId }, show.cookie);
    const initial = await nextEvent(operator, 'show.snapshot');
    const itemId = initial.queues[0]?.items[0]?.id ?? '';
    const update = nextEvent(operator, 'show.state');
    const plannedStartAt = Date.UTC(2026, 10, 10, 8, 0);
    const res = await post(server, show, {
      type: 'item.setSchedule',
      payload: { queueItemId: itemId, plannedStartAt, fixedAnchor: true },
    });
    expect(res.status).toBe(200);
    const queue = (await update).queues[0];
    expect(queue?.items[0]).toMatchObject({
      plannedStartAt,
      fixedAnchor: true,
      actualStartAt: null,
    });
    expect(queue?.revision).toBe((initial.queues[0]?.revision ?? 0) + 1);
  });
});
