# Local development

Established in M0. Facts here describe the repository as built, not plans.

## Prerequisites

- Node.js 24 LTS (`.nvmrc`), pnpm 12 (`packageManager` field; `corepack enable` picks it up)
- Docker with Compose (either the `docker compose` plugin or standalone `docker-compose`; `scripts/compose.mjs` uses whichever exists)

## First run

```bash
pnpm install
cp .env.example .env
pnpm db:up        # PostgreSQL 18 on 127.0.0.1:54329 (port chosen to avoid clashing with other local Postgres)
pnpm db:migrate
pnpm dev          # web :3000, server :4000, worker
```

Open http://localhost:3000, create a Quick Timer, then open the Speaker Board link from the Operator View in another window or device. The web app proxies `/api/v1` and `/realtime` to the server (`KLOCKR_SERVER_URL`, Next rewrites); in ACC/PRD the reverse proxy does this.

Health endpoints:

- server: `GET http://127.0.0.1:4000/health` (liveness), `GET /health/ready` (includes DB check)
- web: `GET http://localhost:3000/healthz`

Screens: `/` (New Quick Timer), `/show/<showId>` (Operator View, owner cookie required), `/b/<board token>` (Speaker Board, read-only).

## Checks

```bash
pnpm check              # format:check, lint, typecheck, test, build
pnpm test:integration   # needs PostgreSQL (pnpm db:up)
pnpm test:e2e           # needs PostgreSQL and a build; port 4000 must be free
```

E2E (Playwright, `apps/web/e2e`) starts `next start` itself and launches the built API server per test file, so a test can stop and restart it (outage/reconnect + persistence). One-time browser install: `pnpm --filter @klockr/web exec playwright install chromium`.

Individual: `pnpm format`, `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`.

CI (`.github/workflows/ci.yml`) runs: frozen-lockfile install, format check, lint, typecheck, unit tests, migrations + integration tests against a PostgreSQL service, build.

## Package layout and build model

- `packages/*` are internal source packages: their `exports` point at TypeScript source. They are typechecked and tested but not compiled separately.
- `apps/server` and `apps/worker` bundle their workspace dependencies with tsup into `dist/main.js` (ESM, Node 24).
- `apps/web` compiles workspace packages through Next.js `transpilePackages`.
- Shared tsconfig presets and the ESLint config live in `packages/config` (`eslint.shared.js`).

ESLint enforces architecture boundaries: `packages/domain` may not import frameworks, persistence, Zod or other KLOCKR packages; `packages/application` may not import frameworks or adapters (`@klockr/db`, `@klockr/ui`); `packages/contracts` may not import `@klockr/db`.

## Database migration workflow

1. Change Drizzle schema in `packages/db/src/schema/`.
2. `pnpm db:generate` (runs `drizzle-kit generate`) and review the SQL in `packages/db/migrations/`.
3. `pnpm db:migrate` applies pending migrations (`packages/db/scripts/migrate.ts`, Drizzle migrator; safe to rerun).
4. Commit schema + generated SQL + `migrations/meta` together.

Never edit an applied migration; add a new one. Only add tables when the milestone that needs them is implemented.

Current migrations: `0000_bootstrap` (`system_meta`, infrastructure-only), `0001_quick_timer` (M1 tables, see `DATA_MODEL.md`).

The server build copies `packages/db/migrations` to `apps/server/dist/migrations`; with `MIGRATE_ON_START=true` the server applies them at startup (local/E2E convenience). ACC/PRD migrate as an explicit release step.

## Dependency build scripts

pnpm blocks dependency install scripts by default. Allowed ones are listed under `allowBuilds` in `pnpm-workspace.yaml` (currently `esbuild`).
