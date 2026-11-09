import {
  BoardId,
  DeviceId,
  EventId,
  GrantId,
  grantPermits,
  QueueItemId,
  ShowId,
  type Clock,
  type GrantResource,
  type Permission,
} from '@klockr/domain';
import type { Actor } from '../command';
import type { Authorizer, GrantRepository, ResourceRef, ShowLocator } from '../ports';

/**
 * Authorizer backed by persisted access grants. Resolves the resource to its scope (Show and the
 * Event it is placed in, or an Event) and applies the pure domain rule `grantPermits`. Unknown
 * actor kinds are denied; Devices never authorize through this path (read-only display only).
 */
export class GrantAuthorizer implements Authorizer {
  constructor(
    private readonly deps: {
      readonly grants: GrantRepository;
      readonly locator: ShowLocator;
      readonly clock: Clock;
    },
  ) {}

  async can(actor: Actor, permission: Permission, resource: ResourceRef): Promise<boolean> {
    if (actor.kind !== 'management_grant' && actor.kind !== 'board_share') return false;
    const grant = await this.deps.grants.findById(GrantId(actor.id));
    if (!grant) return false;
    const scoped = await this.resolve(resource);
    if (!scoped) return false;
    return grantPermits(grant, permission, scoped, this.deps.clock.now());
  }

  private async resolve(resource: ResourceRef): Promise<GrantResource | null> {
    switch (resource.kind) {
      case 'show': {
        const showId = ShowId(resource.id);
        return { kind: 'show', showId, eventId: await this.deps.locator.eventIdOfShow(showId) };
      }
      case 'queueItem': {
        const showId = await this.deps.locator.showIdOfItem(QueueItemId(resource.id));
        return showId
          ? { kind: 'show', showId, eventId: await this.deps.locator.eventIdOfShow(showId) }
          : null;
      }
      case 'board': {
        const boardId = BoardId(resource.id);
        const scope = await this.deps.locator.scopeOfBoard(boardId);
        return scope
          ? { kind: 'board', boardId, showId: scope.showId, eventId: scope.eventId }
          : null;
      }
      case 'event':
        return { kind: 'event', eventId: EventId(resource.id) };
      case 'device': {
        const scope = await this.deps.locator.scopeOfDevice(DeviceId(resource.id));
        if (!scope) return null;
        return scope.showId !== null
          ? { kind: 'show', showId: scope.showId, eventId: scope.eventId }
          : scope.eventId !== null
            ? { kind: 'event', eventId: scope.eventId }
            : null;
      }
    }
  }
}
