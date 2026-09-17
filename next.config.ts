import type { NextConfig } from 'next'

const SECURITY_HEADERS = [
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
  { key: 'X-DNS-Prefetch-Control', value: 'on' },
]

const config: NextConfig = {
  // @napi-rs/canvas (src/lib/chart/render.ts) ships a native .node binary.
  // Webpack cannot bundle that — it tries to parse it as JS and fails the
  // build ("Unexpected character") — so this package must be excluded from
  // the server bundle and required at runtime via Node's own require()
  // instead, the standard fix for native addons in Next 15 route handlers.
  serverExternalPackages: ['@napi-rs/canvas'],
  async headers() {
    return [{ source: '/:path*', headers: SECURITY_HEADERS }]
  },
}

export default config
