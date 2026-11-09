import {
  authenticateToken,
  createBoardShare,
  createQuickTimer,
  executeShowCommand,
  getBoardState,
  GrantAuthorizer,
  runShowTimerCommand,
  type ShowServiceDeps,
} from '@klockr/application';
import { FakeTokenService, RecordingEventPublisher } from '@klockr/application/testing';
import { BoardId, calculateShowSchedule, ManualClock, MINUTE_MS, ShowId } from '@klockr/domain';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase } from './client';
import { runMigrations } from './migrate';
import { PgIdempotencyStore, PgShowStore } from './repositories';
import { boards } from './schema';

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
function services(clock: ManualClock): ShowServiceDeps {
  const store = new PgShowStore(handle.db);
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
    idempotency: new PgIdempotencyStore(handle.db),
    events: new RecordingEventPublisher(),
    authorizer: new GrantAuthorizer({ grants: store, locator: store, clock }),
  };
}

type Command = Parameters<typeof executeShowCommand>[1];
type Body = Omit<Command, 'commandId'>;

async function setup() {
  const clock = new ManualClock(Date.UTC(2026, 10, 10, 9, 0));
  const deps = services(clock);
  const created = await createQuickTimer({ durationMs: 10 * MINUTE_MS }, deps);
  if (!created.ok) throw new Error('create');
  const showId = ShowId(created.value.showId);
  const owner = await authenticateToken(created.value.ownerToken, 'owner', deps);
  const board = await authenticateToken(created.value.boardShareToken, 'board', deps);
  if (!owner || !board?.grant.boardId) throw new Error('auth');
  const run = async (body: Body, d: ShowServiceDeps = services(clock)) => {
    const r = await executeShowCommand(
      showId,
      { commandId: randomUUID(), ...body } as Command,
      { actor: owner.actor },
      d,
    );
    if (!r.ok) throw new Error(`${body.type}: ${r.error.message}`);
    return r.value.createdId ?? '';
  };
  const load = async () => {
    const show = await new PgShowStore(handle.db).loadShowAggregate(showId);
    if (!show) throw new Error('show');
    return show;
  };
  return {
    clock,
    deps,
    showId,
    owner,
    board,
    speakerBoard: board.grant.boardId,
    run,
    load,
    boardToken: created.value.boardShareToken,
  };
}

async function production(s: Awaited<ReturnType<typeof setup>>) {
  const opening = (await s.load()).queues[0]?.items[0]?.id ?? '';
  const program = (await s.load()).primaryQueueId as string;
  const audio = await s.run({
    type: 'queue.create',
    payload: { name: 'Audio', discipline: 'Audio' },
  });
  const light = await s.run({
    type: 'queue.create',
    payload: { name: 'Lighting', discipline: 'Lighting' },
  });
  const keynote = await s.run({
    type: 'item.add',
    payload: { title: 'Keynote', durationMs: 20 * MINUTE_MS },
  });
  await s.run({
    type: 'item.setSchedule',
    payload: { queueItemId: opening, plannedStartAt: Date.UTC(2026, 10, 10, 10, 0) },
  });
  const walkin = await s.run({
    type: 'item.add',
    payload: { title: 'Walk-in', durationMs: 10 * MINUTE_MS, queueId: audio },
  });
  const mic = await s.run({
    type: 'item.add',
    payload: { title: 'Keynote mic', durationMs: 20 * MINUTE_MS, queueId: audio },
  });
  const olook = await s.run({
    type: 'item.add',
    payload: { title: 'Opening look', durationMs: 10 * MINUTE_MS, queueId: light },
  });
  const klook = await s.run({
    type: 'item.add',
    payload: { title: 'Keynote look', durationMs: 20 * MINUTE_MS, queueId: light },
  });
  await s.run({ type: 'queue.setCurrent', payload: { queueItemId: walkin } });
  await s.run({ type: 'queue.setCurrent', payload: { queueItemId: olook } });
  await s.run({
    type: 'relation.create',
    payload: { sourceItemId: keynote, targetItemId: mic, offsetMs: -30_000, preserveOffset: true },
  });
  await s.run({
    type: 'relation.create',
    payload: { sourceItemId: keynote, targetItemId: klook, offsetMs: 0, preserveOffset: true },
  });
  return { opening, program, audio, light, keynote, walkin, mic, olook, klook };
}

describe('PostgreSQL multi-Queue / Boards persistence (requires PostgreSQL)', () => {
  it('a full restart reconstructs Queues, Currents, running timers, relations, suggestions, Boards and messages', async () => {
    const s = await setup();
    const p = await production(s);
    await runShowTimerCommand(
      s.showId,
      { commandId: randomUUID(), type: 'timer.start', payload: { queueItemId: p.opening } },
      { actor: s.owner.actor },
      services(s.clock),
    );
    // END + NEXT: Current transition, completion and suggestions in ONE commit.
    const revision = (await s.load()).revision;
    await s.run({ type: 'item.end', payload: { queueItemId: p.opening, next: true } });
    const foh = await s.run({ type: 'board.create', payload: { preset: 'production' } });
    await s.run({
      type: 'board.update',
      payload: {
        boardId: foh,
        name: 'FOH',
        sources: { kind: 'queues', queueIds: [p.program, p.audio, p.light] },
      },
    });
    await s.run({
      type: 'item.setVisibility',
      payload: { queueItemId: p.keynote, visibility: ['production'] },
    });
    await s.run({
      type: 'message.send',
      payload: { text: 'WRAP UP', audiences: ['stage'], priority: 'urgent', ttlMs: 10 * MINUTE_MS },
    });

    const show = await s.load();
    expect(show.revision).toBeGreaterThan(revision);
    expect(show.queues.map((q) => [q.queue.name, q.queue.discipline, q.queue.position])).toEqual([
      ['Program', 'Program', 0],
      ['Audio', 'Audio', 1],
      ['Lighting', 'Lighting', 2],
    ]);
    expect(show.queues.map((q) => q.queue.currentItemId)).toEqual([p.keynote, p.walkin, p.olook]);
    expect(show.relations.map((r) => [r.sourceItemId, r.targetItemId, r.offsetMs])).toEqual([
      [p.keynote, p.mic, -30_000],
      [p.keynote, p.klook, 0],
    ]);
    expect(show.suggestions.map((x) => [x.targetQueueId, x.targetItemId, x.status])).toEqual([
      [p.audio, p.mic, 'pending'],
      [p.light, p.klook, 'pending'],
    ]);
    expect(show.boards.find((b) => b.id === foh)).toMatchObject({
      name: 'FOH',
      audience: 'production',
      sources: { kind: 'queues', queueIds: [p.program, p.audio, p.light] },
    });
    expect(show.queues[0]?.items.find((i) => i.id === p.keynote)?.visibility).toEqual([
      'production',
    ]);
    expect(show.messages.map((m) => m.text)).toEqual(['WRAP UP']);

    // Projection is a pure function of the reloaded state: identical for identical input.
    const now = Date.UTC(2026, 10, 10, 10, 5);
    expect(JSON.stringify([...calculateShowSchedule(show, now).queues])).toBe(
      JSON.stringify([...calculateShowSchedule(await s.load(), now).queues]),
    );

    // GO on Audio, IGNORE on Lighting, both persisted.
    const [toAudio, toLight] = show.suggestions;
    await s.run({ type: 'suggestion.accept', payload: { suggestionId: toAudio?.id ?? '' } });
    await s.run({ type: 'suggestion.ignore', payload: { suggestionId: toLight?.id ?? '' } });
    const after = await s.load();
    expect(after.queues.map((q) => q.queue.currentItemId)).toEqual([p.keynote, p.mic, p.olook]);
    expect(after.suggestions).toHaveLength(0);
    // Message clear survives too.
    await s.run({ type: 'message.clear', payload: { messageId: show.messages[0]?.id ?? '' } });
    expect((await s.load()).messages).toHaveLength(0);
  });

  it('Board scope is enforced on the reloaded state: sources, audience, notes, messages', async () => {
    const s = await setup();
    const p = await production(s);
    await s.run({
      type: 'item.update',
      payload: { queueItemId: p.opening, patch: { notes: 'internal: CEO via stage left' } },
    });
    await s.run({
      type: 'item.setVisibility',
      payload: { queueItemId: p.keynote, visibility: ['production'] },
    });
    await s.run({
      type: 'message.send',
      payload: { text: 'MIC CHECK', audiences: ['production'], priority: 'normal' },
    });
    const state = await getBoardState(
      BoardId(s.speakerBoard),
      { actor: s.board.actor },
      services(s.clock),
    );
    if (!state.ok) throw new Error('board');
    const json = JSON.stringify(state.value);
    expect(state.value.board).toMatchObject({ preset: 'speaker_confidence', audience: 'stage' });
    expect(state.value.queues.map((q) => q.name)).toEqual(['Program']);
    for (const secret of ['Keynote', 'Walk-in', 'Opening look', 'internal: CEO', 'MIC CHECK']) {
      expect(json).not.toContain(secret);
    }
  });

  it('an M1-style Board (no stored components) loads with its preset defaults and its share link stays valid', async () => {
    const s = await setup();
    await handle.db.update(boards).set({ components: [] }).where(eq(boards.id, s.speakerBoard));
    const show = await s.load();
    const board = show.boards[0];
    expect(board?.components.find((c) => c.kind === 'timer')).toMatchObject({
      enabled: true,
      size: 'large',
    });
    expect(board?.sources).toEqual({ kind: 'primary' });
    const again = await authenticateToken(s.boardToken, 'board', services(s.clock));
    expect(again?.grant.boardId).toBe(s.speakerBoard);
    const share = await createBoardShare(s.showId, { actor: s.owner.actor }, services(s.clock));
    expect(share.ok && share.value.boardId).toBe(s.speakerBoard);
  });

  it('Queue delete removes its Board sources and relations atomically', async () => {
    const s = await setup();
    const p = await production(s);
    const foh = await s.run({ type: 'board.create', payload: { preset: 'production' } });
    await s.run({
      type: 'board.update',
      payload: { boardId: foh, sources: { kind: 'queues', queueIds: [p.light] } },
    });
    await s.run({ type: 'queue.delete', payload: { queueId: p.light } });
    const show = await s.load();
    expect(show.queues.map((q) => q.queue.name)).toEqual(['Program', 'Audio']);
    expect(show.relations.map((r) => r.targetItemId)).toEqual([p.mic]);
    expect(show.boards.find((b) => b.id === foh)?.sources).toEqual({ kind: 'primary' });
  });

  it('a stale Show revision writes nothing', async () => {
    const s = await setup();
    const prev = await s.load();
    await s.run({ type: 'queue.create', payload: { name: 'Video' } });
    const stale = await new PgShowStore(handle.db).saveShowAggregate(prev, {
      ...prev,
      revision: prev.revision + 1,
      title: 'x',
    });
    expect(!stale.ok && stale.error.code).toBe('revision_conflict');
    expect((await s.load()).queues.map((q) => q.queue.name)).toEqual(['Program', 'Video']);
  });

  it('a board token cannot mutate Queues, relations, Boards or messages', async () => {
    const s = await setup();
    for (const body of [
      { type: 'queue.create', payload: { name: 'Hack' } },
      { type: 'board.create', payload: { preset: 'custom' } },
      { type: 'message.send', payload: { text: 'X', audiences: ['stage'], priority: 'normal' } },
    ] as Body[]) {
      const r = await executeShowCommand(
        s.showId,
        { commandId: randomUUID(), ...body } as Command,
        { actor: s.board.actor },
        services(s.clock),
      );
      expect(!r.ok && r.error.code).toBe('forbidden');
    }
    expect((await s.load()).queues).toHaveLength(1);
  });
});
