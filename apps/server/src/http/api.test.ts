import { showStateSnapshotSchema } from '@klockr/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { cookieFrom, startTestServer } from '../testing/harness';

type Server = Awaited<ReturnType<typeof startTestServer>>;
let server: Server | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

async function createShow(s: Server, durationMs = 300_000) {
  const res = await s.app.inject({ method: 'POST', url: '/api/v1/shows', payload: { durationMs } });
  expect(res.statusCode).toBe(201);
  const body = res.json<{ showId: string; boardShareToken: string }>();
  const cookie = cookieFrom(res.headers['set-cookie']);
  const state = await s.app.inject({
    method: 'GET',
    url: `/api/v1/shows/${body.showId}/state`,
    headers: { cookie },
  });
  const itemId = showStateSnapshotSchema.parse(state.json()).queues[0]?.items[0]?.id ?? '';
  return { ...body, cookie, itemId, setCookie: res.headers['set-cookie'] };
}

function command(type: string, queueItemId: string, extra: Record<string, unknown> = {}) {
  return { commandId: crypto.randomUUID(), type, payload: { queueItemId, ...extra } };
}

describe('HTTP API', () => {
  it('creates an anonymous Show and sets an HttpOnly, SameSite=Strict owner cookie', async () => {
    server = await startTestServer();
    const show = await createShow(server);
    const header = String(show.setCookie);
    expect(header).toMatch(/HttpOnly/i);
    expect(header).toMatch(/SameSite=Strict/i);
    expect(header).not.toContain(show.boardShareToken);
    expect(show.boardShareToken).toMatch(/^klb_[A-Za-z0-9_-]{43}$/);
  });

  it('validates the create request', async () => {
    server = await startTestServer();
    const res = await server.app.inject({
      method: 'POST',
      url: '/api/v1/shows',
      payload: { durationMs: -5 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('owner reads state and runs timer commands; the response carries the new revision', async () => {
    server = await startTestServer();
    const show = await createShow(server);
    const res = await server.app.inject({
      method: 'POST',
      url: `/api/v1/shows/${show.showId}/commands`,
      headers: { cookie: show.cookie },
      payload: command('timer.start', show.itemId),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ timer: { status: 'running', revision: 1 } });

    const conflict = await server.app.inject({
      method: 'POST',
      url: `/api/v1/shows/${show.showId}/commands`,
      headers: { cookie: show.cookie },
      payload: command('timer.start', show.itemId),
    });
    expect(conflict.statusCode).toBe(409);
  });

  it('knowing the Show id alone grants nothing', async () => {
    server = await startTestServer();
    const show = await createShow(server);
    const state = await server.app.inject({
      method: 'GET',
      url: `/api/v1/shows/${show.showId}/state`,
    });
    expect(state.statusCode).toBe(401);
    const cmd = await server.app.inject({
      method: 'POST',
      url: `/api/v1/shows/${show.showId}/commands`,
      payload: command('timer.start', show.itemId),
    });
    expect(cmd.statusCode).toBe(401);
  });

  it('board token reads the Board projection but can never mutate or read management state', async () => {
    server = await startTestServer();
    const show = await createShow(server);
    const auth = { authorization: `Bearer ${show.boardShareToken}` };

    const board = await server.app.inject({
      method: 'GET',
      url: '/api/v1/board/state',
      headers: auth,
    });
    expect(board.statusCode).toBe(200);
    expect(Object.keys(board.json<object>()).sort()).toEqual([
      'board',
      'messages',
      'queues',
      'serverTime',
      'timeZone',
      'version',
    ]);

    const asBearer = await server.app.inject({
      method: 'POST',
      url: `/api/v1/shows/${show.showId}/commands`,
      headers: auth,
      payload: command('timer.start', show.itemId),
    });
    expect(asBearer.statusCode).toBe(401);

    const boardCookieName = show.cookie.split('=')[0] ?? '';
    const asCookie = await server.app.inject({
      method: 'POST',
      url: `/api/v1/shows/${show.showId}/commands`,
      headers: { cookie: `${boardCookieName}=${show.boardShareToken}` },
      payload: command('timer.start', show.itemId),
    });
    expect(asCookie.statusCode).toBe(401);
    const share = await server.app.inject({
      method: 'POST',
      url: `/api/v1/shows/${show.showId}/board-shares`,
      headers: auth,
    });
    expect(share.statusCode).toBe(401);
  });

  it('an owner cookie of Show A does not work for Show B', async () => {
    server = await startTestServer();
    const a = await createShow(server);
    const b = await createShow(server);
    const tokenA = a.cookie.split('=')[1] ?? '';
    const cookieNameB = b.cookie.split('=')[0] ?? '';
    const res = await server.app.inject({
      method: 'POST',
      url: `/api/v1/shows/${b.showId}/commands`,
      headers: { cookie: `${cookieNameB}=${tokenA}` },
      payload: command('timer.start', b.itemId),
    });
    expect(res.statusCode).toBe(403);
  });

  it('owner can create an additional board share', async () => {
    server = await startTestServer();
    const show = await createShow(server);
    const res = await server.app.inject({
      method: 'POST',
      url: `/api/v1/shows/${show.showId}/board-shares`,
      headers: { cookie: show.cookie },
    });
    expect(res.statusCode).toBe(201);
    const token = res.json<{ boardShareToken: string }>().boardShareToken;
    const board = await server.app.inject({
      method: 'GET',
      url: '/api/v1/board/state',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(board.statusCode).toBe(200);
  });

  it('rejects malformed commands', async () => {
    server = await startTestServer();
    const show = await createShow(server);
    const res = await server.app.inject({
      method: 'POST',
      url: `/api/v1/shows/${show.showId}/commands`,
      headers: { cookie: show.cookie },
      payload: { type: 'timer.start' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rate-limits anonymous Show creation', async () => {
    server = await startTestServer();
    const codes: number[] = [];
    for (let i = 0; i < 22; i++) {
      const res = await server.app.inject({
        method: 'POST',
        url: '/api/v1/shows',
        payload: { durationMs: 60_000 },
      });
      codes.push(res.statusCode);
    }
    expect(codes.filter((c) => c === 201)).toHaveLength(20);
    expect(codes.at(-1)).toBe(429);
  });
});
