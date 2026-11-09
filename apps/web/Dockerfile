# KLOCKR web image (Next.js standalone server).
# Build context: repository root.
#   docker build -f apps/web/Dockerfile -t ghcr.io/gdekeijzer/klockr-web:dev .
#
# The image is environment-independent (identical on ACC and PRD). The only build-time value is
# the Docker-internal fallback target for /api/v1 and /realtime rewrites: the Compose service
# `server` on port 4000. Public routing is done by the Cloudflare Tunnel, not by this container.

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
ARG KLOCKR_SERVER_URL=http://server:4000
ENV KLOCKR_SERVER_URL=${KLOCKR_SERVER_URL} \
    KLOCKR_STANDALONE=1
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
RUN pnpm fetch --frozen-lockfile
COPY . .
RUN pnpm install --offline --frozen-lockfile
RUN pnpm turbo run build --filter=@klockr/web

FROM ${NODE_IMAGE} AS runtime
ARG KLOCKR_VERSION=0.0.0-dev
LABEL org.opencontainers.image.source="https://github.com/gdekeijzer/Klockr" \
      org.opencontainers.image.title="klockr-web" \
      org.opencontainers.image.description="KLOCKR web (Operator, Master, Boards)" \
      org.opencontainers.image.licenses="UNLICENSED"
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    KLOCKR_VERSION=${KLOCKR_VERSION}
WORKDIR /app
# Standalone output keeps the monorepo layout (apps/web/server.js); static assets are copied in.
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=5 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "apps/web/server.js"]
