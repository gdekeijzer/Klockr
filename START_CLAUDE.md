# Start here with Claude Code

KLOCKR is ready for **M0 — Repository Bootstrap & Domain/Application Kernel**.

## Recommended start

Open Claude Code in this repository root and use:

```text
/start-m0
```

The command points Claude to `docs/prompts/M0_BOOTSTRAP.md` and the mandatory architecture/product documents.

If slash commands are not available, paste the contents of `docs/prompts/M0_BOOTSTRAP.md` into Claude Code.

## What Claude must do first

Claude should first present a concise M0 implementation plan including:

- files/packages to create;
- stable package/tool versions selected;
- timer state model and Clock abstraction;
- test strategy;
- any genuine contradiction found in the docs.

If no contradiction blocks work, Claude may proceed without routine confirmation.

## What M0 is allowed to build

- pnpm/Turborepo monorepo;
- web/server/worker scaffolds;
- domain/application/contracts/db/ui/config packages;
- timer domain kernel + deterministic tests;
- local PostgreSQL Compose environment;
- Drizzle migration tooling;
- CI baseline;
- health/bootstrap behavior.

## What M0 must NOT build

- Anonymous Quick Timer UI (M1);
- polished Operator/Master screens;
- auth/magic-link implementation;
- Redis;
- OSC/Companion/QLab;
- ACC/PRD deployment automation;
- production deployment.

When M0 is green, stop and review before starting M1.
