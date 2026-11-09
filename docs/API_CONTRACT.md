# API and command contract

## Principle

External API and internal UI converge on the same application command layer. An API-triggered START should behave like the Operator pressing START, subject to permissions and command options.

## Authentication/scoping

Each external integration uses its own revocable API credential with explicit scopes. Do not reuse browser sessions, Board shares or Device credentials as API tokens.

## API style

Recommended V1:

- REST/HTTP for commands, resources and external automation;
- realtime socket channel for snapshots/state events;
- versioned public namespace, e.g. `/api/v1`.

The exact routing can be refined during implementation.

## Write-command requirements

Each mutation should support:

- authenticated/scoped actor;
- validated payload;
- permission check;
- optional expected revision for concurrency-sensitive writes;
- idempotency key for commands likely to be retried;
- command/correlation ID in logs/result.

## Canonical command families

### Show / Queue / Item

- create anonymous Show;
- claim Show;
- create/update/duplicate/move Queue;
- create/update/duplicate/move Group;
- create/update/duplicate/move Queue Item;
- activate/deactivate/skip item;
- set current / GO item;
- END item / END+NEXT.

### Timer

- start;
- pause;
- resume;
- stop;
- adjust;
- restart/reset where product UX allows it (START on a stopped timer is a restart).

END is not a timer command; it is `END item / END+NEXT` under Queue Items above.

### Scheduling

- update planned time/duration;
- set/clear fixed anchor;
- apply/review projected Sliding shift;
- change timing mode/settings.

### Messages

- publish;
- clear;
- expire.

### Boards / Devices

- create/update Board;
- issue/revoke share;
- begin/complete device pairing;
- assign/revoke Device.

### Locks

- lock;
- unlock;
- request unlock;
- emergency override.

## Command vs timer nuance

`START TIMER` and `GO ITEM` are separate concepts.

- `START TIMER` starts a specific timer capability and does not necessarily change Queue current.
- `GO ITEM` changes operational current according to Queue semantics and may start the item's timer according to configured behavior.

This distinction is important for later Companion/OSC integration.

## Suggested result envelope

A mutation result should communicate at least:

- success/failure;
- command ID;
- new revision;
- affected object IDs;
- structured error code when rejected;
- optional warnings (e.g. linked shift pending).

## Error categories

At minimum distinguish:

- validation;
- unauthenticated;
- unauthorized;
- locked;
- conflict/stale revision;
- invalid state transition;
- not found;
- expired/revoked access;
- rate limited;
- internal failure.

## Realtime events

Recommended logical event set:

- `show.snapshot`;
- `show.changed`;
- `queue.changed`;
- `queue.current.changed`;
- `item.changed`;
- `timer.state.changed`;
- `schedule.changed`;
- `message.changed`;
- `lock.changed`;
- `device.status.changed`;
- `presence.changed`.

Keep wire events coarse enough that clients can evolve without coupling every UI component to backend internals.

## Versioning

Public API behavior is versioned. Internal code may evolve behind the application-command boundary.
