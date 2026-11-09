import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

/**
 * The browser only ever uses same-origin relative URLs (`/api/v1`, `/realtime/`).
 *
 * - Local DEV/TST: these rewrites proxy API and realtime traffic to apps/server so browsers see
 *   one origin (cookies stay first-party, no CORS).
 * - ACC/PRD: the Cloudflare Tunnel routes `/api/v1/*` and `/realtime/*` directly to the server
 *   container (docs/DEPLOYMENT_UGREEN_ACC.md). The rewrites are only a fallback for traffic that
 *   reaches the web container anyway.
 *
 * Next.js bakes rewrite destinations into the build. The production image is built once with
 * the Docker-internal default `http://server:4000` (the Compose service name in ACC and PRD), so
 * the image stays environment-independent.
 */
const serverUrl = process.env.KLOCKR_SERVER_URL ?? 'http://127.0.0.1:4000';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Workspace packages ship TypeScript source.
  transpilePackages: ['@klockr/contracts', '@klockr/domain', '@klockr/ui'],
  poweredByHeader: false,
  // Container builds produce a self-contained server (apps/web/Dockerfile); local `next start`
  // (used by E2E) keeps the regular output.
  ...(process.env.KLOCKR_STANDALONE === '1'
    ? {
        output: 'standalone' as const,
        outputFileTracingRoot: fileURLToPath(new URL('../../', import.meta.url)),
      }
    : {}),
  // Socket.IO uses `/realtime/` with a trailing slash; do not redirect it.
  skipTrailingSlashRedirect: true,
  rewrites() {
    return Promise.resolve([
      { source: '/api/v1/:path*', destination: `${serverUrl}/api/v1/:path*` },
      { source: '/realtime/', destination: `${serverUrl}/realtime/` },
      { source: '/realtime/:path*', destination: `${serverUrl}/realtime/:path*` },
    ]);
  },
};

export default nextConfig;
