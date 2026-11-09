import {
  GrantAuthorizer,
  type AuditRepository,
  type DevicePresence,
  type DeviceRepository,
  type EventPublisher,
  type EventRepository,
  type GrantRepository,
  type IdempotencyStore,
  type PlatformDeps,
  type ShowRepository,
  type ShowStateRepository,
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
    AuditRepository &
    EventRepository &
    DeviceRepository;
  readonly idempotency: IdempotencyStore;
}

/** Composition root for the application layer. Adapters in, use-case dependencies out. */
export function createServices(options: {
  readonly persistence: Persistence;
  readonly clock: Clock;
  readonly events: EventPublisher;
  /** Live Device presence (the realtime hub); defaults to "nobody connected". */
  readonly presence?: DevicePresence;
  readonly onPublishError?: (error: unknown) => void;
}): PlatformDeps {
  const { store, idempotency } = options.persistence;
  return {
    clock: options.clock,
    shows: store,
    timers: store,
    state: store,
    grants: store,
    audit: store,
    locator: store,
    eventStore: store,
    deviceStore: store,
    presence: options.presence ?? { isConnected: () => false },
    idempotency,
    events: options.events,
    tokens: new NodeTokenService(),
    ids: { uuid: () => randomUUID() },
    authorizer: new GrantAuthorizer({ grants: store, locator: store, clock: options.clock }),
    ...(options.onPublishError ? { onPublishError: options.onPublishError } : {}),
  };
}
