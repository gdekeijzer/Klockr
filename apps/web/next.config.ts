import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Workspace packages ship TypeScript source.
  transpilePackages: ['@klockr/contracts', '@klockr/ui'],
  poweredByHeader: false,
};

export default nextConfig;
