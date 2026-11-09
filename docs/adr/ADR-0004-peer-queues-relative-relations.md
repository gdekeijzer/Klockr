# ADR-0004 — Peer Queues with relative cross-Queue relationships

**Status:** Accepted

## Decision

Program, Audio, Stage, Lighting etc. are peer Queues. An item can reference an item in another Queue with a relative offset.

Do not model discipline cues as children nested under the Program item.

## Consequences

- each discipline can have an independent operational Queue/current item;
- linked schedule changes need explicit UX;
- moving/deleting anchors must handle relation impact safely.
