import type { NextConfig } from 'next';

/**
 * Local DEV/TST: the web app proxies API and realtime traffic to apps/server so browsers see one
 * origin (cookies stay first-party, no CORS). In ACC/PRD the reverse proxy does this routing.
 */
const serverUrl = process.env.KLOCKR_SERVER_URL ?? 'http://127.0.0.1:4000';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Workspace packages ship TypeScript source.
  transpilePackages: ['@klockr/contracts', '@klockr/domain', '@klockr/ui'],
  poweredByHeader: false,
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
