import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  turbopack: {},
  // Enforce request body size limits (default is 1MB; explicit is safer)
  experimental: {
    serverActions: {
      bodySizeLimit: '1mb',
    },
  },
}

export default nextConfig
