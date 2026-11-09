import {
  BoardId,
  deriveTimer,
  GrantId,
  ManualClock,
  MINUTE_MS,
  SECOND_MS,
  ShowId,
} from '@klockr/domain';
import { beforeEach, describe, expect, it } from 'vitest';
import { authenticateToken } from '../auth';
import { GrantAuthorizer } from '../auth/grant-authorizer';
import type { CommandContext } from '../command';
import {
  FakeTokenService,
  InMemoryIdempotencyStore,
  InMemoryStore,
  RecordingEventPublisher,
  SequentialIds,
} from '../testing';
import type { TimerCommand } from '../timer';
import {
  createBoardShare,
  createQuickTimer,
  getBoardState,
  getShowState,
  runShowTimerCommand,
  type ShowServiceDeps,
} from './quick-timer';

let seq = 0;
function command(
  type: TimerCommand['type'],
  queueItemId: string,
  extra: object = {},
): TimerCommand {
  return {
    commandId: `c-${String(++seq)}`,
    type,
    payload: { queueItemId, ...extra },
    ...extra,
  } as TimerCommand;
}

describe('Quick Timer use cases', () => {
  let clock: ManualClock;
  let store: InMemoryStore;
  let events: RecordingEventPublisher;
  let deps: ShowServiceDeps;

  beforeEach(() => {
    clock = new ManualClock();
    store = new InMemoryStore();
    events = new RecordingEventPublisher();
    const tokens = new FakeTokenService();
    deps = {
      clock,
      shows: store,
      timers: store,
      grants: store,
      locator: store,
      tokens,
      ids: new SequentialIds(),
      idempotency: new InMemoryIdempotencyStore(),
      events,
      authorizer: new GrantAuthorizer({ grants: store, locator: store, clock }),
    };
  });

  async function newShow(durationMs = 10 * MINUTE_MS) {
    const created = await createQuickTimer({ durationMs }, deps);
    if (!created.ok) throw new Error('create failed');
    const owner = await authenticateToken(created.value.ownerToken, 'owner', deps);
    const board = await authenticateToken(created.value.boardShareToken, 'board', deps);
    if (!owner || !board) throw new Error('auth failed');
    const state = await getShowState(created.value.showId, { actor: owner.actor }, deps);
    if (!state.ok) throw new Error('state failed');
    return {
      ...created.value,
      owner: { actor: owner.actor } satisfies CommandContext,
      board: { actor: board.actor } satisfies CommandContext,
      boardGrant: board.grant,
      itemId: state.value.item.id,
      boardId: state.value.board.id,
    };
  }

  describe('anonymous Show creation', () => {
    it('creates Show, Program Queue, timed item, Speaker Board and two separate credentials', async () => {
      const show = await newShow();
      const stored = store.shows.get(show.showId);
      expect(stored).toMatchObject({ ownership: 'anonymous', createdAt: clock.now() });
      expect(stored?.expiresAt).toBe(clock.now() + 7 * 24 * 60 * MINUTE_MS);
      expect(store.queues.size).toBe(1);
      expect(store.boards.size).toBe(1);
      expect(show.ownerToken).not.toBe(show.boardShareToken);
    });

    it('stores only token hashes, never the secrets', async () => {
      const show = await newShow();
      const hashes = [...store.grants.values()].map((g) => g.tokenHash);
      expect(hashes).toHaveLength(2);
      expect(hashes).not.toContain(show.ownerToken);
      expect(hashes).not.toContain(show.boardShareToken);
    });

    it('rejects an invalid duration', async () => {
      const result = await createQuickTimer({ durationMs: 0 }, deps);
      expect(!result.ok && result.error.code).toBe('validation_failed');
    });
  });

  describe('authentication', () => {
    it('a board token never authenticates as owner and vice versa', async () => {
      const show = await newShow();
      expect(await authenticateToken(show.boardShareToken, 'owner', deps)).toBeNull();
      expect(await authenticateToken(show.ownerToken, 'board', deps)).toBeNull();
      expect(await authenticateToken('klo_guessed', 'owner', deps)).toBeNull();
      expect(await authenticateToken(show.showId, 'owner', deps)).toBeNull();
    });

    it('a revoked grant no longer authenticates', async () => {
      const show = await newShow();
      store.revoke(GrantId(show.boardGrant.id), clock.now());
      expect(await authenticateToken(show.boardShareToken, 'board', deps)).toBeNull();
    });
  });

  describe('authorization: owner vs board', () => {
    it('owner can read Show State and control the timer', async () => {
      const show = await newShow();
      expect((await getShowState(show.showId, show.owner, deps)).ok).toBe(true);
      const started = await runShowTimerCommand(
        show.showId,
        command('timer.start', show.itemId),
        show.owner,
        deps,
      );
      expect(started.ok).toBe(true);
      expect(store.shows.get(show.showId)?.lastActiveAt).toBe(clock.now());
    });

    it('board can read only its Board projection and can never mutate', async () => {
      const show = await newShow();
      const boardState = await getBoardState(BoardId(show.boardId), show.board, deps);
      expect(boardState.ok && boardState.value.timer.status).toBe('idle');

      for (const type of ['timer.start', 'timer.pause', 'timer.stop'] as const) {
        const result = await runShowTimerCommand(
          show.showId,
          command(type, show.itemId),
          show.board,
          deps,
        );
        expect(!result.ok && result.error.code).toBe('forbidden');
      }
      const adjust = await runShowTimerCommand(
        show.showId,
        command('timer.adjust', show.itemId, { deltaMs: 30_000 }),
        show.board,
        deps,
      );
      expect(!adjust.ok && adjust.error.code).toBe('forbidden');
      expect((await getShowState(show.showId, show.board, deps)).ok).toBe(false);
      expect((await createBoardShare(show.showId, show.board, deps)).ok).toBe(false);
    });

    it('an owner of one Show cannot touch another Show', async () => {
      const a = await newShow();
      const b = await newShow();
      const result = await runShowTimerCommand(
        b.showId,
        command('timer.start', b.itemId),
        a.owner,
        deps,
      );
      expect(!result.ok && result.error.code).toBe('forbidden');
      // Addressing another Show's item through your own Show id is not_found (no probing).
      const cross = await runShowTimerCommand(
        a.showId,
        command('timer.start', b.itemId),
        a.owner,
        deps,
      );
      expect(!cross.ok && cross.error.code).toBe('not_found');
      expect((await getShowState(b.showId, a.owner, deps)).ok).toBe(false);
      const otherBoard = await getBoardState(BoardId(b.boardId), a.board, deps);
      expect(!otherBoard.ok && otherBoard.error.code).toBe('forbidden');
    });

    it('owner can issue an additional board share that works read-only', async () => {
      const show = await newShow();
      const share = await createBoardShare(show.showId, show.owner, deps);
      if (!share.ok) throw new Error('share failed');
      const principal = await authenticateToken(share.value.boardShareToken, 'board', deps);
      expect(principal?.grant).toMatchObject({ kind: 'board_share', boardId: show.boardId });
    });
  });

  describe('timer commands through the application layer', () => {
    it('runs the Quick Timer flow and publishes Show-scoped events', async () => {
      const show = await newShow(2 * MINUTE_MS);
      const run = (type: TimerCommand['type'], extra: object = {}) =>
        runShowTimerCommand(show.showId, command(type, show.itemId, extra), show.owner, deps);

      await run('timer.start');
      clock.advance(30 * SECOND_MS);
      await run('timer.pause');
      await run('timer.resume');
      await run('timer.adjust', { deltaMs: 30 * SECOND_MS });
      await run('timer.stop');
      const restarted = await run('timer.start');
      if (!restarted.ok) throw new Error('restart failed');
      expect(deriveTimer(restarted.value.state, clock.now()).remainingMs).toBe(2 * MINUTE_MS);

      expect(events.events.every((e) => e.showId === ShowId(show.showId))).toBe(true);
      expect(events.events.map((e) => e.state.revision)).toEqual([1, 2, 3, 4, 5, 6]);
    });

    it('configures the duration while idle or stopped, not while running', async () => {
      const show = await newShow();
      const configured = await runShowTimerCommand(
        show.showId,
        command('timer.configure', show.itemId, { mode: 'countdown', durationMs: 3 * MINUTE_MS }),
        show.owner,
        deps,
      );
      expect(configured.ok && configured.value.state.durationMs).toBe(3 * MINUTE_MS);
      await runShowTimerCommand(show.showId, command('timer.start', show.itemId), show.owner, deps);
      const whileRunning = await runShowTimerCommand(
        show.showId,
        command('timer.configure', show.itemId, { mode: 'countdown', durationMs: MINUTE_MS }),
        show.owner,
        deps,
      );
      expect(!whileRunning.ok && whileRunning.error.code).toBe('invalid_transition');
    });

    it('rejects a stale expected revision (revision conflict)', async () => {
      const show = await newShow();
      await runShowTimerCommand(show.showId, command('timer.start', show.itemId), show.owner, deps);
      const stale = await runShowTimerCommand(
        show.showId,
        command('timer.pause', show.itemId, { expectedRevision: 0 }),
        show.owner,
        deps,
      );
      expect(!stale.ok && stale.error.code).toBe('revision_conflict');
    });

    it('applies an idempotent retry only once', async () => {
      const show = await newShow();
      const first = await runShowTimerCommand(
        show.showId,
        command('timer.adjust', show.itemId, { deltaMs: 10_000, idempotencyKey: 'retry-key-1' }),
        show.owner,
        deps,
      );
      const retry = await runShowTimerCommand(
        show.showId,
        command('timer.adjust', show.itemId, { deltaMs: 10_000, idempotencyKey: 'retry-key-1' }),
        show.owner,
        deps,
      );
      expect(retry).toEqual(first);
      expect(events.events).toHaveLength(1);
    });
  });
});
