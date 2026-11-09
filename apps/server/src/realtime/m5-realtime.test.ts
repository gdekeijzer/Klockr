import { afterEach, describe, expect, it } from 'vitest';
import { connectError, cookieFrom, nextEvent, startTestServer } from '../testing/harness';

type Server = Awaited<ReturnType<typeof startTestServer>>;
let server: Server | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

async function post(s: Server, path: string, body: object, cookie?: string) {
  return fetch(`${s.baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}

async function eventWithShow(s: Server) {
  const res = await post(s, '/api/v1/events', { name: 'Congress', timeZone: 'Europe/Amsterdam' });
  expect(res.status).toBe(201);
  const { eventId } = (await res.json()) as { eventId: string };
  const cookie = cookieFrom(res.headers.getSetCookie());
  const cmd = async (type: string, payload: object) => {
    const r = await post(
      s,
      `/api/v1/events/${eventId}/commands`,
      { commandId: crypto.randomUUID(), type, payload },
      cookie,
    );
    expect(r.status).toBe(200);
    return (await r.json()) as { createdId: string | null };
  };
  const roomId = (await cmd('room.create', { name: 'Main Stage' })).createdId ?? '';
  const created = await post(
    s,
    `/api/v1/events/${eventId}/shows`,
    { title: 'Keynote', roomId },
    cookie,
  );
  expect(created.status).toBe(201);
  const { showId } = (await created.json()) as { showId: string };
  return { eventId, cookie, cmd, roomId, showId };
}

describe('M5 realtime: Event dashboard, Devices, share revocation', () => {
  it('the Event room gets a fresh state when a Show inside it changes; the event cookie manages that Show', async () => {
    server = await startTestServer();
    const e = await eventWithShow(server);
    const socket = server.connect({ role: 'event', eventId: e.eventId }, e.cookie);
    const first = await nextEvent(socket, 'event.state');
    expect(first.shows.map((s) => [s.title, s.roomId])).toEqual([['Keynote', e.roomId]]);
    const item = first.shows[0]?.current?.id ?? '';
    // The Event cookie is accepted for the Show's own command endpoint.
    const next = nextEvent(socket, 'event.state');
    const start = await post(
      server,
      `/api/v1/shows/${e.showId}/commands`,
      { commandId: crypto.randomUUID(), type: 'timer.start', payload: { queueItemId: item } },
      e.cookie,
    );
    expect(start.status).toBe(200);
    expect((await next).shows[0]?.currentTimer?.status).toBe('running');
    // An operator socket for the Show also authenticates with the Event cookie.
    const op = server.connect({ role: 'operator', showId: e.showId }, e.cookie);
    const snap = await nextEvent(op, 'show.snapshot');
    expect(snap.show.context).toMatchObject({ eventName: 'Congress', roomName: 'Main Stage' });
    // Without a cookie: rejected.
    const anon = server.connect({ role: 'event', eventId: e.eventId });
    expect((await connectError(anon)).message).toBe('unauthorized');
  });

  it('a paired Device follows its Board, is re-routed on reassignment and cut off when revoked', async () => {
    server = await startTestServer();
    const e = await eventWithShow(server);
    const agenda =
      (await e.cmd('board.create', { preset: 'room_agenda', roomId: e.roomId })).createdId ?? '';
    const pairing = (await (await post(server, '/api/v1/devices/pairing', {})).json()) as {
      code: string;
      pairingSecret: string;
    };
    const pending = await post(server, '/api/v1/devices/pairing/claim', {
      pairingSecret: pairing.pairingSecret,
    });
    expect(pending.status).toBe(202);
    const devices = await fetch(`${server.baseUrl}/api/v1/events/${e.eventId}/devices`, {
      headers: { cookie: e.cookie },
    });
    const { assignableBoards } = (await devices.json()) as {
      assignableBoards: { id: string; preset: string }[];
    };
    const speaker = assignableBoards.find((b) => b.preset === 'speaker_confidence')?.id ?? '';
    const paired = await post(
      server,
      `/api/v1/events/${e.eventId}/devices`,
      {
        commandId: crypto.randomUUID(),
        type: 'device.pair',
        payload: { code: pairing.code, name: 'Stage Monitor', boardId: speaker },
      },
      e.cookie,
    );
    expect(paired.status).toBe(200);
    const deviceId = ((await paired.json()) as { createdId: string }).createdId;
    const claim = await post(server, '/api/v1/devices/pairing/claim', {
      pairingSecret: pairing.pairingSecret,
    });
    const { deviceToken } = (await claim.json()) as { deviceToken: string };
    expect(deviceToken).toMatch(/^kld_/);

    const display = server.connect({ role: 'device', deviceToken });
    const first = await nextEvent(display, 'device.snapshot');
    expect(first.board?.board.preset).toBe('speaker_confidence');
    // Reassign -> the Device gets the new Board's projection without reconnecting.
    const rerouted = nextEvent(display, 'device.snapshot');
    await post(
      server,
      `/api/v1/events/${e.eventId}/devices`,
      {
        commandId: crypto.randomUUID(),
        type: 'device.assign',
        payload: { deviceId, boardId: agenda },
      },
      e.cookie,
    );
    expect((await rerouted).board?.board.id).toBe(agenda);
    // Revoke -> access.revoked, disconnected, and the credential no longer works.
    const revoked = nextEvent(display, 'access.revoked');
    await post(
      server,
      `/api/v1/events/${e.eventId}/devices`,
      { commandId: crypto.randomUUID(), type: 'device.revoke', payload: { deviceId } },
      e.cookie,
    );
    expect(await revoked).toEqual({ reason: 'device_revoked' });
    const state = await fetch(`${server.baseUrl}/api/v1/device/state`, {
      headers: { authorization: `Bearer ${deviceToken}` },
    });
    expect(state.status).toBe(401);
    const again = server.connect({ role: 'device', deviceToken });
    expect((await connectError(again)).message).toBe('unauthorized');
  });

  it('a revoked Board share is cut off immediately; a new link works', async () => {
    server = await startTestServer();
    const qt = await post(server, '/api/v1/shows', { durationMs: 60_000 });
    const { showId } = (await qt.json()) as { showId: string };
    const cookie = cookieFrom(qt.headers.getSetCookie());
    const created = await post(
      server,
      `/api/v1/shows/${showId}/board-shares`,
      { label: 'Lectern' },
      cookie,
    );
    expect(created.status).toBe(201);
    const share = (await created.json()) as { shareId: string; boardShareToken: string };
    const board = server.connect({ role: 'board', boardShareToken: share.boardShareToken });
    await nextEvent(board, 'board.snapshot');
    const list = await fetch(`${server.baseUrl}/api/v1/shows/${showId}/board-shares`, {
      headers: { cookie },
    });
    expect(
      ((await list.json()) as { shares: { label: string | null }[] }).shares.map((s) => s.label),
    ).toEqual([null, 'Lectern']);
    const revoked = nextEvent(board, 'access.revoked');
    expect(
      (
        await post(
          server,
          `/api/v1/shows/${showId}/board-shares/${share.shareId}/revoke`,
          {},
          cookie,
        )
      ).status,
    ).toBe(200);
    expect(await revoked).toEqual({ reason: 'share_revoked' });
    const read = await fetch(`${server.baseUrl}/api/v1/board/state`, {
      headers: { authorization: `Bearer ${share.boardShareToken}` },
    });
    expect(read.status).toBe(401);
    const fresh = (await (
      await post(server, `/api/v1/shows/${showId}/board-shares`, {}, cookie)
    ).json()) as {
      boardShareToken: string;
    };
    const ok = await fetch(`${server.baseUrl}/api/v1/board/state`, {
      headers: { authorization: `Bearer ${fresh.boardShareToken}` },
    });
    expect(ok.status).toBe(200);
  });
});
