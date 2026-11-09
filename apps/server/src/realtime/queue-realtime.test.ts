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
    body: JSON.stringify({ durationMs: 10 * MINUTE_MS }),
  });
  const body = (await res.json()) as { showId: string; boardShareToken: string };
  return { ...body, cookie: cookieFrom(res.headers.getSetCookie()) };
}

async function post(
  s: Server,
  show: { showId: string; cookie?: string },
  type: string,
  payload: object,
  headers: Record<string, string> = {},
) {
  return fetch(`${s.baseUrl}/api/v1/shows/${show.showId}/commands`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(show.cookie ? { cookie: show.cookie } : {}),
      ...headers,
    },
    body: JSON.stringify({ commandId: crypto.randomUUID(), type, payload }),
  });
}

async function command(
  s: Server,
  show: { showId: string; cookie: string },
  type: string,
  payload: object,
) {
  const res = await post(s, show, type, payload);
  expect(res.status).toBe(200);
  return (await res.json()) as {
    queue: {
      revision: number;
      currentItemId: string | null;
      nextItemId: string | null;
      items: { id: string; title: string }[];
    };
    createdId: string | null;
  };
}

describe('Queue commands over HTTP and realtime', () => {
  it('operators receive queue.state and the board follows Current automatically', async () => {
    server = await startTestServer();
    const show = await createShow(server);
    const operator = server.connect({ role: 'operator', showId: show.showId }, show.cookie);
    const initial = await nextEvent(operator, 'show.snapshot');
    const board = server.connect({ role: 'board', boardShareToken: show.boardShareToken });
    const boardInitial = await nextEvent(board, 'board.snapshot');
    expect(boardInitial.current?.title).toBe('Timer');

    const queueUpdate = nextEvent(operator, 'queue.state');
    const added = await command(server, show, 'item.add', {
      title: 'Speaker A',
      durationMs: 5 * MINUTE_MS,
      notes: 'secret note',
    });
    const update = await queueUpdate;
    expect(update.revision).toBe(initial.queue.revision + 1);
    expect(update.items.map((i) => i.title)).toEqual(['Timer', 'Speaker A']);
    expect(update.nextItemId).toBe(added.createdId);

    const boardUpdate = nextEvent(board, 'board.snapshot');
    const ended = await command(server, show, 'item.end', {
      queueItemId: initial.queue.currentItemId,
      next: true,
    });
    expect(ended.queue.currentItemId).toBe(added.createdId);
    const followed = await boardUpdate;
    expect(followed.current).toEqual({ id: added.createdId, title: 'Speaker A', subtitle: null });
    expect(followed.timer).toMatchObject({ status: 'idle', durationMs: 5 * MINUTE_MS });
    // The board never receives operator notes or the queue.
    expect(JSON.stringify(followed)).not.toContain('secret note');
  });

  it('a note item without timer can become current; the board shows it without timer', async () => {
    server = await startTestServer();
    const show = await createShow(server);
    const note = await command(server, show, 'item.add', {
      title: 'CEO arrives stage left',
      durationMs: null,
    });
    const board = server.connect({ role: 'board', boardShareToken: show.boardShareToken });
    await nextEvent(board, 'board.snapshot');
    const boardUpdate = nextEvent(board, 'board.snapshot');
    await command(server, show, 'queue.setCurrent', { queueItemId: note.createdId });
    const snapshot = await boardUpdate;
    expect(snapshot.current?.title).toBe('CEO arrives stage left');
    expect(snapshot.timer).toBeNull();
  });

  it('a board token can never send Queue commands', async () => {
    server = await startTestServer();
    const show = await createShow(server);
    const res = await post(
      server,
      { showId: show.showId },
      'item.add',
      { title: 'intrusion' },
      { authorization: `Bearer ${show.boardShareToken}` },
    );
    expect(res.status).toBe(401);
  });

  it('maps domain errors to HTTP: stale revision 409, invalid input 400, unknown item 404', async () => {
    server = await startTestServer();
    const show = await createShow(server);
    const stale = await fetch(`${server.baseUrl}/api/v1/shows/${show.showId}/commands`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: show.cookie },
      body: JSON.stringify({
        commandId: crypto.randomUUID(),
        type: 'item.add',
        expectedRevision: 42,
        payload: { title: 'x' },
      }),
    });
    expect(stale.status).toBe(409);
    expect((await post(server, show, 'item.add', { title: '' })).status).toBe(400);
    expect(
      (await post(server, show, 'item.delete', { queueItemId: crypto.randomUUID() })).status,
    ).toBe(404);
  });
});
