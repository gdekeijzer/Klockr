# ADR-0009 — Single authoritative realtime server in V1; no Redis by default

**Status:** Accepted

## Context

KLOCKR needs deterministic realtime behavior but V1 does not require horizontal application scaling from day one.

## Decision

Run one authoritative `apps/server` instance for V1 live Show State and realtime connections in an environment.

Do not add Redis/pub-sub solely in anticipation of future scale.

Keep event/state interfaces and transport boundaries abstract enough that a shared pub/sub or distributed state mechanism can be introduced when measured load, availability or scaling needs justify it.

## Consequences

- Fewer moving parts in the first production version.
- Process restart/reconnect behavior must be tested thoroughly.
- Persistence/snapshots must allow clients and server to restore authoritative state safely.
- Horizontal scaling becomes a deliberate future architecture change, not accidental complexity in M0.
