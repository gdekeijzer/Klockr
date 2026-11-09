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

## Implemented in M1

All bodies are validated with `packages/contracts`. Errors use `{ error: { code, message, details? } }` with HTTP status: `validation_failed` 400, missing/invalid credential 401, `forbidden` 403, `not_found` 404, `revision_conflict`/`invalid_transition` 409, `idempotency_conflict` 422.

| Method | Path | Credential | Purpose |
| --- | --- | --- | --- |
| POST | `/api/v1/shows` | none (rate-limited 20/min/IP) | Anonymous New Show + Quick Timer `{ durationMs }` -> `{ showId, boardShareToken }`; owner credential set as HttpOnly cookie |
| GET | `/api/v1/shows/:showId/state` | owner cookie | Operator projection of Show State |
| POST | `/api/v1/shows/:showId/commands` | owner cookie | Timer command: `timer.start` / `pause` / `resume` / `stop` / `adjust` / `configure` (+ optional `idempotencyKey`, `expectedRevision`) |
| POST | `/api/v1/shows/:showId/board-shares` | owner cookie | New read-only Speaker Board credential |
| GET | `/api/v1/board/state` | `Authorization: Bearer klb_…` (rate-limited) | Board projection |

The web client uses the command id as idempotency key, so retried requests never apply twice.

## Implemented in M2

`POST /api/v1/shows/:showId/commands` (owner cookie) also accepts Queue commands (`packages/contracts/src/queue.ts`). Same envelope (`commandId`, optional `idempotencyKey`, optional `expectedRevision` = Queue revision). Response: `{ queue: QueueSnapshot, createdId }`.

| Command | Capability | Payload |
| --- | --- | --- |
| `item.add` | `queue.manage` | `title`, optional `subtitle`, `notes`, `tags`, `durationMs` (null = no timer), `active`, `startMode`, `groupId`, `index` |
| `item.update` | `queue.manage` | `queueItemId`, `patch` {title, subtitle, notes, tags, startMode, durationMs (null removes the timer)} |
| `item.delete` / `item.duplicate` | `queue.manage` | `queueItemId` |
| `item.move` | `queue.manage` | `queueItemId`, `groupId` (null = top level), `index` |
| `item.setActive` | `queue.manage` | `queueItemId`, `active` |
| `item.setWarning` | `queue.manage` | `queueItemId`, `warning` (rule or null = reset to inherited) |
| `group.add` / `group.rename` / `group.delete` / `group.duplicate` / `group.move` | `queue.manage` | `title` / `groupId` (+ `title` / `index`) |
| `queue.setWarning` | `queue.manage` | `warning` (rule or null = reset to Show default) |
| `show.setWarning` | `show.manage` | `warning` (rule) |
| `queue.setCurrent` | `item.control` | `queueItemId` |
| `item.end` | `item.control` | `queueItemId` (must be current), `next` (false = END, true = END + NEXT) |

Presets (Timer, Speaker, Note, Break) are UI only and all send `item.add`. `GET /api/v1/shows/:showId/state` returns `{ show, board, queue }`; `GET /api/v1/board/state` returns `{ board, queueRevision, current, warning, timer, serverTime }`. Without `expectedRevision` a lost compare-and-set race is re-evaluated against the fresh state (max. 3 attempts); with it, a mismatch is `409 revision_conflict`.

## Implemented in M3

- New Queue commands on `POST /api/v1/shows/:showId/commands`: `item.setSchedule` {queueItemId, plannedStartAt?, plannedDurationMs?, fixedAnchor?} and `queue.setTimingMode` {mode|null} and `show.setSchedule` {timingMode?, timeZone?, scheduleDate?, toleranceMs?, severeBehindMs?} (`schedule.manage`); `lock.set` / `lock.release` {target} (`lock.manage`); `lock.requestUnlock` {target, reason?} (`lock.request`). `startMode` accepts `scheduled`.
- Envelope: optional `override: { reason }` = explicit Emergency Override of a lock (`lock.override`, always audited).
- Error `locked` → **HTTP 423** with `details.lock` {id, target} and `details.inheritedFrom`.
- `GET /api/v1/shows/:showId/audit?limit=` (owner cookie, `audit.read`) → `{ events: [{ id, at, actor, action, resource, details }] }`, newest first.
- `POST /api/v1/shows` accepts optional `timeZone` (IANA) and `scheduleDate` (YYYY-MM-DD); the web client sends the creating browser's values.
- Queue snapshots carry the planning inputs (`plannedStartAt`, `plannedDurationMs`, `fixedAnchor`, `actualStartAt`, `actualEndAt`, `showSchedule`, `timingMode`, `locks`, `unlockRequests`); projected values are derived by clients with the domain engine.
