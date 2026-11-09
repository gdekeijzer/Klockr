import { describe, expect, it } from 'vitest';
import { itemFixture, queueFixture } from './fixtures';
import { moveFor, rowsOf, stepMove, stepMoveGroup } from './queue-layout';

// Layout: A, [G: g1, g2], B
const queue = queueFixture(
  [
    itemFixture('A', { position: 0 }),
    itemFixture('g1', { groupId: 'G', position: 0 }),
    itemFixture('g2', { groupId: 'G', position: 1 }),
    itemFixture('B', { position: 2 }),
  ],
  { groups: [{ id: 'G', title: 'Group', position: 1 }] },
);

describe('rowsOf', () => {
  it('interleaves top-level items and groups by position', () => {
    expect(
      rowsOf(queue).map((r) =>
        r.kind === 'item' ? r.item.id : `[${r.items.map((i) => i.id).join(',')}]`,
      ),
    ).toEqual(['A', '[g1,g2]', 'B']);
  });
});

describe('moveFor (drag & drop)', () => {
  it('drop an item on another top-level item inserts before it', () => {
    expect(moveFor(queue, { kind: 'item', id: 'B' }, { kind: 'item', id: 'A' })).toEqual({
      type: 'item.move',
      payload: { queueItemId: 'B', groupId: null, index: 0 },
    });
  });

  it('drop an item on a group header appends it to the group', () => {
    expect(moveFor(queue, { kind: 'item', id: 'A' }, { kind: 'group', id: 'G' })).toEqual({
      type: 'item.move',
      payload: { queueItemId: 'A', groupId: 'G', index: 2 },
    });
  });

  it('drop an item on a group child inserts before that child', () => {
    expect(moveFor(queue, { kind: 'item', id: 'B' }, { kind: 'item', id: 'g2' })).toEqual({
      type: 'item.move',
      payload: { queueItemId: 'B', groupId: 'G', index: 1 },
    });
  });

  it('drop a group child on the end zone moves it out of the group', () => {
    expect(moveFor(queue, { kind: 'item', id: 'g1' }, { kind: 'end' })).toEqual({
      type: 'item.move',
      payload: { queueItemId: 'g1', groupId: null, index: 3 },
    });
  });

  it('drop a group on a top-level item moves it (with children) before that item', () => {
    expect(moveFor(queue, { kind: 'group', id: 'G' }, { kind: 'item', id: 'A' })).toEqual({
      type: 'group.move',
      payload: { groupId: 'G', index: 0 },
    });
  });

  it('no-ops: dropping on itself, a group on its own child, an item where it already is', () => {
    expect(moveFor(queue, { kind: 'item', id: 'A' }, { kind: 'item', id: 'A' })).toBeNull();
    expect(moveFor(queue, { kind: 'group', id: 'G' }, { kind: 'item', id: 'g1' })).toBeNull();
    expect(moveFor(queue, { kind: 'item', id: 'g1' }, { kind: 'item', id: 'g2' })).toBeNull();
  });
});

describe('step moves (keyboard alternative)', () => {
  it('moves within the container and stops at its edges', () => {
    expect(stepMove(queue, 'B', -1)).toEqual({
      type: 'item.move',
      payload: { queueItemId: 'B', groupId: null, index: 1 },
    });
    expect(stepMove(queue, 'A', -1)).toBeNull();
    expect(stepMove(queue, 'g1', 1)).toEqual({
      type: 'item.move',
      payload: { queueItemId: 'g1', groupId: 'G', index: 1 },
    });
    expect(stepMove(queue, 'g2', 1)).toBeNull();
    expect(stepMoveGroup(queue, 'G', 1)).toEqual({
      type: 'group.move',
      payload: { groupId: 'G', index: 2 },
    });
  });
});
