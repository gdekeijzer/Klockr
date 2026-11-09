import type { QueueCommandDto } from '@klockr/contracts';
import {
  firstLock,
  type EffectiveLock,
  type LockTarget,
  type QueueAggregate,
} from '@klockr/domain';

/**
 * Which lock targets a command touches. A lock is a STRUCTURE / CONFIGURATION lock: it gates
 * structure, content, planning and timing configuration. Live operation (set current, END /
 * NEXT, timer transport) and lock management itself are never gated (they return []).
 */
export function lockTargetsFor(agg: QueueAggregate, command: QueueCommandDto): LockTarget[] {
  const queue: LockTarget = { kind: 'queue', id: agg.queue.id };
  const show: LockTarget = { kind: 'show', id: agg.showId };
  const item = (id: string): LockTarget => ({ kind: 'item', id });
  const group = (id: string): LockTarget => ({ kind: 'group', id });
  const containerOf = (itemId: string): LockTarget => {
    const groupId = agg.items.find((i) => i.id === itemId)?.groupId;
    return groupId ? group(groupId) : queue;
  };
  switch (command.type) {
    case 'item.add':
      return [command.payload.groupId ? group(command.payload.groupId) : queue];
    case 'item.update':
    case 'item.delete':
    case 'item.setActive':
    case 'item.setWarning':
    case 'item.setSchedule':
      return [item(command.payload.queueItemId)];
    case 'item.duplicate':
      return [containerOf(command.payload.queueItemId)];
    case 'item.move':
      return [
        item(command.payload.queueItemId),
        command.payload.groupId ? group(command.payload.groupId) : queue,
      ];
    case 'group.add':
    case 'group.duplicate':
    case 'queue.setWarning':
    case 'queue.setTimingMode':
      return [queue];
    case 'group.rename':
    case 'group.delete':
    case 'group.move':
      return [group(command.payload.groupId)];
    case 'show.setWarning':
    case 'show.setSchedule':
      return [show];
    case 'queue.setCurrent':
    case 'item.end':
    case 'lock.set':
    case 'lock.release':
    case 'lock.requestUnlock':
      return [];
  }
}

export function blockingLock(
  agg: QueueAggregate,
  targets: readonly LockTarget[],
): EffectiveLock | null {
  return firstLock(agg, targets);
}
