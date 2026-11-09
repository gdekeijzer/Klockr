import type { DeviceCommandDto, EventCommandDto } from '@klockr/contracts';
import { DeviceId, EventId, ManualClock, MINUTE_MS, ShowId } from '@klockr/domain';
import { beforeEach, describe, expect, it } from 'vitest';
import { authenticateToken } from '../auth';
import { GrantAuthorizer } from '../auth/grant-authorizer';
import type { CommandContext } from '../command';
import {
  authenticateDevice,
  claimPairing,
  createScopedBoardShare,
  executeDeviceCommand,
  getDeviceDisplay,
  listBoardShares,
  listDevices,
  readSharedBoard,
  revokeBoardShare,
  startPairing,
} from '../device';
import { executeShowCommand } from '../queue';
import { createQuickTimer, runShowTimerCommand } from '../show';
import {
  FakeTokenService,
  InMemoryIdempotencyStore,
  InMemoryStore,
  RecordingEventPublisher,
  SequentialIds,
} from '../testing';
import {
  attachShowToEvent,
  createEvent,
  createShowInEvent,
  duplicateShow,
  executeEventCommand,
  getEventState,
  getShowStateWithContext,
  type PlatformDeps,
} from './event-service';

let seq = 0;
const cid = () => `00000000-0000-4000-9000-${String(++seq).padStart(12, '0')}`;
type EventBody = Omit<EventCommandDto, 'commandId'>;
type DeviceBody = Omit<DeviceCommandDto, 'commandId'>;

describe('M5 Events, Rooms, Shows, Devices and share links (application)', () => {
  let clock: ManualClock;
  let store: InMemoryStore;
  let events: RecordingEventPublisher;
  let deps: PlatformDeps;
  let eventId: string;
  let eventOwner: CommandContext;
  const connected = new Set<string>();

  beforeEach(async () => {
    clock = new ManualClock(Date.UTC(2026, 10, 10, 8, 0));
    store = new InMemoryStore();
    events = new RecordingEventPublisher();
    connected.clear();
    deps = {
      clock,
      shows: store,
      state: store,
      timers: store,
      grants: store,
      audit: store,
      locator: store,
      tokens: new FakeTokenService(),
      ids: new SequentialIds(),
      idempotency: new InMemoryIdempotencyStore(),
      events,
      authorizer: new GrantAuthorizer({ grants: store, locator: store, clock }),
      eventStore: store,
      deviceStore: store,
      presence: { isConnected: (id) => connected.has(id) },
    };
    const created = await createEvent(
      {
        name: 'Congress 2026',
        timeZone: 'Europe/Amsterdam',
        startsAt: Date.UTC(2026, 10, 10, 8, 0),
        endsAt: Date.UTC(2026, 10, 10, 18, 0),
      },
      deps,
    );
    if (!created.ok) throw new Error('setup');
    eventId = created.value.eventId;
    const principal = await authenticateToken(created.value.ownerToken, 'event', deps);
    if (!principal) throw new Error('setup');
    eventOwner = { actor: principal.actor };
  });

  const run = (body: EventBody, ctx: CommandContext = eventOwner) =>
    executeEventCommand(eventId, { commandId: cid(), ...body } as EventCommandDto, ctx, deps);
  async function ok(body: EventBody, ctx: CommandContext = eventOwner) {
    const r = await run(body, ctx);
    if (!r.ok) throw new Error(`${body.type}: ${r.error.code} ${r.error.message}`);
    return r.value;
  }
  const room = async (name: string) =>
    (await ok({ type: 'room.create', payload: { name } })).createdId ?? '';
  async function newShow(title: string, roomId: string | null = null) {
    const r = await createShowInEvent(eventId, { title, roomId }, eventOwner, deps);
    if (!r.ok) throw new Error(r.error.message);
    return r.value.showId;
  }
  async function state() {
    const r = await getEventState(eventId, eventOwner, deps);
    if (!r.ok) throw new Error('state');
    return r.value;
  }
  async function standalone() {
    const created = await createQuickTimer({ durationMs: 5 * MINUTE_MS }, deps);
    if (!created.ok) throw new Error('qt');
    const o = await authenticateToken(created.value.ownerToken, 'owner', deps);
    if (!o) throw new Error('owner');
    return { showId: created.value.showId, owner: { actor: o.actor } as CommandContext };
  }

  describe('Events and Rooms', () => {
    it('Event CRUD + Room CRUD with revisions and audit', async () => {
      const main = await room('Main Stage');
      const breakout = await room('Breakout Room 1');
      await ok({ type: 'room.update', payload: { roomId: breakout, name: 'Tent A' } });
      await ok({ type: 'room.move', payload: { roomId: breakout, index: 0 } });
      await ok({ type: 'event.update', payload: { status: 'active', description: 'Day one' } });
      const s = await state();
      expect(s.event).toMatchObject({
        name: 'Congress 2026',
        status: 'active',
        description: 'Day one',
      });
      expect(s.rooms.map((r) => r.name)).toEqual(['Tent A', 'Main Stage']);
      expect(s.revision).toBe(5);
      await ok({ type: 'room.delete', payload: { roomId: main } });
      expect((await state()).rooms.map((r) => r.id)).toEqual([breakout]);
      expect(store.audit.map((a) => a.action)).toEqual([
        'room.create',
        'room.create',
        'room.update',
        'room.move',
        'event.update',
        'room.delete',
      ]);
      expect(store.audit.every((a) => a.eventId === eventId && a.showId === null)).toBe(true);
    });

    it('revision conflict and idempotent replay', async () => {
      await room('Main Stage');
      const stale = await run({ type: 'room.create', payload: { name: 'X' }, expectedRevision: 0 });
      expect(!stale.ok && stale.error.code).toBe('revision_conflict');
      const once = {
        type: 'room.create',
        payload: { name: 'Once' },
        idempotencyKey: 'k1',
      } as const;
      const a = await ok(once);
      const b = await ok(once);
      expect(a.createdId).toBe(b.createdId);
      expect((await state()).rooms.filter((r) => r.name === 'Once')).toHaveLength(1);
      const conflict = await run({
        type: 'room.create',
        payload: { name: 'Other' },
        idempotencyKey: 'k1',
      });
      expect(!conflict.ok && conflict.error.code).toBe('idempotency_conflict');
    });

    it('permissions: a Show owner or a Board share cannot manage the Event', async () => {
      const { owner } = await standalone();
      const r = await run({ type: 'room.create', payload: { name: 'X' } }, owner);
      expect(!r.ok && r.error.code).toBe('forbidden');
      expect((await getEventState(eventId, owner, deps)).ok).toBe(false);
    });
  });

  describe('Show hierarchy', () => {
    it('Shows in a Room, in the Event without Room, moved and detached; runtime untouched', async () => {
      const main = await room('Main Stage');
      const breakout = await room('Breakout');
      const keynote = await newShow('Keynote', main);
      const panel = await newShow('Panel');
      let s = await state();
      expect(s.shows.map((x) => [x.title, x.roomId])).toEqual([
        ['Keynote', main],
        ['Panel', null],
      ]);
      // New Shows inherit the Event timezone.
      expect(s.shows[0]?.timeZone).toBe('Europe/Amsterdam');
      // Event owner runs the Show's timer through the normal Show commands.
      const item = s.shows[0]?.current?.id ?? '';
      const started = await runShowTimerCommand(
        keynote,
        { commandId: cid(), type: 'timer.start', payload: { queueItemId: item } },
        eventOwner,
        deps,
      );
      expect(started.ok).toBe(true);
      const before = await store.loadShowAggregate(keynote);
      await ok({ type: 'show.place', payload: { showId: keynote, roomId: breakout } });
      await ok({ type: 'show.place', payload: { showId: panel, roomId: main } });
      s = await state();
      expect(s.shows.map((x) => [x.title, x.roomId])).toEqual([
        ['Panel', main],
        ['Keynote', breakout],
      ]);
      // Moving never touches Current or running timers.
      const after = await store.loadShowAggregate(keynote);
      expect(after).toBe(before);
      expect(s.shows.find((x) => x.id === keynote)?.currentTimer?.status).toBe('running');
      // The Show knows its context (breadcrumb).
      const withCtx = await getShowStateWithContext(keynote, eventOwner, deps);
      expect(withCtx.ok && withCtx.value.show.context).toEqual({
        eventId,
        eventName: 'Congress 2026',
        roomId: breakout,
        roomName: 'Breakout',
      });
      // Out of the Room, then out of the Event.
      await ok({ type: 'show.place', payload: { showId: panel, roomId: null } });
      await ok({ type: 'show.detach', payload: { showId: panel } });
      expect((await state()).shows.map((x) => x.title)).toEqual(['Keynote']);
      expect((await store.getShow(panel))?.eventId).toBeNull();
      expect(events.events.filter((e) => e.type === 'event.changed').length).toBeGreaterThan(0);
      expect(store.audit.filter((a) => a.action === 'show.move')).toHaveLength(3);
      // After detaching, the Event owner no longer manages the Show.
      const lost = await runShowTimerCommand(
        panel,
        { commandId: cid(), type: 'timer.start', payload: { queueItemId: 'x' } },
        eventOwner,
        deps,
      );
      expect(!lost.ok && lost.error.code).toBe('forbidden');
    });

    it('attaching an existing standalone Show needs owner access to BOTH Show and Event', async () => {
      const { showId, owner } = await standalone();
      const intruder = await standalone();
      const denied = await attachShowToEvent(
        eventId,
        { showId },
        { event: eventOwner, show: intruder.owner },
        deps,
      );
      expect(!denied.ok && denied.error.code).toBe('forbidden');
      const notEventOwner = await attachShowToEvent(
        eventId,
        { showId },
        { event: owner, show: owner },
        deps,
      );
      expect(!notEventOwner.ok && notEventOwner.error.code).toBe('forbidden');
      const attached = await attachShowToEvent(
        eventId,
        { showId },
        { event: eventOwner, show: owner },
        deps,
      );
      expect(attached.ok).toBe(true);
      expect((await state()).shows.map((s) => s.id)).toEqual([showId]);
      // Standalone timezone is kept (never silently rewritten).
      expect((await state()).shows[0]?.timeZone).toBe('UTC');
    });

    it('locks: Room/Event locks block structure; a Show lock blocks moving that Show; transport is never blocked', async () => {
      const main = await room('Main Stage');
      const breakout = await room('Breakout');
      const keynote = await newShow('Keynote', main);
      await ok({ type: 'lock.set', payload: { target: { kind: 'room', id: main } } });
      const blocked = await run({
        type: 'show.place',
        payload: { showId: keynote, roomId: breakout },
      });
      expect(!blocked.ok && blocked.error.code).toBe('locked');
      // Emergency Override is explicit and audited.
      const forced = await run({
        type: 'show.place',
        payload: { showId: keynote, roomId: breakout },
        override: { reason: 'room swap' },
      });
      expect(forced.ok).toBe(true);
      expect(store.audit.some((a) => a.action === 'lock.override')).toBe(true);
      await ok({ type: 'lock.release', payload: { target: { kind: 'room', id: main } } });
      await ok({ type: 'lock.set', payload: { target: { kind: 'event', id: eventId } } });
      const roomBlocked = await run({ type: 'room.create', payload: { name: 'X' } });
      expect(!roomBlocked.ok && roomBlocked.error.code).toBe('locked');
      // Live transport inside the Show still works under an Event lock.
      const item = (await state()).shows[0]?.current?.id ?? '';
      const started = await runShowTimerCommand(
        keynote,
        { commandId: cid(), type: 'timer.start', payload: { queueItemId: item } },
        eventOwner,
        deps,
      );
      expect(started.ok).toBe(true);
      await ok({ type: 'lock.release', payload: { target: { kind: 'event', id: eventId } } });
      // A Show-level lock guards moving that Show.
      await executeShowCommand(
        keynote,
        { commandId: cid(), type: 'lock.set', payload: { target: { kind: 'show', id: keynote } } },
        eventOwner,
        deps,
      );
      const showLocked = await run({
        type: 'show.place',
        payload: { showId: keynote, roomId: main },
      });
      expect(!showLocked.ok && showLocked.error.code).toBe('locked');
    });

    it('duplicate: clean/idle copy in the same Event; source unchanged; audited', async () => {
      const main = await room('Main Stage');
      const breakout = await room('Breakout');
      const keynote = await newShow('Keynote', main);
      const item = (await state()).shows[0]?.current?.id ?? '';
      await runShowTimerCommand(
        keynote,
        { commandId: cid(), type: 'timer.start', payload: { queueItemId: item } },
        eventOwner,
        deps,
      );
      const copy = await duplicateShow(keynote, { roomId: breakout }, eventOwner, deps);
      if (!copy.ok) throw new Error(copy.error.message);
      const s = await state();
      const dup = s.shows.find((x) => x.id === copy.value.showId);
      expect(dup).toMatchObject({
        title: 'Keynote (copy)',
        roomId: breakout,
        current: null,
        runningTimers: 0,
      });
      expect(dup?.agenda.map((a) => a.state)).toEqual(['upcoming']);
      expect(s.shows.find((x) => x.id === keynote)?.runningTimers).toBe(1);
      expect(store.audit.some((a) => a.action === 'show.duplicate' && a.showId === keynote)).toBe(
        true,
      );
      // Standalone duplicate by a Show owner stays standalone.
      const solo = await standalone();
      const soloCopy = await duplicateShow(solo.showId, {}, solo.owner, deps);
      expect(soloCopy.ok && (await store.getShow(soloCopy.value.showId))?.eventId).toBeNull();
    });
  });

  describe('Event/Room Boards', () => {
    it('Room Agenda and Central Agenda reuse the Board projection; audience filtering holds', async () => {
      const main = await room('Main Stage');
      const tent = await room('Tent A');
      const keynote = await newShow('Keynote', main);
      await newShow('Workshop', tent);
      const agenda =
        (await ok({ type: 'board.create', payload: { preset: 'room_agenda', roomId: main } }))
          .createdId ?? '';
      const central =
        (await ok({ type: 'board.create', payload: { preset: 'public_agenda', name: 'Central' } }))
          .createdId ?? '';
      // A hidden item (production only) never reaches the public agenda.
      const ks = await store.loadShowAggregate(keynote);
      const hidden = ks?.queues[0]?.items[0]?.id ?? '';
      await executeShowCommand(
        keynote,
        {
          commandId: cid(),
          type: 'item.add',
          payload: { title: 'Q&A', durationMs: 10 * MINUTE_MS },
        },
        eventOwner,
        deps,
      );
      await executeShowCommand(
        keynote,
        {
          commandId: cid(),
          type: 'item.setVisibility',
          payload: { queueItemId: hidden, visibility: ['production'] },
        },
        eventOwner,
        deps,
      );
      const shareResult = await createScopedBoardShare(
        { showId: null, eventId: EventId(eventId) },
        { boardId: central },
        eventOwner,
        deps,
      );
      if (!shareResult.ok) throw new Error('share');
      const reader = await authenticateToken(shareResult.value.boardShareToken, 'board', deps);
      if (!reader) throw new Error('reader');
      const read = await readSharedBoard(central, { actor: reader.actor }, deps);
      if (!read.ok) throw new Error(read.error.message);
      expect(read.value.queues.map((q) => [q.name, q.discipline])).toEqual([
        ['Main Stage', 'Keynote'],
        ['Tent A', 'Workshop'],
      ]);
      expect(read.value.queues[0]?.current).toBeNull();
      expect(read.value.queues[0]?.standBy).toBe(true);
      expect(JSON.stringify(read.value)).not.toContain(hidden);
      // The share reads only its own Board.
      const other = await readSharedBoard(agenda, { actor: reader.actor }, deps);
      expect(!other.ok && other.error.code).toBe('forbidden');
    });
  });

  describe('Devices', () => {
    const scope = () => ({ showId: null, eventId: EventId(eventId) });
    const device = (body: DeviceBody, ctx: CommandContext = eventOwner) =>
      executeDeviceCommand(scope(), { commandId: cid(), ...body } as DeviceCommandDto, ctx, deps);

    async function boards() {
      const main = await room('Main Stage');
      await newShow('Keynote', main);
      const agenda =
        (await ok({ type: 'board.create', payload: { preset: 'room_agenda', roomId: main } }))
          .createdId ?? '';
      const list = await listDevices(scope(), eventOwner, deps);
      if (!list.ok) throw new Error('list');
      const speaker =
        list.value.assignableBoards.find((b) => b.preset === 'speaker_confidence')?.id ?? '';
      return { agenda, speaker };
    }

    it('pair -> claim once -> display shows its Board; reassign; rename; revoke; remove', async () => {
      const { agenda, speaker } = await boards();
      const pairing = await startPairing(deps);
      expect(pairing.code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{2}$/);
      expect(await claimPairing(pairing.pairingSecret, deps)).toEqual({ status: 'pending' });

      const paired = await device({
        type: 'device.pair',
        payload: {
          code: pairing.code.toLowerCase(),
          name: 'Speaker Monitor Main',
          boardId: speaker,
        },
      });
      if (!paired.ok) throw new Error(paired.error.message);
      const deviceId = paired.value.createdId ?? '';
      expect(paired.value.devices[0]).toMatchObject({
        name: 'Speaker Monitor Main',
        status: 'never_connected',
      });
      // The code is one-time.
      const again = await device({
        type: 'device.pair',
        payload: { code: pairing.code, name: 'X' },
      });
      expect(!again.ok && again.error.code).toBe('validation_failed');

      const claim = await claimPairing(pairing.pairingSecret, deps);
      if (claim.status !== 'paired') throw new Error('claim');
      expect(await claimPairing(pairing.pairingSecret, deps)).toEqual({ status: 'expired' });
      const d = await authenticateDevice(claim.deviceToken, deps);
      if (!d) throw new Error('device auth');
      // A device credential is never a management or Board-share credential.
      expect(await authenticateToken(claim.deviceToken, 'owner', deps)).toBeNull();
      expect(await authenticateToken(claim.deviceToken, 'board', deps)).toBeNull();

      expect((await getDeviceDisplay(d, deps)).board?.board.preset).toBe('speaker_confidence');
      await device({ type: 'device.assign', payload: { deviceId, boardId: agenda } });
      await device({ type: 'device.rename', payload: { deviceId, name: 'Main Stage Agenda' } });
      const reassigned = await store.findDevice(DeviceId(deviceId));
      if (!reassigned) throw new Error('device');
      expect((await getDeviceDisplay(reassigned, deps)).board?.board.preset).toBe('room_agenda');
      connected.add(deviceId);
      expect((await listDevices(scope(), eventOwner, deps)).ok).toBe(true);
      const online = await listDevices(scope(), eventOwner, deps);
      expect(online.ok && online.value.devices[0]?.status).toBe('online');

      const removeFirst = await device({ type: 'device.remove', payload: { deviceId } });
      expect(!removeFirst.ok && removeFirst.error.code).toBe('validation_failed');
      await device({ type: 'device.revoke', payload: { deviceId } });
      expect(await authenticateDevice(claim.deviceToken, deps)).toBeNull();
      const revokedEvent = events.events.at(-1);
      expect(revokedEvent).toMatchObject({ type: 'devices.changed', revoked: true });
      await device({ type: 'device.remove', payload: { deviceId } });
      expect(await store.findDevice(DeviceId(deviceId))).toBeNull();
      expect(store.audit.filter((a) => a.resource.kind === 'device').map((a) => a.action)).toEqual([
        'device.pair',
        'device.reassign',
        'device.rename',
        'device.revoke',
        'device.remove',
      ]);
    });

    it('expired pairing code; Boards outside the scope cannot be assigned; Show owners cannot manage Event devices', async () => {
      await boards();
      const pairing = await startPairing(deps);
      clock.advance(11 * MINUTE_MS);
      const late = await device({
        type: 'device.pair',
        payload: { code: pairing.code, name: 'Late' },
      });
      expect(!late.ok && late.error.code).toBe('validation_failed');
      const fresh = await startPairing(deps);
      const solo = await standalone();
      const soloBoard = (await store.loadShowAggregate(solo.showId))?.boards[0]?.id ?? '';
      const outside = await device({
        type: 'device.pair',
        payload: { code: fresh.code, name: 'X', boardId: soloBoard },
      });
      expect(!outside.ok && outside.error.code).toBe('validation_failed');
      const denied = await device(
        { type: 'device.pair', payload: { code: fresh.code, name: 'X' } },
        solo.owner,
      );
      expect(!denied.ok && denied.error.code).toBe('forbidden');
    });
  });

  describe('Board share management', () => {
    it('list, create with label, revoke: revoked token can no longer read; audited', async () => {
      const solo = await standalone();
      const showScope = { showId: ShowId(solo.showId), eventId: null };
      const created = await createScopedBoardShare(
        showScope,
        { label: 'Lectern iPad' },
        solo.owner,
        deps,
      );
      if (!created.ok) throw new Error('share');
      const list = await listBoardShares(showScope, solo.owner, deps);
      expect(list.ok && list.value.shares.map((s) => [s.label, s.boardName, s.revokedAt])).toEqual([
        [null, 'Speaker Board', null],
        ['Lectern iPad', 'Speaker Board', null],
      ]);
      const reader = await authenticateToken(created.value.boardShareToken, 'board', deps);
      if (!reader) throw new Error('reader');
      expect((await readSharedBoard(created.value.boardId, { actor: reader.actor }, deps)).ok).toBe(
        true,
      );
      const revoked = await revokeBoardShare(showScope, created.value.shareId, solo.owner, deps);
      expect(revoked.ok).toBe(true);
      expect(await authenticateToken(created.value.boardShareToken, 'board', deps)).toBeNull();
      expect((await readSharedBoard(created.value.boardId, { actor: reader.actor }, deps)).ok).toBe(
        false,
      );
      expect(events.events.at(-1)).toMatchObject({
        type: 'access.revoked',
        grantId: created.value.shareId,
      });
      expect(store.audit.map((a) => a.action)).toEqual([
        'board.share.create',
        'board.share.revoke',
      ]);
      // Someone else's Show owner cannot list or revoke.
      const other = await standalone();
      expect((await listBoardShares(showScope, other.owner, deps)).ok).toBe(false);
      expect((await revokeBoardShare(showScope, created.value.shareId, other.owner, deps)).ok).toBe(
        false,
      );
    });
  });

  it('a standalone Quick Timer still works without any Event', async () => {
    const solo = await standalone();
    const withCtx = await getShowStateWithContext(solo.showId, solo.owner, deps);
    expect(withCtx.ok && withCtx.value.show.context).toBeNull();
  });
});
