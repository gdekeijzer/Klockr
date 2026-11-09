# CI/CD and release process

## Principles

- CI verifies every change before environment deployment.
- ACC is the acceptance environment.
- PRD is promoted deliberately.
- Application code is built once and promoted unchanged.
- Database migrations are versioned and reviewed as part of the release.

## Minimum CI checks

At M0 establish commands/workflows for:

- install with lockfile enforcement;
- formatting check;
- lint;
- TypeScript typecheck;
- unit/domain tests;
- integration tests where infrastructure is required;
- build all apps/packages.

Add Playwright E2E once M1 has browser flows.

## Image strategy

Build separate deployable images for:

- web;
- server;
- worker.

Use one release identifier across them, e.g. Git SHA and later optional semantic release tag.

Record the exact images/digests accepted in ACC and promote those same identifiers to PRD.

## ACC deployment

The exact GitHub Actions mechanism can be selected during implementation. The desired effect is:

1. CI passes;
2. immutable images are published;
3. ACC Compose environment updates to the selected release;
4. migrations execute in a controlled step;
5. health/smoke tests run;
6. release is marked accepted/rejected.

## PRD promotion

PRD is not rebuilt. A manual promotion updates the PRD Compose release version/digests to the already accepted release.

Production credentials remain only in the deployment environment/secrets store and are never exposed to Claude prompts, repository files or application logs.

## Failure behavior

A failed ACC deployment does not affect PRD.

A failed PRD health check should stop further rollout and preserve enough information for a deliberate forward fix/rollback decision. Database migrations must be designed with this constraint in mind.
