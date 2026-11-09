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

- timer started/paused/resumed/stopped/adjusted;
- Queue Item ended (END / NEXT);
- current item changed;
- schedule projection changed;
- message published/cleared;
- lock changed;
- Board/Device presence changed.

Do not treat WebSocket transport events as the domain model itself.

## Implementation (M1)

- **Transport:** Socket.IO 4.8 attached to the Fastify HTTP server, path `/realtime`, one authoritative server instance, no Redis. Chosen because the accepted baseline asks for a Socket.IO-class transport and it provides automatic reconnect with backoff, rooms (one per Show), acknowledgements (used for clock probes) and an HTTP long-polling fallback for restrictive venue networks, without extra infrastructure.
- **Read channel only.** Mutations are HTTP commands (`POST /api/v1/shows/:showId/commands`) through `packages/application`; the socket only delivers state.
- **Wire events** (`packages/contracts/src/realtime.ts`): on every connect/reconnect the server sends a full snapshot (`show.snapshot` for Operators, `board.snapshot` for Boards); after each committed transition it sends `timer.state` (a timer snapshot with `revision` and `serverTime`). No ticks are sent.
- **Ordering:** clients keep the snapshot with the highest `revision` (`apps/web/lib/timer-sync.ts`); an equal revision (reconnect) is accepted, older ones are dropped.
- **Clock offset:** clients send `clock.ping` with an ack (on connect and every 15 s); the NTP-style midpoint of the lowest-RTT sample in a small window is used, with 150 ms hysteresis so jitter never makes the display jump. Before the first ping completes, the snapshot's `serverTime` seeds the offset.
- **Projection:** clients render `deriveTimer(lastSnapshot, Date.now() + offset)` from `@klockr/domain` about 10 times per second. This is presentation only.
- **Board during an outage:** keeps rendering from the last snapshot; a small `RECONNECTING` marker appears; no loader or error page after the first sync.
- **Operator during an outage:** `RECONNECTING` (then `OFFLINE` after 10 s) status chip, a full-width banner, and all controls disabled. The UI never applies a command optimistically; state changes only on server confirmation (HTTP response or realtime event).
- **Reconnect:** the client is `connected` only after the post-reconnect snapshot arrived; if nothing changed the revision is equal and nothing visibly moves; if the server state differs, the newer revision replaces local state immediately (a real correction).
