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
