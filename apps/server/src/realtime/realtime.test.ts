import { deriveTimer, MINUTE_MS, type TimerState } from '@klockr/domain';
import { afterEach, describe, expect, it } from 'vitest';
import { connectError, cookieFrom, nextEvent, startTestServer } from '../testing/harness';

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
  const cookie = cookieFrom(res.headers.getSetCookie());
  const state = (await (
    await fetch(`${s.baseUrl}/api/v1/shows/${body.showId}/state`, { headers: { cookie } })
  ).json()) as { queues: { items: { id: string }[] }[] };
  return { ...body, cookie, itemId: state.queues[0]?.items[0]?.id ?? '' };
}

async function send(
  s: Server,
  show: { showId: string; cookie: string; itemId: string },
  type: string,
) {
  const res = await fetch(`${s.baseUrl}/api/v1/shows/${show.showId}/commands`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: show.cookie },
    body: JSON.stringify({
      commandId: crypto.randomUUID(),
      type,
      payload: { queueItemId: show.itemId },
    }),
  });
  expect(res.status).toBe(200);
}

describe('realtime', () => {
  it('a board receives a snapshot on connect and a new authoritative state on each operator action', async () => {
    server = await startTestServer();
    const show = await createShow(server);
    const board = server.connect({ role: 'board', boardShareToken: show.boardShareToken });
    const snapshot = await nextEvent(board, 'board.snapshot');
    expect(snapshot.queues[0]?.timers[0]).toMatchObject({ status: 'idle', revision: 0 });

    const update = nextEvent(board, 'timer.state');
    await send(server, show, 'timer.start');
    const started = await update;
    expect(started).toMatchObject({ status: 'running', revision: 1 });
    expect(started.serverTime).toBeGreaterThanOrEqual(started.startedAt ?? 0);
  });

  it('operators connect with the owner cookie and receive the management snapshot', async () => {
    server = await startTestServer();
    const show = await createShow(server);
    const operator = server.connect({ role: 'operator', showId: show.showId }, show.cookie);
    const snapshot = await nextEvent(operator, 'show.snapshot');
    expect(snapshot.show.id).toBe(show.showId);
  });

  it('rejects an operator without the owner cookie and a board with an invalid token', async () => {
    server = await startTestServer();
    const show = await createShow(server);
    const operator = server.connect({ role: 'operator', showId: show.showId });
    expect((await connectError(operator)).message).toBe('unauthorized');
    const board = server.connect({ role: 'board', boardShareToken: 'klb_not-a-real-token-at-all' });
    expect((await connectError(board)).message).toBe('unauthorized');
    // A board token presented as an operator credential is rejected too.
    const name = show.cookie.split('=')[0] ?? '';
    const sneaky = server.connect(
      { role: 'operator', showId: show.showId },
      `${name}=${show.boardShareToken}`,
    );
    expect((await connectError(sneaky)).message).toBe('unauthorized');
  });

  it('the server sends transitions only, never ticks', async () => {
    server = await startTestServer();
    const show = await createShow(server);
    const board = server.connect({ role: 'board', boardShareToken: show.boardShareToken });
    await nextEvent(board, 'board.snapshot');
    const received: unknown[] = [];
    board.on('timer.state', (t) => received.push(t));
    await send(server, show, 'timer.start');
    // Round-trip a clock ping: everything the server sent before the ack has arrived.
    await board.emitWithAck('clock.ping');
    await board.emitWithAck('clock.ping');
    expect(received).toHaveLength(1);
  });

  it('a reconnecting board receives the current authoritative revision', async () => {
    server = await startTestServer();
    const show = await createShow(server);
    const first = server.connect({ role: 'board', boardShareToken: show.boardShareToken });
    await nextEvent(first, 'board.snapshot');
    await send(server, show, 'timer.start');
    first.disconnect();

    // Changes happen while the board is away.
    await send(server, show, 'timer.pause');
    await send(server, show, 'timer.resume');

    const again = server.connect({ role: 'board', boardShareToken: show.boardShareToken });
    const snapshot = await nextEvent(again, 'board.snapshot');
    expect(snapshot.queues[0]?.timers[0]).toMatchObject({ status: 'running', revision: 3 });
  });

  it('a client can reconstruct the visible timer from the snapshot timestamps', async () => {
    server = await startTestServer();
    const show = await createShow(server);
    await send(server, show, 'timer.start');
    const board = server.connect({ role: 'board', boardShareToken: show.boardShareToken });
    const timer = (await nextEvent(board, 'board.snapshot')).queues[0]?.timers[0];
    if (!timer) throw new Error('board snapshot without timer');
    const state: TimerState = { ...timer };
    const at = timer.serverTime + 90_000;
    expect(deriveTimer(state, at).remainingMs).toBe(10 * MINUTE_MS - (at - (timer.startedAt ?? 0)));
  });

  it('answers clock pings with the server time', async () => {
    server = await startTestServer();
    const show = await createShow(server);
    const board = server.connect({ role: 'board', boardShareToken: show.boardShareToken });
    await nextEvent(board, 'board.snapshot');
    const before = Date.now();
    const ack = await board.emitWithAck('clock.ping');
    expect(ack.serverTime).toBeGreaterThanOrEqual(before);
  });
});
