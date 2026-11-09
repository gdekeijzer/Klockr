# Changelog

## M0 review — 2026-11-09

- timer states reduced to `idle | running | paused | stopped`; removed `ended`, `endedAt`, `endTimer` and the `item.end` command/contract (END / NEXT is a Queue Item command, added with Queue Items);
- START after STOP confirmed as restart from full duration; explicit tests that previous-run adjustments do not leak;
- adjustment contract examples across zero (`02:00 +00:30`, `+00:10 -00:30`, `+02:14 +00:30`) as tests and in `TIMER_ENGINE.md`;
- `OPEN_QUESTIONS.md` #31-33 resolved; `API_CONTRACT.md` and `REALTIME_OFFLINE.md` no longer list a timer END;
- recreated `.claude/commands/*` and `.github/PULL_REQUEST_TEMPLATE.md`; `MANIFEST.md` lists M0 additions;
- Prettier no longer formats Markdown/docs.

## M0 — 2026-11-09 — Repository bootstrap and domain/application kernel

- pnpm/Turborepo monorepo with web/server/worker apps and domain/application/contracts/db/ui/config packages;
- strict TypeScript 6.0, ESLint 10 (type-aware, architecture boundary rules), Prettier;
- timestamp-derived timer domain kernel with `Clock`/`ManualClock` and 30 deterministic tests;
- application command layer with idempotency, optimistic revisions, capability-based authorization port and event publishing that cannot block the timer;
- Zod contracts for timer commands, snapshots, errors and health;
- Drizzle/PostgreSQL setup with bootstrap migration and integration tests; local Compose PostgreSQL on port 54329;
- Fastify server and worker health/bootstrap behavior; Next.js placeholder page;
- GitHub Actions CI: frozen install, format, lint, typecheck, tests, migrations + integration tests, build;
- docs: `DEVELOPMENT.md`, selected versions, timer implementation notes, open questions #31-33.

## v1.0 — 2026-11-08 — Claude Code bootstrap baseline

- accepted TypeScript/Next.js/Fastify/PostgreSQL/Drizzle architecture boundaries;
- made `packages/application` mandatory;
- added separate `apps/worker` runtime boundary;
- accepted anonymous management grant + magic-link claim/login model;
- accepted temporary role links, read-only Board grants, persistent Device credentials and scoped API tokens;
- accepted Platform Admin read-only support + explicit audited impersonation;
- formalized graceful anonymous 7-day expiry/cleanup behavior;
- accepted one authoritative realtime server/no Redis for V1;
- accepted DEV/TST -> ACC -> PRD deployment topology;
- ACC/PRD are separate Docker Compose projects with their own PostgreSQL containers/volumes/secrets;
- formalized build-once/promote-the-same-images release rule;
- added CI/CD, deployment/runtime, release runbook and identity/lifecycle documentation;
- added ADR-0007 through ADR-0010;
- added first Claude Code M0 bootstrap prompt and `/start-m0` command.

## v0.3 — 2026-11-08 — UX/design baseline

- KLOCKR visual direction and semantic color system;
- design tokens and UI component contracts;
- UX patterns and design reference mockups;
- low-light Speaker/Confidence behavior.

## v0.2 — functional review

- incorporated linked-queue shift behavior, override visibility, lock emergency override, anonymous expiry safety, offline robustness and Board preset requirements.
