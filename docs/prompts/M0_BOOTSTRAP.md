# Claude Code prompt — M0 Repository Bootstrap & Domain/Application Kernel

Use this prompt from the root of the KLOCKR repository.

---

We are starting **M0** of KLOCKR.

Read `CLAUDE.md` first and then read, at minimum:

- `PROJECT_STATUS.md`
- `docs/PRODUCT_PRINCIPLES.md`
- `docs/DOMAIN_MODEL.md`
- `docs/TIMER_ENGINE.md`
- `docs/TECHNICAL_ARCHITECTURE.md`
- `docs/TEST_STRATEGY.md`
- `docs/IMPLEMENTATION_PLAN.md`
- ADR-0003, ADR-0006, ADR-0009 and ADR-0010

Do not start M1 and do not invent UI/product behavior.

## Goal

Create the implementation-ready repository and the first deterministic domain/application kernel. The result must be a clean, tested foundation for the Anonymous Quick Timer vertical slice that follows in M1.

## Required repository structure

Create and wire:

```text
apps/
  web/
  server/
  worker/
packages/
  domain/
  application/
  contracts/
  db/
  ui/
  config/
```

Use the accepted baseline:

- TypeScript strict mode
- pnpm workspaces
- Turborepo
- Next.js/React for `apps/web`
- Fastify for `apps/server`
- PostgreSQL + Drizzle in `packages/db`
- Zod-style validated contracts
- Vitest
- Playwright dependency/config may be scaffolded but browser tests are not required until M1
- structured Pino-style server logging

Select stable maintained versions. Record the selected versions and any material package choice in the docs. Do not replace accepted architectural boundaries without an ADR and explicit instruction.

## Local development

Application processes may run natively using pnpm/Turbo. Provide a local Docker Compose file for PostgreSQL only (optional local mail catcher is fine but not required).

Do not create Redis. V1 uses one authoritative realtime server.

## Domain kernel required in M0

Implement a framework-independent timer domain with deterministic tests for at least:

- countdown configuration;
- start;
- pause;
- resume;
- stop;
- time adjustment;
- derived remaining time;
- transition through zero into overtime;
- no per-second persisted tick model;
- controllable/fake Clock abstraction.

Respect the documented distinction between STOP and END. It is acceptable for END orchestration to remain an application command contract if full Queue behavior belongs to M1/M2.

Introduce minimal Queue/QueueItem identifiers/types only where necessary to establish boundaries. Do not prematurely model the full database schema.

## Application layer

`packages/application` is mandatory.

Establish command/use-case conventions so future UI, REST, realtime and external integrations call the same layer. Include representative command types/interfaces such as timer start/pause/resume/stop/adjust, but implement only what M0 needs coherently.

Establish:

- command ID convention;
- typed result/error convention;
- revision/idempotency concepts where appropriate;
- no Fastify/Next imports in domain/application packages.

## Contracts

Create validated shared contract conventions without overdesigning the whole product. Contracts must not become a dump of database models.

## Database

- local PostgreSQL Compose service;
- Drizzle setup;
- migration command and one minimal initial/bootstrap migration only if needed to prove tooling;
- document migration workflow;
- do not create every future table in M0.

## Apps

`apps/web`, `apps/server` and `apps/worker` should build and expose minimal health/bootstrap behavior only. Do not implement polished KLOCKR screens yet.

Server should have a simple health endpoint. Worker should start cleanly and demonstrate its boundary without implementing cleanup logic prematurely.

## Tooling and CI

Provide root commands for:

- dev
- build
- format / format:check
- lint
- typecheck
- test
- database start/stop/migrate as appropriate

Add CI that runs install with lockfile enforcement, format check, lint, typecheck, tests and build.

## Quality rules

- no `any` as an architectural shortcut;
- no business logic in route handlers/UI;
- timer tests use fake time, not sleeps;
- no server tick loop that writes/broadcasts each second;
- no Redis;
- no auth implementation yet;
- no ACC/PRD deployment implementation yet unless only harmless placeholders/docs are needed;
- no M1 UI.

## Before coding

First output a concise implementation plan containing:

1. exact files/packages you intend to create;
2. chosen stable tool/package versions;
3. timer state model and Clock abstraction;
4. test strategy;
5. any contradiction you found in the docs.

If there is no contradiction, proceed without asking for routine confirmation.

## Before finishing

Run all repository checks and fix failures. Then update:

- `PROJECT_STATUS.md`
- `CHANGELOG.md`
- relevant technical docs if implementation facts differ from placeholders

Report:

- what was created;
- exact commands to start local development;
- exact commands to run all checks;
- migrations created;
- test counts/results;
- any genuinely unresolved issue that blocks M1.

Stop after M0. Do not silently begin the Anonymous Quick Timer feature.
