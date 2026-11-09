# ADR-0010 — Background work is isolated from the live show runtime

**Status:** Accepted

## Context

Anonymous cleanup, expiry warnings, email delivery and later exports/housekeeping are not latency-critical live-show commands and must not disrupt timing/realtime execution.

## Decision

Create `apps/worker` as a separate runtime boundary from the start.

Initial responsibilities may include:

- anonymous Show expiry/cleanup checks;
- lifecycle warnings;
- outbound email jobs;
- housekeeping;
- later non-live exports or asynchronous tasks.

The worker shares domain/application/contracts/db packages but does not own authoritative live timer state.

## Consequences

- Live server failures and background-job failures are observable separately.
- Worker tasks must be idempotent/retry-safe where applicable.
- A heavyweight queue product is not required in M0; choose the simplest reliable execution mechanism compatible with the accepted runtime.
