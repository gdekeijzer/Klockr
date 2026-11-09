# Changelog

## M3 — 2026-11-10 — Scheduling + Master

- review: M3 approved; OPEN_QUESTIONS #41 (Strict never projects an explicitly planned item earlier) and #42 (timer duration = planned duration; live adjustments never change it) resolved.

- domain: schedule engine (`calculateSchedule`, `classifyOffset`) with Planned / Projected / Actual, Strict / Sliding, fixed anchors, recovery-to-anchor, soft scheduled start; schedule operations (`setItemSchedule`, `setQueueTimingMode`, `setShowSchedule`, `transitionItemTimer`); locks with inheritance (`effectiveLock`, `setLock`, `releaseLock`, `requestUnlock`); actual start/end recorded by START/current/END; capabilities `schedule.*`, `lock.*`, `audit.read`;
- application: `mutateQueue` as the single aggregate mutation path for Queue AND timer commands (lock gate, audited Emergency Override, audit records in the same transaction); new commands `item.setSchedule`, `queue.setTimingMode`, `show.setSchedule`, `lock.set`, `lock.release`, `lock.requestUnlock`; `getAuditTrail`;
- contracts: schedule/lock/audit DTOs, `override` envelope, error `locked`;
- db: migrations `0003_scheduling_locks`, `0004_audit_sequence`; locks, unlock requests and audit in `saveQueue`;
- server: `GET /api/v1/shows/:showId/audit`, `423 locked`;
- web: Master View (tree, rundown with planned/projected/shift/status/anchor/lock, inspector with Planned/Projected/Actual, locks, timing settings, audit), Operator schedule bar and schedule facts, `/edit` → `/master`;
- tests: 286 unit/component, 16 PostgreSQL integration, 8 Playwright E2E (M3 flow + scheduled warning);
- docs: scheduling/lock/audit implementation, API/realtime/security/data-model M3 sections, OPEN_QUESTIONS #6-8 baselines and #38-42.

## M2 — 2026-11-09 — Queue operations

- review: M2 approved; OPEN_QUESTIONS #34-37 resolved (Next skips completed items; Note title may show on the Speaker Board, `notes` never; Group collapse is local UI state; `on_previous_end` stays a Queue Item property).

- domain: Queue aggregate with one-level Groups, universal Queue Item (subtitle, notes, tags, active, completedAt, startMode, warning override, created/updated, revision), dense ordering (`layoutOf`/`orderedItems`), derived `nextItem` and lifecycle, pure operations incl. `endItem` (END / END + NEXT, stops a live timer as part of END, starts the next timer only with start mode `on_previous_end`), percent **and** absolute thresholds with `resolveItemThresholds` (Show -> Queue -> Item); capabilities `queue.read`, `queue.manage`, `item.control`, `show.manage`;
- application: `executeQueueCommand` (permission per command, idempotency, expected Queue revision, automatic re-evaluation of lost races, `queue.changed` events), `QueueRepository` port with atomic `saveQueue`, Queue/Board projections;
- contracts: Queue command DTOs, Queue/Board snapshots, `showCommandSchema` for the shared commands endpoint, `queue.state` realtime event;
- db: migration `0002_queue_operations` (queue_groups; Queue/Item/Show columns; data migration for M1 Shows) and transactional diff-based `saveQueue`;
- server: Queue commands on `/api/v1/shows/:showId/commands`, per-audience realtime rooms, Board projection pushed on every Queue change;
- web: Operator View rebuilt around Current / Next / Queue preview with separate END and END + NEXT, Queue Editor (`/show/<id>/edit`) with presets, inspector, drag & drop, Groups and inherited warning settings, Speaker Board follows Current;
- tests: 231 unit/component, 12 PostgreSQL integration (incl. atomic END + NEXT and restart reload), 6 Playwright E2E;
- docs: canonical production domain `klockr.live` recorded (CLAUDE.md, README, TECHNICAL_ARCHITECTURE, DEPLOYMENT_RUNTIME, OPEN_QUESTIONS #1/#24; `KLOCKR_PUBLIC_URL` config, no hardcoded domain in runtime code); Queue implementation notes, END-with-live-timer decision, threshold inheritance, API/realtime/security/data-model M2 sections, OPEN_QUESTIONS #34-37.

## M1 — 2026-11-09 — Anonymous Quick Timer vertical slice

- domain: `createQuickTimerShow` (anonymous Show, Program Queue, timed Queue Item, Speaker Board, 7-day expiry), access grants with capability bundles and scope (`grantPermits`), derived `timerPhase` with percentage-based KLOCKR defaults (warning <= 20 %, critical <= 5 % of configured duration; OPEN_QUESTIONS #5 resolved);
- application: `createQuickTimer`, `createBoardShare`, `getShowState`, `getBoardState`, `runShowTimerCommand`, `timer.configure`, `authenticateToken`, `GrantAuthorizer`; events carry `showId`;
- contracts: Show/Board snapshots, create/share DTOs, typed realtime event maps;
- db: migration `0001_quick_timer` (shows, queues, queue_items, item_timers, boards, access_grants, idempotency_records) and PostgreSQL repositories (compare-and-set timer writes, durable idempotency);
- server: HTTP API (`/api/v1/shows`, `/state`, `/commands`, `/board-shares`, `/board/state`), HttpOnly owner cookie, hashed type-prefixed tokens, rate limits, log redaction, Socket.IO realtime read channel with snapshot-on-connect, migrations shipped with the bundle;
- web: New Quick Timer page, Operator View, Speaker Board, revision-gated realtime client with clock-offset estimation and offline projection; tokens generated from `docs/design/tokens.json`; self-hosted fonts;
- tests: 141 unit/component, 6 PostgreSQL integration, 4 Playwright E2E (sync flow, server outage + restart, invalid board link, foreign browser); E2E added to CI;
- docs: realtime/API/security/data-model implementation sections, development guide, default thresholds documented in TIMER_ENGINE.md.

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
