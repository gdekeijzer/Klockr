import type { BoardCommandDto, QueueCommandDto } from '@klockr/contracts';
import { BoardId, ManualClock, MINUTE_MS, type ShowAggregate, type ShowId } from '@klockr/domain';
import { beforeEach, describe, expect, it } from 'vitest';
import { authenticateToken } from '../auth';
import { GrantAuthorizer } from '../auth/grant-authorizer';
import type { CommandContext } from '../command';
import {
  createBoardShare,
  createQuickTimer,
  getBoardState,
  getShowState,
  runShowTimerCommand,
  type ShowServiceDeps,
} from '../show';
import {
  FakeTokenService,
  InMemoryIdempotencyStore,
  InMemoryStore,
  RecordingEventPublisher,
  SequentialIds,
} from '../testing';
import type { TimerCommand } from '../timer';
import { executeShowCommand } from './queue-commands';

type Command = QueueCommandDto | BoardCommandDto;
type Body = Omit<Command, 'commandId'>;
let seq = 0;
const cid = () => `00000000-0000-4000-9000-${String(++seq).padStart(12, '0')}`;

describe('M4 multi-Queue, relations, suggestions, Boards, Messages (application)', () => {
  let clock: ManualClock;
  let store: InMemoryStore;
  let events: RecordingEventPublisher;
  let deps: ShowServiceDeps;
  let showId: ShowId;
  let owner: CommandContext;
  let board: CommandContext;
  let speakerBoardId: string;
  let opening: string;

  beforeEach(async () => {
    clock = new ManualClock(Date.UTC(2026, 10, 10, 9, 0));
    store = new InMemoryStore();
    events = new RecordingEventPublisher();
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
    };
    const created = await createQuickTimer({ durationMs: 10 * MINUTE_MS }, deps);
    if (!created.ok) throw new Error('setup');
    showId = created.value.showId;
    const o = await authenticateToken(created.value.ownerToken, 'owner', deps);
    const b = await authenticateToken(created.value.boardShareToken, 'board', deps);
    if (!o || !b?.grant.boardId) throw new Error('setup');
    owner = { actor: o.actor };
    board = { actor: b.actor };
    speakerBoardId = b.grant.boardId;
    opening = (await show()).queues[0]?.items[0]?.id ?? '';
  });

  async function show(): Promise<ShowAggregate> {
    const s = await store.loadShowAggregate(showId);
    if (!s) throw new Error('no show');
    return s;
  }
  const run = (body: Body, context: CommandContext = owner) =>
    executeShowCommand(showId, { commandId: cid(), ...body } as Command, context, deps);
  async function ok(body: Body) {
    const r = await run(body);
    if (!r.ok) throw new Error(`${body.type}: ${r.error.code} ${r.error.message}`);
    return r.value;
  }
  const created = async (body: Body) => (await ok(body)).createdId ?? '';
  const timer = (type: TimerCommand['type'], queueItemId: string) =>
    runShowTimerCommand(
      showId,
      { commandId: cid(), type, payload: { queueItemId } } as TimerCommand,
      owner,
      deps,
    );
  const queueOf = async (id: string) => (await show()).queues.find((q) => q.queue.id === id);

  /** Program: Opening, Keynote · Audio: Walk-in, Keynote mic · Lighting: Opening look, Keynote look. */
  async function production() {
    const program = (await show()).primaryQueueId;
    const audio = await created({
      type: 'queue.create',
      payload: { name: 'Audio', discipline: 'Audio' },
    });
    const light = await created({
      type: 'queue.create',
      payload: { name: 'Lighting', discipline: 'Lighting' },
    });
    const keynote = await created({
      type: 'item.add',
      payload: { title: 'Keynote', durationMs: 20 * MINUTE_MS },
    });
    const walkin = await created({
      type: 'item.add',
      payload: { title: 'Walk-in', durationMs: 10 * MINUTE_MS, queueId: audio },
    });
    const mic = await created({
      type: 'item.add',
      payload: { title: 'Keynote mic', durationMs: 20 * MINUTE_MS, queueId: audio },
    });
    const olook = await created({
      type: 'item.add',
      payload: { title: 'Opening look', durationMs: 10 * MINUTE_MS, queueId: light },
    });
    const klook = await created({
      type: 'item.add',
      payload: { title: 'Keynote look', durationMs: 20 * MINUTE_MS, queueId: light },
    });
    await ok({ type: 'queue.setCurrent', payload: { queueItemId: walkin } });
    await ok({ type: 'queue.setCurrent', payload: { queueItemId: olook } });
    const toMic = await created({
      type: 'relation.create',
      payload: {
        sourceItemId: keynote,
        targetItemId: mic,
        offsetMs: -30_000,
        preserveOffset: true,
      },
    });
    const toLook = await created({
      type: 'relation.create',
      payload: { sourceItemId: keynote, targetItemId: klook, offsetMs: 0, preserveOffset: true },
    });
    return { program, audio, light, keynote, walkin, mic, olook, klook, toMic, toLook };
  }

  describe('Queues', () => {
    it('create, rename, reorder, set Primary, delete safely', async () => {
      const p = await production();
      expect((await show()).queues.map((q) => q.queue.name)).toEqual([
        'Program',
        'Audio',
        'Lighting',
      ]);
      await ok({
        type: 'queue.update',
        payload: { queueId: p.audio, name: 'Sound', discipline: 'Audio' },
      });
      await ok({ type: 'queue.move', payload: { queueId: p.light, index: 0 } });
      expect((await show()).queues.map((q) => q.queue.name)).toEqual([
        'Lighting',
        'Program',
        'Sound',
      ]);
      const primary = await run({ type: 'queue.delete', payload: { queueId: p.program } });
      expect(!primary.ok && primary.error.code).toBe('invalid_transition');
      await ok({ type: 'queue.setPrimary', payload: { queueId: p.audio } });
      expect((await show()).primaryQueueId).toBe(p.audio);
      await ok({ type: 'queue.delete', payload: { queueId: p.light } });
      const s = await show();
      expect(s.queues.map((q) => q.queue.name)).toEqual(['Program', 'Sound']);
      expect(s.relations.map((r) => r.id)).toEqual([p.toMic]);
      expect(store.audit.map((a) => a.action)).toEqual(
        expect.arrayContaining(['queue.create', 'queue.set_primary', 'queue.delete']),
      );
    });

    it('per-Queue expectedRevision conflicts; idempotent retry is applied once', async () => {
      const p = await production();
      const revision = (await queueOf(p.audio))?.queue.revision ?? -1;
      await ok({ type: 'item.add', payload: { title: 'X', queueId: p.audio } });
      const stale = await run({
        type: 'item.add',
        expectedRevision: revision,
        payload: { title: 'Y', queueId: p.audio },
      });
      expect(!stale.ok && stale.error.code).toBe('revision_conflict');
      // A change in another Queue does not conflict with this Queue's revision.
      const audioRevision = (await queueOf(p.audio))?.queue.revision ?? -1;
      await ok({ type: 'item.add', payload: { title: 'Program item' } });
      expect(
        (
          await run({
            type: 'item.add',
            expectedRevision: audioRevision,
            payload: { title: 'Z', queueId: p.audio },
          })
        ).ok,
      ).toBe(true);
      const body = {
        commandId: cid(),
        type: 'queue.create',
        idempotencyKey: 'queue-key-1',
        payload: { name: 'Video' },
      } as Command;
      await executeShowCommand(showId, body, owner, deps);
      await executeShowCommand(showId, body, owner, deps);
      expect((await show()).queues.filter((q) => q.queue.name === 'Video')).toHaveLength(1);
    });
  });

  describe('Current per Queue, timers, relations and suggested follow', () => {
    it('Queues run timers simultaneously and keep their own Current', async () => {
      const p = await production();
      await ok({ type: 'queue.setCurrent', payload: { queueItemId: p.mic } });
      expect((await timer('timer.start', opening)).ok).toBe(true);
      expect((await timer('timer.start', p.mic)).ok).toBe(true);
      const s = await show();
      expect(
        s.queues.flatMap((q) => q.items).filter((i) => i.timer?.status === 'running'),
      ).toHaveLength(2);
      expect(s.queues.map((q) => q.queue.currentItemId)).toEqual([opening, p.mic, p.olook]);
    });

    it('END + NEXT in Program creates suggestions atomically; no other Queue changes Current', async () => {
      const p = await production();
      const before = (await show()).revision;
      await ok({ type: 'item.end', payload: { queueItemId: opening, next: true } });
      const s = await show();
      expect(s.revision).toBe(before + 1);
      expect(s.queues.map((q) => q.queue.currentItemId)).toEqual([p.keynote, p.walkin, p.olook]);
      expect(s.suggestions.map((x) => [x.targetQueueId, x.targetItemId, x.status])).toEqual([
        [p.audio, p.mic, 'pending'],
        [p.light, p.klook, 'pending'],
      ]);
      // A retried/double END + NEXT neither ends another item nor duplicates suggestions.
      const again = await run({ type: 'item.end', payload: { queueItemId: opening, next: true } });
      expect(again.ok).toBe(false);
      expect((await show()).suggestions).toHaveLength(2);
    });

    it('accept (GO) and ignore; a stale suggestion is never executed', async () => {
      const p = await production();
      await ok({ type: 'item.end', payload: { queueItemId: opening, next: true } });
      const [toAudio, toLight] = (await show()).suggestions;
      await ok({ type: 'suggestion.accept', payload: { suggestionId: toAudio?.id ?? '' } });
      expect((await queueOf(p.audio))?.queue.currentItemId).toBe(p.mic);
      expect((await queueOf(p.audio))?.items.find((i) => i.id === p.mic)?.timer?.status).toBe(
        'idle',
      );
      // Lighting moves on by itself -> its pending suggestion turns stale.
      await ok({ type: 'queue.setCurrent', payload: { queueItemId: p.klook } });
      expect((await show()).suggestions).toHaveLength(0);
      const late = await run({
        type: 'suggestion.accept',
        payload: { suggestionId: toLight?.id ?? '' },
      });
      expect(!late.ok && late.error.code).toBe('not_found');
      expect((await queueOf(p.light))?.queue.currentItemId).toBe(p.klook);
    });

    it('ignore closes the suggestion and keeps Current', async () => {
      const p = await production();
      await ok({ type: 'item.end', payload: { queueItemId: opening, next: true } });
      const light = (await show()).suggestions.find((x) => x.targetQueueId === p.light);
      await ok({ type: 'suggestion.ignore', payload: { suggestionId: light?.id ?? '' } });
      expect((await queueOf(p.light))?.queue.currentItemId).toBe(p.olook);
      expect((await show()).suggestions.map((x) => x.targetQueueId)).toEqual([p.audio]);
    });

    it('relations: update/delete, cycles refused, gated by the target lock', async () => {
      const p = await production();
      await ok({ type: 'relation.update', payload: { relationId: p.toMic, offsetMs: -60_000 } });
      expect((await show()).relations.find((r) => r.id === p.toMic)?.offsetMs).toBe(-60_000);
      const cycle = await run({
        type: 'relation.create',
        payload: {
          sourceItemId: p.mic,
          targetItemId: p.keynote,
          offsetMs: 0,
          preserveOffset: false,
        },
      });
      expect(!cycle.ok && cycle.error.code).toBe('invalid_transition');
      await ok({ type: 'lock.set', payload: { target: { kind: 'item', id: p.klook } } });
      const locked = await run({ type: 'relation.delete', payload: { relationId: p.toLook } });
      expect(!locked.ok && locked.error.code).toBe('locked');
      await ok({ type: 'relation.delete', payload: { relationId: p.toMic } });
      expect((await show()).relations.map((r) => r.id)).toEqual([p.toLook]);
    });

    it('cross-Queue move of a not-live item; Current is refused', async () => {
      const p = await production();
      const current = await run({
        type: 'item.moveToQueue',
        payload: { queueItemId: opening, queueId: p.audio, groupId: null, index: 0 },
      });
      expect(!current.ok && current.error.code).toBe('invalid_transition');
      const extra = await created({
        type: 'item.add',
        payload: { title: 'Spare', queueId: p.audio },
      });
      await ok({
        type: 'item.moveToQueue',
        payload: { queueItemId: extra, queueId: p.light, groupId: null, index: 0 },
      });
      expect((await queueOf(p.light))?.items.some((i) => i.id === extra)).toBe(true);
      expect((await queueOf(p.audio))?.items.some((i) => i.id === extra)).toBe(false);
    });
  });

  describe('Boards, audiences, messages', () => {
    it('Board create / configure sources and audience / delete', async () => {
      const p = await production();
      const productionBoard = await created({
        type: 'board.create',
        payload: { preset: 'production' },
      });
      await ok({
        type: 'board.update',
        payload: {
          boardId: productionBoard,
          sources: { kind: 'queues', queueIds: [p.program, p.audio, p.light] },
          name: 'FOH',
        },
      });
      const b = (await show()).boards.find((x) => x.id === productionBoard);
      expect(b).toMatchObject({ name: 'FOH', audience: 'production', sources: { kind: 'queues' } });
      const bad = await run({
        type: 'board.update',
        payload: {
          boardId: productionBoard,
          sources: { kind: 'queues', queueIds: ['00000000-0000-4000-8000-0000000000ff'] },
        },
      });
      expect(!bad.ok && bad.error.code).toBe('validation_failed');
      const share = await createBoardShare(showId, owner, deps, productionBoard);
      expect(share.ok && share.value.boardId).toBe(productionBoard);
      await ok({ type: 'board.delete', payload: { boardId: productionBoard } });
      expect((await show()).boards).toHaveLength(1);
    });

    it('Board projection is scoped server-side: sources, audience visibility, notes, messages', async () => {
      const p = await production();
      await ok({
        type: 'item.update',
        payload: { queueItemId: opening, patch: { notes: 'CEO via stage left' } },
      });
      await ok({
        type: 'item.setVisibility',
        payload: { queueItemId: p.keynote, visibility: ['production'] },
      });
      await ok({
        type: 'message.send',
        payload: { text: 'WRAP UP', audiences: ['stage'], priority: 'urgent', ttlMs: 60_000 },
      });
      await ok({
        type: 'message.send',
        payload: { text: 'MIC 3 CHECK', audiences: ['production'], priority: 'normal' },
      });
      const speaker = await getBoardState(BoardId(speakerBoardId), board, deps);
      if (!speaker.ok) throw new Error('board');
      const json = JSON.stringify(speaker.value);
      // Only the Primary source Queue; no Audio/Lighting data.
      expect(speaker.value.queues.map((q) => q.name)).toEqual(['Program']);
      expect(json).not.toContain('Keynote mic');
      // Hidden from Stage: Keynote is not delivered at all; notes are never published by default.
      expect(json).not.toContain('Keynote');
      expect(json).not.toContain('CEO via stage left');
      expect(speaker.value.messages.map((m) => m.text)).toEqual(['WRAP UP']);
      expect(json).not.toContain('MIC 3 CHECK');
      expect(Object.keys(speaker.value)).toEqual([
        'board',
        'version',
        'timeZone',
        'queues',
        'messages',
        'serverTime',
      ]);

      // A Production Board with all three Queues sees Keynote and its own message.
      const foh = await created({ type: 'board.create', payload: { preset: 'production' } });
      await ok({
        type: 'board.update',
        payload: {
          boardId: foh,
          sources: { kind: 'queues', queueIds: [p.program, p.audio, p.light] },
        },
      });
      const share = await createBoardShare(showId, owner, deps, foh);
      if (!share.ok) throw new Error('share');
      const fohActor = await authenticateToken(share.value.boardShareToken, 'board', deps);
      if (!fohActor) throw new Error('auth');
      const fohState = await getBoardState(BoardId(foh), { actor: fohActor.actor }, deps);
      if (!fohState.ok) throw new Error('board');
      expect(fohState.value.queues.map((q) => q.name)).toEqual(['Program', 'Audio', 'Lighting']);
      expect(fohState.value.queues[0]?.next?.title).toBe('Keynote');
      expect(fohState.value.messages.map((m) => m.text)).toEqual(['MIC 3 CHECK']);
      // A Board grant reads only its own Board.
      const other = await getBoardState(BoardId(foh), board, deps);
      expect(!other.ok && other.error.code).toBe('forbidden');
    });

    it('notes reach a Board only with a Notes component AND an explicit audience', async () => {
      await ok({
        type: 'item.update',
        payload: { queueItemId: opening, patch: { notes: 'Headset 3' } },
      });
      const sm = await created({ type: 'board.create', payload: { preset: 'stage_manager' } });
      const share = await createBoardShare(showId, owner, deps, sm);
      if (!share.ok) throw new Error('share');
      const actor = await authenticateToken(share.value.boardShareToken, 'board', deps);
      if (!actor) throw new Error('auth');
      const read = async () => {
        const r = await getBoardState(BoardId(sm), { actor: actor.actor }, deps);
        if (!r.ok) throw new Error('board');
        return r.value.queues[0]?.currentNotes ?? null;
      };
      expect(await read()).toBeNull();
      await ok({
        type: 'item.setVisibility',
        payload: { queueItemId: opening, visibility: null, notesAudiences: ['backstage'] },
      });
      expect(await read()).toBeNull(); // Notes component still disabled
      const components = (await show()).boards
        .find((b) => b.id === sm)
        ?.components.map((c) => (c.kind === 'notes' ? { ...c, enabled: true } : c));
      await ok({
        type: 'board.update',
        payload: { boardId: sm, components: components?.map((c) => ({ ...c })) ?? [] },
      });
      expect(await read()).toBe('Headset 3');
    });

    it('message clear; a board token can never send messages, manage Boards, Queues or relations', async () => {
      const id = await created({
        type: 'message.send',
        payload: { text: 'STOP', audiences: ['stage'], priority: 'urgent' },
      });
      await ok({ type: 'message.clear', payload: { messageId: id } });
      expect((await show()).messages).toHaveLength(0);
      for (const body of [
        { type: 'message.send', payload: { text: 'X', audiences: ['stage'], priority: 'normal' } },
        { type: 'board.create', payload: { preset: 'custom' } },
        { type: 'queue.create', payload: { name: 'Hack' } },
        {
          type: 'relation.delete',
          payload: { relationId: '00000000-0000-4000-8000-0000000000ff' },
        },
        {
          type: 'suggestion.ignore',
          payload: { suggestionId: '00000000-0000-4000-8000-0000000000ff' },
        },
      ] as Body[]) {
        const r = await run(body, board);
        expect(!r.ok && r.error.code).toBe('forbidden');
      }
    });

    it('management snapshot carries all Queues, relations, pending suggestions, Boards and active messages', async () => {
      await production();
      await ok({ type: 'item.end', payload: { queueItemId: opening, next: true } });
      const state = await getShowState(showId, owner, deps);
      if (!state.ok) throw new Error('state');
      expect(state.value.queues.map((q) => [q.name, q.isPrimary])).toEqual([
        ['Program', true],
        ['Audio', false],
        ['Lighting', false],
      ]);
      expect(state.value.relations).toHaveLength(2);
      expect(state.value.suggestions).toHaveLength(2);
      expect(state.value.boards.map((b) => b.preset)).toEqual(['speaker_confidence']);
      expect(events.events.at(-1)?.type).toBe('show.changed');
    });
  });
});
