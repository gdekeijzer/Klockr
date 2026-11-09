# ADR-0005 — Operator-controlled schedule recovery

**Status:** Accepted

## Decision

Strict mode reports deviation but does not silently shorten later items. Sliding mode changes projected times according to policy. Automatic recovery is not V1.

## Consequences

- baseline/projected/actual time must remain distinct;
- UI must make behind/ahead and fixed anchors clear;
- future auto-recovery can be added as explicit policy rather than changing the core model.
