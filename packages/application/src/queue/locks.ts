import type { BoardCommandDto, QueueCommandDto } from '@klockr/contracts';
import { queueOfItem, type LockTarget, type ShowAggregate } from '@klockr/domain';

/**
 * Which lock targets a command touches. A lock is a STRUCTURE / CONFIGURATION lock: it gates
 * structure, content, planning, timing configuration, Queue management and relation timing.
 * Live operation (set current, END / NEXT, suggestions, timer transport), lock management
 * itself, Board presentation and ad-hoc Messages are never gated (they return []).
 */
export function lockTargetsFor(
  show: ShowAggregate,
  command: QueueCommandDto | BoardCommandDto,
): LockTarget[] {
  const showTarget: LockTarget = { kind: 'show', id: show.showId };
  const queue = (id: string | undefined): LockTarget => ({
    kind: 'queue',
    id: id ?? show.primaryQueueId,
  });
  const item = (id: string): LockTarget => ({ kind: 'item', id });
  const group = (id: string): LockTarget => ({ kind: 'group', id });
  const containerOf = (itemId: string): LockTarget => {
    const state = queueOfItem(show, itemId);
    const groupId = state?.items.find((i) => i.id === itemId)?.groupId;
    return groupId ? group(groupId) : queue(state?.queue.id);
  };
  const relationTarget = (relationId: string): LockTarget[] => {
    const relation = show.relations.find((r) => r.id === relationId);
    return relation ? [item(relation.targetItemId)] : [];
  };
  switch (command.type) {
    case 'item.add':
      return [
        command.payload.groupId ? group(command.payload.groupId) : queue(command.payload.queueId),
      ];
    case 'item.update':
    case 'item.delete':
    case 'item.setActive':
    case 'item.setWarning':
    case 'item.setSchedule':
    case 'item.setVisibility':
      return [item(command.payload.queueItemId)];
    case 'item.duplicate':
      return [containerOf(command.payload.queueItemId)];
    case 'item.move':
      return [
        item(command.payload.queueItemId),
        command.payload.groupId
          ? group(command.payload.groupId)
          : containerOf(command.payload.queueItemId),
      ];
    case 'item.moveToQueue':
      return [
        item(command.payload.queueItemId),
        command.payload.groupId ? group(command.payload.groupId) : queue(command.payload.queueId),
      ];
    case 'group.add':
      return [queue(command.payload.queueId)];
    case 'queue.setWarning':
    case 'queue.setTimingMode':
      return [queue(command.payload.queueId)];
    case 'group.duplicate': {
      const owner = show.queues.find((q) => q.groups.some((g) => g.id === command.payload.groupId));
      return [queue(owner?.queue.id)];
    }
    case 'group.rename':
    case 'group.delete':
    case 'group.move':
      return [group(command.payload.groupId)];
    case 'queue.update':
    case 'queue.move':
    case 'queue.delete':
      return [queue(command.payload.queueId)];
    case 'queue.create':
    case 'queue.setPrimary':
    case 'show.setWarning':
    case 'show.setSchedule':
      return [showTarget];
    case 'relation.create':
      return [item(command.payload.targetItemId)];
    case 'relation.update':
    case 'relation.delete':
      return relationTarget(command.payload.relationId);
    case 'queue.setCurrent':
    case 'item.end':
    case 'lock.set':
    case 'lock.release':
    case 'lock.requestUnlock':
    case 'suggestion.accept':
    case 'suggestion.ignore':
    case 'board.create':
    case 'board.update':
    case 'board.delete':
    case 'message.send':
    case 'message.clear':
      return [];
  }
}
