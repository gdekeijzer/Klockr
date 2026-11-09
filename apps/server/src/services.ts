import {
  GrantAuthorizer,
  type EventPublisher,
  type GrantRepository,
  type AuditRepository,
  type IdempotencyStore,
  type ShowStateRepository,
  type ShowRepository,
  type ShowServiceDeps,
  type TimerRepository,
} from '@klockr/application';
import type { Clock } from '@klockr/domain';
import { randomUUID } from 'node:crypto';
import { NodeTokenService } from './infra/tokens';

export interface Persistence {
  readonly store: ShowRepository &
    ShowStateRepository &
    TimerRepository &
    GrantRepository &
    AuditRepository;
  readonly idempotency: IdempotencyStore;
}

/** Composition root for the application layer. Adapters in, use-case dependencies out. */
export function createServices(options: {
  readonly persistence: Persistence;
  readonly clock: Clock;
  readonly events: EventPublisher;
  readonly onPublishError?: (error: unknown) => void;
}): ShowServiceDeps {
  const { store, idempotency } = options.persistence;
  return {
    clock: options.clock,
    shows: store,
    timers: store,
    state: store,
    grants: store,
    audit: store,
    locator: store,
    idempotency,
    events: options.events,
    tokens: new NodeTokenService(),
    ids: { uuid: () => randomUUID() },
    authorizer: new GrantAuthorizer({ grants: store, locator: store, clock: options.clock }),
    ...(options.onPublishError ? { onPublishError: options.onPublishError } : {}),
  };
}
