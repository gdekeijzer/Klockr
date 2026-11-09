import {
  attachShowToEvent,
  authenticateDevice,
  authenticateToken,
  claimPairing,
  createEvent,
  createScopedBoardShare,
  createShowInEvent,
  duplicateShow,
  executeDeviceCommand,
  executeEventCommand,
  getDeviceDisplay,
  getShowStateWithContext,
  GrantAuthorizer,
  readSharedBoard,
  revokeBoardShare,
  runShowTimerCommand,
  startPairing,
  type PlatformDeps,
} from '@klockr/application';
import { FakeTokenService, RecordingEventPublisher } from '@klockr/application/testing';
import { DeviceId, EventId, ManualClock, MINUTE_MS, ShowId } from '@klockr/domain';
import { randomUUID } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type DatabaseHandle } from './client';
import { migrationsFolder, runMigrations } from './migrate';
import { PgIdempotencyStore, PgShowStore } from './repositories';

const url = process.env.DATABASE_URL ?? 'postgres://klockr:klockr@localhost:54329/klockr_dev';
const handle = createDatabase(url);
const tokens = new FakeTokenService(randomUUID().slice(0, 8));

beforeAll(async () => {
  await runMigrations(handle);
});
afterAll(async () => {
  await handle.close();
});

/** Fresh adapters per call = a server restart (nothing kept in memory). */
function services(clock: ManualClock, db: DatabaseHandle = handle): PlatformDeps {
  const store = new PgShowStore(db.db);
  return {
    clock,
    shows: store,
    state: store,
    timers: store,
    grants: store,
    audit: store,
    locator: store,
    tokens,
    ids: { uuid: () => randomUUID() },
    idempotency: new PgIdempotencyStore(db.db),
    events: new RecordingEventPublisher(),
    authorizer: new GrantAuthorizer({ grants: store, locator: store, clock }),
    eventStore: store,
    deviceStore: store,
    presence: { isConnected: () => false },
  };
}

async function eventSetup() {
  const clock = new ManualClock(Date.UTC(2026, 10, 10, 8, 0));
  const created = await createEvent(
    {
      name: 'Congress',
      timeZone: 'Europe/Amsterdam',
      startsAt: clock.now(),
      endsAt: clock.now() + 8 * 3_600_000,
    },
    services(clock),
  );
  if (!created.ok) throw new Error('event');
  const principal = await authenticateToken(created.value.ownerToken, 'event', services(clock));
  if (!principal) throw new Error('auth');
  const ctx = { actor: principal.actor };
  const eventId = created.value.eventId;
  const run = async (body: Omit<Parameters<typeof executeEventCommand>[1], 'commandId'>) => {
    const r = await executeEventCommand(
      eventId,
      { commandId: randomUUID(), ...body } as Parameters<typeof executeEventCommand>[1],
      ctx,
      services(clock),
    );
    if (!r.ok) throw new Error(`${body.type}: ${r.error.message}`);
    return r.value;
  };
  return { clock, ctx, eventId, run };
}

describe('M5 persistence (PostgreSQL)', () => {
  it('Events, Rooms and the Show hierarchy survive a restart; duplication persists clean', async () => {
    const { clock, ctx, eventId, run } = await eventSetup();
    const main =
      (await run({ type: 'room.create', payload: { name: 'Main Stage' } })).createdId ?? '';
    const tent = (await run({ type: 'room.create', payload: { name: 'Tent A' } })).createdId ?? '';
    const keynote = await createShowInEvent(
      eventId,
      { title: 'Keynote', roomId: main },
      ctx,
      services(clock),
    );
    const workshop = await createShowInEvent(eventId, { title: 'Workshop' }, ctx, services(clock));
    if (!keynote.ok || !workshop.ok) throw new Error('shows');
    await run({ type: 'show.place', payload: { showId: workshop.value.showId, roomId: tent } });
    await run({ type: 'lock.set', payload: { target: { kind: 'room', id: tent } } });
    await run({ type: 'board.create', payload: { preset: 'room_agenda', roomId: main } });

    // Start the Keynote timer, then duplicate it into the Tent.
    const store = new PgShowStore(handle.db);
    const ks = await store.loadShowAggregate(keynote.value.showId);
    const item = ks?.queues[0]?.items[0]?.id ?? '';
    const started = await runShowTimerCommand(
      keynote.value.showId,
      { commandId: randomUUID(), type: 'timer.start', payload: { queueItemId: item } },
      ctx,
      services(clock),
    );
    expect(started.ok).toBe(true);
    const dup = await duplicateShow(keynote.value.showId, { roomId: null }, ctx, services(clock));
    if (!dup.ok) throw new Error(dup.error.message);

    // Restart: brand-new adapters.
    const fresh = new PgShowStore(handle.db);
    const event = await fresh.loadEvent(EventId(eventId));
    expect(event?.rooms.map((r) => r.name)).toEqual(['Main Stage', 'Tent A']);
    expect(event?.locks.map((l) => l.target)).toEqual([{ kind: 'room', id: tent }]);
    expect(event?.boards.map((b) => b.sources)).toEqual([{ kind: 'room', roomId: main }]);
    expect(
      event?.shows
        .map((s) => [s.showId, s.roomId])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    ).toEqual(
      [
        [keynote.value.showId, main],
        [workshop.value.showId, tent],
        [dup.value.showId, null],
      ].sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    );
    const meta = await fresh.getShow(keynote.value.showId);
    expect(meta).toMatchObject({ eventId, roomId: main });
    expect(meta?.schedule.timeZone).toBe('Europe/Amsterdam');
    const copy = await fresh.loadShowAggregate(dup.value.showId);
    expect(copy?.queues[0]?.items[0]?.timer?.status).toBe('idle');
    expect(copy?.queues[0]?.queue.currentItemId).toBeNull();
    expect(
      (await fresh.loadShowAggregate(keynote.value.showId))?.queues[0]?.items[0]?.timer?.status,
    ).toBe('running');
    const withCtx = await getShowStateWithContext(keynote.value.showId, ctx, services(clock));
    expect(withCtx.ok && withCtx.value.show.context).toMatchObject({ roomName: 'Main Stage' });

    // Detach persists; the Room FK keeps Rooms inside their Event.
    await run({ type: 'show.detach', payload: { showId: dup.value.showId } });
    expect((await fresh.getShow(dup.value.showId))?.eventId).toBeNull();
    await expect(
      handle.pool.query('update shows set room_id = $1 where id = $2', [main, dup.value.showId]),
    ).rejects.toThrow();
  });

  it('attach an M1-style standalone Show; Devices and share links survive restarts and revocations', async () => {
    const { clock, ctx, eventId } = await eventSetup();
    const solo = await createShowInEvent(eventId, { title: 'Solo' }, ctx, services(clock));
    if (!solo.ok) throw new Error('solo');
    const ownerPrincipal = await authenticateToken(solo.value.ownerToken, 'owner', services(clock));
    if (!ownerPrincipal) throw new Error('owner');
    // Already attached -> attaching again is refused.
    const twice = await attachShowToEvent(
      eventId,
      { showId: solo.value.showId },
      { event: ctx, show: { actor: ownerPrincipal.actor } },
      services(clock),
    );
    expect(twice.ok).toBe(false);

    const scope = { showId: null, eventId: EventId(eventId) };
    const pairing = await startPairing(services(clock));
    const speakerBoard = (await new PgShowStore(handle.db).loadShowAggregate(solo.value.showId))
      ?.boards[0]?.id;
    const paired = await executeDeviceCommand(
      scope,
      {
        commandId: randomUUID(),
        type: 'device.pair',
        payload: { code: pairing.code, name: 'FOH', boardId: speakerBoard ?? null },
      },
      ctx,
      services(clock),
    );
    if (!paired.ok) throw new Error(paired.error.message);
    const claim = await claimPairing(pairing.pairingSecret, services(clock));
    if (claim.status !== 'paired') throw new Error('claim');
    // Restart: the credential still works and still shows its Board.
    const device = await authenticateDevice(claim.deviceToken, services(clock));
    if (!device) throw new Error('device');
    expect((await getDeviceDisplay(device, services(clock))).board?.board.id).toBe(speakerBoard);
    expect(await claimPairing(pairing.pairingSecret, services(clock))).toEqual({
      status: 'expired',
    });

    // Pairing codes expire.
    const late = await startPairing(services(clock));
    clock.advance(11 * MINUTE_MS);
    const expired = await executeDeviceCommand(
      scope,
      { commandId: randomUUID(), type: 'device.pair', payload: { code: late.code, name: 'Late' } },
      ctx,
      services(clock),
    );
    expect(expired.ok).toBe(false);

    await executeDeviceCommand(
      scope,
      { commandId: randomUUID(), type: 'device.revoke', payload: { deviceId: device.id } },
      ctx,
      services(clock),
    );
    expect(await authenticateDevice(claim.deviceToken, services(clock))).toBeNull();
    expect(
      (await new PgShowStore(handle.db).findDevice(DeviceId(device.id)))?.revokedAt,
    ).not.toBeNull();

    // Share links: create, read, revoke — revocation persists.
    const showScope = { showId: ShowId(solo.value.showId), eventId: null };
    const share = await createScopedBoardShare(
      showScope,
      { label: 'Lectern' },
      ctx,
      services(clock),
    );
    if (!share.ok) throw new Error('share');
    const reader = await authenticateToken(share.value.boardShareToken, 'board', services(clock));
    if (!reader) throw new Error('reader');
    expect(
      (await readSharedBoard(share.value.boardId, { actor: reader.actor }, services(clock))).ok,
    ).toBe(true);
    await revokeBoardShare(showScope, share.value.shareId, ctx, services(clock));
    expect(
      await authenticateToken(share.value.boardShareToken, 'board', services(clock)),
    ).toBeNull();
    const { rows } = await handle.pool.query<{ action: string }>(
      'select action from audit_events where event_id = $1 or show_id = $2 order by seq',
      [eventId, solo.value.showId],
    );
    expect(rows.map((r) => r.action)).toEqual(
      expect.arrayContaining([
        'show.create',
        'device.pair',
        'device.revoke',
        'board.share.create',
        'board.share.revoke',
      ]),
    );
  });
});

describe('M4 -> M5 migration on a database with M4 data', () => {
  const dbName = `klockr_m5mig_${randomUUID().slice(0, 8)}`;
  const admin = new pg.Pool({ connectionString: url, max: 1 });
  const target = url.replace(/\/[^/?]+(\?|$)/, `/${dbName}$1`);
  let m4: DatabaseHandle;
  let folder: string;

  beforeAll(async () => {
    await admin.query(`create database ${dbName}`);
    m4 = createDatabase(target);
    // The scratch database is force-dropped at the end; connections terminated by that drop
    // must not surface as unhandled errors.
    m4.pool.on('error', () => undefined);
    // Migrations 0000-0006 only (= the schema ACC runs with M4).
    folder = mkdtempSync(join(tmpdir(), 'klockr-m4-'));
    cpSync(migrationsFolder, folder, { recursive: true });
    const journalPath = join(folder, 'meta', '_journal.json');
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: { idx: number }[] };
    writeFileSync(
      journalPath,
      JSON.stringify({ ...journal, entries: journal.entries.filter((e) => e.idx <= 6) }),
    );
    await runMigrations(m4, folder);
  });
  afterAll(async () => {
    await m4.close();
    await admin.query(`drop database if exists ${dbName} with (force)`);
    await admin.end();
    rmSync(folder, { recursive: true, force: true });
  });

  it('keeps M4 Shows standalone and valid, Boards and credentials intact', async () => {
    const show = randomUUID();
    const queue = randomUUID();
    const item = randomUUID();
    const board = randomUUID();
    const ownerToken = tokens.issue('owner');
    const boardToken = tokens.issue('board');
    const now = new Date('2026-11-09T10:00:00Z');
    const q = (sql: string, params: unknown[]) => m4.pool.query(sql, params);
    // M4-shaped rows written with the M4 schema (no M5 columns exist yet).
    await q(
      `insert into shows (id, title, ownership, primary_queue_id, created_at, last_active_at, expires_at, time_zone, revision)
       values ($1, 'ACC Show', 'anonymous', $2, $3, $3, $3::timestamptz + interval '7 days', 'Europe/Amsterdam', 12)`,
      [show, queue, now],
    );
    await q(
      `insert into queues (id, show_id, name, discipline, position, current_item_id, revision) values ($1, $2, 'Program', 'Program', 0, null, 3)`,
      [queue, show],
    );
    await q(
      `insert into queue_items (id, queue_id, title, position, created_at, updated_at) values ($1, $2, 'Keynote', 0, $3, $3)`,
      [item, queue, now],
    );
    await q(`update queues set current_item_id = $1 where id = $2`, [item, queue]);
    await q(
      `insert into item_timers (queue_item_id, mode, status, duration_ms, adjustment_ms, paused_total_ms, started_at, revision, updated_at)
       values ($1, 'countdown', 'running', 600000, 0, 0, $2, 2, $2)`,
      [item, now],
    );
    await q(
      `insert into boards (id, show_id, preset, name, audience, source_mode, follow_primary, created_at)
       values ($1, $2, 'production', 'FOH', 'production', 'all', false, $3)`,
      [board, show, now],
    );
    await q(
      `insert into access_grants (id, kind, show_id, board_id, token_hash, created_at) values
       ($1, 'anonymous_owner', $2, null, $3, $5), ($4, 'board_share', $2, $6, $7, $5)`,
      [randomUUID(), show, ownerToken.hash, randomUUID(), now, board, boardToken.hash],
    );
    await q(
      `insert into audit_events (id, show_id, at, actor_kind, actor_id, action, resource_kind, resource_id, details)
       values ($1, $2, $3, 'management_grant', 'g', 'lock.set', 'show', $4, '{}')`,
      [randomUUID(), show, now, show],
    );

    // Upgrade to M5 (what the ACC `migrate` job does).
    await runMigrations(m4);

    const clock = new ManualClock(now.getTime() + 60_000);
    const deps = services(clock, m4);
    const store = new PgShowStore(m4.db);
    const meta = await store.getShow(ShowId(show));
    expect(meta).toMatchObject({ eventId: null, roomId: null, title: 'ACC Show' });
    const agg = await store.loadShowAggregate(ShowId(show));
    expect(agg?.revision).toBe(12);
    expect(agg?.queues[0]?.items[0]?.timer).toMatchObject({ status: 'running', revision: 2 });
    expect(agg?.boards[0]).toMatchObject({
      name: 'FOH',
      showId: show,
      eventId: null,
      sources: { kind: 'all' },
    });
    const owner = await authenticateToken(ownerToken.token, 'owner', deps);
    expect(owner?.grant).toMatchObject({ showId: show, eventId: null, label: null });
    const reader = await authenticateToken(boardToken.token, 'board', deps);
    if (!reader) throw new Error('board token');
    const read = await readSharedBoard(board, { actor: reader.actor }, deps);
    expect(read.ok && read.value.board.name).toBe('FOH');
    const audit = await store.listAudit(ShowId(show), 10);
    expect(audit.map((a) => a.action)).toEqual(['lock.set']);
    // The upgraded Show can join a new Event.
    const event = await createEvent({ name: 'ACC Event', timeZone: 'Europe/Amsterdam' }, deps);
    if (!event.ok || !owner) throw new Error('event');
    const ev = await authenticateToken(event.value.ownerToken, 'event', deps);
    if (!ev) throw new Error('event owner');
    const attached = await attachShowToEvent(
      event.value.eventId,
      { showId: show },
      { event: { actor: ev.actor }, show: { actor: owner.actor } },
      deps,
    );
    expect(attached.ok).toBe(true);
    expect((await store.getShow(ShowId(show)))?.eventId).toBe(event.value.eventId);
  });
});
