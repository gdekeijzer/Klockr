# ADR-0006 — TypeScript web/server/application boundaries

**Status:** Accepted

## Context

KLOCKR needs a web UI, many realtime display clients, a long-lived authoritative Show State path, background lifecycle work, a public HTTP API and future local/integration capabilities.

## Decision

Use a TypeScript monorepo with these boundaries:

- `apps/web` — Next.js/React UI and Boards;
- `apps/server` — Fastify HTTP API + realtime server + authoritative live Show State path;
- `apps/worker` — background lifecycle/housekeeping work that must not block live show execution;
- `packages/domain` — pure business/domain rules;
- `packages/application` — mandatory command/use-case layer shared by UI, API and realtime inputs;
- `packages/contracts` — runtime-validated DTO/event/command contracts;
- `packages/db` — PostgreSQL/Drizzle schema, migrations and repositories;
- `packages/ui` — shared UI primitives/components;
- `packages/config` — shared TypeScript/lint/build configuration.

Use PostgreSQL + Drizzle for persistence and a Socket.IO-class websocket transport for realtime state distribution/reconnect behavior.

## Rationale

The application layer is mandatory from the start because Operator UI, Master UI, HTTP API and future OSC/Companion inputs must converge on the same use cases such as `StartTimer`, `EndItem`, `SetCurrentItem`, `MoveQueueItem` and `SendMessage`.

The web framework and transport layer must not become the domain model. The dedicated server process gives realtime connections and live Show State a stable long-lived runtime. The worker keeps cleanup/mail/housekeeping away from timing-critical execution.

## Consequences

- Domain and application packages must be runnable/testable without Next.js or Fastify.
- Route handlers and UI components stay thin.
- V1 runs one authoritative realtime server instance; horizontal distribution is deferred until required.
- Redis/pub-sub is deliberately not part of the initial architecture.
