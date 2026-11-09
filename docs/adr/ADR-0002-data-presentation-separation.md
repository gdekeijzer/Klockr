# ADR-0002 — Separate show data/state from Boards

**Status:** Accepted

## Decision

Queue/Show objects contain information and live state. Boards select/filter and render this data.

An Agenda is a Board/View, not a separate agenda datastore.

## Consequences

- one source of truth can feed Speaker, FOH, backstage and public screens;
- Board configuration needs versioned schemas;
- visibility/audience logic must remain distinct from layout logic.
