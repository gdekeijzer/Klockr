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

async function command(
  s: Server,
  show: { showId: string; cookie: string },
  type: string,
  payload: object,
) {
  const res = await fetch(`${s.baseUrl}/api/v1/shows/${show.showId}/commands`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: show.cookie },
    body: JSON.stringify({ commandId: crypto.randomUUID(), type, payload }),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as {
    createdId: string | null;
    state: { queues: { id: string; items: { id: string }[] }[] };
  };
}

describe('M4 realtime: scoped Board projections, Show state, messages', () => {
  it('each Board receives only its own scoped projection on every Show commit', async () => {
    server = await startTestServer();
    const show = await createShow(server);
    const audio = (await command(server, show, 'queue.create', { name: 'Audio' })).createdId ?? '';
    const mic =
      (
        await command(server, show, 'item.add', {
          title: 'Keynote mic',
          queueId: audio,
          durationMs: MINUTE_MS,
        })
      ).createdId ?? '';
    const foh =
      (await command(server, show, 'board.create', { preset: 'production' })).createdId ?? '';
    const state = await command(server, show, 'board.update', {
      boardId: foh,
      sources: { kind: 'queues', queueIds: [audio] },
    });
    expect(state.state.queues).toHaveLength(2);

    const share = await fetch(`${server.baseUrl}/api/v1/shows/${show.showId}/board-shares`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: show.cookie },
      body: JSON.stringify({ boardId: foh }),
    });
    expect(share.status).toBe(201);
    const { boardShareToken: fohToken } = (await share.json()) as { boardShareToken: string };

    const speaker = server.connect({ role: 'board', boardShareToken: show.boardShareToken });
    const production = server.connect({ role: 'board', boardShareToken: fohToken });
    const operator = server.connect({ role: 'operator', showId: show.showId }, show.cookie);
    expect((await nextEvent(speaker, 'board.snapshot')).queues.map((q) => q.name)).toEqual([
      'Program',
    ]);
    expect((await nextEvent(production, 'board.snapshot')).queues.map((q) => q.name)).toEqual([
      'Audio',
    ]);
    await nextEvent(operator, 'show.snapshot');

    const speakerNext = nextEvent(speaker, 'board.snapshot');
    const productionNext = nextEvent(production, 'board.snapshot');
    const operatorNext = nextEvent(operator, 'show.state');
    await command(server, show, 'message.send', {
      text: 'WRAP UP',
      audiences: ['stage'],
      priority: 'urgent',
      ttlMs: 60_000,
    });
    await command(server, show, 'queue.setCurrent', { queueItemId: mic });
    const s1 = await speakerNext;
    const p1 = await productionNext;
    expect(s1.messages.map((m) => m.text)).toEqual(['WRAP UP']);
    expect(p1.messages).toEqual([]);
    expect(JSON.stringify(s1)).not.toContain('Keynote mic');
    expect((await operatorNext).messages.map((m) => m.text)).toEqual(['WRAP UP']);

    const preview = await fetch(
      `${server.baseUrl}/api/v1/shows/${show.showId}/boards/${foh}/preview`,
      { headers: { cookie: show.cookie } },
    );
    expect(preview.status).toBe(200);
    const asBoard = await fetch(
      `${server.baseUrl}/api/v1/shows/${show.showId}/boards/${foh}/preview`,
      { headers: { authorization: `Bearer ${fohToken}` } },
    );
    expect(asBoard.status).toBe(401);
  });
});
