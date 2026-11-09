# KLOCKR server image (Fastify API + Socket.IO realtime + one-shot migrations).
# Build context: repository root.
#   docker build -f apps/server/Dockerfile -t ghcr.io/gdekeijzer/klockr-server:dev .
# Run:        node dist/main.js     (default CMD)
# Migrations: node dist/migrate.js  (Compose `migrate` service, same image)

ARG NODE_IMAGE=node:24-alpine

FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    TURBO_TELEMETRY_DISABLED=1 \
    NEXT_TELEMETRY_DISABLED=1 \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo

FROM base AS build
# Dependency layer: only the lockfile and workspace manifest (cached until they change).
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
RUN pnpm fetch --frozen-lockfile
COPY . .
RUN pnpm install --offline --frozen-lockfile
RUN pnpm turbo run build --filter=@klockr/server
# Production-only dependency tree for this app (workspace packages are bundled into dist).
RUN pnpm --filter @klockr/server deploy --prod --legacy /out \
 && rm -rf /out/src /out/*.test.ts /out/tsconfig*.json /out/vitest*.ts /out/tsup.config.ts /out/Dockerfile \
 && rm -rf /out/dist && cp -R apps/server/dist /out/dist

FROM ${NODE_IMAGE} AS runtime
ARG KLOCKR_VERSION=0.0.0-dev
LABEL org.opencontainers.image.source="https://github.com/gdekeijzer/Klockr" \
      org.opencontainers.image.title="klockr-server" \
      org.opencontainers.image.description="KLOCKR API, realtime and migrations" \
      org.opencontainers.image.licenses="UNLICENSED"
ENV NODE_ENV=production \
    SERVER_HOST=0.0.0.0 \
    SERVER_PORT=4000 \
    KLOCKR_VERSION=${KLOCKR_VERSION}
WORKDIR /app
# Root-owned, read-only for the runtime user.
COPY --from=build /out ./
USER node
EXPOSE 4000
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=5 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.SERVER_PORT||4000)+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "--enable-source-maps", "dist/main.js"]
