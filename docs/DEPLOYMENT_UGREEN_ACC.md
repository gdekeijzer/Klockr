# ACC deployment on the UGREEN NAS

ACC (pre-production) runs at **`https://acc.klockr.live`** as one Docker Compose project in the UGREEN NAS **Docker Composer**. The template is [`deploy/acc/compose.yml`](../deploy/acc/compose.yml). PRD (`https://klockr.live`) will later get its own stack, host directory, ports and credentials and run the **same images**.

```text
Cloudflare (DNS, TLS, WebSockets) ── Cloudflare Tunnel (outside this stack)
                                         │
acc.klockr.live                          │
├── /api/v1/*    → NAS:4100 → server:4000 ┐
├── /realtime/*  → NAS:4100 → server:4000 ├── klockr-acc stack
└── /*           → NAS:3100 → web:3000    ┘     db (no port) · migrate (one-shot) · worker (no port)
```

There is no reverse proxy or gateway container in the stack. The browser only uses same-origin relative URLs (`/api/v1`, `/realtime/`), so it works through the tunnel with no extra runtime configuration.

## Services

| Service   | Image                                     | Host port | Purpose                                                                   |
| --------- | ----------------------------------------- | --------- | ------------------------------------------------------------------------- |
| `db`      | `postgres:18`                             | —         | PostgreSQL 18, data and backups on NAS bind mounts, `pg_isready` health   |
| `migrate` | `ghcr.io/gdekeijzer/klockr-server`        | —         | one-shot `node dist/migrate.js` (Drizzle migrations), then exits 0        |
| `server`  | `ghcr.io/gdekeijzer/klockr-server`        | `4100`    | Fastify API `/api/v1`, Socket.IO `/realtime/`, health `/health`           |
| `worker`  | `ghcr.io/gdekeijzer/klockr-worker`        | —         | background housekeeping loop (no port, no health endpoint; logs a cycle) |
| `web`     | `ghcr.io/gdekeijzer/klockr-web`           | `3100`    | Next.js (Operator, Master, Boards), health `/healthz`                     |

Start order (enforced by `depends_on`): `db` healthy → `migrate` completed successfully → `server` + `worker` → `server` healthy → `web`. A failed migration leaves server, worker and web in `Created`; nothing is reset or recreated. Only `migrate` runs migrations (`MIGRATE_ON_START=false` on the server).

Networks: `internal` (no outside connectivity) carries all database traffic; `edge` carries the published ports and the web → server fallback. PostgreSQL is never published to the NAS/LAN.

## 1. Prepare directories (once)

```sh
mkdir -p /volume1/docker/klockr/db/data
mkdir -p /volume1/docker/klockr/db/backups
```

Only PostgreSQL has persistent host directories. Web, server and worker have no host mounts; their logs go to stdout/stderr (Docker/UGREEN keeps them).

## 2. Create the stack in UGREEN Docker Composer

1. Open **Docker** → **Composer** (Project).
2. Create a new project, e.g. `klockr-acc`, with path `/volume1/docker/klockr`.
3. Paste the full contents of `deploy/acc/compose.yml`.
4. Replace `CHANGE_ME_TO_A_LONG_RANDOM_PASSWORD` in **both** places (the `x-database-url` line and `POSTGRES_PASSWORD`) with the same long random password. Use letters and digits only, so the URL needs no encoding. Generate one with e.g. `openssl rand -hex 32`.
5. Check `KLOCKR_PUBLIC_URL: https://acc.klockr.live` (server and web) and `COOKIE_SECURE: 'true'`.
6. Optionally pin the images to a Git SHA (see Image versions).
7. Start or deploy the project.

The first start initialises an empty database. `migrate` then applies all migrations and the other services start. In the project view, `db`, `server` and `web` should show **healthy**, `worker` running, and `migrate` exited (0).

The PostgreSQL password is set only when the data directory is first initialised. Changing it later in the Compose file does not change it in the database.

## 3. Cloudflare Tunnel routes (outside this repository)

On the existing tunnel, add three public hostname rules for **`acc.klockr.live`**. **Order matters**: the first matching rule wins.

| # | Hostname          | Path          | Service (origin)          |
| - | ----------------- | ------------- | ------------------------- |
| 1 | `acc.klockr.live` | `^/api/v1/`   | `http://<NAS-IP>:4100`    |
| 2 | `acc.klockr.live` | `^/realtime/` | `http://<NAS-IP>:4100`    |
| 3 | `acc.klockr.live` | _(empty)_     | `http://<NAS-IP>:3100`    |

Notes:

- `/realtime/` carries Socket.IO (HTTP long-polling and WebSocket upgrade). Cloudflare Tunnel forwards WebSockets by default, so no extra option is needed. Keep the trailing slash in the pattern; the client uses `/realtime/`.
- The health endpoints `/health` (server) and `/healthz` (web) are for local checks on the NAS. Only `/healthz` is publicly reachable (rule 3).
- Fallback: if `/api/v1` or `/realtime` ever reach the web container, the web image rewrites them internally to `http://server:4000`. That is the Compose service name, baked in at image build and identical for ACC and PRD. The direct routes above are the intended path.
- For PRD later: the same three rules on `klockr.live`, pointing to the PRD stack's own ports.

## Configuration (inline, no `.env`)

| Variable              | Service(s)               | ACC value                                       | Notes                                                                 |
| --------------------- | ------------------------ | ----------------------------------------------- | --------------------------------------------------------------------- |
| `DATABASE_URL`        | migrate, server, worker  | `postgres://klockr:<password>@db:5432/klockr`   | same password as `POSTGRES_PASSWORD`                                  |
| `SERVER_HOST`         | server                   | `0.0.0.0`                                       | image default; listen on all container interfaces                    |
| `SERVER_PORT`         | server                   | `4000`                                          | container port (host 4100)                                            |
| `KLOCKR_PUBLIC_URL`   | server, web              | `https://acc.klockr.live`                       | validated by the server (must be a URL); PRD: `https://klockr.live`   |
| `COOKIE_SECURE`       | server                   | `true`                                          | HTTPS via Cloudflare → Secure credential cookies                      |
| `MIGRATE_ON_START`    | server                   | `false`                                         | migrations only via `migrate`                                         |
| `LOG_LEVEL`           | server, worker           | `info`                                          |                                                                       |
| `NODE_ENV`            | all app services         | `production`                                    |                                                                       |
| `TZ`                  | all                      | `Europe/Amsterdam`                              | `PGTZ` as well on `db`                                                |
| `KLOCKR_VERSION`      | images                   | Git SHA (set at build)                          | reported by `/health` and `/healthz`                                  |

`KLOCKR_SERVER_URL` is **not** a runtime variable. It is the build-time rewrite target of the web image (`http://server:4000`).

## Image versions

ACC may use `:latest` for quick tests. The reproducible variant, and the only one allowed for PRD, pins the Git SHA built by GitHub Actions:

```text
ghcr.io/gdekeijzer/klockr-web:<git-sha>
ghcr.io/gdekeijzer/klockr-server:<git-sha>     (server and migrate)
ghcr.io/gdekeijzer/klockr-worker:<git-sha>
```

Flow: **build once** (CI on `main`) → deploy those exact images to ACC → test/accept → promote the **same SHA** to PRD. PRD is never rebuilt.

The images are published for `linux/amd64`.

## Update / redeploy

Primary: in UGREEN Composer, pull the newer images and redeploy the project. `migrate` runs again and applies only pending migrations.

CLI alternative (in the project directory):

```sh
cd /volume1/docker/klockr
docker compose pull
docker compose up -d
```

## Status and logs

```sh
docker compose ps
docker compose logs -f
docker compose logs -f server
docker compose logs -f worker
docker compose logs -f web
docker compose logs -f migrate
```

Quick health checks on the NAS:

```sh
curl -s http://127.0.0.1:4100/health
curl -s http://127.0.0.1:4100/health/ready   # includes the database check
curl -s http://127.0.0.1:3100/healthz
```

## Stop

```sh
docker compose down
```

> **Never** run `docker compose down -v` out of habit, and **never** delete `/volume1/docker/klockr/db/data` by hand. That directory **is** the ACC database. A container may be recreated; this directory and the backups may not.

## Backup (logical, manual)

```sh
docker compose exec db sh -c 'pg_dump -U klockr -d klockr -Fc -f /backups/klockr-$(date +%Y%m%d-%H%M).dump'
ls -la /volume1/docker/klockr/db/backups
```

`/backups` in the container is `/volume1/docker/klockr/db/backups` on the NAS. Copy dumps off the NAS as well (backup destination, schedule and retention: OPEN_QUESTIONS #27). This slice has no automated backup service.

## Restore

Restore into an **empty** database. Stop the application first so nothing writes during the restore:

```sh
docker compose stop web server worker
docker compose exec db dropdb -U klockr klockr
docker compose exec db createdb -U klockr klockr
docker compose exec db pg_restore -U klockr -d klockr --no-owner /backups/<file>.dump
docker compose up -d
```

`migrate` then applies any migrations newer than the dump. To test a dump without touching the live database, restore it into a scratch database (`createdb -U klockr klockr_restore_test` … `dropdb …`).

## ACC versus PRD isolation

ACC and PRD never share a PostgreSQL instance or database, persistent storage, credentials or ports. They do share the **images** (same SHA). PRD gets its own Compose project (e.g. `klockr-prd`), its own host directory, its own password and `KLOCKR_PUBLIC_URL=https://klockr.live`. Production promotion is always an explicit, manual step.
