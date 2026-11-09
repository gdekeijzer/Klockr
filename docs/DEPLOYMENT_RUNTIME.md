# Deployment and runtime environments

**Status: Accepted baseline.**

## Environment flow

```text
DEV / TST
   -> CI build/test
   -> immutable application images
   -> ACC
   -> acceptance + smoke/realtime/migration checks
   -> manual promotion of the same images
   -> PRD
```

## DEV / TST

Development is optimized for Claude Code and local iteration.

Recommended workflow:

- run `apps/web`, `apps/server` and `apps/worker` directly via pnpm/Turborepo during development;
- run local PostgreSQL (and optional mail catcher) with Docker Compose;
- use deterministic test clocks and seeded fixtures;
- run lint/typecheck/unit/integration/E2E before promotion.

Dockerizing Next.js locally is optional, not a development requirement.

## ACC

ACC is a separate Docker Compose project on the dedicated server.

Expected services:

```text
klockr-acc
  web
  server
  worker
  postgres
```

It has its own:

- `.env` / secrets;
- hostname;
- Compose project name;
- PostgreSQL named volume;
- backup target;
- logs;
- migrations.

ACC is where deploy, migration, realtime, reconnect and acceptance smoke tests are performed against the actual container topology.

## PRD

PRD is another independent Docker Compose project:

```text
klockr-prd
  web
  server
  worker
  postgres
```

PRD has completely separate secrets, database volume and hostname. The PRD hostname is the canonical public domain **`klockr.live`** (`https://klockr.live/`, with `/api/v1` and `/realtime` routed by the reverse proxy to the server).

## Public URL configuration

Images are identical on ACC and PRD, so nothing environment-specific is baked in:

| Variable | ACC | PRD | Local |
| --- | --- | --- | --- |
| `KLOCKR_PUBLIC_URL` (absolute links without a request origin, e.g. future e-mails) | ACC URL (tbd, `OPEN_QUESTIONS.md` #24) | `https://klockr.live` | `http://localhost:3000` |
| `COOKIE_SECURE` | `true` | `true` | `false` |

The web app itself uses relative routes and the request origin; `klockr.live` is never hardcoded in runtime code.

Deployment to PRD requires an explicit promotion action. Claude Code must not silently deploy production as a side effect of implementation.

## Build once, promote exact artifacts

A release build produces immutable web/server/worker images tagged by a stable release identifier and preferably addressable by digest.

ACC tests those images. PRD uses the exact same image digests/tags. Do not rebuild between ACC acceptance and PRD promotion.

## Database

PostgreSQL runs as a service inside each ACC/PRD Compose project.

Required operational properties:

- persistent named volume;
- backups stored outside the database volume;
- scheduled backup verification;
- documented restore procedure;
- migration history in source control;
- pre-deploy migration compatibility review;
- stable NTP/system time on the host.

A database container may be recreated; the data volume/backups are not disposable.

## Reverse proxy

The dedicated server may use an existing nginx/Caddy/Traefik reverse proxy outside the KLOCKR Compose projects. Route each environment to its web/server services and support websocket upgrades/long-lived connections.

## Redis

No Redis in V1 by default. One authoritative realtime server instance runs per environment. Introduce shared pub/sub only after a measured requirement.

## Worker

Background worker is a separate service/container so cleanup, mail and housekeeping cannot block the live server path.

## Release safety

Before PRD promotion:

1. CI green;
2. images built and immutable;
3. ACC deployed successfully;
4. migrations applied successfully on ACC;
5. smoke tests pass;
6. Quick Timer/operator/Board realtime flow passes;
7. reconnect test passes;
8. acceptance confirmed;
9. same image versions promoted to PRD;
10. PRD smoke/health checks run after deployment.

For later mature production, consider a deployment guard that reports active live Shows before restart. Do not invent automatic forced restarts during a live production.
