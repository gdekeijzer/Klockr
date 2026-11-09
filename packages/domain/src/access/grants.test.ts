import { describe, expect, it } from 'vitest';
import { BoardId, GrantId, ShowId } from '../ids';
import { grantPermits, type AccessGrant } from './grants';

const show = ShowId('show-a');
const other = ShowId('show-b');
const board = BoardId('board-a');

const owner: AccessGrant = {
  id: GrantId('g1'),
  kind: 'anonymous_owner',
  showId: show,
  eventId: null,
  boardId: null,
  label: null,
  createdAt: 0,
  expiresAt: null,
  revokedAt: null,
};
const boardShare: AccessGrant = {
  ...owner,
  id: GrantId('g2'),
  kind: 'board_share',
  boardId: board,
};

describe('grantPermits', () => {
  it('owner controls timers and shares boards of its own Show only', () => {
    expect(grantPermits(owner, 'timer.control', { kind: 'show', showId: show }, 1)).toBe(true);
    expect(grantPermits(owner, 'board.share', { kind: 'show', showId: show }, 1)).toBe(true);
    expect(grantPermits(owner, 'timer.control', { kind: 'show', showId: other }, 1)).toBe(false);
  });

  it('board share reads its own Board and can never mutate', () => {
    expect(
      grantPermits(boardShare, 'board.read', { kind: 'board', showId: show, boardId: board }, 1),
    ).toBe(true);
    expect(grantPermits(boardShare, 'timer.control', { kind: 'show', showId: show }, 1)).toBe(
      false,
    );
    expect(grantPermits(boardShare, 'board.share', { kind: 'show', showId: show }, 1)).toBe(false);
    expect(grantPermits(boardShare, 'show.read', { kind: 'show', showId: show }, 1)).toBe(false);
  });

  it.each([
    'queue.read',
    'queue.manage',
    'item.control',
    'show.manage',
    'schedule.read',
    'schedule.manage',
    'lock.manage',
    'lock.request',
    'lock.override',
    'audit.read',
    'queue.create',
    'queue.delete',
    'relation.manage',
    'board.manage',
    'message.send',
  ] as const)('owner has %s on its own Show; a board share never has it', (permission) => {
    expect(grantPermits(owner, permission, { kind: 'show', showId: show }, 1)).toBe(true);
    expect(grantPermits(owner, permission, { kind: 'show', showId: other }, 1)).toBe(false);
    expect(grantPermits(boardShare, permission, { kind: 'show', showId: show }, 1)).toBe(false);
  });

  it('board share is scoped to one Board', () => {
    expect(
      grantPermits(
        boardShare,
        'board.read',
        { kind: 'board', showId: show, boardId: BoardId('x') },
        1,
      ),
    ).toBe(false);
    expect(grantPermits(boardShare, 'board.read', { kind: 'show', showId: show }, 1)).toBe(false);
  });

  it('revoked or expired grants permit nothing', () => {
    expect(
      grantPermits({ ...owner, revokedAt: 5 }, 'timer.control', { kind: 'show', showId: show }, 10),
    ).toBe(false);
    expect(
      grantPermits({ ...owner, expiresAt: 10 }, 'timer.control', { kind: 'show', showId: show }, 9),
    ).toBe(true);
    expect(
      grantPermits(
        { ...owner, expiresAt: 10 },
        'timer.control',
        { kind: 'show', showId: show },
        10,
      ),
    ).toBe(false);
  });
});
