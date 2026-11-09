import { describe, expect, it } from 'vitest';
import { grantPermits, type AccessGrant } from '../access';
import { presetDefaults, validateBoard, type Board } from '../board';
import {
  assignBoard,
  claimSession,
  createDevice,
  deviceStatus,
  formatPairingCode,
  generatePairingCode,
  normalizePairingCode,
  pairSession,
  PAIRING_CLAIM_GRACE_MS,
  PAIRING_TTL_MS,
  RECENTLY_SEEN_MS,
  renameDevice,
  revokeDevice,
  shouldWriteLastSeen,
  startPairing,
  LAST_SEEN_WRITE_INTERVAL_MS,
} from '../device';
import { BoardId, DeviceId, EventId, GrantId, QueueId, QueueItemId, RoomId, ShowId } from '../ids';
import { createMessage } from '../message';
import { addItem, setCurrent } from '../queue/operations';
import { createRelation } from '../relation';
import type { Result } from '../result';
import { setItemSchedule, transitionItemTimer } from '../schedule/operations';
import { addQueue, duplicateShow, queueView, withQueueView, type ShowAggregate } from '../show';
import { createQuickTimerShow } from '../show/show';
import { MINUTE_MS } from '../time';
import { startTimer } from '../timer';
import {
  addRoom,
  createEvent,
  deleteRoom,
  detachShow,
  eventLockFor,
  moveRoom,
  placeShow,
  releaseEventLock,
  setEventLock,
  showsIn,
  updateEvent,
  updateRoom,
  type EventAggregate,
} from './event';

function unwrap<T, E>(r: Result<T, E>): T {
  if (!r.ok) throw new Error(`unexpected: ${JSON.stringify(r.error)}`);
  return r.value;
}
const at = (h: number, m: number) => Date.UTC(2026, 10, 10, h, m);
let n = 0;
const newId = () => `00000000-0000-4000-8000-${(++n).toString(16).padStart(12, '0')}`;
const actor = { kind: 'management_grant', id: 'g' };

function event(): EventAggregate {
  let agg = unwrap(
    createEvent(
      EventId('e1'),
      {
        name: 'Congress 2026',
        timeZone: 'Europe/Amsterdam',
        startsAt: at(8, 0),
        endsAt: at(18, 0),
      },
      at(7, 0),
    ),
  );
  agg = unwrap(addRoom(agg, { id: RoomId('main'), name: 'Main Stage' }, at(7, 0)));
  agg = unwrap(addRoom(agg, { id: RoomId('b1'), name: 'Breakout Room 1' }, at(7, 0)));
  return agg;
}

describe('Event and Rooms (optional context above Shows)', () => {
  it('an Event needs no Room; a Show can sit in the Event without Room', () => {
    const bare = unwrap(createEvent(EventId('e'), { name: 'Fair', timeZone: 'UTC' }, 0));
    expect(bare).toMatchObject({ rooms: [], shows: [], revision: 0, event: { status: 'draft' } });
    const placed = unwrap(placeShow(bare, { showId: ShowId('s1'), roomId: null }));
    expect(showsIn(placed, null).map((s) => s.showId)).toEqual(['s1']);
  });

  it('validates name, timezone and dates', () => {
    expect(createEvent(EventId('e'), { name: ' ', timeZone: 'UTC' }, 0).ok).toBe(false);
    expect(createEvent(EventId('e'), { name: 'X', timeZone: 'Mars/Base' }, 0).ok).toBe(false);
    expect(
      createEvent(EventId('e'), { name: 'X', timeZone: 'UTC', startsAt: 10, endsAt: 5 }, 0).ok,
    ).toBe(false);
    const agg = event();
    expect(unwrap(updateEvent(agg, { status: 'active' }, 1)).event).toMatchObject({
      status: 'active',
      revision: 1,
    });
  });

  it('Event + Room + Show: a Show is in at most one Room; moving keeps one placement', () => {
    let agg = event();
    agg = unwrap(placeShow(agg, { showId: ShowId('a'), roomId: RoomId('main') }));
    agg = unwrap(placeShow(agg, { showId: ShowId('b'), roomId: RoomId('main') }));
    agg = unwrap(placeShow(agg, { showId: ShowId('c'), roomId: null }));
    expect(showsIn(agg, 'main').map((s) => s.showId)).toEqual(['a', 'b']);
    // Move a to Breakout: exactly one placement remains, positions are dense in both Rooms.
    agg = unwrap(placeShow(agg, { showId: ShowId('a'), roomId: RoomId('b1') }));
    expect(agg.shows.filter((s) => s.showId === 'a')).toHaveLength(1);
    expect(showsIn(agg, 'main').map((s) => [s.showId, s.position])).toEqual([['b', 0]]);
    expect(showsIn(agg, 'b1').map((s) => [s.showId, s.position])).toEqual([['a', 0]]);
    // Out of the Room, still in the Event; then reorder within the Event bucket.
    agg = unwrap(placeShow(agg, { showId: ShowId('a'), roomId: null, index: 0 }));
    expect(showsIn(agg, null).map((s) => s.showId)).toEqual(['a', 'c']);
    // Detach from the Event completely.
    agg = unwrap(detachShow(agg, 'a'));
    expect(agg.shows.map((s) => s.showId).sort()).toEqual(['b', 'c']);
  });

  it('invariant: a Room of another Event (or unknown Room) can never hold a Show', () => {
    const agg = event();
    expect(placeShow(agg, { showId: ShowId('a'), roomId: RoomId('elsewhere') }).ok).toBe(false);
  });

  it('Rooms: rename, inactive, reorder; only an empty Room can be deleted', () => {
    let agg = event();
    agg = unwrap(updateRoom(agg, 'b1', { name: 'Tent A', status: 'inactive' }, 1));
    agg = unwrap(moveRoom(agg, 'b1', 0));
    expect(agg.rooms.map((r) => [r.name, r.position, r.status])).toEqual([
      ['Tent A', 0, 'inactive'],
      ['Main Stage', 1, 'active'],
    ]);
    agg = unwrap(placeShow(agg, { showId: ShowId('a'), roomId: RoomId('main') }));
    expect(deleteRoom(agg, 'main').ok).toBe(false);
    expect(unwrap(deleteRoom(agg, 'b1')).rooms.map((r) => r.id)).toEqual(['main']);
  });

  it('Event lock guards every structural change; Room lock guards its own Room only', () => {
    let agg = event();
    agg = unwrap(setEventLock(agg, { id: 'l1', target: { kind: 'room', id: 'main' }, actor }, 1));
    expect(eventLockFor(agg, [{ kind: 'room', id: 'main' }])?.id).toBe('l1');
    expect(eventLockFor(agg, [{ kind: 'room', id: 'b1' }])).toBeNull();
    agg = unwrap(setEventLock(agg, { id: 'l2', target: { kind: 'event', id: 'e1' }, actor }, 1));
    expect(eventLockFor(agg, [{ kind: 'room', id: 'b1' }])?.id).toBe('l2');
    agg = unwrap(releaseEventLock(agg, { kind: 'event', id: 'e1' }));
    expect(eventLockFor(agg, [])).toBeNull();
  });
});

describe('Event Boards', () => {
  const base = (sources: Board['sources'], owner: 'show' | 'event'): Board => ({
    ...presetDefaults('room_agenda'),
    id: BoardId('b'),
    showId: owner === 'show' ? ShowId('s') : null,
    eventId: owner === 'event' ? EventId('e1') : null,
    preset: 'room_agenda',
    sources,
    createdAt: 0,
    updatedAt: 0,
    revision: 0,
  });

  it('an Event Board reads a Room or the Event; a Show Board only its own Queues', () => {
    const rooms = ['main'];
    expect(
      validateBoard(base({ kind: 'room', roomId: RoomId('main') }, 'event'), [], rooms).ok,
    ).toBe(true);
    expect(validateBoard(base({ kind: 'event' }, 'event'), [], rooms).ok).toBe(true);
    expect(validateBoard(base({ kind: 'room', roomId: RoomId('x') }, 'event'), [], rooms).ok).toBe(
      false,
    );
    expect(validateBoard(base({ kind: 'primary' }, 'event'), [], rooms).ok).toBe(false);
    expect(validateBoard(base({ kind: 'event' }, 'show'), [QueueId('q')], rooms).ok).toBe(false);
  });
});

describe('Show duplication: configuration yes, runtime no', () => {
  function liveShow(): ShowAggregate {
    const qt = unwrap(
      createQuickTimerShow(
        {
          showId: ShowId('s'),
          queueId: QueueId('program'),
          queueItemId: QueueItemId('opening'),
          boardId: BoardId('speaker'),
        },
        10 * MINUTE_MS,
        at(9, 0),
        { timeZone: 'Europe/Amsterdam', scheduleDate: '2026-11-10' },
      ),
    );
    let show: ShowAggregate = {
      showId: qt.show.id,
      title: 'Morning',
      revision: 7,
      primaryQueueId: qt.show.primaryQueueId,
      showWarning: qt.show.warning,
      showSchedule: qt.show.schedule,
      queues: [{ queue: qt.queue, groups: [], items: [{ ...qt.item, title: 'Opening' }] }],
      locks: [{ id: 'lock', target: { kind: 'show', id: 's' }, lockedAt: 0, lockedBy: actor }],
      unlockRequests: [],
      relations: [],
      suggestions: [],
      boards: [qt.board],
      messages: [
        unwrap(
          createMessage({
            id: 'm',
            text: 'WRAP UP',
            audiences: ['stage'],
            boardIds: [],
            priority: 'urgent',
            ttlMs: null,
            now: at(9, 0),
          }),
        ),
      ],
    };
    const view = queueView(show, 'program');
    if (!view) throw new Error('view');
    const added = unwrap(
      addItem(view, { title: 'Keynote', durationMs: 20 * MINUTE_MS }, { now: at(9, 0), newId }),
    );
    const keynote = added.aggregate.items.at(-1)?.id ?? '';
    let v = unwrap(
      setItemSchedule(
        added.aggregate,
        { id: QueueItemId(keynote), patch: { plannedStartAt: at(10, 0), fixedAnchor: true } },
        { now: at(9, 0), newId },
      ),
    );
    v = unwrap(setCurrent(v, { id: QueueItemId('opening') }, { now: at(9, 0), newId }));
    v = unwrap(
      transitionItemTimer(
        v,
        { id: QueueItemId('opening'), transition: (t) => startTimer(t, at(9, 5)) },
        { now: at(9, 5) },
      ),
    ).aggregate;
    show = withQueueView(show, v);
    const audio = unwrap(addQueue(show, { name: 'Audio', discipline: 'Audio' }, { newId }));
    show = audio.show;
    const audioView = queueView(show, audio.queueId);
    if (!audioView) throw new Error('audio');
    const mic = unwrap(
      addItem(audioView, { title: 'Headset 1', durationMs: null }, { now: at(9, 0), newId }),
    );
    show = withQueueView(show, mic.aggregate);
    const micId = mic.aggregate.items.at(-1)?.id ?? '';
    const relation = unwrap(
      createRelation(
        show,
        { sourceItemId: keynote, targetItemId: micId, offsetMs: -60_000, preserveOffset: true },
        { now: at(9, 0), newId },
      ),
    );
    return relation.show;
  }

  it('copies Queues, Items, planning, visibility, relations and Boards with new ids', () => {
    const src = liveShow();
    const copy = duplicateShow(src, {
      showId: ShowId('copy'),
      title: 'Morning (copy)',
      newId,
      now: at(11, 0),
    });
    const items = copy.queues[0]?.items ?? [];
    expect(items.map((i) => i.title)).toEqual(['Opening', 'Keynote']);
    expect(items[1]).toMatchObject({ plannedStartAt: at(10, 0), fixedAnchor: true });
    expect(items.every((i) => !['opening'].includes(i.id))).toBe(true);
    expect(copy.primaryQueueId).not.toBe(src.primaryQueueId);
    expect(copy.queues[0]?.queue.id).toBe(copy.primaryQueueId);
    expect(copy.relations).toHaveLength(1);
    const copiedMic = copy.queues[1]?.items[0];
    expect(copy.queues.map((q) => [q.queue.name, q.queue.discipline])).toEqual([
      ['Program', 'Program'],
      ['Audio', 'Audio'],
    ]);
    expect(copy.relations[0]).toMatchObject({
      sourceItemId: items[1]?.id,
      targetItemId: copiedMic?.id,
      offsetMs: -60_000,
    });
    expect(copy.boards.map((b) => [b.name, b.showId, b.eventId])).toEqual([
      ['Speaker Board', 'copy', null],
    ]);
    expect(copy.boards[0]?.id).not.toBe('speaker');
    expect(copy.showSchedule).toEqual(src.showSchedule);
  });

  it('starts clean and idle: no timers running, no Current, actuals, messages, locks or suggestions', () => {
    const src = liveShow();
    expect(src.queues[0]?.items[0]?.timer?.status).toBe('running');
    const copy = duplicateShow(src, { showId: ShowId('copy'), title: 'x', newId, now: at(11, 0) });
    const items = copy.queues[0]?.items ?? [];
    expect(items.map((i) => i.timer?.status)).toEqual(['idle', 'idle']);
    expect(copy.queues.map((q) => q.queue.currentItemId)).toEqual([null, null]);
    expect(items[0]?.timer).toMatchObject({
      durationMs: 10 * MINUTE_MS,
      adjustmentMs: 0,
      startedAt: null,
    });
    expect(
      items.every(
        (i) => i.actualStartAt === null && i.actualEndAt === null && i.completedAt === null,
      ),
    ).toBe(true);
    expect(copy.queues[0]?.queue.currentItemId).toBeNull();
    expect(copy).toMatchObject({
      revision: 0,
      messages: [],
      locks: [],
      suggestions: [],
      unlockRequests: [],
    });
  });
});

describe('Devices and pairing', () => {
  const scope = { eventId: EventId('e1'), showId: null };
  const device = () =>
    unwrap(
      createDevice({ id: DeviceId('d'), scope, name: 'FOH Screen', assignedBoardId: null, now: 0 }),
    );

  it('a Device belongs to exactly one Event or Show', () => {
    expect(
      createDevice({
        id: DeviceId('d'),
        scope: { eventId: null, showId: null },
        name: 'x',
        assignedBoardId: null,
        now: 0,
      }).ok,
    ).toBe(false);
  });

  it('pairing code: unambiguous alphabet, formatted, normalised from sloppy input', () => {
    let i = 0;
    const code = generatePairingCode(() => i++ % 31);
    expect(code).toHaveLength(6);
    expect(formatPairingCode('7K4MP2')).toBe('7K4M-P2');
    expect(normalizePairingCode(' 7k4m-p2 ')).toBe('7K4MP2');
    expect(normalizePairingCode('7K4M-P0')).toBeNull(); // 0 is not in the alphabet
    expect(normalizePairingCode('7K4M')).toBeNull();
  });

  it('pair once, claim once; expired codes are refused', () => {
    const session = startPairing({ id: 'p', codeHash: 'c', secretHash: 's', now: 0 });
    expect(claimSession(session, 1)).toMatchObject({ ok: false, error: { code: 'pending' } });
    const paired = unwrap(pairSession(session, DeviceId('d'), 1000));
    expect(pairSession(paired, DeviceId('d2'), 1001)).toMatchObject({
      ok: false,
      error: { code: 'used' },
    });
    const claimed = unwrap(claimSession(paired, 2000));
    expect(claimed.deviceId).toBe('d');
    expect(claimSession(claimed, 2001)).toMatchObject({ ok: false, error: { code: 'used' } });
    expect(pairSession(session, DeviceId('d'), PAIRING_TTL_MS)).toMatchObject({
      ok: false,
      error: { code: 'expired' },
    });
    expect(claimSession(paired, 1000 + PAIRING_CLAIM_GRACE_MS)).toMatchObject({
      ok: false,
      error: { code: 'expired' },
    });
  });

  it('assign / reassign / rename; revocation is final', () => {
    let d = unwrap(assignBoard(device(), BoardId('b1')));
    d = unwrap(assignBoard(d, BoardId('b2')));
    d = unwrap(renameDevice(d, 'Speaker Monitor'));
    expect(d).toMatchObject({ assignedBoardId: 'b2', name: 'Speaker Monitor', revision: 3 });
    const revoked = unwrap(revokeDevice(d, 5));
    expect(assignBoard(revoked, BoardId('b1')).ok).toBe(false);
    expect(revokeDevice(revoked, 6).ok).toBe(false);
  });

  it('status is derived; lastSeen is written sparsely', () => {
    const d = { ...device(), lastSeenAt: 1000 };
    expect(deviceStatus(device(), false, 0)).toBe('never_connected');
    expect(deviceStatus(d, true, 2000)).toBe('online');
    expect(deviceStatus(d, false, 1000 + RECENTLY_SEEN_MS)).toBe('recently_seen');
    expect(deviceStatus(d, false, 1001 + RECENTLY_SEEN_MS)).toBe('offline');
    expect(deviceStatus({ ...d, revokedAt: 5 }, true, 2000)).toBe('revoked');
    expect(shouldWriteLastSeen(d, 1000 + 1000, false)).toBe(false);
    expect(shouldWriteLastSeen(d, 1000 + LAST_SEEN_WRITE_INTERVAL_MS, false)).toBe(true);
    expect(shouldWriteLastSeen(d, 1001, true)).toBe(true);
  });
});

describe('grants with Event scope; share revocation', () => {
  const grant = (over: Partial<AccessGrant>): AccessGrant => ({
    id: GrantId('g'),
    kind: 'anonymous_event_owner',
    showId: null,
    eventId: EventId('e1'),
    boardId: null,
    label: null,
    createdAt: 0,
    expiresAt: null,
    revokedAt: null,
    ...over,
  });

  it('an Event owner manages the Event and the Shows placed in it, nothing else', () => {
    const g = grant({});
    expect(grantPermits(g, 'room.manage', { kind: 'event', eventId: EventId('e1') }, 1)).toBe(true);
    expect(
      grantPermits(
        g,
        'timer.control',
        { kind: 'show', showId: ShowId('s'), eventId: EventId('e1') },
        1,
      ),
    ).toBe(true);
    expect(grantPermits(g, 'timer.control', { kind: 'show', showId: ShowId('s') }, 1)).toBe(false);
    expect(grantPermits(g, 'event.read', { kind: 'event', eventId: EventId('e2') }, 1)).toBe(false);
  });

  it('a Show owner cannot manage an Event; it may move/duplicate its own Show', () => {
    const owner = grant({ kind: 'anonymous_owner', showId: ShowId('s'), eventId: null });
    expect(grantPermits(owner, 'event.manage', { kind: 'event', eventId: EventId('e1') }, 1)).toBe(
      false,
    );
    expect(grantPermits(owner, 'show.move', { kind: 'show', showId: ShowId('s') }, 1)).toBe(true);
    expect(grantPermits(owner, 'show.duplicate', { kind: 'show', showId: ShowId('s') }, 1)).toBe(
      true,
    );
  });

  it('a revoked Board share no longer reads its Board', () => {
    const share = grant({
      kind: 'board_share',
      showId: ShowId('s'),
      eventId: null,
      boardId: BoardId('b'),
    });
    const resource = { kind: 'board' as const, showId: ShowId('s'), boardId: BoardId('b') };
    expect(grantPermits(share, 'board.read', resource, 1)).toBe(true);
    expect(grantPermits({ ...share, revokedAt: 1 }, 'board.read', resource, 2)).toBe(false);
  });
});
