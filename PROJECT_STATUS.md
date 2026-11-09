# Project status

## Phase

**M0 complete (2026-11-09) — ready for M1 review.**

Repository, tooling and the timer domain/application kernel exist and pass all checks. No product UI exists yet.

## M0 delivered

- pnpm 12 + Turborepo monorepo: `apps/{web,server,worker}`, `packages/{domain,application,contracts,db,ui,config}`
- strict TypeScript 6.0 everywhere; ESLint enforces domain/application framework independence
- pure timer kernel (`packages/domain`): start/pause/resume/stop/end/adjust/configure, derived remaining/overtime, `Clock` + `ManualClock`, branded IDs, `Result`
- application command layer (`packages/application`): command envelope (`commandId`, `idempotencyKey`, `expectedRevision`), typed `AppError`, ports (`TimerRepository` with compare-and-set, `IdempotencyStore`, `Authorizer` with capability checks, `EventPublisher`), `executeTimerCommand`, in-memory adapters
- Zod contracts (`packages/contracts`): timer command DTOs, timer snapshot with `serverTime` + `revision`, error and health responses
- Drizzle + PostgreSQL (`packages/db`): client, migrator, one infrastructure-only migration `0000_bootstrap`
- server: Fastify `/health` and `/health/ready`; worker: isolated job runner with empty job registry; web: Next.js placeholder page + `/healthz`
- local PostgreSQL via `compose.dev.yaml` (host port 54329); CI workflow in `.github/workflows/ci.yml`
- tests: 57 unit tests (domain 30, contracts 9, application 12, ui 1, server 3, worker 2) + 2 PostgreSQL integration tests
- versions and commands: `docs/TECHNICAL_ARCHITECTURE.md` (Selected versions), `docs/DEVELOPMENT.md`

## Known gaps / notes after M0

- Timer interpretations made in M0 are listed in `docs/TIMER_ENGINE.md` and raised as `OPEN_QUESTIONS.md` #31-33; none blocks M1.
- CI workflow has not yet run on GitHub (no remote configured; the folder was initialised as a local git repository without commits).
- The delivered bootstrap package was missing its dotfiles listed in `MANIFEST.md` (`.claude/commands/*`, `.github/PULL_REQUEST_TEMPLATE.md`, original `.env.example`/`.gitignore`/`.editorconfig`). M0 created new `.env.example`, `.gitignore` and `.editorconfig`; the `.claude/commands` and PR template are still absent.

## Completed decisions

### Product/domain

- Product vision and complexity-is-opt-in philosophy
- Event / optional Room / Show / Queue model
- universal Queue Item model
- parallel peer Queues and relative linked items
- timer behavior, warning states and overtime
- Strict vs Sliding scheduling and fixed anchors
- Master vs focused Operator responsibilities
- Boards, audiences and ad-hoc Messages
- locks / Request Unlock / Emergency Override
- realtime/offline display behavior
- V1 vs later scope split

### UX

- KLOCKR dark-first visual direction
- semantic blue/green/amber/red usage
- calm white/light-gray default Speaker timer
- low-light behavior
- Operator, Master, Speaker and Stage Manager reference mockups
- design tokens, UI component contracts and UX patterns

### Identity/auth/lifecycle

- anonymous New Show gets temporary Owner/Master management grant
- magic-link primary account/claim flow
- social login later
- persistent member invites plus temporary scoped role links
- Board shares read-only/scoped by default
- persistent paired Device identity + revocable credential
- scoped API token per integration
- graceful 7-day anonymous expiry/cleanup
- separate Platform Admin with read-only support + audited impersonation

### Architecture/runtime

- TypeScript pnpm/Turborepo monorepo
- Next.js web
- Fastify API/realtime server
- mandatory application command layer
- PostgreSQL + Drizzle
- separate background worker
- timestamp-derived timers; no per-second server ticking
- one authoritative realtime server instance in V1
- no Redis until measured scaling requires it
- DEV/TST local/Claude + CI
- ACC and PRD as independent Docker Compose projects
- PostgreSQL container + named volume in each ACC/PRD project
- build once; promote exact images from ACC to PRD
- production deployment explicit/manual

## Next milestone

**M1 — Anonymous Quick Timer vertical slice** (see `ROADMAP.md`). Review M0 before starting.

## Decisions that do not block M1

- concrete magic-link/auth library;
- transactional email provider;
- production domain;
- object storage (only if/when uploaded Board assets enter scope);
- registry/reverse proxy details;
- backup target and retention;
- subscription/licensing model.

See `docs/OPEN_QUESTIONS.md`.
