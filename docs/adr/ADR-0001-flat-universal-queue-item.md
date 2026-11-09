# ADR-0001 — Universal Queue Item and flat model

**Status:** Accepted

## Context

A traditional model could introduce Event -> Room -> Show -> Session -> Cue -> Timer. This adds conceptual cost to the simple-timer use case and duplicates information.

## Decision

Use one universal Queue Item with optional properties/capabilities. Provide UI presets (Timer, Speaker, Note, Break, Cue) without making them separate core entity types.

Use Groups for intentional containment and peer Queues for disciplines.

## Consequences

- lower entry complexity;
- easier evolution from Quick Timer to full Show;
- schemas/config must be well validated because many properties are optional;
- UI should use presets to prevent a “giant generic form” experience.
