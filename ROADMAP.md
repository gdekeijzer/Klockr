# KLOCKR Roadmap

Each milestone must leave the architecture coherent and, from M1 onward, the product increasingly usable.

## M0 — Repository bootstrap and domain/application kernel

Deliverables:

- pnpm/Turborepo workspace;
- `apps/web`, `apps/server`, `apps/worker`;
- `packages/domain`, `packages/application`, `packages/contracts`, `packages/db`, `packages/ui`, `packages/config`;
- strict TypeScript;
- lint/format/test/typecheck/build scripts;
- local Docker Compose PostgreSQL;
- Drizzle migration setup;
- CI baseline;
- Clock abstraction;
- ID/result/error/command conventions;
- application command boundary with at least representative command interfaces;
- timer domain kernel and deterministic tests;
- no polished product UI yet.

Exit criteria:

- fresh clone can install and run documented checks;
- all apps/packages build;
- domain/application packages have no Next.js/Fastify dependency;
- local PostgreSQL can start and a migration can run;
- timer math tests cover start/pause/resume/stop/adjust/overtime;
- CI runs formatting/lint/typecheck/tests/build;
- architecture docs/status are updated with actual selected package versions.

## M1 — Anonymous Quick Timer vertical slice

Implement:

- `New Show` with anonymous management grant;
- default Program Queue + first timed Queue Item;
- simple focused Operator page;
- simple Speaker Board using approved design rules;
- authoritative Show State + realtime broadcast;
- local Board ticking from authoritative timestamp;
- Board read-only share grant;
- reconnect snapshot/resync;
- short-disconnect Board continuity;
- anonymous 7-day lifecycle metadata (cleanup can be worker-stubbed until hardening).

This milestone must be genuinely usable on a small real production.

## M2 — Queue operations

- multiple Items;
- Groups;
- notes/tags/visibility;
- active/skip;
- per-Queue current/next;
- STOP vs END/NEXT;
- multiple running timers;
- warning inheritance and visible override source;
- focused Operator View.

## M3 — Scheduling + Master

- schedule fields;
- baseline/projected/actual model;
- soft Scheduled start;
- Previous END;
- Strict/Sliding;
- fixed anchors;
- ahead/behind;
- calm live shift indicators;
- Master tree/drag-drop;
- locks/Request Unlock/Emergency Override.

## M4 — Boards + multi-queue

- Board presets;
- constrained component configuration;
- data-source filtering;
- Audiences;
- multiple peer Queues;
- relative relationships;
- ad-hoc Messages;
- refined offline behavior.

## M5 — Event / Room / Device

- Event and optional Rooms;
- Show duplication/move;
- Event Dashboard;
- persistent Device Management;
- pairing code + persistent credential flow;
- central/per-Board sharing management.

## M6 — Accounts / collaboration / RBAC / API

- magic-link account login/claim flow;
- account/member invitations;
- temporary scoped role links;
- permission bundles/scopes;
- Platform support read-only mode + audited impersonation baseline;
- scoped API credentials;
- versioned HTTP control API;
- idempotency/revision controls.

## M7 — MVP hardening and environments

- anonymous cleanup worker + active-use protection;
- email/background lifecycle jobs;
- security review;
- accessibility/readability;
- E2E regression suite;
- load/soak/reconnect tests;
- observability;
- Docker images for web/server/worker;
- ACC Compose deployment;
- PRD Compose deployment;
- build-once/promote-same-image workflow;
- backup/restore runbook;
- production release runbook.

## Claude working pattern per milestone

1. Read `CLAUDE.md` and the relevant docs/ADRs.
2. Produce a short implementation plan with file boundaries and tests.
3. Implement domain/contracts/application layer first.
4. Add persistence/infrastructure adapters.
5. Add API/realtime/UI only as needed by the vertical slice.
6. Run all checks.
7. Update docs and `PROJECT_STATUS.md` with facts, not aspirations.
8. Stop at the milestone boundary unless explicitly asked to continue.
