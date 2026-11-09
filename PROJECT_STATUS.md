# Project status

## Phase

**M2 complete and approved (2026-11-09) — Queue operations.** OPEN_QUESTIONS #34-37 resolved in the review.

## M2 delivered

- Program Queue as a real rundown: multiple universal Queue Items (title, subtitle, notes, tags, optional timer, active/inactive, start mode, warning override, completed lifecycle, created/updated, revision) and one-level Groups (Group -> Queue Items). No Session/Cue/Timer hierarchy; Speaker/Note/Break/Timer are UI presets of the same item
- Queue commands through `packages/application` (`executeQueueCommand`): add, edit, delete, duplicate, move/reorder (also into/out of Groups), active/inactive, set current, END, END + NEXT, Group add/rename/delete/duplicate/move, warning overrides on Show/Queue/Item
- Current persisted per Queue, Next derived (first active, not completed item after Current); inactive items skipped
- STOP vs END kept separate: STOP only stops the timer; END completes the item (stopping a live timer as part of END, no `ended` timer state); END + NEXT moves Current and starts the next timer only with start mode "On previous END"
- warning thresholds: percent or absolute; inheritance Show default -> Queue override -> Queue Item override with visible source and Reset to inherited
- Operator View: large Current (title, subtitle, timer, state, thresholds + source, notes), Timer transport, ±10/±30 s, separate END and END + NEXT, Next card (duration, notes, AUTO-START), compact Queue preview with Go to / stop controls for other running timers
- Queue Editor (`/show/<id>/edit`): presets, inspector (title, subtitle, duration, start mode, notes, tags, group, active, warning override), duplicate, two-step delete, drag & drop reorder plus ↑/↓, Groups with collapse, Show/Queue warning settings
- Speaker Board follows Current automatically; items without timer show their title only; notes never reach Boards
- persistence: migration `0002_queue_operations`; atomic aggregate save (Queue revision + per-timer compare-and-set); restart/reload keeps order, Groups, current, completed, active, timers and overrides (tested)
- realtime: `queue.state` to operators and fresh `board.snapshot` per Queue change, timer transitions unchanged; client gating by Queue revision and timer revision
- capabilities `queue.read`, `queue.manage`, `item.control`, `show.manage`; board token can never mutate
- tests: 231 unit/component tests (domain 96, contracts 19, application 43, ui 16, server 23, worker 2, web 32), 12 PostgreSQL integration tests, 6 Playwright E2E (M1's 4 unchanged + rundown flow + Group/inheritance flow)

## Known limitations after M2

- No schedule fields, planned/projected/actual times, ahead/behind or Scheduled start (M3). Only the "On previous END" start mode exists.
- Notes are operator-only by rule; per-audience visibility (e.g. "Speaker Board hidden") comes with Boards/Audiences (M4). A current item without timer shows its title on the Speaker Board; the `notes` property never reaches Boards (OPEN_QUESTIONS #35).
- Tags are stored and editable as text but not used for filtering yet.
- Group collapse state is per browser and not shared.
- No locks yet: structural edits during a live show are guarded only by the safety rules (current/running items cannot be deleted) and revisions (M3).
- Keyboard shortcuts for live control are not defined yet.
- Single Program Queue only; no parallel discipline Queues or relations (M4/M5).

## M1 delivered

- anonymous New Show -> Quick Timer: Show + Program Queue + one timed Queue Item + Speaker Board, `expiresAt` = created + 7 days (cleanup not active yet)
- Operator View (`/show/<id>`): large timer, state/phase chips, Start/Pause/Resume/Stop/Restart, ±10/±30 s, duration set while idle/stopped, connection status + offline banner, Share Speaker Board, anonymous-expiry notice
- Speaker Board (`/b/<token>`): near-black, white normal digits, amber warning, red critical/overtime, PAUSED/STOPPED labels, progress, subtle RECONNECTING, fullscreen, wake lock
- authoritative state on one server; Socket.IO read channel; transitions only, no ticks; revision-gated client state; clock-offset estimation; local projection with `deriveTimer`
- owner credential (HttpOnly cookie) and separate read-only board credential, both hashed at rest; capability-based grant authorization
- PostgreSQL persistence (migration `0001_quick_timer`); Shows survive server restart (tested)
- design tokens generated from `docs/design/tokens.json`; self-hosted Inter/Roboto Mono
- tests: 141 unit/component tests (domain 52, contracts 10, application 25, ui 15, server 19, worker 2, web 18), 6 PostgreSQL integration tests, 4 Playwright E2E incl. server outage/restart

## Known limitations after M1

- (Resolved in M2: thresholds configurable with inheritance; END/NEXT, Queue editing, multiple items, Current/Next.)
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
- canonical production / public domain: `klockr.live` (configuration, never hardcoded in runtime code)

## Next milestone

**M3 — Scheduling + Master** (see `ROADMAP.md`). Start only on explicit instruction.

## Decisions that do not block M3

- concrete magic-link/auth library;
- transactional email provider;
- object storage (only if/when uploaded Board assets enter scope);
- registry/reverse proxy details;
- backup target and retention;
- subscription/licensing model.

See `docs/OPEN_QUESTIONS.md`.
