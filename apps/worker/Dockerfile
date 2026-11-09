# KLOCKR worker image (background housekeeping; never on the live timing path).
# Build context: repository root.
#   docker build -f apps/worker/Dockerfile -t ghcr.io/gdekeijzer/klockr-worker:dev .

ARG NODE_IMAGE=node:24-alpine

FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    TURBO_TELEMETRY_DISABLED=1 \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
RUN pnpm fetch --frozen-lockfile
COPY . .
RUN pnpm install --offline --frozen-lockfile
RUN pnpm turbo run build --filter=@klockr/worker
# Production-only dependency tree for this app (workspace packages are bundled into dist).
RUN pnpm --filter @klockr/worker deploy --prod --legacy /out \
 && rm -rf /out/src /out/*.test.ts /out/tsconfig*.json /out/vitest*.ts /out/tsup.config.ts /out/Dockerfile \
 && rm -rf /out/dist && cp -R apps/worker/dist /out/dist

FROM ${NODE_IMAGE} AS runtime
ARG KLOCKR_VERSION=0.0.0-dev
LABEL org.opencontainers.image.source="https://github.com/gdekeijzer/Klockr" \
      org.opencontainers.image.title="klockr-worker" \
      org.opencontainers.image.description="KLOCKR background worker" \
      org.opencontainers.image.licenses="UNLICENSED"
ENV NODE_ENV=production \
    KLOCKR_VERSION=${KLOCKR_VERSION}
WORKDIR /app
COPY --from=build /out ./
USER node
# No port and no health endpoint: the worker is a loop that logs each cycle to stdout.
CMD ["node", "--enable-source-maps", "dist/main.js"]
