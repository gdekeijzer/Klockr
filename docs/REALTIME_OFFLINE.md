# Realtime and offline behavior

## Authoritative state

The server-side Show State is authoritative.

Clients receive:

1. an authoritative snapshot;
2. ordered state-change events;
3. periodic/reconnect validation as needed.

Each snapshot/event should include a monotonic revision/sequence so clients can reject stale updates.

## Do not stream ticks

A running timer should be represented by state plus timestamps. Clients render each visible tick locally.

Example broadcast:

```json
{
  "timerId": "...",
  "state": "running",
  "anchorTime": "...",
  "durationMs": 1200000,
  "adjustmentMs": 0,
  "revision": 42
}
```

The exact wire shape may differ; the principle must not.

## Clock synchronization

Clients need a lightweight server-time offset estimate so independent screens render closely aligned values.

Do not assume every device clock is accurate.

## Reconnect

On reconnect:

1. mark connectivity as recovering;
2. request/receive authoritative snapshot;
3. compare revision;
4. replace stale local structural/runtime state;
5. correct visible timer gracefully;
6. resume event stream.

Avoid a jarring full-screen reset if only a small timer correction is required.

## Display Board offline behavior

During a brief outage:

- keep the existing layout;
- continue deriving the running timer from the last known authoritative state;
- do not display a blocking spinner;
- optionally show subtle reconnect status depending on Board type.

## Operator/Master offline behavior

In V1, a disconnected control UI is effectively read-only for central mutations.

It may continue showing locally derivable timer state, but START/END/move/etc. must not be presented as successfully committed without server confirmation.

This avoids later conflict reconciliation during a live show.

## Multiple server instances

V1 can begin with a single authoritative realtime process if deployment constraints allow it. The application boundary must permit a distributed pub/sub/state coordinator later without changing domain commands.

## Event semantics

Prefer domain/application events for discrete transitions:

- timer started/paused/resumed/stopped/ended/adjusted;
- current item changed;
- schedule projection changed;
- message published/cleared;
- lock changed;
- Board/Device presence changed.

Do not treat WebSocket transport events as the domain model itself.
