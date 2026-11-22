// Rendering per route (ADR 0008) and response headers (web-hosting spec).
// Every specific rule repeats the security headers, so they never depend on rule merging.
const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
}

const playground = {
  ssr: false,
  headers: { ...securityHeaders, 'X-Robots-Tag': 'noindex' },
}

export default defineNuxtConfig({
  compatibilityDate: '2026-11-21',
  telemetry: false,
  devtools: { enabled: false },
  css: ['~/assets/css/main.css'],
  routeRules: {
    '/**': { headers: securityHeaders },
    '/playground': playground,
    '/playground/**': playground,
    '/api/health': { headers: { ...securityHeaders, 'Cache-Control': 'no-store' } },
  },
})
