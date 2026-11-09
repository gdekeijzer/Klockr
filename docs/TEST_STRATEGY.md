# Test strategy

## Test pyramid

### Domain unit tests — highest priority

Pure, fast and deterministic tests for:

- countdown derivation;
- pause/resume;
- overtime;
- adjustment semantics;
- STOP vs END;
- start/end behavior combinations;
- next eligible item / skipped items;
- warning threshold inheritance;
- Strict/Sliding scheduling;
- fixed anchors;
- relative Queue relationships;
- permissions;
- locks/emergency override.

All time-sensitive tests use a fake Clock.

### Application/integration tests

- command handlers + repositories;
- transaction rollback;
- idempotency;
- optimistic revision conflicts;
- anonymous claim lifecycle;
- device pairing/revocation;
- share grant scope;
- cleanup safety.

### Realtime tests

- snapshot then ordered events;
- stale event rejection;
- reconnect snapshot;
- multiple clients/Boards;
- multiple simultaneous timers;
- clock offset correction;
- temporary disconnect with local Board continuation.

### Browser E2E

Critical journeys:

1. anonymous New Timer -> START -> Speaker Board;
2. add multiple Queue Items -> current/next -> END/NEXT;
3. warning/critical/overtime presentation;
4. Strict show reports behind after overrun;
5. Sliding change shows controlled shift state;
6. linked Audio cue keeps relative offset;
7. lock blocks edit; permitted emergency override works/audits;
8. pair Device and assign Board;
9. disconnect/reconnect Speaker Board;
10. claim anonymous Show into account.

## Regression fixtures

Maintain representative Shows:

- simple speaker day;
- single-tent day program;
- three-room conference;
- multi-queue Program/Audio/Stage example;
- overtime/fixed-anchor stress Show.

## Performance/soak

Before MVP release measure:

- many simultaneous Board connections;
- long-running timers;
- repeated reconnects;
- busy multi-queue Show updates;
- Event Dashboard fan-out.

Do not invent hard performance promises before representative load testing; instrument first, then set release SLOs.
