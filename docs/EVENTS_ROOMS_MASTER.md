# Events, Rooms and Master

## Event

Event is optional. It groups larger productions and provides a global overview.

## Room / Area

Room is optional and adds physical/logical granularity. A Show belongs to at most one Room at a time.

To reuse a Show in another Room, duplicate it so last-minute Room A changes do not mutate Room B.

## Master View

Master is the broad planning + live-management interface.

Capabilities can include:

- create/edit Events/Rooms/Shows/Queues;
- expand/collapse the structure tree;
- drag/drop and duplicate;
- manage relationships;
- manage locks;
- manage Boards/Devices/sharing;
- inspect schedule and state;
- perform timer/show controls when permitted.

Operator intentionally has fewer structural options.

## Locking

Lock target scopes may include:

- Event;
- Room;
- Show;
- Queue;
- Group;
- Queue Item.

A lock records who/what created it and its scope.

### Request Unlock

A permitted user may request release from the lock owner/authorized role where collaboration supports it.

### Emergency Override

If a user's permissions explicitly allow it, a live-show emergency override may break a lock after clear confirmation.

Emergency override must create an audit event with:

- actor;
- timestamp;
- target;
- previous lock state;
- optional reason if the UX collects one.

## Event Dashboard

Global production overview over available data, for example:

```text
MAIN STAGE
LIVE — Keynote Jan — +03:18 BEHIND
Speaker Board ONLINE
Stage Board ONLINE

ROOM A
LIVE — Workshop A — ON TIME

ROOM B
NEXT — Panel — 14:30
```

Potential status sources:

- Shows/Queues;
- current/next;
- schedule deviation;
- running timers;
- Board/Device connectivity;
- warnings/locks.

## Implementation (M5)

- **Optional hierarchy:** `Event → Room / Area → Show`, never forced. A Show is standalone, in an Event without Room, or in exactly one Room (composite FK). Quick Timer is unchanged and never needs an Event. Existing Shows stayed standalone on migration.
- **Event** (`packages/domain/src/event/event.ts`): name, description, start/end, one IANA timezone, status `draft | active | completed | archived`, revision. Shows created inside an Event inherit its timezone; an attached standalone Show keeps its own (shown as `TZ …` on its card, never silently rewritten).
- **Room**: name, description, display order, status `active | inactive`, revision. Flat; only an empty Room can be deleted.
- **Planning** (Event commands, one Event revision for CAS): add/update/move/delete Room; `show.place` (into a Room, between Rooms, out of a Room, reorder); `show.detach`; new Show in the Event; attach an existing Show (owner of both); duplicate (clean copy). No structural action starts timers, changes Current or touches the Show aggregate.
- **Locks**: Event lock (all structure) and Room locks, plus the Show's own lock when moving that Show; never block live transport. Override explicit and audited.
- **Event Dashboard** `/event/<id>`: Rooms with LIVE marker, Shows per Room and Event Shows without Room; per Show: Primary Queue Current, its timer (local derivation), Next with planned/projected start, Show offset, fixed-anchor risk, running timers, conflicts, pending suggestions, lock, Boards; Device summary; planning actions. Realtime (`event.state`), no polling.
- **Room View** `/event/<id>/room/<roomId>`: current Show, Show cards, room agenda (planned · projected) as a view over the Shows' Primary Queues (no agenda database), Boards and Devices serving the Room.
- **Master** shows the breadcrumb `Event / Room / Show`; it stays the Show's own editor.
- **Audit** (event scope): `event.update`, `room.create/update/move/delete`, `show.create/attach/move/detach/duplicate`, `board.create/delete`, `lock.set/release/override`.
