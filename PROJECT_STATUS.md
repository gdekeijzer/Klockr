# Project status

## Phase

**M0 complete (2026-11-09) — ready for M1 review.**

Repository, tooling and the timer domain/application kernel exist and pass all checks. No product UI exists yet.

## M0 delivered

- pnpm 12 + Turborepo monorepo: `apps/{web,server,worker}`, `packages/{domain,application,contracts,db,ui,config}`
- strict TypeScript 6.0 everywhere; ESLint enforces domain/application framework independence
- pure timer kernel (`packages/domain`): timer states `idle | running | paused | stopped` with start (restart after stop)/pause/resume/stop/adjust/configure, derived remaining/overtime, `Clock` + `ManualClock`, branded IDs, `Result`
- application command layer (`packages/application`): command envelope (`commandId`, `idempotencyKey`, `expectedRevision`), typed `AppError`, ports (`TimerRepository` with compare-and-set, `IdempotencyStore`, `Authorizer` with capability checks, `EventPublisher`), `executeTimerCommand`, in-memory adapters
- Zod contracts (`packages/contracts`): timer command DTOs, timer snapshot with `serverTime` + `revision`, error and health responses
- Drizzle + PostgreSQL (`packages/db`): client, migrator, one infrastructure-only migration `0000_bootstrap`
- server: Fastify `/health` and `/health/ready`; worker: isolated job runner with empty job registry; web: Next.js placeholder page + `/healthz`
- local PostgreSQL via `compose.dev.yaml` (host port 54329); CI workflow in `.github/workflows/ci.yml`
- tests: 62 unit tests (domain 34, contracts 10, application 12, ui 1, server 3, worker 2) + 2 PostgreSQL integration tests
- versions and commands: `docs/TECHNICAL_ARCHITECTURE.md` (Selected versions), `docs/DEVELOPMENT.md`

## Known gaps / notes after M0

- M0 review (2026-11-09) applied: timer `ended` state and timer END command removed; END / NEXT becomes the Queue Item command `EndItem`, introduced with Queue Items. START after STOP = restart; adjustment crosses zero both ways. `OPEN_QUESTIONS.md` #31-33 resolved.
- Repository on GitHub: `gdekeijzer/Klockr`, pushed directly to `main`. The first CI run on GitHub has not been verified from here.
- Files missing from the delivered package (`.claude/commands/*`, `.github/PULL_REQUEST_TEMPLATE.md`) were recreated as thin pointers; `.env.example`, `.gitignore` and `.editorconfig` were written new in M0. `MANIFEST.md` lists M0 additions.
- Prettier ignores Markdown/docs; documentation is only edited deliberately. (The initial M0 commit had already reformatted existing docs with Prettier; formatting only.)

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
