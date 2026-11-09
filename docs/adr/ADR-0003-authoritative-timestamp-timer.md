# ADR-0003 — Authoritative timestamp-based timer state

**Status:** Accepted

## Decision

Do not persist or broadcast per-second ticks. The authoritative service stores transitions/timestamps and clients derive the visible timer locally.

## Consequences

- efficient realtime fan-out;
- Boards can keep visibly ticking during brief disconnects;
- requires client/server clock-offset handling and reconnect snapshots;
- timer math must be a pure, heavily tested domain concern.
