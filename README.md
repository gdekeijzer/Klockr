# KLOCKR — Claude Code bootstrap v1.0

This repository is the approved product, UX and technical baseline for **KLOCKR**, a professional StageTimer / show-control web application.

> A Queue contains what is happening. A timer is one optional property of a Queue Item. The Show owns the live state. Boards determine what people see.

A first-time user must be able to start a useful timer within seconds, while the same model scales to multi-queue, multi-room and multi-device live productions.

## Status

**M0 (repository bootstrap + timer kernel) complete.** See `PROJECT_STATUS.md` and `docs/DEVELOPMENT.md` to run it locally.

Product behavior, design direction, architecture boundaries, identity model and environment strategy have been agreed. Remaining open questions are intentionally deferred until the feature that needs them.

## Before coding

Claude Code must read `CLAUDE.md`.

Human orientation:

1. `PROJECT_STATUS.md`
2. `docs/PRODUCT_PRINCIPLES.md`
3. `docs/FUNCTIONAL_DESIGN.md`
4. `docs/DESIGN_SYSTEM.md`
5. `docs/TECHNICAL_ARCHITECTURE.md`
6. `docs/IDENTITY_AUTH_LIFECYCLE.md`
7. `docs/DEPLOYMENT_RUNTIME.md`
8. `docs/IMPLEMENTATION_PLAN.md`
9. `docs/prompts/M0_BOOTSTRAP.md`

## Accepted implementation baseline

- TypeScript strict monorepo
- pnpm + Turborepo
- Next.js/React `apps/web`
- Fastify API/realtime `apps/server`
- background `apps/worker`
- mandatory `packages/application` command/use-case layer
- pure `packages/domain`
- shared validated `packages/contracts`
- PostgreSQL + Drizzle
- Socket.IO-class realtime transport
- Vitest + Playwright
- timestamp-derived timers; no per-second server tick persistence/broadcast
- one authoritative realtime server instance in V1; no Redis by default

## Identity baseline

- anonymous New Show: browser-held secret management grant with temporary Owner/Master control;
- account claim/login: email magic link;
- social login: later option;
- persistent member invitations + temporary scoped role links;
- Board shares: scoped/read-only by default;
- paired Devices: persistent revocable credentials;
- API clients: separate scoped tokens;
- Platform Admin: read-only support context plus explicit audited impersonation.

## Environment/release baseline

```text
DEV/TST (Claude/local + CI)
  -> build immutable images
  -> ACC (separate Docker Compose + Postgres)
  -> acceptance
  -> manual promotion of exact same images
  -> PRD (separate Docker Compose + Postgres)
```

Local development does not require running Next.js in Docker. ACC/PRD use independent Compose projects on the dedicated server.

## M0

Start with the prompt in:

- `docs/prompts/M0_BOOTSTRAP.md`
- or `.claude/commands/start-m0.md`

M0 creates the repository/tooling/domain/application kernel. It does **not** build the polished UI yet.

## Visual direction

KLOCKR is dark-first for live-production environments. Blue is product/information; green, amber and red communicate operational state. Normal Speaker/Confidence timer output is calm white/light gray until warning/critical/overtime state requires stronger color.

Reference assets: `docs/design/assets/`.

## Functional source

- `docs/FUNCTIONAL_DESIGN.md`
- `docs/source/Functioneel_Ontwerp_StageTimer_Show_Control_v0.2.rtf`

## License

No software license has been selected. Do not add one without an explicit decision.
