# Project status

## Phase

**M1 complete (2026-11-09) — Anonymous Quick Timer vertical slice. Awaiting review before M2.**

## M1 delivered

- anonymous New Show -> Quick Timer: Show + Program Queue + one timed Queue Item + Speaker Board, `expiresAt` = created + 7 days (cleanup not active yet)
- Operator View (`/show/<id>`): large timer, state/phase chips, Start/Pause/Resume/Stop/Restart, ±10/±30 s, duration set while idle/stopped, connection status + offline banner, Share Speaker Board, anonymous-expiry notice
- Speaker Board (`/b/<token>`): near-black, white normal digits, amber warning, red critical/overtime, PAUSED/STOPPED labels, progress, subtle RECONNECTING, fullscreen, wake lock
- authoritative state on one server; Socket.IO read channel; transitions only, no ticks; revision-gated client state; clock-offset estimation; local projection with `deriveTimer`
- owner credential (HttpOnly cookie) and separate read-only board credential, both hashed at rest; capability-based grant authorization
- PostgreSQL persistence (migration `0001_quick_timer`); Shows survive server restart (tested)
- design tokens generated from `docs/design/tokens.json`; self-hosted Inter/Roboto Mono
- tests: 138 unit/component tests (domain 49, contracts 10, application 25, ui 15, server 19, worker 2, web 18), 6 PostgreSQL integration tests, 4 Playwright E2E incl. server outage/restart

## Known limitations after M1

- Warning/critical thresholds are provisional (05:00 / 01:00) and make short timers amber/red from the start — `OPEN_QUESTIONS.md` #5 needs a decision.
- No END/NEXT, Queue editing, multiple items, Current/Next (M2).
- Board links cannot be revoked from the UI yet; no PIN/expiry; no anonymous cleanup job; no "Claim Show".
- The owner credential is bound to one browser; clearing cookies loses control of the Show (by design until accounts/claim in M6).
- Rate limits and realtime state are in-process (single instance, as accepted for V1).
- Logo is a plain text label until the final SVG wordmark exists.

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

**M2 — Queue operations** (see `ROADMAP.md`). Review M1 before starting.

## Decisions that do not block M2

- concrete magic-link/auth library;
- transactional email provider;
- production domain;
- object storage (only if/when uploaded Board assets enter scope);
- registry/reverse proxy details;
- backup target and retention;
- subscription/licensing model.

See `docs/OPEN_QUESTIONS.md`.
