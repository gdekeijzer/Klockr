# ADR-0008 — DEV/TST → ACC → PRD deployment and promotion model

**Status:** Accepted

## Context

KLOCKR is live-event software. Uncontrolled production restarts or rebuilding different artifacts between acceptance and production creates avoidable operational risk.

## Decision

Use three environment stages:

### DEV/TST

- development and test execution from Claude Code/local development;
- web/server/worker may run directly with `pnpm dev`;
- local infrastructure such as PostgreSQL runs via Docker Compose;
- unit, integration and browser tests run here and in CI.

### ACC

- separate Docker Compose project on the dedicated server;
- its own web, server, worker and PostgreSQL containers;
- its own named volumes, secrets, hostname and environment configuration;
- used for acceptance, smoke, migration and realtime/reconnect testing.

### PRD

- separate Docker Compose project;
- its own web, server, worker and PostgreSQL containers;
- its own named volumes, secrets, hostname and environment configuration;
- deployment is an explicit/manual promotion step.

## Build once, promote

Build immutable application images once. ACC tests a specific image version/digest. PRD receives **the exact same images** after acceptance; PRD must not rebuild application code independently.

Example:

```text
feature work
  -> DEV/TST + CI
  -> build immutable images
  -> deploy exact images to ACC
  -> acceptance/smoke/realtime checks
  -> manual promote same image digests to PRD
```

## PostgreSQL

Each ACC/PRD Compose project contains its own PostgreSQL service and persistent named volume. Containerization does not make data disposable: backups, migrations and restore procedures are mandatory operational concerns.

## Consequences

- Claude Code may prepare deployment artifacts and workflows but must not silently deploy PRD.
- Production release is explicit and auditable.
- Database migrations must be compatible with promotion and rollback/forward-fix strategy.
- Runtime configuration/secrets differ per environment while application artifacts remain identical.
